/*一次任务的总循环。创建模型，装上工具和中间层，跑流式输出，把事件交给会话，
并在关键步骤写下检查点。完成、中断或出错都要有明确结束，不要留下仍标记为运行中的会话。*/
import { createAgent, type AgentMiddleware } from 'langchain';
import { createChatModel } from './models';
import { createSafetyMiddleware, raceAbort, withAbort } from './middleware';
import { createAgentTools, type ToolBridge } from './tools/index';
import { buildSystemPrompt } from './prompts';
import { checkpointKey, clearCheckpoint, saveCheckpoint } from '@/features/agent/session/checkpoint';
import { applyTokenDelta, createStreamToolState, interpretStreamChunk } from './stream';
import { loadSecrets, loadSettings } from '@/shared/storage/storage';
import { toUserErrorMessage } from '@/shared/contracts/errors';
import { toolLabel } from '@/features/agent/session/tool-display';
import { nowId } from '@/shared/utils/utils';
import { redactText } from '@/shared/contracts/policy';
import {
    applyAssistantThinking,
    applyAssistantToken,
    applyAssistantToolResult,
    applyAssistantToolStart,
    applyAssistantUsage,
    modelUserContent,
    toModelMessages,
} from '@/features/agent/session/messages';
import { emptyTurnUsage, extractTurnUsage, mergeTurnUsage, preferRicherUsage, withTurnTiming } from './usage';
import { buildSummaryCandidates, createCompressionMiddleware } from './compression';
import { createResumeGuardMiddleware, getAgentCheckpointer } from './checkpointer';
import type { AgentEvent } from '@/shared/contracts/agent';
import type { AgentSettings } from '@/shared/contracts/settings';
import type { ChatMessage, TaskRow, UserBadge, UserReference } from '@/shared/contracts/session-messages';

export type RuntimeHandle = {
    stop: () => void;
    done: Promise<void>;
};

const TOOL_START_EMIT_MS = 50;

/** 从 LangGraph 检查点继续一次被打断的运行；界面状态取自中断前保存的快照。 */
export type RunResume = {
    messages: ChatMessage[];
    tasks: TaskRow[];
    modelCalls: number;
    toolCalls: number;
    resumeCount: number;
    interruptedToolCallIds: string[];
};

export async function runAgent(options: {
    resume?: RunResume;
    prompt: string;
    context?: string;
    imageDataUrl?: string;
    badges?: UserBadge[];
    references?: UserReference[];
    tabId: number;
    url?: string;
    getTabId?: () => number;
    sessionId?: string;
    conversationId?: string;
    history?: ChatMessage[];
    bridge: ToolBridge;
    emit: (event: AgentEvent) => void;
    signal: AbortSignal;
}): Promise<void> {
    const settings = await loadSettings();
    const secrets = await loadSecrets();
    const model = createChatModel(settings, secrets);
    const tools = await createAgentTools({ ...options.bridge, settings });
    let streamUsage = emptyTurnUsage();
    const history = options.history ?? [];
    const resume = options.resume;
    let messages: ChatMessage[] = resume
        ? resume.messages
        : [
            ...history,
            {
                id: nowId('m'),
                role: 'user',
                content: options.prompt,
                imageDataUrl: options.imageDataUrl,
                badges: options.badges,
                references: options.references,
            },
        ];
    let emitUsage = () => {};

    const safety = createSafetyMiddleware({
        signal: options.signal,
        onBudget: (usage) =>
            options.emit({
                type: 'budget',
                modelCalls: usage.modelCalls,
                toolCalls: usage.toolCalls,
            }),
        onStatus: (text) => options.emit({ type: 'thinking', text }),
        onUsage: () => emitUsage(),
    });
    if (resume) {
        safety.usage.modelCalls = resume.modelCalls;
        safety.usage.toolCalls = resume.toolCalls;
    }

    emitUsage = () => {
        const usage = withTurnTiming(
            safety.usage.tokens.totalTokens > 0 ? safety.usage.tokens : streamUsage,
            {
                startedAt: safety.usage.startedAt,
                modelCalls: safety.usage.modelCalls,
                toolCalls: safety.usage.toolCalls,
            },
        );
        messages = applyAssistantUsage(messages, usage, nowId('m'));
        options.emit({ type: 'usage', usage });
    };

    const compression = settings.compression.enabled
        ? createCompressionMiddleware({
            triggerTokens: settings.compression.triggerTokens,
            getCandidates: () => buildSummaryCandidates(settings, secrets),
            signal: options.signal,
            onStatus: (text) => options.emit({ type: 'thinking', text }),
            onSummary: ({ response }) => {
                const extracted = extractTurnUsage(response);
                if (!extracted) return;
                safety.usage.tokens = mergeTurnUsage(safety.usage.tokens, extracted);
                emitUsage();
            },
        })
        : undefined;

    // 每次运行一个线程，用 sessionId 作线程 id；正常结束就删除，只有后台被回收时才会留下来供恢复。
    const threadId = options.sessionId ?? nowId('s');
    const checkpointer = getAgentCheckpointer();
    const middleware: AgentMiddleware[] = [safety.middleware];
    if (compression) middleware.unshift(compression);
    // 守卫放在最外层：被拦下的工具调用不进入安全层的计数和重复检测。
    if (resume) middleware.unshift(createResumeGuardMiddleware(resume.interruptedToolCallIds));
    const agent = createAgent({
        model,
        tools,
        systemPrompt: buildSystemPrompt(undefined, settings.memory.enabled),
        checkpointer,
        middleware,
    });
    const tasks: TaskRow[] = resume ? resume.tasks.map((task) => ({ ...task })) : [];
    const recursionLimit = 500;
    const CHECKPOINT_INTERVAL_MS = 750;
    let checkpointTimer: ReturnType<typeof setTimeout> | undefined;
    let checkpointQueue: Promise<unknown> = Promise.resolve();
    const pendingToolStarts = new Map<string, Extract<AgentEvent, { type: 'tool-start' }>>();
    let toolStartTimer: ReturnType<typeof setTimeout> | undefined;

    const persist = (running: boolean) => {
        const checkpoint = {
            tabId: options.getTabId?.() ?? options.tabId,
            sessionId: options.sessionId,
            updatedAt: Date.now(),
            running,
            prompt: options.prompt,
            conversationId: options.conversationId,
            messages,
            tasks: tasks.map((task) => ({ ...task })),
            modelCalls: safety.usage.modelCalls,
            toolCalls: safety.usage.toolCalls,
            resumeCount: resume?.resumeCount ?? 0,
        };
        checkpointQueue = checkpointQueue
            .catch(() => undefined)
            .then(() => saveCheckpoint(checkpoint));
        return checkpointQueue;
    };

    const scheduleCheckpoint = () => {
        if (checkpointTimer) return;
        checkpointTimer = setTimeout(() => {
            checkpointTimer = undefined;
            void persist(true);
        }, CHECKPOINT_INTERVAL_MS);
    };

    const flushToolStarts = () => {
        if (toolStartTimer) {
            clearTimeout(toolStartTimer);
            toolStartTimer = undefined;
        }
        for (const pending of pendingToolStarts.values()) options.emit(pending);
        pendingToolStarts.clear();
    };

    const persistTerminal = async () => {
        flushToolStarts();
        if (checkpointTimer) clearTimeout(checkpointTimer);
        checkpointTimer = undefined;
        await persist(false);
    };

    const finishThread = async () => {
        await clearCheckpoint(checkpointKey({
            tabId: options.getTabId?.() ?? options.tabId,
            conversationId: options.conversationId,
            sessionId: options.sessionId,
        }));
        await checkpointer.deleteThread(threadId).catch(() => undefined);
    };

    await persist(true);
    options.emit({ type: 'thinking', text: resume ? '正在从中断处继续…' : '正在调用模型…' });

    try {
        // 恢复时输入为 null：LangGraph 从线程最新检查点接着执行，只重跑没完成的那一步。
        const input = resume
            ? null
            : {
                messages: [
                    ...toModelMessages(history, options.prompt),
                    {
                        role: 'user' as const,
                        content: modelUserContent(
                            options.prompt,
                            options.imageDataUrl,
                            options.references,
                            options.context,
                        ),
                    },
                ],
            };
        const stream = await raceAbort(
            options.signal,
            agent.stream(input, {
                signal: options.signal,
                streamMode: ['messages', 'updates'],
                recursionLimit,
                configurable: { thread_id: threadId },
                // 每一步写完检查点再进入下一步：后台随时可能被回收，异步写入可能丢掉最后一步。
                durability: 'sync',
            }),
        );

        let assistant = '';
        let reasoning = '';
        const streamTools = createStreamToolState();
        for await (const chunk of withAbort(options.signal, stream)) {
            if (options.signal.aborted) throw new Error('任务已停止');
            for (const event of interpretStreamChunk(chunk, streamTools)) {
                if (event.type !== 'tool-start') flushToolStarts();
                if (event.type === 'reasoning') {
                    const applied = applyTokenDelta(reasoning, event.text);
                    if (!applied.delta) continue;
                    reasoning = applied.next;
                    messages = applyAssistantThinking(messages, applied.delta, nowId('m'));
                    options.emit({ type: 'reasoning', text: applied.delta });
                    continue;
                }
                if (event.type === 'token') {
                    const applied = applyTokenDelta(assistant, event.text);
                    if (!applied.delta) continue;
                    assistant = applied.next;
                    messages = applyAssistantToken(messages, applied.delta, nowId('m'));
                    options.emit({ type: 'token', text: applied.delta });
                    continue;
                }
                if (event.type === 'tool-start') {
                    assistant = '';
                    reasoning = '';
                    const existing = tasks.find((item) => item.id === event.id);
                    const argsDetail =
                        event.args == null
                            ? existing?.detail
                            : typeof event.args === 'string'
                                ? redactText(event.args)
                                : redactText(JSON.stringify(event.args));
                    if (existing) {
                        const nextDetail =
                            argsDetail && argsDetail !== '{}' && argsDetail !== '[]' ? argsDetail : existing.detail;
                        if (existing.title === (event.name || existing.title) && existing.detail === nextDetail) {
                            continue;
                        }
                        existing.title = event.name || existing.title;
                        existing.detail = nextDetail;
                        messages = applyAssistantToolStart(
                            messages,
                            { id: event.id, name: event.name, args: event.args, status: 'running' },
                            nowId('m'),
                        );
                        pendingToolStarts.set(event.id, event);
                        if (!toolStartTimer) {
                            toolStartTimer = setTimeout(flushToolStarts, TOOL_START_EMIT_MS);
                        }
                        continue;
                    }
                    tasks.push({
                        id: event.id,
                        title: event.name,
                        detail: argsDetail,
                        status: 'running',
                    });
                    messages = applyAssistantToolStart(
                        messages,
                        { id: event.id, name: event.name, args: event.args, status: 'running' },
                        nowId('m'),
                    );
                    options.emit({ type: 'thinking', text: `正在${toolLabel(event.name)}…` });
                    options.emit(event);
                    continue;
                }
                if (event.type === 'tool-end' || event.type === 'tool-error') {
                    const status = event.type === 'tool-end' ? 'done' : 'error';
                    const elapsedMs = Math.max(0, Date.now() - safety.usage.startedAt);
                    const task = tasks.find((item) => item.id === event.id);
                    if (task) {
                        task.status = status;
                        task.detail = redactText(event.output);
                    }
                    messages = applyAssistantToolResult(messages, event.id, status, event.output, elapsedMs);
                    options.emit({ ...event, elapsedMs });
                    continue;
                }
                if (event.type === 'usage') {
                    if (safety.usage.tokens.totalTokens <= 0) {
                        streamUsage = preferRicherUsage(streamUsage, event.usage);
                        emitUsage();
                    }
                    continue;
                }
                options.emit(event);
            }
            scheduleCheckpoint();
        }

        if (assistant) options.emit({ type: 'message', content: assistant });
        emitUsage();
        options.emit({ type: 'done' });
        await persistTerminal();
        await finishThread();
    } catch (error) {
        const message = options.signal.aborted ? '任务已停止' : toUserErrorMessage(error);
        emitUsage();
        options.emit({ type: 'error', message });
        await persistTerminal();
        await finishThread();
        throw error;
    }
}

export function settingsSummary(settings: AgentSettings): string {
    return [
        `模型 ${settings.model.provider}/${settings.model.model}`,
        `执行 ${settings.executionMode}`,
    ].join(' · ');
}
