/*从保存的线程状态判断恢复后会从哪一步继续，并处理中断时正在执行的工具调用。
那次调用可能已经生效（例如已经点了提交），也可能没有，结果无从得知。
恢复时不再自动重跑它，而是告诉模型结果未知、先观察页面再决定，避免重复提交这类不可逆操作。*/
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { toolLabel } from '@/features/agent/session/tool-display';
import { RESUME_NOTICE } from '../prompts';

export function interruptedToolContent(name: string): string {
    return `工具「${toolLabel(name)}」执行到一半时扩展后台被重启，无法确认它是否已经生效。不要直接重做：先重新读取页面确认当前状态，再决定下一步。`;
}

export type ResumeState = {
    /** 中断时已发出但没有结果的工具调用；恢复后不会重跑。 */
    interruptedToolCallIds: string[];
    /** 恢复后会重新调用模型：中断前流式输出的半截回复要丢掉，否则会和新回复拼在一起。 */
    rerunsModel: boolean;
};

function asMessages(value: unknown): BaseMessage[] {
    return Array.isArray(value) ? (value as BaseMessage[]) : [];
}

function toolResultIds(messages: readonly unknown[]): Set<string> {
    const ids = new Set<string>();
    for (const message of messages) {
        if (ToolMessage.isInstance(message as BaseMessage) && (message as ToolMessage).tool_call_id) {
            ids.add((message as ToolMessage).tool_call_id);
        }
    }
    return ids;
}

/** 读取线程最新检查点。线程不存在时返回 null，调用方应退回到“提示用户重发”的旧流程。 */
export async function readResumeState(
    saver: BaseCheckpointSaver,
    threadId: string,
): Promise<ResumeState | null> {
    const tuple = await saver.getTuple({ configurable: { thread_id: threadId } });
    if (!tuple) return null;
    const messages = asMessages(tuple.checkpoint.channel_values?.messages);
    const last = messages.at(-1);
    if (!last || !AIMessage.isInstance(last)) {
        // 模型调用（或它之前的压缩）被打断：恢复后重新调用模型。
        return { interruptedToolCallIds: [], rerunsModel: true };
    }
    const calls = last.tool_calls ?? [];
    // 最后一条是没有工具调用的回复：任务其实已经跑完，恢复后图直接结束，只做收尾。
    if (!calls.length) return { interruptedToolCallIds: [], rerunsModel: false };

    // 已完成的工具结果可能还在 pendingWrites 里，没合并进 messages。
    const pendingResults = (tuple.pendingWrites ?? [])
        .filter(([, channel]) => channel === 'messages')
        .flatMap(([, , value]) => (Array.isArray(value) ? value : [value]));
    const answered = toolResultIds([...messages, ...pendingResults]);
    const interruptedToolCallIds = calls
        .map((call) => call.id)
        .filter((id): id is string => Boolean(id) && !answered.has(id!));
    return { interruptedToolCallIds, rerunsModel: interruptedToolCallIds.length === 0 };
}

/**
 * 只在恢复的那次运行里使用：
 * - 第一次调用模型时在系统提示后补一段说明，提醒先重新观察页面；
 * - 中断时正在执行的工具调用直接返回“结果未知”，不再真正执行。
 */
export function createResumeGuardMiddleware(interruptedToolCallIds: readonly string[]) {
    const pending = new Set(interruptedToolCallIds);
    let noticed = false;
    return createMiddleware({
        name: 'PagexResumeGuard',
        wrapModelCall: async (request, handler) => {
            if (noticed) return handler(request);
            noticed = true;
            return handler({ ...request, systemMessage: request.systemMessage.concat(RESUME_NOTICE) });
        },
        wrapToolCall: async (request, handler) => {
            const id = request.toolCall?.id;
            if (!id || !pending.has(id)) return handler(request);
            pending.delete(id);
            const name = request.toolCall.name ?? 'unknown';
            return new ToolMessage({
                content: interruptedToolContent(name),
                tool_call_id: id,
                name,
                status: 'error',
            });
        },
    });
}
