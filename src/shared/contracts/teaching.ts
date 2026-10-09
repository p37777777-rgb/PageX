export type TeachingStatus = 'recording' | 'summarizing' | 'reviewing' | 'confirmed';
//用户操作示范
//记录操作类型原子动作
export type RecordedActionKind =
    | 'click'
    | 'double_click'
    | 'input'
    | 'select'
    | 'keypress'
    | 'scroll'
    | 'navigate'
    | 'reload'
    | 'tab_switch'
    | 'tab_open'
    | 'tab_close'
    | 'comment';
//被操作的动作描述
export type RecordedTarget = {
    tag: string;
    role?: string;
    name?: string;
    text?: string;
    selector?: string;
    inputType?: string;
    placeholder?: string;
    href?: string;
};
//单条录制动作记录
export type RecordedAction = {
    id: string;
    at: number;
    kind: RecordedActionKind;
    tabId?: number;
    page: { url: string; title?: string };
    target?: RecordedTarget;
    value?: string;
    redacted?: boolean;
    detail?: string;
};
//流程的步骤，自然语言
export type FlowStep = {
    id: string;
    title: string;
    detail: string;
};
//流程草稿
export type FlowDraft = {
    id: string;
    sessionId: string;
    conversationId?: string;
    name: string;
    key: string;
    purpose: string;
    prerequisites: string[];
    steps: FlowStep[];
    prompt: string;
    revision: number;
    updatedAt: number;
    lastRequest?: string;
};
//域名分的持久化产物
export type SavedCommand = {
    id: string;
    vaultDomain: string;
    originUrl: string;
    name: string;
    key: string;
    desc: string;
    prompt: string;
    steps: FlowStep[];
    createdAt: number;
    updatedAt: number;
};
//会话完整状态
export type TeachingSession = {
    id: string;
    status: TeachingStatus;
    originTabId: number;
    originUrl: string;
    originDomain: string;
    conversationId?: string;
    tabIds: number[];
    actions: RecordedAction[];
    startedAt: number;
    updatedAt: number;
    draft?: FlowDraft;
    error?: string;
};

export type TeachingContext = {
    session: TeachingSession | null;
};
