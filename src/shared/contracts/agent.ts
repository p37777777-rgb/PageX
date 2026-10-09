import type { TurnUsage } from './session-messages';
//agent 运行时的所有时间
export type AgentEvent =
    | { type: 'token'; text: string }
    | { type: 'reasoning'; text: string }
    | { type: 'thinking'; text: string }
    | { type: 'tool-start'; id: string; name: string; args: unknown }
    | { type: 'tool-end'; id: string; name: string; output: string; elapsedMs?: number }
    | { type: 'tool-error'; id: string; name: string; output: string; elapsedMs?: number }
    | { type: 'message'; content: string }
    | { type: 'status'; text: string }
    | { type: 'budget'; modelCalls: number; toolCalls: number }
    | { type: 'usage'; usage: TurnUsage }
    | { type: 'error'; message: string }
    | { type: 'done' };