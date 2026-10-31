import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import {
    cleanSummaryText,
    resetSummaryFailures,
    summarizeWithFallback,
    type SummaryCandidate,
    type SummaryModel,
} from './summarizer';

const SUMMARY = '## 用户目标与限制\n把通知邮箱改成 test@example.com，不保存。';
const history = [new HumanMessage('改邮箱'), new AIMessage('已填写')];

function candidate(key: string, invoke: SummaryModel['invoke']) {
    const create = vi.fn(() => ({ invoke }));
    return { key, label: key, maxInputTokens: 10_000, create } satisfies SummaryCandidate;
}

const ok = () => vi.fn<SummaryModel['invoke']>(async () => ({ content: SUMMARY }));
const fail = (message: string) => vi.fn<SummaryModel['invoke']>(async () => {
    throw new Error(message);
});

afterEach(() => resetSummaryFailures());

describe('summarizeWithFallback', () => {
    it('首选模型失败时回退，并在冷却期内跳过它', async () => {
        const broken = candidate('light', fail('model_not_found'));
        const main = candidate('main', ok());
        const failed = vi.fn();
        let time = 0;
        const now = () => time;

        const first = await summarizeWithFallback({ messages: history, candidates: [broken, main], onAttemptFailed: failed, now });
        expect(first?.candidate).toBe(main);
        expect(first?.text).toBe(SUMMARY);
        expect(failed).toHaveBeenCalledWith(broken, expect.any(Error));

        await summarizeWithFallback({ messages: history, candidates: [broken, main], now });
        expect(broken.create).toHaveBeenCalledTimes(1);

        time = 11 * 60 * 1000;
        await summarizeWithFallback({ messages: history, candidates: [broken, main], now });
        expect(broken.create).toHaveBeenCalledTimes(2);
    });

    it('空摘要和只有思考的输出视为失败；全部失败返回 null', async () => {
        const empty = candidate('empty', vi.fn(async () => ({ content: '   ' })));
        const thinkingOnly = candidate('think', vi.fn(async () => ({ content: '<think>只有思考没有正文' })));
        expect(await summarizeWithFallback({ messages: history, candidates: [empty, thinkingOnly] })).toBeNull();
    });

    it('超时会回退，但不进入失败缓存', async () => {
        const hanging = candidate('slow', vi.fn(() => new Promise<never>(() => undefined)));
        const main = candidate('main', ok());
        const result = await summarizeWithFallback({ messages: history, candidates: [hanging, main], timeoutMs: 10 });
        expect(result?.candidate).toBe(main);
        await summarizeWithFallback({ messages: history, candidates: [hanging, main], timeoutMs: 10 });
        expect(hanging.create).toHaveBeenCalledTimes(2);
    });

    it('用户中止时立即抛出，不再尝试后面的模型', async () => {
        const controller = new AbortController();
        const aborting = candidate('first', vi.fn(async () => {
            controller.abort();
            throw new Error('aborted');
        }));
        const main = candidate('main', ok());
        await expect(
            summarizeWithFallback({ messages: history, candidates: [aborting, main], signal: controller.signal }),
        ).rejects.toThrow();
        expect(main.create).not.toHaveBeenCalled();
    });

    it('创建模型失败（如缺少密钥）也会回退', async () => {
        const missingKey = {
            key: 'nokey',
            label: 'nokey',
            maxInputTokens: 10_000,
            create: () => {
                throw new Error('尚未配置 API Key');
            },
        } satisfies SummaryCandidate;
        const main = candidate('main', ok());
        expect((await summarizeWithFallback({ messages: history, candidates: [missingKey, main] }))?.candidate).toBe(main);
    });

    it('摘要调用带 nostream 标签，提示词包含转义后的历史', async () => {
        const invoke = ok();
        await summarizeWithFallback({ messages: [new HumanMessage('<b>页面</b>')], candidates: [candidate('main', invoke)] });
        const [prompt, options] = invoke.mock.calls[0]!;
        expect(options?.tags).toEqual(['nostream']);
        expect(prompt).toContain('<messages>');
        expect(prompt).toContain('&lt;b&gt;页面&lt;/b&gt;');
    });
});

describe('cleanSummaryText', () => {
    it('去掉混在正文里的思考标签', () => {
        expect(cleanSummaryText('<think>想一想</think>\n摘要正文')).toBe('摘要正文');
        expect(cleanSummaryText('摘要<think>被截断的思考')).toBe('摘要');
    });
});
