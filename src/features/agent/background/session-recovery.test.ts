import { describe, expect, it } from 'vitest';
import { dropUnfinishedAssistantOutput } from '@/features/agent/session/messages';
import type { ChatMessage, Checkpoint } from '@/shared/contracts/session';
import { AUTO_RESUME_WINDOW_MS, MAX_AUTO_RESUMES, shouldAutoResume } from './session-recovery';

const NOW = 1_000_000_000;
const checkpoint = (patch: Partial<Checkpoint> = {}): Checkpoint => ({
    tabId: 1,
    sessionId: 's1',
    updatedAt: NOW,
    running: true,
    messages: [],
    tasks: [],
    modelCalls: 2,
    toolCalls: 1,
    ...patch,
});

describe('shouldAutoResume', () => {
    it('resumes a recent running task that still has resume attempts left', () => {
        expect(shouldAutoResume(checkpoint(), NOW)).toBe(true);
        expect(shouldAutoResume(checkpoint({ resumeCount: MAX_AUTO_RESUMES - 1 }), NOW)).toBe(true);
    });

    it('falls back to marking the task interrupted otherwise', () => {
        expect(shouldAutoResume(checkpoint({ running: false }), NOW)).toBe(false);
        expect(shouldAutoResume(checkpoint({ sessionId: undefined }), NOW)).toBe(false);
        expect(shouldAutoResume(checkpoint({ resumeCount: MAX_AUTO_RESUMES }), NOW)).toBe(false);
        expect(shouldAutoResume(checkpoint({ updatedAt: NOW - AUTO_RESUME_WINDOW_MS - 1 }), NOW)).toBe(false);
    });
});

describe('dropUnfinishedAssistantOutput', () => {
    const user: ChatMessage = { id: 'u', role: 'user', content: '填表' };
    const tool = { type: 'tool' as const, id: 'c1', name: 'fill', args: {}, status: 'done' as const };

    it('drops text and thinking streamed after the last tool', () => {
        const assistant: ChatMessage = {
            id: 'a',
            role: 'assistant',
            content: '半截回复',
            parts: [{ type: 'text', text: '先读页面' }, tool, { type: 'thinking', text: '想' }, { type: 'text', text: '半截回复' }],
        };
        const [, trimmed] = dropUnfinishedAssistantOutput([user, assistant]);
        expect(trimmed?.parts).toEqual([{ type: 'text', text: '先读页面' }, tool]);
        expect(trimmed?.content).toBe('先读页面');
        expect(trimmed?.thinking).toBe('');
    });

    it('removes an assistant message that had only unfinished output', () => {
        const assistant: ChatMessage = { id: 'a', role: 'assistant', content: '半截', parts: [{ type: 'text', text: '半截' }] };
        expect(dropUnfinishedAssistantOutput([user, assistant])).toEqual([user]);
    });

    it('leaves messages that end with a tool or a user message unchanged', () => {
        const endsWithTool: ChatMessage = { id: 'a', role: 'assistant', content: '', parts: [tool] };
        const messages = [user, endsWithTool];
        expect(dropUnfinishedAssistantOutput(messages)).toBe(messages);
        const onlyUser = [user];
        expect(dropUnfinishedAssistantOutput(onlyUser)).toBe(onlyUser);
    });
});
