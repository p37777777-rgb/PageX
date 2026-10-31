/*消息内容的读写工具：统一处理字符串和内容块数组两种形态，
让 token 估算、记录格式化和摘要合并都不必关心各家模型的内容格式差异。*/
import { AIMessage, type BaseMessage, type MessageContent } from '@langchain/core/messages';

/** 不计入正文的内容块：思考过程和工具调用会单独处理，图片只计数。 */
const NON_TEXT_PART_TYPES = new Set([
    'reasoning',
    'thinking',
    'redacted_thinking',
    'reasoning_content',
    'tool_use',
    'tool_call',
    'tool_call_chunk',
    'image_url',
    'image',
]);

function partType(part: unknown): string {
    return part && typeof part === 'object' ? String((part as { type?: unknown }).type ?? '') : '';
}

/** 取出内容里的可见正文，跳过思考、工具调用和图片块。 */
export function contentText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .map((part) => {
            if (typeof part === 'string') return part;
            if (!part || typeof part !== 'object' || NON_TEXT_PART_TYPES.has(partType(part))) return '';
            const text = (part as { text?: unknown }).text;
            return typeof text === 'string' ? text : '';
        })
        .join('');
}

export function countImageParts(content: unknown): number {
    if (!Array.isArray(content)) return 0;
    return content.filter((part) => {
        const type = partType(part);
        return type === 'image_url' || type === 'image';
    }).length;
}

/** AI 消息里的工具调用，渲染成 `name(args)` 文本，供 token 估算和摘要记录使用。 */
export function toolCallsText(message: BaseMessage): string {
    if (!AIMessage.isInstance(message) || !message.tool_calls?.length) return '';
    return message.tool_calls
        .map((call) => {
            let args = '';
            try {
                args = JSON.stringify(call.args ?? {});
            } catch {
                args = String(call.args);
            }
            return `${call.name}(${args})`;
        })
        .join('\n');
}

/** 在内容最前面插入一段文字；保持原来的字符串/数组形态，因为部分服务商不接受纯文本消息用数组。 */
export function prependText(content: MessageContent, prefix: string): MessageContent {
    if (typeof content === 'string') return content ? `${prefix}\n\n${content}` : prefix;
    return [{ type: 'text', text: prefix }, ...content];
}
