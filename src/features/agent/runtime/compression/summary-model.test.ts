import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    applySettingsPatch,
    defaultCompressionModel,
    DEFAULT_SETTINGS,
    LIGHT_MODELS,
    normalizeCompressionSettings,
    PROVIDER_IDS,
    type AgentSettings,
    type ProviderId,
} from '@/shared/contracts/settings';
import { createChatModel, providerHasThinkingSwitch } from '@/features/agent/runtime/models';
import { buildSummaryCandidates, testCompressionModel, type ModelFactory } from './summary-model';
import { resetSummaryFailures } from './summarizer';

function settingsFor(provider: ProviderId, model: string, compression: Partial<AgentSettings['compression']> = {}): AgentSettings {
    return {
        ...DEFAULT_SETTINGS,
        model: { ...DEFAULT_SETTINGS.model, provider, model },
        compression: { ...DEFAULT_SETTINGS.compression, ...compression },
    };
}

const SUMMARY = '## 用户目标与限制\n修改通知邮箱，暂不保存。';

afterEach(() => resetSummaryFailures());

describe('buildSummaryCandidates', () => {
    it('用户指定的模型优先，其次是关闭思考的对话模型，最后不带关闭思考参数', () => {
        const settings = settingsFor('zhipu', 'glm-5.3', { models: { zhipu: 'my-cheap-glm' } });
        const factory = vi.fn<ModelFactory>(() => ({ invoke: async () => ({ content: SUMMARY }) }));
        const candidates = buildSummaryCandidates(settings, {}, factory);
        expect(candidates.map((item) => item.label)).toEqual([
            'zhipu/my-cheap-glm',
            'zhipu/glm-5.3',
            'zhipu/glm-5.3（不带关闭思考参数）',
        ]);
        candidates[1]!.create();
        expect(factory).toHaveBeenLastCalledWith(settings, {}, 'glm-5.3', true);
        candidates[2]!.create();
        expect(factory).toHaveBeenLastCalledWith(settings, {}, 'glm-5.3', false);
    });

    it('未指定时用内置廉价模型；与对话模型相同则不重复', () => {
        for (const provider of PROVIDER_IDS) {
            const light = defaultCompressionModel(provider);
            const plain = providerHasThinkingSwitch(provider) ? [`${provider}/main-model（不带关闭思考参数）`] : [];
            const labels = buildSummaryCandidates(settingsFor(provider, 'main-model'), {}).map((item) => item.label);
            expect(labels).toEqual([...(light ? [`${provider}/${light}`] : []), `${provider}/main-model`, ...plain]);
            if (light) {
                expect(buildSummaryCandidates(settingsFor(provider, light), {})).toHaveLength(1 + plain.length);
            }
        }
    });

    it('不同 Base URL 的同名模型不共用失败记录', () => {
        const base = settingsFor('openai-compatible', 'm');
        const a = buildSummaryCandidates({ ...base, model: { ...base.model, baseURL: 'https://a/v1' } }, {});
        const b = buildSummaryCandidates({ ...base, model: { ...base.model, baseURL: 'https://b/v1' } }, {});
        expect(a[0]!.key).not.toBe(b[0]!.key);
    });
});

describe('testCompressionModel', () => {
    it('报告实际完成摘要的模型，以及是否发生回退', async () => {
        const settings = settingsFor('qwen', 'qwen3.7-plus', { models: { qwen: 'missing-model' } });
        const factory: ModelFactory = (_settings, _secrets, modelId) => ({
            invoke: async () => {
                if (modelId === 'missing-model') throw new Error('model_not_found');
                return { content: SUMMARY };
            },
        });
        const result = await testCompressionModel(settings, {}, factory);
        expect(result).toMatchObject({ ok: true, model: 'qwen/qwen3.7-plus', fallback: true });
        expect(result.errors?.[0]).toContain('model_not_found');
    });
});

describe('压缩用的模型客户端', () => {
    const summaryModel = (provider: ProviderId, model: string, disableThinking?: boolean) =>
        createChatModel(settingsFor(provider, model), { [provider]: 'sk-test' }, {
            purpose: 'summary',
            model: LIGHT_MODELS[provider] ?? model,
            disableThinking,
        }) as unknown as Record<string, unknown>;

    it('DeepSeek 压缩时关闭思考、温度 0、非流式，对话模型不受影响', () => {
        expect(summaryModel('deepseek', 'deepseek-v4-pro')).toMatchObject({
            model: 'deepseek-flash',
            temperature: 0,
            streaming: false,
            maxTokens: 4_096,
            modelKwargs: { thinking: { type: 'disabled' } },
        });
        const chat = createChatModel(settingsFor('deepseek', 'deepseek-v4-pro'), { deepseek: 'sk-test' });
        expect(chat).toMatchObject({ streaming: true, modelKwargs: { thinking: { type: 'enabled' } } });
    });

    it('沿用当前服务商的地址；可以去掉关闭思考的参数重试', () => {
        expect(summaryModel('qwen', 'qwen3.7-plus')).toMatchObject({
            model: 'qwen3.8-flash',
            modelKwargs: { enable_thinking: false },
            clientConfig: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
        });
        expect(summaryModel('qwen', 'qwen3.7-plus', false).modelKwargs).toEqual({});
    });

    it('没有统一思考开关的服务商不发送额外参数', () => {
        expect(summaryModel('openai', 'gpt-5.2').modelKwargs).toEqual({});
        expect(summaryModel('anthropic', 'claude-sonnet-4-6')).toMatchObject({ model: 'claude-haiku-5-5', maxTokens: 4_096 });
        expect(summaryModel('google', 'gemini-3.8-flash')).toMatchObject({ model: 'gemini-3.5-flash-lite', maxOutputTokens: 4_096 });
    });
});

describe('压缩设置', () => {
    it('廉价模型表只包含已知服务商', () => {
        for (const [provider, model] of Object.entries(LIGHT_MODELS)) {
            expect(PROVIDER_IDS as readonly string[]).toContain(provider);
            expect(model?.trim()).toBeTruthy();
        }
    });

    it('清洗旧数据和坏数据', () => {
        expect(normalizeCompressionSettings(undefined)).toEqual(DEFAULT_SETTINGS.compression);
        expect(normalizeCompressionSettings({
            enabled: 'yes',
            models: { qwen: '  qwen-x  ', unknown: 'a', zhipu: '   ', openai: 1 },
            triggerTokens: 10,
        })).toEqual({ enabled: true, models: { qwen: 'qwen-x' }, triggerTokens: 16_000 });
        expect(normalizeCompressionSettings({ triggerTokens: Number.NaN }).triggerTokens).toBe(64_000);
        expect(normalizeCompressionSettings({ triggerTokens: 5e9 }).triggerTokens).toBe(1_000_000);
    });

    it('补丁合并时保留其他服务商的压缩模型，恢复默认时清空', () => {
        const current = { ...DEFAULT_SETTINGS, compression: { ...DEFAULT_SETTINGS.compression, models: { qwen: 'a' } } };
        const patched = applySettingsPatch(current, { compression: { enabled: false } });
        expect(patched.compression).toEqual({ ...DEFAULT_SETTINGS.compression, enabled: false, models: { qwen: 'a' } });
        expect(applySettingsPatch(patched, { ...DEFAULT_SETTINGS }).compression).toEqual(DEFAULT_SETTINGS.compression);
    });
});
