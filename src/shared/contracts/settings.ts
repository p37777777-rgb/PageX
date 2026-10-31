export const PROVIDER_IDS = [
    'openai',
    'anthropic',
    'google',
    'deepseek',
    'moonshot',
    'zhipu',
    'qwen',
    'ark',
    'xai',
    'siliconflow',
    'ollama',
    'openai-compatible',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const API_PROTOCOLS = ['chat-completions', 'responses'] as const;

export type ApiProtocol = (typeof API_PROTOCOLS)[number];

export type ExecutionMode = 'dom' | 'cdp';

export type MemorySettings = {
    enabled: boolean;
    provider: 'jina' | 'custom';
    embeddingEndpoint: string;
    embeddingModel: string;
    rerankerEndpoint: string;
    rerankerModel: string;
};

/** 前文压缩：上下文超过阈值时，用模型把早期消息总结成一段摘要。 */
export type CompressionSettings = {
    enabled: boolean;
    /** 按服务商记录用户指定的压缩模型 ID；留空表示自动选择该服务商的廉价模型。 */
    models: Partial<Record<ProviderId, string>>;
    /** 估算上下文超过这个 token 数时触发压缩。 */
    triggerTokens: number;
};

/** 设置页“测试压缩模型”的结果；fallback 表示首选模型不可用、实际由当前对话模型完成。 */
export type CompressionTestResult = {
    ok: boolean;
    model?: string;
    fallback?: boolean;
    errors?: string[];
};

/** 各服务商用于前文压缩的廉价模型；没有列出的服务商直接用当前对话模型压缩。 */
export const LIGHT_MODELS: Partial<Record<ProviderId, string>> = {
    openai: 'gpt-6-luna',
    anthropic: 'claude-haiku-5-5',
    google: 'gemini-3.5-flash-lite',
    deepseek: 'deepseek-flash',
    zhipu: 'glm-5.3-flash',
    qwen: 'qwen3.8-flash',
    xai: 'grok-4.3',
};

export function defaultCompressionModel(provider: ProviderId): string | undefined {
    return LIGHT_MODELS[provider];
}

export const COMPRESSION_TRIGGER_LIMITS = {
    min: 16_000,
    max: 1_000_000,
    default: 64_000,
} as const;

export type ModelSettings = {
    provider: ProviderId;
    model: string;
    baseURL?: string;
    apiProtocol: ApiProtocol;
    persistKey: boolean;
};

/** 每个服务商上次使用的模型、Base URL 和协议，切换回来时恢复。 */
export type ProviderProfile = {
    model: string;
    baseURL?: string;
    apiProtocol: ApiProtocol;
};

export type ProviderPreset = {
    label: string;
    model: string;
    apiProtocol: ApiProtocol;
    baseURL?: string;
    apiKeyHint?: string;
};
//预设供应商
export const PROVIDER_PRESETS: Record<ProviderId, ProviderPreset> = {
    openai: {
        label: 'OpenAI',
        model: 'gpt-5.2',
        apiProtocol: 'chat-completions',
        baseURL: 'https://api.openai.com/v1',
        apiKeyHint: 'sk-…',
    },
    anthropic: {
        label: 'Anthropic',
        model: 'claude-sonnet-4-6',
        apiProtocol: 'chat-completions',
        baseURL: 'https://api.anthropic.com',
        apiKeyHint: 'sk-ant-…',
    },
    google: {
        label: 'Google Gemini',
        model: 'gemini-3.8-flash',
        apiProtocol: 'chat-completions',
        baseURL: 'https://generativelanguage.googleapis.com',
        apiKeyHint: 'AIza…',
    },
    deepseek: {
        label: 'DeepSeek',
        // 官方推荐模型名，实际由 DeepSeek-V4.1-Flash-1017 提供服务（旧名 deepseek-v4-flash 已由新模型接管）
        model: 'deepseek-flash',
        apiProtocol: 'chat-completions',
        baseURL: 'https://api.deepseek.com',
        apiKeyHint: 'sk-…',
    },
    moonshot: {
        label: 'Moonshot Kimi',
        model: 'kimi-k3',
        apiProtocol: 'chat-completions',
        baseURL: 'https://api.moonshot.cn/v1',
        apiKeyHint: 'sk-…',
    },
    zhipu: {
        label: '智谱 GLM',
        model: 'glm-5.3',
        apiProtocol: 'chat-completions',
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
        apiKeyHint: '{id}.{secret}',
    },
    qwen: {
        label: '阿里云百炼',
        model: 'qwen3.7-plus',
        apiProtocol: 'chat-completions',
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKeyHint: 'sk-…',
    },
    ark: {
        label: '火山方舟',
        model: 'doubao-seed-1-8-251228',
        apiProtocol: 'chat-completions',
        baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKeyHint: 'ARK…',
    },
    xai: {
        label: 'xAI Grok',
        model: 'grok-4.7',
        apiProtocol: 'chat-completions',
        baseURL: 'https://api.x.ai/v1',
        apiKeyHint: 'xai-…',
    },
    siliconflow: {
        label: '硅基流动',
        model: 'deepseek-ai/DeepSeek-V4.1-Flash',
        apiProtocol: 'chat-completions',
        baseURL: 'https://api.siliconflow.cn/v1',
        apiKeyHint: 'sk-…',
    },
    ollama: {
        label: 'Ollama（本地）',
        model: 'qwen3:8b',
        apiProtocol: 'chat-completions',
        baseURL: 'http://localhost:11434/v1',
    },
    'openai-compatible': {
        label: '自定义 OpenAI 兼容',
        model: 'gpt-4o-mini',
        apiProtocol: 'chat-completions',
    },
};

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
//兼容能力判断，选择sdk
/** 使用 ChatOpenAI（OpenAI 兼容协议）的提供商：除 Anthropic / Google 原生 SDK 外都是。 */
export function providerUsesOpenAICompat(provider: ProviderId): boolean {
    return provider !== 'anthropic' && provider !== 'google';
}

export function providerSupportsResponsesApi(provider: ProviderId): boolean {
    return provider === 'openai' || provider === 'openai-compatible';
}
//模型目录
export type CatalogModel = {
    id: string;
    label: string;
    tag: string;
    apiProtocol: ApiProtocol;
};

export const PROVIDER_MODELS: Record<ProviderId, CatalogModel[]> = {
    openai: [
        { id: 'gpt-5.5', label: 'gpt-5.5', tag: 'Flagship', apiProtocol: 'chat-completions' },
        { id: 'gpt-5.5-pro', label: 'gpt-5.5-pro', tag: 'Pro', apiProtocol: 'responses' },
        { id: 'gpt-5.4', label: 'gpt-5.4', tag: 'Flagship', apiProtocol: 'chat-completions' },
        { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', tag: 'Fast', apiProtocol: 'chat-completions' },
        { id: 'gpt-5.2', label: 'gpt-5.2', tag: 'Flagship', apiProtocol: 'chat-completions' },
        { id: 'gpt-5.2-chat-latest', label: 'gpt-5.2-chat-latest', tag: 'Instant', apiProtocol: 'chat-completions' },
        { id: 'gpt-5.1', label: 'gpt-5.1', tag: 'Flagship', apiProtocol: 'chat-completions' },
        { id: 'gpt-5', label: 'gpt-5', tag: 'Flagship', apiProtocol: 'chat-completions' },
        { id: 'gpt-5-mini', label: 'gpt-5-mini', tag: 'Fast', apiProtocol: 'chat-completions' },
        { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini', tag: 'Fast', apiProtocol: 'chat-completions' },
        { id: 'gpt-4o-mini', label: 'gpt-4o-mini', tag: 'Fast', apiProtocol: 'chat-completions' },
        { id: 'o3', label: 'o3', tag: 'Reasoning', apiProtocol: 'responses' },
    ],
    anthropic: [
        { id: 'claude-opus-5-5', label: 'claude-opus-5-5', tag: 'Opus', apiProtocol: 'chat-completions' },
        { id: 'claude-opus-4-8', label: 'claude-opus-4-8', tag: 'Opus', apiProtocol: 'chat-completions' },
        { id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6', tag: 'Sonnet', apiProtocol: 'chat-completions' },
        { id: 'claude-haiku-4-5', label: 'claude-haiku-4-5', tag: 'Haiku', apiProtocol: 'chat-completions' },
    ],
    google: [
        { id: 'gemini-4-argon', label: 'gemini-4-argon', tag: 'Flagship', apiProtocol: 'chat-completions' },
        { id: 'gemini-3.8-flash', label: 'gemini-3.8-flash', tag: 'Flash', apiProtocol: 'chat-completions' },
        { id: 'gemini-3.7-flash', label: 'gemini-3.7-flash', tag: 'Flash', apiProtocol: 'chat-completions' },
        { id: 'gemini-3.5-flash', label: 'gemini-3.5-flash', tag: 'Flash', apiProtocol: 'chat-completions' },
        { id: 'gemini-3.5-flash-lite', label: 'gemini-3.5-flash-lite', tag: 'Flash-Lite', apiProtocol: 'chat-completions' },
    ],
    deepseek: [
        // 官方当前模型名：deepseek-flash 实际由 DeepSeek-V4.1-Flash-1017 提供服务
        { id: 'deepseek-flash', label: 'deepseek-flash (V4.1-Flash)', tag: 'Fast', apiProtocol: 'chat-completions' },
        { id: 'deepseek-v4-pro', label: 'deepseek-v4-pro', tag: 'Pro', apiProtocol: 'chat-completions' },
        { id: 'deepseek-chat', label: 'deepseek-chat', tag: 'Chat', apiProtocol: 'chat-completions' },
        { id: 'deepseek-reasoner', label: 'deepseek-reasoner', tag: 'Reasoning', apiProtocol: 'chat-completions' },
    ],
    moonshot: [
        // K2 系列 / kimi-latest / moonshot-v1 系列已全部下线（2026-05~08），当前主打 K3
        { id: 'kimi-k3', label: 'kimi-k3', tag: 'K3', apiProtocol: 'chat-completions' },
        { id: 'kimi-k2.7-code', label: 'kimi-k2.7-code', tag: 'Coding', apiProtocol: 'chat-completions' },
        { id: 'kimi-k2.7-code-highspeed', label: 'kimi-k2.7-code-highspeed', tag: 'Coding', apiProtocol: 'chat-completions' },
        { id: 'kimi-k2.6', label: 'kimi-k2.6', tag: 'K2.6', apiProtocol: 'chat-completions' },
    ],
    zhipu: [
        { id: 'glm-5.3', label: 'glm-5.3', tag: 'GLM-5.3', apiProtocol: 'chat-completions' },
        { id: 'glm-5.3-flash', label: 'glm-5.3-flash', tag: 'Flash', apiProtocol: 'chat-completions' },
        { id: 'glm-5.2', label: 'glm-5.2', tag: 'GLM-5.2', apiProtocol: 'chat-completions' },
        { id: 'glm-5.1', label: 'glm-5.1', tag: 'GLM-5.1', apiProtocol: 'chat-completions' },
        { id: 'glm-5', label: 'glm-5', tag: 'GLM-5', apiProtocol: 'chat-completions' },
        { id: 'glm-4.7-flash', label: 'glm-4.7-flash', tag: '免费', apiProtocol: 'chat-completions' },
    ],
    qwen: [
        // qwen3-max 及更早主线模型已于 2026-10-10 在百炼下线，当前主打 Qwen3.7 / 3.8 系列
        { id: 'qwen3.8-max', label: 'qwen3.8-max', tag: 'Max', apiProtocol: 'chat-completions' },
        { id: 'qwen3.7-max', label: 'qwen3.7-max', tag: 'Max', apiProtocol: 'chat-completions' },
        { id: 'qwen3.7-plus', label: 'qwen3.7-plus', tag: 'Plus', apiProtocol: 'chat-completions' },
        { id: 'qwen3.7-flash', label: 'qwen3.7-flash', tag: 'Flash', apiProtocol: 'chat-completions' },
        { id: 'qwen3.8-flash', label: 'qwen3.8-flash', tag: 'Flash', apiProtocol: 'chat-completions' },
        { id: 'qwen3.6-plus', label: 'qwen3.6-plus', tag: 'Plus', apiProtocol: 'chat-completions' },
    ],
    ark: [
        { id: 'doubao-seed-1-8-251228', label: 'doubao-seed-1-8-251228', tag: 'Seed', apiProtocol: 'chat-completions' },
        { id: 'doubao-seed-2-0-lite', label: 'doubao-seed-2-0-lite', tag: 'Lite', apiProtocol: 'chat-completions' },
        { id: 'doubao-seed-2-0-mini', label: 'doubao-seed-2-0-mini', tag: 'Mini', apiProtocol: 'chat-completions' },
    ],
    xai: [
        // grok-4 / grok-4.1-fast / grok-3 已于 2026-05-15 从 API 下线
        { id: 'grok-4.7', label: 'grok-4.7', tag: 'Grok-4.7', apiProtocol: 'chat-completions' },
        { id: 'grok-4.6', label: 'grok-4.6', tag: 'Grok-4.6', apiProtocol: 'chat-completions' },
        { id: 'grok-4.5', label: 'grok-4.5', tag: 'Grok-4.5', apiProtocol: 'chat-completions' },
        { id: 'grok-4.3', label: 'grok-4.3', tag: 'Grok-4.3', apiProtocol: 'chat-completions' },
        { id: 'grok-4.20', label: 'grok-4.20', tag: '长上下文', apiProtocol: 'chat-completions' },
    ],
    siliconflow: [
        { id: 'deepseek-ai/DeepSeek-V4.1-Flash', label: 'DeepSeek-V4.1-Flash', tag: 'DeepSeek', apiProtocol: 'chat-completions' },
        { id: 'deepseek-ai/DeepSeek-V4-Pro', label: 'DeepSeek-V4-Pro', tag: 'DeepSeek', apiProtocol: 'chat-completions' },
        { id: 'deepseek-ai/DeepSeek-V4-Flash', label: 'DeepSeek-V4-Flash', tag: 'DeepSeek', apiProtocol: 'chat-completions' },
        { id: 'zai-org/GLM-5.3', label: 'GLM-5.3', tag: 'GLM', apiProtocol: 'chat-completions' },
        { id: 'moonshotai/Kimi-K2.6', label: 'Kimi-K2.6', tag: 'Kimi', apiProtocol: 'chat-completions' },
        { id: 'Qwen/Qwen3.8-27B', label: 'Qwen3.8-27B', tag: 'Qwen', apiProtocol: 'chat-completions' },
        { id: 'Qwen/Qwen3-VL-32B-Instruct', label: 'Qwen3-VL-32B-Instruct', tag: 'Qwen', apiProtocol: 'chat-completions' },
    ],
    ollama: [
        { id: 'qwen3:8b', label: 'qwen3:8b', tag: '本地', apiProtocol: 'chat-completions' },
        { id: 'llama3.1:8b', label: 'llama3.1:8b', tag: '本地', apiProtocol: 'chat-completions' },
        { id: 'deepseek-r1:7b', label: 'deepseek-r1:7b', tag: '本地', apiProtocol: 'chat-completions' },
        { id: 'gemma3:12b', label: 'gemma3:12b', tag: '本地', apiProtocol: 'chat-completions' },
        { id: 'mistral:7b', label: 'mistral:7b', tag: '本地', apiProtocol: 'chat-completions' },
        { id: 'phi4:14b', label: 'phi4:14b', tag: '本地', apiProtocol: 'chat-completions' },
    ],
    'openai-compatible': [
        { id: 'gpt-4o-mini', label: 'gpt-4o-mini', tag: 'Compat', apiProtocol: 'chat-completions' },
    ],
};

export function modelsForProvider(provider: ProviderId): CatalogModel[] {
    return PROVIDER_MODELS[provider];
}
//在目录里找模型,或者provider兜底
export function resolveCatalogModel(provider: ProviderId, model: string): CatalogModel {
    return (
        PROVIDER_MODELS[provider].find((item) => item.id === model) ?? {
            id: model,
            label: model,
            tag: PROVIDER_PRESETS[provider].label,
            apiProtocol: PROVIDER_PRESETS[provider].apiProtocol,
        }
    );
}

/**
 * 解析最终展示的模型列表：在线拉取成功（非空）时完全替换内置目录；
 * 未获取到在线列表（无密钥、拉取失败或为空）时才回退内置目录。
 */
export function resolveModelList(base: CatalogModel[], remote?: CatalogModel[]): CatalogModel[] {
    if (remote && remote.length > 0) return remote;
    return base;
}
//用哪个模型、各服务商记忆、记忆功能、执行模式、是否跨域、截图相关开关、禁用工具、主题。
export type AgentSettings = {
    model: ModelSettings;
    /** 按服务商记住上次的模型 / URL / 协议，切换回来时恢复而不是回到预设。 */
    providerProfiles: Partial<Record<ProviderId, ProviderProfile>>;
    memory: MemorySettings;
    compression: CompressionSettings;
    executionMode: ExecutionMode;
    allowCrossOrigin: boolean;
    captureScreenshots: boolean;
    /** 截图以真实图片（image_url 内容块）传给模型，而不是 base64 文本；需要模型支持视觉 */
    screenshotAsImage: boolean;
    captureDevtools: boolean;
    disabledBuiltinTools: string[];
    theme: 'light' | 'dark' | 'system';
};

//?model/memory 被 Omit 掉后用更细的局部类型重新定义（可以只改模型里的某个字段）。
export type AgentSettingsPatch = Partial<Omit<AgentSettings, 'model' | 'memory' | 'compression' | 'providerProfiles'>> & {
    model?: Partial<ModelSettings>;
    memory?: Partial<MemorySettings>;
    compression?: Partial<CompressionSettings>;
    providerProfiles?: AgentSettings['providerProfiles'];
};

/** 清洗压缩设置：未知服务商、空模型名和越界阈值都回落到安全值，保证旧存储或坏数据不会让运行时出错。 */
export function normalizeCompressionSettings(value: unknown): CompressionSettings {
    const defaults = DEFAULT_SETTINGS.compression;
    const raw = value && typeof value === 'object' ? (value as Partial<Record<keyof CompressionSettings, unknown>>) : {};
    const models: Partial<Record<ProviderId, string>> = {};
    if (raw.models && typeof raw.models === 'object') {
        for (const [provider, model] of Object.entries(raw.models as Record<string, unknown>)) {
            if (!(PROVIDER_IDS as readonly string[]).includes(provider)) continue;
            if (typeof model !== 'string' || !model.trim()) continue;
            models[provider as ProviderId] = model.trim();
        }
    }
    return {
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaults.enabled,
        models,
        triggerTokens: typeof raw.triggerTokens === 'number'
            ? clampCompressionTrigger(raw.triggerTokens)
            : defaults.triggerTokens,
    };
}

export function clampCompressionTrigger(value: number): number {
    if (!Number.isFinite(value)) return COMPRESSION_TRIGGER_LIMITS.default;
    return Math.min(COMPRESSION_TRIGGER_LIMITS.max, Math.max(COMPRESSION_TRIGGER_LIMITS.min, Math.round(value)));
}
//把当前模型设置「快照」成 profile，用于切换时记忆。
export function snapshotProviderProfile(model: ModelSettings): ProviderProfile {
    const profile: ProviderProfile = {
        model: model.model,
        apiProtocol: model.apiProtocol,
    };
    if (model.baseURL !== undefined) profile.baseURL = model.baseURL;
    return profile;
}
//切到某服务商时，生成它的 ModelSettings（优先恢复上次的，否则用预设）。!!!!!!
export function modelSettingsForProvider(
    provider: ProviderId,
    profiles: Partial<Record<ProviderId, ProviderProfile>> | undefined,
    persistKey: boolean,
): ModelSettings {
    const preset = PROVIDER_PRESETS[provider];
    const saved = profiles?.[provider];
    const next: ModelSettings = {
        provider,
        persistKey,
        model: saved?.model ?? preset.model,
        apiProtocol: saved?.apiProtocol ?? preset.apiProtocol,
    };
    if (saved?.baseURL !== undefined) next.baseURL = saved.baseURL;
    return next;
}
//特殊处理 baseURL === undefined 时真正删除该字段（而不是留空）。
function mergeModelSettings(base: ModelSettings, patch?: Partial<ModelSettings>): ModelSettings {
    if (!patch) return { ...base };
    const next = { ...base, ...patch };
    if ('baseURL' in patch && patch.baseURL === undefined) {
        delete next.baseURL;
    }
    return next;
}

/** 合并设置补丁：切换服务商时先归档当前项，再恢复目标服务商上次的模型 / URL / 协议。 */
export function applySettingsPatch(current: AgentSettings, patch: AgentSettingsPatch): AgentSettings {
    const profiles: Partial<Record<ProviderId, ProviderProfile>> =
        patch.providerProfiles !== undefined
            ? { ...patch.providerProfiles }
            : {
                ...current.providerProfiles,
                [current.model.provider]: snapshotProviderProfile(current.model),
            };

    const persistKey = patch.model?.persistKey ?? current.model.persistKey;
    let model: ModelSettings;
    if (patch.model?.provider && patch.model.provider !== current.model.provider) {
        model = mergeModelSettings(
            modelSettingsForProvider(patch.model.provider, profiles, persistKey),
            patch.model,
        );
    } else {
        model = mergeModelSettings(current.model, patch.model);
    }

    if (model.provider === 'deepseek' && model.apiProtocol === 'responses') {
        model = { ...model, apiProtocol: 'chat-completions' };
    }
    profiles[model.provider] = snapshotProviderProfile(model);

    return {
        ...current,
        ...patch,
        model,
        memory: { ...current.memory, ...patch.memory },
        compression: normalizeCompressionSettings({ ...current.compression, ...patch.compression }),
        providerProfiles: profiles,
    };
}

export type SecretMap = Partial<Record<ProviderId, string>>;

export type PermissionState = {
    allSites: boolean;
    debugger: boolean;
    tabs: boolean;
    origins: string[];
};

export const DEFAULT_SETTINGS: AgentSettings = {
    model: {
        provider: 'openai',
        model: 'gpt-5.2',
        apiProtocol: 'chat-completions',
        persistKey: true,
    },
    providerProfiles: {},
    memory: {
        enabled: true,
        provider: 'jina',
        embeddingEndpoint: 'https://api.jina.ai/v1/embeddings',
        embeddingModel: 'jina-embeddings-v5-text-small',
        rerankerEndpoint: 'https://api.jina.ai/v1/rerank',
        rerankerModel: 'jina-reranker-v3.5',
    },
    compression: {
        enabled: true,
        models: {},
        triggerTokens: COMPRESSION_TRIGGER_LIMITS.default,
    },
    executionMode: 'dom',
    allowCrossOrigin: false,
    captureScreenshots: true,
    screenshotAsImage: true,
    captureDevtools: true,
    disabledBuiltinTools: [],
    theme: 'system',
};
