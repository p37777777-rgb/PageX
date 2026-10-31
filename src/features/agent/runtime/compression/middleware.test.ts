import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { interpretStreamChunk } from '@/features/agent/runtime/stream';
import { createContextCompressor } from './middleware';
import { resetSummaryFailures, type SummaryCandidate, type SummaryModel } from './summarizer';

const TRIGGER = 16_000;

/** 一个用户请求加若干轮整页观察，每轮约 2000 token。 */
function longTask(request: string, steps: number): BaseMessage[] {
    const messages: BaseMessage[] = [new HumanMessage(request)];
    for (let index = 0; index < steps; index += 1) {
        const id = `c${index}`;
        messages.push(new AIMessage({ content: '', tool_calls: [{ id, name: 'observe_page', args: {} }] }));
        messages.push(new ToolMessage({ tool_call_id: id, name: 'observe_page', content: `第${index}次观察 ${'页面'.repeat(1_000)}` }));
    }
    return messages;
}

function summaryCandidate(invoke: SummaryModel['invoke']): SummaryCandidate {
    return { key: 'main', label: 'main', maxInputTokens: 50_000, create: () => ({ invoke }) };
}

const replyWith = (...texts: string[]) => {
    let index = 0;
    return vi.fn<SummaryModel['invoke']>(async () => ({ content: texts[Math.min(index++, texts.length - 1)] }));
};

afterEach(() => resetSummaryFailures());

describe('createContextCompressor', () => {
    it('未超过阈值时不压缩，也不准备模型', async () => {
        const getCandidates = vi.fn(() => [summaryCandidate(replyWith('不会被调用的摘要内容，长度足够二十个字。'))]);
        const compress = createContextCompressor({ triggerTokens: TRIGGER, getCandidates });
        expect(await compress(longTask('目标', 2))).toBeNull();
        expect(getCandidates).not.toHaveBeenCalled();
    });

    it('超过阈值时生成摘要，保留最近的工具循环和用户原话', async () => {
        const onStatus = vi.fn();
        const onSummary = vi.fn();
        const compress = createContextCompressor({
            triggerTokens: TRIGGER,
            getCandidates: () => [summaryCandidate(replyWith('第一次摘要：用户要求整理订单列表，已观察页面八次。'))],
            onStatus,
            onSummary,
        });
        const messages = longTask('请整理订单列表', 10);
        const result = await compress(messages);

        expect(result).not.toBeNull();
        const [, opener, ...rest] = result!.update;
        expect(opener).toBe(result!.opener);
        expect(opener!.content).toContain('第一次摘要');
        expect(opener!.content).toContain('请整理订单列表');
        expect(AIMessage.isInstance(rest[0])).toBe(true);
        expect(rest.at(-1)).toBe(messages.at(-1));
        expect(onStatus).toHaveBeenCalledWith('正在压缩前文…');
        expect(onSummary).toHaveBeenCalledTimes(1);
    });

    it('再次压缩时带回用户原话，不嵌套旧摘要', async () => {
        const invoke = replyWith(
            '第一次摘要：用户要求整理订单列表，已观察页面八次。',
            '第二次摘要：继续观察页面，订单列表尚未整理完毕。',
        );
        const compress = createContextCompressor({
            triggerTokens: TRIGGER,
            getCandidates: () => [summaryCandidate(invoke)],
        });
        const first = await compress(longTask('请整理订单列表', 10));
        const afterFirst = first!.update.slice(1);
        const second = await compress([...afterFirst, ...longTask('不会出现', 10).slice(1)]);

        const content = String(second!.opener.content);
        expect(content).toContain('第二次摘要');
        expect(content).not.toContain('第一次摘要');
        expect(content.match(/请整理订单列表/g)).toHaveLength(1);
    });

    it('所有模型都失败时跳过压缩，本轮不再尝试', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const getCandidates = vi.fn(() => [summaryCandidate(async () => {
            throw new Error('model_not_found');
        })]);
        const compress = createContextCompressor({ triggerTokens: TRIGGER, getCandidates });
        expect(await compress(longTask('目标', 10))).toBeNull();
        expect(await compress(longTask('目标', 12))).toBeNull();
        expect(getCandidates).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('用户中止时抛出，让任务按停止处理', async () => {
        const controller = new AbortController();
        const compress = createContextCompressor({
            triggerTokens: TRIGGER,
            signal: controller.signal,
            getCandidates: () => [summaryCandidate(async () => {
                controller.abort();
                throw new Error('aborted');
            })],
        });
        await expect(compress(longTask('目标', 10))).rejects.toThrow();
    });
});

describe('stream 更新过滤', () => {
    it('忽略 beforeModel 节点重写的旧工具结果', () => {
        const tool = new ToolMessage({ tool_call_id: 'c1', name: 'observe_page', content: 'ok' });
        expect(interpretStreamChunk(['updates', { 'PagexCompression.before_model': { messages: [tool] } }])).toEqual([]);
        expect(interpretStreamChunk(['updates', { tools: { messages: [tool] } }])).toEqual([
            expect.objectContaining({ type: 'tool-end', id: 'c1' }),
        ]);
    });
});
