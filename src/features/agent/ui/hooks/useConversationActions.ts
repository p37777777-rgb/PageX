//会话动作层：发送、停止、新建、切换、关闭标签、删除，共 7 个函数。
//由它们负责「改 store 里的会话状态 + 通知后台」；组件只管调用，不直接碰状态。
import { useCallback } from 'react';
import { rpc } from '@/shared/extension/rpc-client';
import {
    emptyConversation,
    isRecentConversation,
    latestRecentConversation,
    nextConversationTitle,
    settleFinishedConversation,
    titleFromPrompt,
} from '@/features/agent/session/conversations';
import { conversationVaultKey } from '@/features/agent/session/vault';
import type { PageConversation, UserBadge, UserReference } from '@/shared/contracts/session';
import { nowId } from '@/shared/utils/utils';
import { useAgentSessionStore } from '../store/agent-session-store';
import { patchConversation } from './agent-session-reducer';

export function useConversationActions() {
    const send = useCallback(async (
        prompt: string,
        context?: string,
        imageDataUrl?: string,
        badges?: UserBadge[],
        references?: UserReference[],
    ) => {
        const store = useAgentSessionStore.getState();
        const id = store.activeId;
        const current = store.conversations.find((item) => item.id === id);
        const history = current?.messages ?? [];
        const now = Date.now();
        const nextConversations = patchConversation(store.conversations, id, (item) => ({
            ...item,
            error: '',
            running: true,
            thinking: '正在调用模型…',
            startedAt: item.startedAt ?? now,
            title: titleFromPrompt(item.title, prompt),
            messages: [
                ...item.messages,
                { id: nowId('m'), role: 'user', content: prompt, imageDataUrl, badges, references },
            ],
        }));
        const nextRevision = store.bumpRevision();
        useAgentSessionStore.setState({
            runningId: id,
            workingOnThisPage: true,
            agentActive: true,
            view: 'chat',
            conversations: nextConversations,
        });
        const latest = useAgentSessionStore.getState();
        void rpc('session.saveStore', {
            activeId: id,
            conversations: nextConversations,
            url: latest.pageUrl,
            revision: nextRevision,
            sessionId: latest.sessionId,
            deletedConversationIds: [...latest.deletedConversationIds],
        });
        await rpc('agent.start', {
            prompt,
            context,
            imageDataUrl,
            badges,
            references,
            conversationId: id,
            history,
        });
    }, []);

    const stop = useCallback(async () => {
        // 本地立即结算，不等后台往返；后台会同步结算 store 并广播终止事件
        const store = useAgentSessionStore.getState();
        useAgentSessionStore.setState({
            runningId: null,
            workingOnThisPage: false,
            agentActive: false,
            conversations: store.conversations.map((item) =>
                item.running ? settleFinishedConversation(item) : item,
            ),
        });
        await rpc('agent.stop', {});
    }, []);

    const createConversation = useCallback(() => {
        const store = useAgentSessionStore.getState();
        const domain = conversationVaultKey(store.pageUrl);
        const nextRevision = store.bumpRevision();
        const next = emptyConversation(
            nextConversationTitle(store.conversations.map((item) => item.title)),
            domain ? [domain] : [],
        );
        const nextConversations = [...store.conversations, next];
        useAgentSessionStore.setState({
            activeId: next.id,
            conversations: nextConversations,
            view: 'chat',
        });
        const latest = useAgentSessionStore.getState();
        void rpc('session.saveStore', {
            activeId: next.id,
            conversations: nextConversations,
            url: latest.pageUrl,
            revision: nextRevision,
            sessionId: latest.sessionId,
            deletedConversationIds: [...latest.deletedConversationIds],
        }).catch(() => {});
    }, []);

    const openInitialConversation = useCallback(async () => {
        const store = useAgentSessionStore.getState();
        const current = store.conversations;
        const recent = latestRecentConversation(current);
        const nextClosedTabIds = new Set(
            current.filter((item) => item.id !== recent?.id).map((item) => item.id),
        );
        useAgentSessionStore.setState({ closedTabIds: nextClosedTabIds });
        if (!recent) {
            await createConversation();
            return;
        }
        store.bumpRevision();
        useAgentSessionStore.setState({ activeId: recent.id, view: 'chat' });
    }, [createConversation]);

    const selectConversation = useCallback(
        (id: string) => {
            const store = useAgentSessionStore.getState();
            const nextRevision = store.bumpRevision();
            // 从历史中打开一个已关闭的标签页 → 重新打开
            const closedTabIds = store.closedTabIds.has(id)
                ? (() => {
                    const next = new Set(store.closedTabIds);
                    next.delete(id);
                    return next;
                })()
                : store.closedTabIds;
            // 从历史中打开的旧会话也视为"打开"的标签页：触碰 updatedAt 使其进入最近窗口
            const conversations = store.conversations.some(
                (item) => item.id === id && isRecentConversation(item),
            )
                ? store.conversations
                : store.conversations.map((item) =>
                    item.id === id ? { ...item, updatedAt: Date.now() } : item,
                );
            useAgentSessionStore.setState({
                activeId: id,
                view: 'chat',
                closedTabIds,
                conversations,
            });
            void nextRevision;
        },
        [],
    );

    /** 关闭标签页：仅从标签栏隐藏会话，不删除历史；关闭当前标签时切换到其他打开的标签页 */
    const closeTab = useCallback(
        (id: string) => {
            const store = useAgentSessionStore.getState();
            const openTabs = () =>
                store.conversations.filter(
                    (item) =>
                        item.id !== id && isRecentConversation(item) && !store.closedTabIds.has(item.id),
                );
            const patch: {
                activeId?: string;
                view?: 'chat';
                closedTabIds: Set<string>;
            } = {
                closedTabIds: (() => {
                    const next = new Set(store.closedTabIds);
                    next.add(id);
                    return next;
                })(),
            };
            if (id === store.activeId) {
                const remaining = openTabs();
                if (remaining.length > 0) {
                    const nextId = remaining.at(-1)!.id;
                    store.bumpRevision();
                    patch.activeId = nextId;
                    patch.view = 'chat';
                } else {
                    // 没有其他打开的标签页：保留至少一个会话标签，像浏览器一样新建一个
                    void createConversation();
                }
            }
            useAgentSessionStore.setState(patch);
        },
        [createConversation],
    );

    /** 删除会话：从存储与历史中彻底移除 */
    const deleteConversation = useCallback(
        (id: string) => {
            const store = useAgentSessionStore.getState();
            store.bumpRevision();
            store.markConversationDeleted(id);
            const closedTabIds = new Set(store.closedTabIds);
            closedTabIds.delete(id);
            const current = store.conversations;
            if (current.length <= 1) {
                const domain = conversationVaultKey(store.pageUrl);
                const reset = emptyConversation('会话 1', domain ? [domain] : []);
                useAgentSessionStore.setState({
                    closedTabIds,
                    conversations: [reset],
                    activeId: reset.id,
                    view: 'chat',
                });
                return;
            }
            const next = current.filter((item) => item.id !== id);
            const patch: {
                closedTabIds: Set<string>;
                conversations: PageConversation[];
                activeId?: string;
                view?: 'chat';
            } = { closedTabIds, conversations: next };
            if (store.activeId === id) {
                patch.activeId = next.at(-1)!.id;
                patch.view = 'chat';
            }
            useAgentSessionStore.setState(patch);
        },
        [],
    );

    return {
        send,
        stop,
        createConversation,
        openInitialConversation,
        selectConversation,
        closeTab,
        deleteConversation,
    };
}
