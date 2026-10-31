/*按候选顺序调用压缩模型生成摘要：前一个失败（模型不存在、无权限、超时、输出为空）就换下一个，
全部失败返回 null，由调用方决定跳过本次压缩。用户中止任务时立即抛出，不再尝试。*/
import type { BaseMessage } from '@langchain/core/messages';
import { isRateLimitError, retryWithBackoff } from '@/features/agent/runtime/middleware';
import { buildSummaryPrompt } from '@/features/agent/runtime/prompts';
import { toErrorMessage } from '@/shared/contracts/errors';
import { contentText } from './content';
import { formatTranscript } from './transcript';

/** 摘要只需要 invoke；用最小接口而不是具体模型类，便于替换和测试。 */
export type SummaryModel = {
    invoke(input: string, options?: { signal?: AbortSignal; tags?: string[] }): Promise<{ content: unknown }>;
};

export type SummaryCandidate = {
    /** 失败缓存的键，同一服务商、端点和模型共用一份记录。 */
    key: string;
    /** 日志里显示的名称，不含密钥。 */
    label: string;
    /** 交给这个模型的记录文本上限。 */
    maxInputTokens: number;
    create: () => SummaryModel;
};

export type SummaryResult = {
    text: string;
    candidate: SummaryCandidate;
    response: { content: unknown };
};

/** 不可恢复的失败（模型不存在、无权限等）在这段时间内直接跳过，避免每次压缩都先等一次失败。 */
const FAILURE_TTL_MS = 10 * 60 * 1000;
const ATTEMPT_TIMEOUT_MS = 90 * 1000;
/** 短于这个长度的输出视为无效摘要，长于上限的截断。 */
const MIN_SUMMARY_CHARS = 20;
const MAX_SUMMARY_CHARS = 6_000;
/** 给压缩提示词和模型输出预留的 token。 */
const PROMPT_RESERVE_TOKENS = 3_000;
/** LangGraph 的 messages 流会跳过带这个标签的调用，摘要生成过程不会出现在界面上。 */
const NO_STREAM_TAG = 'nostream';

const recentFailures = new Map<string, number>();

export function resetSummaryFailures(): void {
    recentFailures.clear();
}

class SummaryTimeoutError extends Error {
    constructor() {
        super('压缩模型响应超时');
        this.name = 'SummaryTimeoutError';
    }
}

/** 限流、超时和网络错误可能马上恢复，不记入失败缓存。 */
function isTransientError(error: unknown): boolean {
    if (error instanceof SummaryTimeoutError || isRateLimitError(error)) return true;
    return /network|fetch|timeout|timed out|ECONNRESET|socket|503|502|overloaded/i.test(toErrorMessage(error));
}

/** 部分推理模型把思考过程写成 <think> 标签混在正文里。 */
export function cleanSummaryText(raw: string): string {
    const text = raw
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<think>[\s\S]*$/i, '')
        .trim();
    return text.length > MAX_SUMMARY_CHARS ? `${text.slice(0, MAX_SUMMARY_CHARS)}…` : text;
}

async function invokeWithTimeout(
    model: SummaryModel,
    prompt: string,
    signal: AbortSignal | undefined,
    timeoutMs: number,
): Promise<{ content: unknown }> {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            // 先让超时分支落定，再中止请求，保证 race 的结果是超时而不是中止。
            reject(new SummaryTimeoutError());
            controller.abort();
        }, timeoutMs);
    });
    try {
        return await Promise.race([
            model.invoke(prompt, { signal: controller.signal, tags: [NO_STREAM_TAG] }),
            timeout,
        ]);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', forwardAbort);
    }
}

export async function summarizeWithFallback(options: {
    messages: readonly BaseMessage[];
    candidates: readonly SummaryCandidate[];
    signal?: AbortSignal;
    onAttemptFailed?: (candidate: SummaryCandidate, error: unknown) => void;
    timeoutMs?: number;
    now?: () => number;
}): Promise<SummaryResult | null> {
    const now = options.now ?? Date.now;
    for (const candidate of options.candidates) {
        const failedAt = recentFailures.get(candidate.key);
        if (failedAt !== undefined && now() - failedAt < FAILURE_TTL_MS) continue;
        try {
            const transcript = formatTranscript(
                options.messages,
                Math.max(1_000, candidate.maxInputTokens - PROMPT_RESERVE_TOKENS),
            );
            const prompt = buildSummaryPrompt(transcript);
            const model = candidate.create();
            const response = await retryWithBackoff(
                () => invokeWithTimeout(model, prompt, options.signal, options.timeoutMs ?? ATTEMPT_TIMEOUT_MS),
                { maxRetries: 2, delayMs: 1_000, signal: options.signal },
            );
            const text = cleanSummaryText(contentText(response.content));
            if (text.length < MIN_SUMMARY_CHARS) throw new Error('压缩模型返回了空摘要');
            recentFailures.delete(candidate.key);
            return { text, candidate, response };
        } catch (error) {
            if (options.signal?.aborted) throw error;
            if (!isTransientError(error)) recentFailures.set(candidate.key, now());
            options.onAttemptFailed?.(candidate, error);
        }
    }
    return null;
}
