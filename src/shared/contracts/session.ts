import type { ChatMessage, TaskRow } from './session-messages';

export type {
    ChatMessage,
    TaskRow,
    TaskStatus,
    ChatRole,
    ChatToolCall,
    AssistantPart,
    TurnUsage,
    UserBadge,
    UserReference,
    PageReference,
    CommandReference,
    ElementReference
} from './session-messages';

//一次对话
export type PageConversation = {
    id: string;
    revision?: number;
    title: string;
    createdAt: number;
    updatedAt: number;
    startedAt?: number;
    messages: ChatMessage[];// 该对话的所有消息
    tasks: TaskRow[];// 任务清单
    error: string;
    thinking: string;
    running: boolean;
    budget: { modelCalls: number; toolCalls: number };
    vaults: string[];
};
//页面的对话合集储存
export type PageConversationStore = {
    activeId: string;
    conversations: PageConversation[];
    panelOpen?: boolean;
    sessionId?: string;
    revision?: number;
};
//把对话按域名归类、跨页面复用/归档
export type DomainVault = {
    domain: string;
    updatedAt: number;
    panelOpen?: boolean;
    activeId?: string;
    conversations: PageConversation[];
};
//域名->valut字典
export type VaultMap = Record<string, DomainVault>;
//精简的对话信息
export type ConversationSummary = {
    id: string;
    title: string;
    vaults: string[];
    createdAt: number;
    updatedAt: number;
    messageCount: number;
    preview: string;
};
//传递的上下文
export type SessionContext = {
    tabId: number;
    sessionTabId?: number;
    sessionId?: string;
    revision?: number;
    running: boolean;
    agentActive?: boolean;
    conversationId?: string;
    panelOpen: boolean;
    store?: PageConversationStore | null;
};
//快照、检查点保存运行状态（running、原始 prompt）、消息、任务、版本和调用计数。
export type Checkpoint = {
    tabId: number;
    sessionId?: string;
    updatedAt: number;
    running: boolean;
    prompt?: string;
    conversationId?: string;
    messages: ChatMessage[];
    tasks: TaskRow[];
    revision?: number;
    modelCalls: number;
    toolCalls: number;
};
