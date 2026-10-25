//Agent UI hooks 统一出口。
//各 hook 职责一览（会话状态的单一数据源在 ../store/agent-session-store）：
//- useAgentSession         总装：组合以下各层，向 AgentApp 暴露完整会话视图与操作
//- useBackgroundSessionSync 后台同步：轮询 session.context，把后台会话合并进 store
//- useAgentEventConsumer   事件消费：监听后台广播的 Agent 事件，流式缓冲后折进 store
//- useConversationActions  会话动作：发送/停止/新建/切换/关标签/删除，改 store + 通知后台
//- usePageContext          页面上下文：当前 url / title / 选区，站内导航后自动更新
//- useStickToBottom        滚动吸底：内容增长时自动滚底，用户上翻时不打扰
//agent-session-reducer 是纯函数（事件 → 会话列表变换），有独立单测，勿引入 React 依赖。
export { useAgentSession } from './useAgentSession';
export { useBackgroundSessionSync } from './useBackgroundSessionSync';
export { useAgentEventConsumer } from './useAgentEventConsumer';
export { useConversationActions } from './useConversationActions';
export { usePageContext, type PageContextState } from './usePageContext';
export {
    useStickToBottom,
    STICK_TO_BOTTOM_THRESHOLD,
    isScrolledToBottom,
    nextStickPinned,
} from './useStickToBottom';
