//Agent 面板会话状态的单一数据源（zustand）。
//这份状态原来散落在 useAgentSession / useBackgroundSessionSync / useAgentEventConsumer /
//useConversationActions 之间，靠 6 个 useRef 镜像和十几个 setter 参数互相传递；
//收敛到这里之后，任何一方都能同步读到最新值（getState），ref 镜像与参数钻孔一并消失。
//
//用法约定：
//- 组件订阅用 useAgentSessionStore(selector)，事件/异步回调里一律 getState() 直读直写；
//- actions 引用稳定，可以直接解构，不进 useEffect 依赖数组。
import { create } from 'zustand';
import { createPageStore } from '@/features/agent/session/conversations';
import type { PageConversation } from '@/shared/contracts/session';

export type AgentView = 'chat' | 'settings';

export type AgentSessionState = {
    /** 首挂载水合标记：只允许 useBackgroundSessionSync 在首次渲染前写入一次初始会话 */
    hydrated: boolean;
    /** 会话列表与当前选中会话 */
    conversations: PageConversation[];
    activeId: string;
    revision: number;
    sessionId: string | undefined;
    /** 正在跑的会话 id；null 表示空闲。替代原 runningIdRef */
    runningId: string | null;
    /** 后台同步就绪键；null 表示尚未从后台拉到首份数据（对应原 ready 语义） */
    readyKey: string | null;
    restorePanel: boolean;
    attachKey: number;
    workingOnThisPage: boolean;
    agentActive: boolean;
    /** 当前页面 URL，由 useAgentSession 从 usePageContext 同步进来，供动作层与保存逻辑读取 */
    pageUrl: string;
    /** 面板视图：聊天 / 设置 */
    view: AgentView;
    /** 已关闭（仅从标签栏隐藏）的会话 id */
    closedTabIds: Set<string>;
    /** 已彻底删除、待从后台存储移除的会话 id */
    deletedConversationIds: Set<string>;
};

export type ConversationsUpdate =
    | PageConversation[]
    | ((current: PageConversation[]) => PageConversation[]);

export type AgentSessionActions = {
    /** 首次渲染前同步水合初始会话，等价于原 useState(() => createPageStore(vaultKey)) */
    hydrateInitial(vaultKey: string | undefined): void;
    setConversations(update: ConversationsUpdate): void;
    setActiveId(id: string): void;
    setRevision(revision: number): void;
    /** revision +1 并返回新值，替代原 bumpRevision */
    bumpRevision(): number;
    setSessionId(id: string | undefined): void;
    setRunningId(id: string | null): void;
    setReadyKey(key: string | null): void;
    setRestorePanel(value: boolean): void;
    bumpAttachKey(): void;
    setWorkingOnThisPage(value: boolean): void;
    setAgentActive(value: boolean): void;
    setPageUrl(url: string): void;
    setView(view: AgentView): void;
    setClosedTabIds(ids: Set<string>): void;
    markTabClosed(id: string): void;
    removeClosedTab(id: string): void;
    markConversationDeleted(id: string): void;
    /** 仅测试使用：恢复初始状态 */
    resetForTest(): void;
};

export type AgentSessionStore = AgentSessionState & AgentSessionActions;

export function initialAgentSessionState(): AgentSessionState {
    return {
        hydrated: false,
        conversations: [],
        activeId: '',
        revision: 0,
        sessionId: undefined,
        runningId: null,
        readyKey: null,
        restorePanel: false,
        attachKey: 0,
        workingOnThisPage: false,
        agentActive: false,
        pageUrl: location.href,
        view: 'chat',
        closedTabIds: new Set(),
        deletedConversationIds: new Set(),
    };
}

export const useAgentSessionStore = create<AgentSessionStore>()((set, get) => ({
    ...initialAgentSessionState(),

    hydrateInitial: (vaultKey) => {
        if (get().hydrated) return;
        const initial = createPageStore(vaultKey);
        set({
            hydrated: true,
            conversations: initial.conversations,
            activeId: initial.activeId,
            revision: initial.revision ?? 0,
        });
    },

    setConversations: (update) =>
        set((state) => ({
            conversations: typeof update === 'function' ? update(state.conversations) : update,
        })),

    setActiveId: (id) => set({ activeId: id }),

    setRevision: (revision) => set({ revision }),

    bumpRevision: () => {
        const next = get().revision + 1;
        set({ revision: next });
        return next;
    },

    setSessionId: (id) => set({ sessionId: id }),

    setRunningId: (id) => set({ runningId: id }),

    setReadyKey: (key) => set({ readyKey: key }),

    setRestorePanel: (value) => set({ restorePanel: value }),

    bumpAttachKey: () => set((state) => ({ attachKey: state.attachKey + 1 })),

    setWorkingOnThisPage: (value) => set({ workingOnThisPage: value }),

    setAgentActive: (value) => set({ agentActive: value }),

    setPageUrl: (url) => set({ pageUrl: url }),

    setView: (view) => set({ view }),

    setClosedTabIds: (ids) => set({ closedTabIds: ids }),

    markTabClosed: (id) =>
        set((state) => {
            if (state.closedTabIds.has(id)) return state;
            const next = new Set(state.closedTabIds);
            next.add(id);
            return { closedTabIds: next };
        }),

    removeClosedTab: (id) =>
        set((state) => {
            if (!state.closedTabIds.has(id)) return state;
            const next = new Set(state.closedTabIds);
            next.delete(id);
            return { closedTabIds: next };
        }),

    markConversationDeleted: (id) =>
        set((state) => {
            const next = new Set(state.deletedConversationIds);
            next.add(id);
            return { deletedConversationIds: next };
        }),

    resetForTest: () => set(initialAgentSessionState()),
}));

/** 仅测试使用：一键把 store 恢复到初始状态 */
export function resetAgentSessionStore() {
    useAgentSessionStore.getState().resetForTest();
}
