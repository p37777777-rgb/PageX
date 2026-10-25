//听后台广播的 Agent 事件，折进 store 里的会话列表（真正的消息变换在 agent-session-reducer）。
//流式更新不要每个 token 都重画整棵界面：token/reasoning/tool-start 先进缓冲，50ms 批量落一次。
import { useEffect } from 'react';
import { CHANNEL } from '@/shared/contracts/channel';
import type { AgentEvent } from '@/shared/contracts/agent';
import type { PageConversationStore } from '@/shared/contracts/session';
import { settleFinishedConversation } from '@/features/agent/session/conversations';
import { useAgentSessionStore } from '../store/agent-session-store';
import {
    applyAgentEventToConversations,
    applyStreamPending,
    type StreamPending,
} from './agent-session-reducer';

const STREAM_RENDER_INTERVAL_MS = 50;

export function useAgentEventConsumer() {
    useEffect(() => {
        const store = useAgentSessionStore;
        let streamTimer: number | undefined;
        let pendingStream: StreamPending | undefined;

        const flushPendingStream = () => {
            if (streamTimer != null) {
                window.clearTimeout(streamTimer);
                streamTimer = undefined;
            }
            const pending = pendingStream;
            pendingStream = undefined;
            if (!pending) return;
            store.getState().setConversations((current) => applyStreamPending(current, pending));
        };

        const scheduleFlush = () => {
            if (streamTimer == null) {
                streamTimer = window.setTimeout(flushPendingStream, STREAM_RENDER_INTERVAL_MS);
            }
        };

        const ensurePending = (targetId: string) => {
            if (pendingStream && pendingStream.targetId !== targetId) flushPendingStream();
            pendingStream ??= { targetId, token: '', reasoning: '', tools: [] };
            return pendingStream;
        };

        const enqueueStream = (targetId: string, type: 'token' | 'reasoning', text: string) => {
            const pending = ensurePending(targetId);
            pending[type] += text;
            scheduleFlush();
        };

        const enqueueToolStart = (targetId: string, event: Extract<AgentEvent, { type: 'tool-start' }>) => {
            const pending = ensurePending(targetId);
            const index = pending.tools.findIndex((item) => item.id === event.id);
            if (index >= 0) pending.tools[index] = event;
            else pending.tools.push(event);
            scheduleFlush();
        };

        const onMessage = (message: {
            channel?: string;
            kind?: string;
            event?: AgentEvent;
            revision?: number;
            sessionId?: string;
            conversationId?: string;
            store?: PageConversationStore;
            working?: boolean;
            agentActive?: boolean;
        }) => {
            if (message.channel !== CHANNEL) return;
            if (message.kind === 'agent-retarget') {
                flushPendingStream();
                if (message.working === false) {
                    store.setState({
                        runningId: null,
                        workingOnThisPage: false,
                        agentActive: Boolean(message.agentActive),
                    });
                }
                return;
            }
            if (message.kind !== 'agent-event' || !message.event) return;
            const event = message.event;
            const targetId = store.getState().runningId;
            if ((event.type === 'token' || event.type === 'reasoning') && targetId) {
                enqueueStream(targetId, event.type, event.text);
                return;
            }
            if (event.type === 'tool-start' && targetId) {
                enqueueToolStart(targetId, event);
                return;
            }
            flushPendingStream();
            if (event.type === 'error' || event.type === 'done') {
                store.setState({ runningId: null });
            }
            if (message.store && (message.revision ?? 0) > store.getState().revision) {
                const incoming = message.store;
                const nextRevision = incoming.revision ?? message.revision ?? 0;
                const nextSessionId = message.sessionId ?? incoming.sessionId;
                const nextRunningId = message.conversationId ?? incoming.activeId;
                const liveHere = incoming.conversations.some(
                    (item) => item.id === nextRunningId && item.running,
                );
                store.setState({
                    revision: nextRevision,
                    sessionId: nextSessionId,
                    runningId: nextRunningId,
                    conversations: incoming.conversations,
                    activeId: incoming.activeId,
                    workingOnThisPage: liveHere,
                    agentActive: liveHere,
                });
                return;
            }
            if (!targetId) return;

            if (event.type === 'error') {
                store.setState({
                    runningId: null,
                    workingOnThisPage: false,
                    agentActive: false,
                });
                store.getState().setConversations((current) =>
                    current.map((item) =>
                        item.id === targetId
                            ? { ...settleFinishedConversation(item), error: event.message }
                            : item,
                    ),
                );
                return;
            }
            if (event.type === 'done') {
                store.setState({
                    runningId: null,
                    workingOnThisPage: false,
                    agentActive: false,
                });
                store.getState().setConversations((current) =>
                    current.map((item) => (item.id === targetId ? settleFinishedConversation(item) : item)),
                );
                return;
            }

            store.getState().setConversations((current) =>
                applyAgentEventToConversations(current, targetId, event),
            );
        };
        browser.runtime.onMessage.addListener(onMessage);
        return () => {
            if (streamTimer != null) window.clearTimeout(streamTimer);
            browser.runtime.onMessage.removeListener(onMessage);
        };
    }, []);
}
