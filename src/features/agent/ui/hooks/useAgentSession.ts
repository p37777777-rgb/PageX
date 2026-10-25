//Agent 面板的总装 hook：把会话 store、后台同步、事件消费、动作层和页面上下文组合起来，
//向 AgentApp 暴露一份完整的会话视图与操作集合（返回字段与整理前完全一致）。
//会话状态本体在 zustand store（../store/agent-session-store），这里只保留设置与主题这类
//面板本地的 UI 状态。
import { useEffect, useMemo, useState } from 'react';
import { rpc } from '@/shared/extension/rpc-client';
import { conversationVaultKey } from '@/features/agent/session/vault';
import { DEFAULT_SETTINGS, type AgentSettings } from '@/shared/contracts/settings';
import { startClientKeepAlive } from '@/shared/extension/keepalive';
import { usePageContext } from './usePageContext';
import { useBackgroundSessionSync } from './useBackgroundSessionSync';
import { useAgentEventConsumer } from './useAgentEventConsumer';
import { useConversationActions } from './useConversationActions';
import { useAgentSessionStore } from '../store/agent-session-store';

const STORE_SAVE_DEBOUNCE_MS = 400;

export function useAgentSession() {
    const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS);
    const { page, clearSelection } = usePageContext();

    //全量订阅 store：与原来那组集中在 useContext 内的 useState 行为一致，
    //任一会话状态变化都会让面板重渲染。
    const session = useAgentSessionStore();
    const vaultKey = conversationVaultKey(page.url) ?? undefined;

    //页面上下文同步进 store，供动作层与保存逻辑在事件回调里读到最新 URL。
    //声明在其余 effect 之前，保证同一提交内先更新 URL 再调度保存。
    useEffect(() => {
        useAgentSessionStore.getState().setPageUrl(page.url);
    }, [page.url]);

    useBackgroundSessionSync(vaultKey);
    useAgentEventConsumer();
    const actions = useConversationActions();

    useEffect(() => {
        void rpc('settings.get', {}).then((value) => setSettings(value as AgentSettings));
    }, []);

    //防抖保存：依赖与整理前一致（readyKey / activeId / conversations / revision / sessionId），
    //runningId 与页面 URL 在回调里直读 store 最新值，不进依赖。
    useEffect(() => {
        if (!session.readyKey) return;
        if (useAgentSessionStore.getState().runningId) return;
        const timer = window.setTimeout(() => {
            const latest = useAgentSessionStore.getState();
            void rpc('session.saveStore', {
                activeId: latest.activeId,
                conversations: latest.conversations,
                url: latest.pageUrl,
                revision: latest.revision,
                sessionId: latest.sessionId,
                deletedConversationIds: [...latest.deletedConversationIds],
            }).catch(() => {});
        }, STORE_SAVE_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [session.readyKey, session.activeId, session.conversations, session.revision, session.sessionId]);

    useEffect(() => {
        if (!session.workingOnThisPage) return;
        return startClientKeepAlive();
    }, [session.workingOnThisPage]);

    useEffect(() => {
        const flush = () => {
            const latest = useAgentSessionStore.getState();
            if (!latest.readyKey) return;
            void rpc('session.saveStore', {
                activeId: latest.activeId,
                conversations: latest.conversations,
                url: latest.pageUrl,
                revision: latest.revision,
                sessionId: latest.sessionId,
                deletedConversationIds: [...latest.deletedConversationIds],
            });
        };
        window.addEventListener('pagehide', flush);
        return () => window.removeEventListener('pagehide', flush);
    }, [session.readyKey]);

    const active = session.conversations.find((item) => item.id === session.activeId) ?? session.conversations[0];

    const [systemDark, setSystemDark] = useState(
        () => window.matchMedia('(prefers-color-scheme: dark)').matches,
    );

    useEffect(() => {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const syncTheme = () => setSystemDark(media.matches);
        syncTheme();
        media.addEventListener('change', syncTheme);
        return () => media.removeEventListener('change', syncTheme);
    }, []);

    const themeClass = useMemo(() => {
        if (settings.theme === 'dark') return 'dark';
        if (settings.theme === 'light') return '';
        return systemDark ? 'dark' : '';
    }, [settings.theme, systemDark]);

    return {
        view: session.view,
        setView: useAgentSessionStore.getState().setView,
        settings,
        setSettings,
        conversations: session.conversations,
        closedTabIds: session.closedTabIds,
        activeId: active?.id ?? session.activeId,
        messages: active?.messages ?? [],
        tasks: active?.tasks ?? [],
        running: Boolean(active?.running),
        thinking: active?.thinking ?? '',
        error: active?.error ?? '',
        startedAt: active?.startedAt,
        page,
        clearSelection,
        send: actions.send,
        stop: actions.stop,
        createConversation: actions.createConversation,
        openInitialConversation: actions.openInitialConversation,
        selectConversation: actions.selectConversation,
        closeTab: actions.closeTab,
        deleteConversation: actions.deleteConversation,
        themeClass,
        ready: Boolean(session.readyKey),
        restorePanel: session.restorePanel,
        attachKey: session.attachKey,
        workingOnThisPage: session.workingOnThisPage,
        agentActive: session.agentActive,
    };
}
