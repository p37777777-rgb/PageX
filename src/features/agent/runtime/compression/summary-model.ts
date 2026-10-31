/*决定用哪些模型来压缩，以及按什么顺序尝试：
1. 用户为当前服务商指定的压缩模型，没有指定时用该服务商的廉价模型；
2. 当前对话模型，关闭思考、温度设为 0；
3. 当前对话模型，不发送关闭思考的参数（兼容不认这个参数的端点）。
所有候选都沿用当前服务商的 API Key 和地址，不会把对话发给用户没有选择的服务商。*/
import { HumanMessage, ToolMessage, AIMessage } from '@langchain/core/messages';
import { createChatModel, providerHasThinkingSwitch } from '@/features/agent/runtime/models';
import { toErrorMessage } from '@/shared/contracts/errors';
import {
    defaultCompressionModel,
    type AgentSettings,
    type CompressionTestResult,
    type SecretMap,
} from '@/shared/contracts/settings';
import { resetSummaryFailures, summarizeWithFallback, type SummaryCandidate, type SummaryModel } from './summarizer';

/** 交给压缩模型的记录文本上限；各模型上下文窗口不同，取一个大多数模型都能接受的值。 */
const MAX_SUMMARY_INPUT_TOKENS = 120_000;

export type ModelFactory = (
    settings: AgentSettings,
    secrets: SecretMap,
    modelId: string,
    disableThinking: boolean,
) => SummaryModel;

const defaultFactory: ModelFactory = (settings, secrets, modelId, disableThinking) =>
    createChatModel(settings, secrets, { purpose: 'summary', model: modelId, disableThinking });

/** 当前服务商下的首选压缩模型：用户指定的优先，其次是内置的廉价模型。 */
export function preferredCompressionModel(settings: AgentSettings): string | undefined {
    const provider = settings.model.provider;
    return settings.compression.models[provider]?.trim() || defaultCompressionModel(provider);
}

export function buildSummaryCandidates(
    settings: AgentSettings,
    secrets: SecretMap,
    factory: ModelFactory = defaultFactory,
): SummaryCandidate[] {
    const { provider, baseURL, model: mainModel } = settings.model;
    const maxInputTokens = Math.min(MAX_SUMMARY_INPUT_TOKENS, settings.compression.triggerTokens);
    const candidate = (modelId: string, disableThinking: boolean): SummaryCandidate => ({
        key: `${provider}|${baseURL ?? ''}|${modelId}|${disableThinking ? 'no-think' : 'plain'}`,
        label: disableThinking ? `${provider}/${modelId}` : `${provider}/${modelId}（不带关闭思考参数）`,
        maxInputTokens,
        create: () => factory(settings, secrets, modelId, disableThinking),
    });
    const ids = [preferredCompressionModel(settings), mainModel].filter(
        (id, index, all): id is string => Boolean(id) && all.indexOf(id) === index,
    );
    const candidates = ids.map((modelId) => candidate(modelId, true));
    if (providerHasThinkingSwitch(provider)) candidates.push(candidate(mainModel, false));
    return candidates;
}

/** 设置页“测试压缩模型”：用一小段固定对话走完整的候选链，并清空失败缓存，让修改后的配置立即生效。 */
export async function testCompressionModel(
    settings: AgentSettings,
    secrets: SecretMap,
    factory: ModelFactory = defaultFactory,
): Promise<CompressionTestResult> {
    resetSummaryFailures();
    const candidates = buildSummaryCandidates(settings, secrets, factory);
    const errors: string[] = [];
    try {
        const result = await summarizeWithFallback({
            messages: SAMPLE_HISTORY,
            candidates,
            onAttemptFailed: (candidate, error) => errors.push(`${candidate.label}：${toErrorMessage(error)}`),
        });
        if (!result) return { ok: false, errors };
        return {
            ok: true,
            model: result.candidate.label,
            fallback: result.candidate !== candidates[0],
            errors,
        };
    } finally {
        resetSummaryFailures();
    }
}

const SAMPLE_HISTORY = [
    new HumanMessage('帮我在设置页把通知邮箱改成 test@example.com，先不要保存。'),
    new AIMessage({
        content: '',
        tool_calls: [{ id: 'call_1', name: 'type_text', args: { text: 'test@example.com' } }],
    }),
    new ToolMessage({ tool_call_id: 'call_1', name: 'type_text', content: '{"changed":true,"satisfied":true}' }),
    new AIMessage('已填写通知邮箱，尚未保存，等待你确认。'),
];
