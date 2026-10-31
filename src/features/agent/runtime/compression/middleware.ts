/*前文压缩中间层：每次调用模型前估算上下文，超过阈值就把早期消息换成摘要。
压缩是优化而不是必需步骤，除了用户中止，任何失败都只跳过压缩，让任务照常继续。*/
import { createMiddleware } from 'langchain';
import type { BaseMessage, MessageContent } from '@langchain/core/messages';
import { toErrorMessage } from '@/shared/contracts/errors';
import { buildCompactedMessages, isSummaryMessage, planCompaction, type CompactionResult } from './compaction';
import { summarizeWithFallback, type SummaryCandidate, type SummaryResult } from './summarizer';
import { estimateMessagesTokens } from './tokens';

/** 压缩后保留的最近消息约占阈值的这个比例，留出继续执行的空间。 */
const KEEP_RATIO = 0.3;
/** 可压缩部分小于阈值的这个比例时不压缩：省下的空间抵不上一次模型调用。 */
const MIN_HEAD_RATIO = 0.25;

export type ContextCompressorOptions = {
    triggerTokens: number;
    getCandidates: () => SummaryCandidate[];
    signal?: AbortSignal;
    onStatus?: (text: string) => void;
    onSummary?: (result: SummaryResult) => void;
};

/** 一次任务的压缩器：记录本轮生成的摘要消息，全部候选都失败后本轮不再尝试。 */
export function createContextCompressor(options: ContextCompressorOptions) {
    const originals = new Map<string, MessageContent>();
    let disabled = false;

    const originalContent = (message: BaseMessage): MessageContent => {
        if (isSummaryMessage(message) && message.id) {
            const original = originals.get(message.id);
            if (original !== undefined) return original;
        }
        return message.content as MessageContent;
    };

    return async function compress(messages: readonly BaseMessage[]): Promise<CompactionResult | null> {
        if (disabled || estimateMessagesTokens(messages) < options.triggerTokens) return null;
        const plan = planCompaction(messages, Math.floor(options.triggerTokens * KEEP_RATIO));
        if (!plan || plan.headTokens < options.triggerTokens * MIN_HEAD_RATIO) return null;
        if (plan.head.length === 1 && isSummaryMessage(plan.head[0]!)) return null;

        try {
            options.onStatus?.('正在压缩前文…');
            const summary = await summarizeWithFallback({
                messages: plan.head,
                candidates: options.getCandidates(),
                signal: options.signal,
                onAttemptFailed: (candidate, error) => {
                    console.warn(`[PageX] 压缩模型 ${candidate.label} 不可用：${toErrorMessage(error)}`);
                },
            });
            if (!summary) {
                disabled = true;
                options.onStatus?.('前文压缩不可用，本轮保留完整上下文');
                return null;
            }
            options.onSummary?.(summary);
            const result = buildCompactedMessages(plan, summary.text, originalContent);
            if (result.openerOriginal !== undefined && result.opener.id) {
                originals.set(result.opener.id, result.openerOriginal);
            }
            return result;
        } catch (error) {
            if (options.signal?.aborted) throw error;
            disabled = true;
            console.warn(`[PageX] 前文压缩失败，已跳过：${toErrorMessage(error)}`);
            return null;
        }
    };
}

export function createCompressionMiddleware(options: ContextCompressorOptions) {
    const compress = createContextCompressor(options);
    return createMiddleware({
        name: 'PagexCompression',
        beforeModel: async (state) => {
            const result = await compress(state.messages);
            return result ? { messages: result.update } : undefined;
        },
    });
}
