import type {
    AssistantPart,
    AssistantToolPart,
    ChatMessage,
    ChatToolCall,
    TaskStatus,
    TurnUsage,
    UserReference,
} from '@/shared/contracts/session-messages';
/*
* 缺文件
* 缺文件
* 缺文件
* 缺文件

*/
import { redactText, redactValue } from '@/shared/contracts/policy';

export type AssistantBlock =
    | { type: 'thinking'; text: string }
    | { type: 'text'; text: string }
    | { type: 'tools'; tools: AssistantToolPart[] };

function asToolPart(tool: ChatToolCall): AssistantToolPart {
    return { type: 'tool', ...tool };
}

function hasToolId(parts: AssistantPart[], id: string): boolean {
    return parts.some((part) => part.type === 'tool' && part.id === id);
}

function syncDerived(message: ChatMessage, parts: AssistantPart[]): ChatMessage {
    return {
        ...message,
        parts,
        content: parts
            .filter((part): part is Extract<AssistantPart, { type: 'text' }> => part.type === 'text')
            .map((part) => part.text)
            .join(''),
        thinking: parts
            .filter((part): part is Extract<AssistantPart, { type: 'thinking' }> => part.type === 'thinking')
            .map((part) => part.text)
            .join(''),
        tools: parts.filter((part): part is AssistantToolPart => part.type === 'tool'),
    };
}

export function messageParts(message: ChatMessage): AssistantPart[] {
    if (message.parts?.length) return message.parts;
    return [
        ...(message.thinking ? [{ type: 'thinking' as const, text: message.thinking }] : []),
        ...(message.tools ?? []).map(asToolPart),
        ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
    ];
}



export function shouldHoldToolGroupOpen(streaming: boolean, followingBlocks: AssistantBlock[]): boolean {
    if (!streaming) return false;
    return !followingBlocks.some((block) => block.type === 'text' && Boolean(block.text.trim()));
}



export function appendAssistantTool(message: ChatMessage, tool: ChatToolCall): ChatMessage {
    const parts = [...messageParts(message)];
    if (hasToolId(parts, tool.id)) return message;
    parts.push(asToolPart(tool));
    return syncDerived(message, parts);
}

export function updateAssistantTool(
    message: ChatMessage,
    id: string,
    patch: Partial<Pick<ChatToolCall, 'status' | 'output' | 'args' | 'name' | 'elapsedMs'>>,
): ChatMessage {
    const parts = messageParts(message);
    if (!hasToolId(parts, id)) return message;
    return syncDerived(
        message,
        parts.map((part) => (part.type === 'tool' && part.id === id ? { ...part, ...patch } : part)),
    );
}




function isEmptyArgs(args: unknown): boolean {
    if (args == null) return true;
    if (typeof args === 'string') {
        const trimmed = args.trim();
        return !trimmed || trimmed === '{}' || trimmed === '[]' || trimmed === 'null';
    }
    if (Array.isArray(args)) return args.length === 0;
    if (typeof args === 'object') return Object.keys(args).length === 0;
    return false;
}

function mergeToolStatus(current?: TaskStatus, incoming?: TaskStatus): TaskStatus {
    if (current === 'done' || current === 'error') return current;
    if (incoming === 'done' || incoming === 'error') return incoming ?? current ?? 'running';
    if (current === 'running' || incoming === 'running') return 'running';
    return incoming ?? current ?? 'running';
}



export function applyAssistantToolResult(
    messages: ChatMessage[],
    id: string,
    status: Extract<TaskStatus, 'done' | 'error'>,
    output: string,
    elapsedMs?: number,
): ChatMessage[] {
    return messages.map((item) =>
        updateAssistantTool(item, id, {
            status,
            output: redactText(output),
            ...(elapsedMs == null ? {} : { elapsedMs }),
        }),
    );
}



export function settleAssistantTools(
    message: ChatMessage,
    status: Extract<TaskStatus, 'done' | 'error'> = 'done',
): ChatMessage {
    const parts = messageParts(message);
    if (!parts.some((part) => part.type === 'tool' && (part.status === 'running' || part.status === 'pending'))) {
        return message;
    }
    return syncDerived(
        message,
        parts.map((part) =>
            part.type === 'tool' && (part.status === 'running' || part.status === 'pending')
                ? { ...part, status }
                : part,
        ),
    );
}

export function settleAssistantMessages(
    messages: ChatMessage[],
    status: Extract<TaskStatus, 'done' | 'error'> = 'done',
): ChatMessage[] {
    let changed = false;
    const next = messages.map((message) => {
        const settled = settleAssistantTools(message, status);
        if (settled !== message) changed = true;
        return settled;
    });
    return changed ? next : messages;
}

export function formatReferencesPrompt(references?: UserReference[]): string {
    if (!references || references.length === 0) return '';
    const blocks: string[] = [];

    for (const ref of references) {
        if (ref.type === 'page') {
            const parts: string[] = [];
            parts.push(`- tabId: ${ref.tabId}`);
            parts.push(`- title: ${ref.title}`);
            parts.push(`- url: ${ref.url || '未知 URL'}`);
            if (ref.active) parts.push('- active: true');
            if (ref.error) parts.push(`- error: ${ref.error}`);
            if (ref.content) {
                parts.push(`- content:\n${ref.content}`);
            }
            blocks.push(`<reference_page>\n${parts.join('\n')}\n</reference_page>`);
        } else if (ref.type === 'command') {
            const parts: string[] = [];
            parts.push(`用户明确选择了命令 /${ref.key}（${ref.name}）。`);
            if (ref.desc) parts.push(`说明：${ref.desc}`);
            parts.push('必须结合用户当前补充要求，按照以下命令说明执行；不要向用户复述整段说明。');
            parts.push('<command_instructions>');
            parts.push(ref.prompt);
            parts.push('</command_instructions>');
            blocks.push(`<reference_command>\n${parts.join('\n')}\n</reference_command>`);
        } else if (ref.type === 'element') {
            const parts: string[] = [];
            if (ref.name) parts.push(`- name: ${ref.name}`);
            if (ref.tag) parts.push(`- tag: ${ref.tag}`);
            if (ref.element != null) {
                parts.push(`- detail:\n${typeof ref.element === 'string' ? ref.element : JSON.stringify(ref.element, null, 2)}`);
            }
            blocks.push(`<reference_element>\n${parts.join('\n')}\n</reference_element>`);
        }
    }

    if (blocks.length === 0) return '';
    return `<runtime_context>\n${blocks.join('\n')}\n</runtime_context>`;
}

export function formatUserMessageContent(
    content: string,
    references?: UserReference[],
    rawContext?: string,
): string {
    const runtimeContext = formatReferencesPrompt(references);
    const extraContext = rawContext?.trim() ? `<runtime_context>\n${rawContext.trim()}\n</runtime_context>` : '';
    const prefix = runtimeContext || extraContext;
    if (!prefix) return content;
    return content ? `${prefix}\n${content}` : prefix;
}



export function modelUserContent(
    prompt: string,
    imageDataUrl?: string,
    references?: UserReference[],
    rawContext?: string,
) {
    const formattedPrompt = formatUserMessageContent(prompt, references, rawContext);
    if (!imageDataUrl) return formattedPrompt;
    return [
        { type: 'text' as const, text: formattedPrompt },
        {
            type: 'image_url' as const,
            image_url: { url: imageDataUrl },
        },
    ];
}
