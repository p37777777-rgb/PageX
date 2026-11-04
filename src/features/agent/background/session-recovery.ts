import { checkpointKey, clearCheckpoint, loadCheckpoints } from '@/features/agent/session/checkpoint';
import {
    createPageStore,
    emptyConversation,
} from '@/features/agent/session/conversations';
import { nextStoreRevision } from '@/features/agent/session/session-live';
import { conversationVaultKey } from '@/features/agent/session/vault';
import { getAgentCheckpointer } from '@/features/agent/runtime/checkpointer';
import type { Checkpoint } from '@/shared/contracts/session';
import { readTabStore, resolveTabUrl, tabDomains, writeTabStore } from './tab-store';
//扩展后台重启后处理上次没跑完的任务：能从 LangGraph 检查点接着跑的自动续跑，其余标记中断。

/** 超过这个时间的中断不自动续跑：用户多半已经离开，突然在页面上操作会让人意外。 */
export const AUTO_RESUME_WINDOW_MS = 10 * 60_000;
/** 同一次任务最多自动续跑的次数，防止某一步反复把后台搞崩时无限重启。 */
export const MAX_AUTO_RESUMES = 2;

export type ResumeRun = (checkpoint: Checkpoint) => Promise<boolean>;

export function shouldAutoResume(checkpoint: Checkpoint, now = Date.now()): boolean {
    return (
        checkpoint.running &&
        Boolean(checkpoint.sessionId) &&
        (checkpoint.resumeCount ?? 0) < MAX_AUTO_RESUMES &&
        now - checkpoint.updatedAt <= AUTO_RESUME_WINDOW_MS
    );
}

async function tryResume(checkpoint: Checkpoint, resume: ResumeRun | undefined): Promise<boolean> {
    if (!resume || !shouldAutoResume(checkpoint)) return false;
    try {
        return await resume(checkpoint);
    } catch (error) {
        console.warn('[PageX] 从检查点恢复任务失败，改为标记中断', error);
        return false;
    }
}

async function markInterrupted(checkpoint: Checkpoint): Promise<void> {
    const current =
        (await readTabStore(checkpoint.tabId)) ??
        createPageStore(conversationVaultKey((await resolveTabUrl(checkpoint.tabId)) ?? '') ?? undefined);
    const conversationId = checkpoint.conversationId ?? current.activeId;
    let found = false;
    const conversations = current.conversations.map((item) => {
        if (item.id !== conversationId) return item;
        found = true;
        return {
            ...item,
            revision: (item.revision ?? 0) + 1,
            updatedAt: Date.now(),
            messages: checkpoint.messages,
            tasks: checkpoint.tasks.map((task) =>
                task.status === 'running' || task.status === 'pending'
                    ? { ...task, status: 'error' as const }
                    : task,
            ),
            budget: { modelCalls: checkpoint.modelCalls, toolCalls: checkpoint.toolCalls },
            running: false,
            thinking: '',
            error: '任务因扩展后台重启而中断，请重新发送消息继续。',
        };
    });
    if (!found) {
        const item = emptyConversation('中断的任务', tabDomains.get(checkpoint.tabId) ? [tabDomains.get(checkpoint.tabId)!] : []);
        item.id = conversationId;
        item.revision = 1;
        item.messages = checkpoint.messages;
        item.tasks = checkpoint.tasks.map((task) => ({ ...task, status: task.status === 'done' ? 'done' : 'error' }));
        item.budget = { modelCalls: checkpoint.modelCalls, toolCalls: checkpoint.toolCalls };
        item.error = '任务因扩展后台重启而中断，请重新发送消息继续。';
        conversations.push(item);
    }
    await writeTabStore(checkpoint.tabId, {
        ...current,
        activeId: conversationId,
        conversations,
        sessionId: checkpoint.sessionId,
        revision: nextStoreRevision(current),
    });
    await clearCheckpoint(checkpointKey(checkpoint));
}

/**
 * 后台启动时调用。传入 resume 才会尝试自动续跑；续跑沿用原来的检查点键，由新的运行覆盖。
 * 最后清掉没有被续跑的 LangGraph 线程，本次启动后新开的运行不受影响。
 */
export async function recoverInterruptedSessions(resume?: ResumeRun): Promise<void> {
    const checkpoints = await loadCheckpoints();
    const resumed = new Set<string>();
    for (const [key, checkpoint] of Object.entries(checkpoints)) {
        if (!checkpoint.running) {
            await clearCheckpoint(key);
            continue;
        }
        if (await tryResume(checkpoint, resume)) {
            resumed.add(checkpoint.sessionId!);
            continue;
        }
        await markInterrupted(checkpoint);
    }
    await getAgentCheckpointer()
        .pruneThreads(resumed)
        .catch((error) => console.warn('[PageX] 清理中断任务的检查点失败', error));
}
