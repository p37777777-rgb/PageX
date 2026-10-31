import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOpenAI } from '@langchain/openai';
import {
    PROVIDER_PRESETS,
    providerSupportsResponsesApi,
    type AgentSettings,
    type ApiProtocol,
    type ProviderId,
    type SecretMap,
} from '@/shared/contracts/settings';

//按设置和密钥创建模型客户端
//密钥只从存储里读，不要写进日志、提示词或页面。
export { providerSupportsResponsesApi };

export function resolveApiKey(provider: ProviderId, secrets: SecretMap): string {
    const key = secrets[provider];
    if (!key) throw new Error(`尚未配置 ${provider} 的 API Key`);
    return key;
}

export function resolveApiProtocol(settings: AgentSettings): ApiProtocol {
    const { provider, apiProtocol } = settings.model;
    if (providerSupportsResponsesApi(provider)) {
        return apiProtocol ?? PROVIDER_PRESETS[provider].apiProtocol;
    }
    return 'chat-completions';
}

export function resolveModelBaseURL(settings: AgentSettings): string | undefined {
    const { provider, baseURL } = settings.model;
    const preset = PROVIDER_PRESETS[provider];
    if (provider === 'openai-compatible') {
        if (!baseURL?.trim()) throw new Error('兼容端点需要填写 Base URL');
        return baseURL.trim();
    }
    if (provider === 'anthropic' || provider === 'google') {
        // 原生 SDK 使用固定端点，暂不支持自定义
        return baseURL?.trim() || undefined;
    }
    return baseURL?.trim() || preset.baseURL;
}

const DEFAULT_MAX_RETRIES = 3;

/** 压缩摘要的输出上限：提示词要求不超过 1500 字，留出余量。 */
const SUMMARY_MAX_OUTPUT_TOKENS = 4_096;
/** 压缩有自己的回退链，SDK 层少重试，失败时能尽快换下一个模型。 */
const SUMMARY_MAX_RETRIES = 1;

/**
 * OpenAI 兼容端点上关闭思考的请求参数。只列出服务商文档里明确的写法；
 * Anthropic 默认不思考，其余服务商没有统一开关，不发送未知参数以免请求被拒。
 */
const THINKING_OFF_KWARGS: Partial<Record<ProviderId, Record<string, unknown>>> = {
    deepseek: { thinking: { type: 'disabled' } },
    zhipu: { thinking: { type: 'disabled' } },
    ark: { thinking: { type: 'disabled' } },
    qwen: { enable_thinking: false },
    siliconflow: { enable_thinking: false },
};

export function providerHasThinkingSwitch(provider: ProviderId): boolean {
    return provider in THINKING_OFF_KWARGS;
}

export type ChatModelOptions = {
    /** chat：对话主模型；summary：前文压缩，温度 0、非流式、限制输出长度。 */
    purpose?: 'chat' | 'summary';
    /** 覆盖设置里的模型 ID，服务商、地址和密钥仍沿用设置。 */
    model?: string;
    /** summary 时是否发送关闭思考的参数，默认发送；端点不认这个参数时可以关掉重试。 */
    disableThinking?: boolean;
};

export function createChatModel(settings: AgentSettings, secrets: SecretMap, options: ChatModelOptions = {}) {
    const { provider } = settings.model;
    const model = options.model ?? settings.model.model;
    const summary = options.purpose === 'summary';
    const maxRetries = summary ? SUMMARY_MAX_RETRIES : DEFAULT_MAX_RETRIES;

    if (provider === 'anthropic') {
        return new ChatAnthropic({
            apiKey: resolveApiKey(provider, secrets),
            model,
            temperature: 0,
            maxRetries,
            ...(summary ? { maxTokens: SUMMARY_MAX_OUTPUT_TOKENS } : {}),
        });
    }
    if (provider === 'google') {
        return new ChatGoogleGenerativeAI({
            apiKey: resolveApiKey(provider, secrets),
            model,
            temperature: 0,
            maxRetries,
            ...(summary ? { maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS } : {}),
        });
    }

    const baseURL = resolveModelBaseURL(settings);
    const protocol = resolveApiProtocol(settings);
    // Ollama 本地端点无需密钥，任意占位即可
    const apiKey = provider === 'ollama' ? 'ollama' : resolveApiKey(provider, secrets);
    const modelKwargs = summary
        ? options.disableThinking === false ? undefined : THINKING_OFF_KWARGS[provider]
        : chatModelKwargs(provider, protocol);
    return new ChatOpenAI({
        apiKey,
        model,
        temperature: 0,
        streaming: !summary,
        maxRetries,
        useResponsesApi: protocol === 'responses',
        ...(summary ? { maxTokens: SUMMARY_MAX_OUTPUT_TOKENS } : {}),
        ...(modelKwargs ? { modelKwargs } : {}),
        configuration: baseURL ? { baseURL } : undefined,
    });
}

/** 对话主模型的额外参数：DeepSeek 默认开启高强度思考，让思考过程显示在界面上。 */
function chatModelKwargs(provider: ProviderId, protocol: ApiProtocol): Record<string, unknown> | undefined {
    if (provider !== 'deepseek') return undefined;
    return protocol === 'responses'
        ? { reasoning: { effort: 'high' } }
        : { thinking: { type: 'enabled' }, reasoning_effort: 'high' };
}

export async function testModelConnection(settings: AgentSettings, secrets: SecretMap) {
    const model = createChatModel(settings, secrets);
    const result = await model.invoke('只回复：ok');
    return {
        ok: true,
        preview: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
    };
}
