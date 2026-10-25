//按运行、空闲和页面是否隐藏，向后台要当前标签页的会话。
//把后台那份正在跑的记录合并进 store，避免本地较新的内容被旧快照盖掉。
//轮询节奏沿用原逻辑：隐藏慢轮询、运行中快轮询、空闲常规轮询；可见性恢复立即拉一次。
import { useEffect } from 'react';
import { rpc } from '@/shared/extension/rpc-client';
import {
    conversationTabKey,
    mergeConversationStores,
    normalizePageStore,
    restoreConversationStore,
    settleFinishedConversation,
} from '@/features/agent/session/conversations';
import {
    SESSION_ACTIVE_POLL_MS,
    SESSION_HIDDEN_POLL_MS,
    SESSION_IDLE_POLL_MS,
    sessionIsOnTab,
    shouldRestoreLiveSession,
} from '@/features/agent/session/session-live';
import type { PageConversation, SessionContext } from '@/shared/contracts/session';
import { useAgentSessionStore } from '../store/agent-session-store';

export function useBackgroundSessionSync(vaultKey: string | undefined) {
    //首次渲染前同步水合初始会话，等价于原来的 useState(() => createPageStore(vaultKey))。
    //此刻 store 还没有订阅者，直接写是安全的；hydrated 标志保证只水合一次。
    useAgentSessionStore.getState().hydrateInitial(vaultKey);

    useEffect(() => {
        let cancelled = false;
        let hydrated = false;
        let pulling = false;
        let timer: number | undefined;

        const applyContext = (context: SessionContext, initial: boolean) => {
            const store = useAgentSessionStore.getState();
            const onThisPage = sessionIsOnTab(context);
            const agentActive = Boolean(context.agentActive ?? context.running);
            const contextRevision = context.store?.revision ?? context.revision ?? 0;

            if (
                shouldRestoreLiveSession({
                    alreadyAttached: Boolean(store.runningId),
                    attachedConversationId: store.runningId ?? undefined,
                    context,
                })
            ) {
                const incoming = restoreConversationStore(
                    normalizePageStore(context.store, vaultKey),
                    { running: true, conversationId: context.conversationId },
                );
                const local = {
                    activeId: store.activeId,
                    conversations: store.conversations,
                };
                const next = hydrated ? mergeConversationStores(local, incoming) : incoming;
                useAgentSessionStore.setState({
                    workingOnThisPage: onThisPage,
                    agentActive,
                    runningId: next.activeId,
                    revision: contextRevision,
                    sessionId: context.sessionId ?? context.store?.sessionId,
                    conversations: next.conversations,
                    activeId: next.activeId,
                    restorePanel: true,
                    attachKey: initial ? store.attachKey : store.attachKey + 1,
                    readyKey: `${conversationTabKey(context.tabId)}:${vaultKey ?? 'unknown'}`,
                });
                hydrated = true;
                return;
            }

            if (hydrated && context.store && contextRevision > store.revision) {
                const next = restoreConversationStore(
                    normalizePageStore(context.store, vaultKey),
                    { running: context.running, conversationId: context.conversationId },
                );
                useAgentSessionStore.setState({
                    workingOnThisPage: onThisPage,
                    agentActive,
                    revision: contextRevision,
                    sessionId: context.sessionId ?? context.store.sessionId,
                    runningId: context.running ? next.activeId : store.runningId,
                    conversations: next.conversations,
                    activeId: next.activeId,
                });
                return;
            }

            const patch: {
                workingOnThisPage: boolean;
                agentActive: boolean;
                runningId?: string | null;
                revision?: number;
                sessionId?: string | undefined;
                conversations?: PageConversation[];
                activeId?: string;
                restorePanel?: boolean;
                readyKey?: string;
            } = { workingOnThisPage: onThisPage, agentActive };

            if (!context.running && store.runningId) {
                patch.runningId = null;
                patch.conversations = store.conversations.map((item) =>
                    item.running ? settleFinishedConversation(item) : item,
                );
            }

            if (!hydrated) {
                const next = restoreConversationStore(
                    normalizePageStore(context.store, vaultKey),
                    { running: context.running, conversationId: context.conversationId },
                );
                patch.runningId = context.running ? next.activeId : null;
                patch.revision = contextRevision;
                patch.sessionId = context.sessionId ?? context.store?.sessionId;
                patch.conversations = next.conversations;
                patch.activeId = next.activeId;
                patch.restorePanel = Boolean(context.panelOpen || context.running);
                patch.readyKey = `${conversationTabKey(context.tabId)}:${vaultKey ?? 'unknown'}`;
                hydrated = true;
            }

            useAgentSessionStore.setState(patch);
        };

        const pull = async (initial: boolean) => {
            if (pulling) return;
            pulling = true;
            try {
                const value = await rpc('session.context', {
                    url: useAgentSessionStore.getState().pageUrl,
                });
                if (cancelled) return;
                applyContext(value as SessionContext, initial);
            } catch {
                // background may be restarting
            } finally {
                pulling = false;
            }
        };

        const schedule = () => {
            if (cancelled) return;
            const delay =
                document.visibilityState !== 'visible'
                    ? SESSION_HIDDEN_POLL_MS
                    : useAgentSessionStore.getState().runningId
                        ? SESSION_ACTIVE_POLL_MS
                        : SESSION_IDLE_POLL_MS;
            timer = window.setTimeout(async () => {
                await pull(false);
                schedule();
            }, delay);
        };

        void pull(true);
        schedule();
        const onVisible = () => {
            if (document.visibilityState !== 'visible') return;
            if (timer != null) window.clearTimeout(timer);
            void pull(false).finally(schedule);
        };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('pageshow', onVisible);
        return () => {
            cancelled = true;
            if (timer != null) window.clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('pageshow', onVisible);
        };
    }, [vaultKey]);
}
