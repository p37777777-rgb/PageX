//任务状态联合
export type TaskStatus = 'pending' | 'running' | 'done' | 'error';

export type TaskRow = {
    id: string;
    title: string;
    detail?: string;
    status: TaskStatus;
};
//消息角色与工具
export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatToolCall = {
    id: string;
    name: string;
    args?: unknown;
    output?: string;
    status: TaskStatus;
    /** 从任务开始到本次调用结束的累计耗时（毫秒）。 */
    elapsedMs?: number;
};
//分流的消息内容：正文-思考-工具调用
export type AssistantTextPart = { type: 'text'; text: string };
export type AssistantThinkingPart = { type: 'thinking'; text: string };
export type AssistantToolPart = { type: 'tool' } & ChatToolCall;
export type AssistantPart = AssistantTextPart | AssistantThinkingPart | AssistantToolPart;
//token用量-时间性能检测
export type TurnUsage = {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedTokens: number;
    reasoningTokens?: number;
    durationMs: number;
    startedAt?: number;
    modelCalls: number;
    toolCalls: number;
};
//当前页面状态徽标
export type UserBadge =
    | { type: 'tab'; id: number; title: string }
    | { type: 'command'; key: string; name: string }
    | { type: 'element'; name?: string; tag?: string };

export type PageReference = {
    type: 'page';
    tabId: number;
    title: string;
    url: string;
    active?: boolean;
    content?: string;
    truncated?: boolean;
    error?: string;
};

export type CommandReference = {
    type: 'command';
    key: string;
    name: string;
    desc?: string;
    prompt: string;
};

export type ElementReference = {
    type: 'element';
    name?: string;
    tag?: string;
    element?: unknown;
};

export type UserReference = PageReference | CommandReference | ElementReference;
//一条聊天消息内
export type ChatMessage = {
    id: string;
    role: ChatRole;
    content: string;
    imageDataUrl?: string;
    badges?: UserBadge[];
    references?: UserReference[];
    thinking?: string;
    tools?: ChatToolCall[];
    parts?: AssistantPart[];
    usage?: TurnUsage;
};
