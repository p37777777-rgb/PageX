import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatModel, resolveApiProtocol, resolveModelBaseURL } from '@/features/agent/runtime/models';
import { fetchProviderModels, clearModelListCache } from '@/features/settings/model-list';
import {
  API_PROTOCOLS,
  DEFAULT_SETTINGS,
  PROVIDER_IDS,
  modelsForProvider,
  providerSupportsResponsesApi,
  providerUsesOpenAICompat,
  resolveCatalogModel,
  resolveModelList,
  type AgentSettings,
} from '@/shared/contracts/settings';
import { parseRpcPayload } from '@/shared/contracts/rpc';

// 以默认设置为底座，仅在 model 分组上做局部改写。
function withModel(patch: Partial<AgentSettings['model']>): AgentSettings {
  return structuredClone({
    ...DEFAULT_SETTINGS,
    model: { ...DEFAULT_SETTINGS.model, ...patch },
  });
}

describe('模型工厂：协议与端点解析', () => {
  it('DeepSeek 走 chat-completions 且端点为官方地址', () => {
    const config = withModel({ provider: 'deepseek', model: 'deepseek-reasoner' });
    expect(providerSupportsResponsesApi('deepseek')).toBe(false);
    expect(resolveApiProtocol(config)).toBe('chat-completions');
    expect(resolveModelBaseURL(config)).toBe('https://api.deepseek.com');
  });

  it('OpenAI 默认 chat-completions，显式指定时可切换到 responses', () => {
    expect(resolveApiProtocol(DEFAULT_SETTINGS)).toBe('chat-completions');
    expect(resolveApiProtocol(withModel({ provider: 'openai', apiProtocol: 'responses' }))).toBe('responses');
  });

  it('兼容端点必须提供 Base URL，提供的值会去掉首尾空白', () => {
    expect(() => resolveModelBaseURL(withModel({ provider: 'openai-compatible' }))).toThrow(/Base URL/);
    expect(
      resolveModelBaseURL(withModel({ provider: 'openai-compatible', baseURL: ' https://relay.example.com/v1 ' })),
    ).toBe('https://relay.example.com/v1');
  });

  it('兼容系服务商使用预设端点，原生 SDK 服务商不套用预设', () => {
    expect(resolveModelBaseURL(withModel({ provider: 'moonshot' }))).toBe('https://api.moonshot.cn/v1');
    expect(resolveModelBaseURL(withModel({ provider: 'qwen' }))).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    );
    expect(resolveModelBaseURL(withModel({ provider: 'ollama' }))).toBe('http://localhost:11434/v1');
    expect(resolveModelBaseURL(withModel({ provider: 'anthropic' }))).toBeUndefined();
  });
});

describe('模型工厂：客户端构造', () => {
  it('DeepSeek 的 chat-completions 客户端开启思考参数且不使用 responses API', () => {
    const model = createChatModel(
      withModel({ provider: 'deepseek', model: 'deepseek-flash', apiProtocol: 'chat-completions' }),
      { deepseek: 'sk-fixed-001' },
    );
    expect(model).toMatchObject({
      useResponsesApi: false,
      modelKwargs: {
        thinking: { type: 'enabled' },
        reasoning_effort: 'high',
      },
    });
  });

  it('Ollama 无需密钥即可创建本地客户端', () => {
    const config = withModel({ provider: 'ollama', model: 'qwen3:8b' });
    expect(providerUsesOpenAICompat('ollama')).toBe(true);
    expect(() => createChatModel(config, {})).not.toThrow();
    expect(createChatModel(config, {})).toMatchObject({
      useResponsesApi: false,
      clientConfig: { baseURL: 'http://localhost:11434/v1' },
    });
  });
});

describe('模型目录', () => {
  it('各服务商目录非空、协议合法且互不重复', () => {
    const signatures = PROVIDER_IDS.map((id) => JSON.stringify(modelsForProvider(id).map((m) => m.id)));
    expect(new Set(signatures).size).toBe(PROVIDER_IDS.length);
    for (const id of PROVIDER_IDS) {
      const catalog = modelsForProvider(id);
      expect(catalog.length).toBeGreaterThan(0);
      for (const entry of catalog) {
        expect(API_PROTOCOLS).toContain(entry.apiProtocol);
        expect(entry.id).toBeTruthy();
      }
    }
  });

  it('目录命中返回目录项，未命中按服务商预设兜底', () => {
    expect(resolveCatalogModel('deepseek', 'deepseek-flash').apiProtocol).toBe('chat-completions');
    expect(resolveCatalogModel('deepseek', 'deepseek-chat').apiProtocol).toBe('chat-completions');
    expect(resolveCatalogModel('openai', 'gpt-5.2').id).toBe('gpt-5.2');
    const fallback = resolveCatalogModel('deepseek', 'not-in-catalog');
    expect(fallback).toMatchObject({ id: 'not-in-catalog', label: 'not-in-catalog', apiProtocol: 'chat-completions' });
  });

  it('在线列表非空时完全替换内置目录，为空或缺失时回退', () => {
    const builtin = modelsForProvider('deepseek');
    const remote = [
      { id: 'deepseek-chat', label: 'deepseek-chat (刷新)', tag: 'DeepSeek', apiProtocol: 'chat-completions' as const },
      { id: 'deepseek-v42', label: 'deepseek-v42', tag: 'DeepSeek', apiProtocol: 'chat-completions' as const },
    ];
    expect(resolveModelList(builtin, remote).map((m) => m.id)).toEqual(['deepseek-chat', 'deepseek-v42']);
    expect(resolveModelList(builtin)).toEqual(builtin);
    expect(resolveModelList(builtin, [])).toEqual(builtin);
  });
});

describe('RPC 载荷', () => {
  it('secrets.set 接受任意合法服务商', () => {
    expect(parseRpcPayload('secrets.set', { provider: 'deepseek', apiKey: 'sk-fixed-001' })).toEqual({
      provider: 'deepseek',
      apiKey: 'sk-fixed-001',
    });
  });

  it('llm.test 透传服务商与协议', () => {
    expect(
      parseRpcPayload('llm.test', { provider: 'deepseek', model: 'deepseek-flash', apiProtocol: 'responses' }),
    ).toMatchObject({ provider: 'deepseek', apiProtocol: 'responses' });
  });

  it('models.list 接受 baseURL 与 force，拒绝未知服务商', () => {
    expect(parseRpcPayload('models.list', { provider: 'moonshot' })).toEqual({ provider: 'moonshot' });
    expect(
      parseRpcPayload('models.list', { provider: 'ollama', baseURL: 'http://127.0.0.1:11434', force: true }),
    ).toEqual({ provider: 'ollama', baseURL: 'http://127.0.0.1:11434', force: true });
    expect(() => parseRpcPayload('models.list', { provider: 'unknown' })).toThrow();
  });
});

type FetchStub = (url: string, init?: RequestInit) => { ok: boolean; status: number; body: unknown };

function stubFetch(handler: FetchStub) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const { ok, status, body } = handler(url, init);
    return {
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  clearModelListCache();
  vi.unstubAllGlobals();
});

describe('在线模型列表拉取', () => {
  it('OpenAI 兼容端点携带 Bearer 认证并解析 data 数组', async () => {
    const fetchMock = stubFetch(() => ({
      ok: true,
      status: 200,
      body: { data: [{ id: 'kimi-k2-0711-preview' }, { id: 'moonshot-v1-8k' }] },
    }));
    const models = await fetchProviderModels('moonshot', {
      apiKey: 'sk-fixed-001',
      baseURL: 'https://api.moonshot.cn/v1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.moonshot.cn/v1/models');
    expect(((fetchMock.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>).Authorization).toBe(
      'Bearer sk-fixed-001',
    );
    expect(models.map((m) => m.id)).toEqual(['kimi-k2-0711-preview', 'moonshot-v1-8k']);
  });

  it('OpenAI 的 o 系列推理模型映射到 responses 协议', async () => {
    stubFetch(() => ({
      ok: true,
      status: 200,
      body: { data: [{ id: 'o3-mini' }, { id: 'gpt-4o-mini' }, { id: 'gpt-5' }] },
    }));
    const models = await fetchProviderModels('openai', { apiKey: 'sk-fixed-001' });
    expect(models.find((m) => m.id === 'o3-mini')?.apiProtocol).toBe('responses');
    expect(models.find((m) => m.id === 'gpt-4o-mini')?.apiProtocol).toBe('chat-completions');
    expect(models.find((m) => m.id === 'gpt-5')?.apiProtocol).toBe('chat-completions');
  });

  it('Anthropic 通过 after_id 游标自动翻页', async () => {
    const fetchMock = stubFetch((url) => {
      if (String(url).includes('after_id=m2')) {
        return {
          ok: true,
          status: 200,
          body: { data: [{ id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' }], has_more: false },
        };
      }
      return {
        ok: true,
        status: 200,
        body: {
          data: [
            { id: 'claude-sonnet-4', display_name: 'Claude Sonnet 4' },
            { id: 'claude-opus-4', display_name: 'Claude Opus 4' },
          ],
          has_more: true,
          last_id: 'm2',
        },
      };
    });
    const models = await fetchProviderModels('anthropic', { apiKey: 'sk-ant-fixed' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl, firstInit] = fetchMock.mock.calls[0] ?? [];
    const headers = (firstInit?.headers ?? {}) as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-fixed');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('after_id=m2');
    expect(models.map((m) => m.id)).toEqual(['claude-sonnet-4', 'claude-opus-4', 'claude-haiku-4-5']);
    expect(models[2]?.label).toBe('Claude Haiku 4.5');
  });

  it('Google 用 key 查询参数并过滤掉非生成模型', async () => {
    const fetchMock = stubFetch(() => ({
      ok: true,
      status: 200,
      body: {
        models: [
          { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-001', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
        ],
      },
    }));
    const models = await fetchProviderModels('google', { apiKey: 'AIza-fixed' });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1beta/models?key=AIza-fixed');
    expect(models.map((m) => m.id)).toEqual(['gemini-2.5-flash']);
    expect(models[0]?.label).toBe('Gemini 2.5 Flash');
  });

  it('Ollama 把 /v1 运行时基址换算成 /api/tags', async () => {
    const fetchMock = stubFetch(() => ({
      ok: true,
      status: 200,
      body: { models: [{ name: 'qwen3:8b' }, { model: 'llama3.1:8b' }] },
    }));
    const models = await fetchProviderModels('ollama', { baseURL: 'http://localhost:11434/v1' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:11434/api/tags');
    expect(models.map((m) => m.id)).toEqual(['qwen3:8b', 'llama3.1:8b']);
  });

  it('需要密钥的服务商缺少 API Key 时拒绝请求', async () => {
    await expect(fetchProviderModels('anthropic', {})).rejects.toThrow(/API Key/);
    await expect(fetchProviderModels('google', {})).rejects.toThrow(/API Key/);
  });

  it('自定义兼容端点缺少 Base URL 时拒绝请求', async () => {
    await expect(fetchProviderModels('openai-compatible', { apiKey: 'sk-fixed-001' })).rejects.toThrow(/Base URL/);
  });

  it('401 响应转换为友好的密钥错误提示', async () => {
    stubFetch(() => ({ ok: false, status: 401, body: { error: { message: 'bad key' } } }));
    await expect(fetchProviderModels('deepseek', { apiKey: 'sk-expired' })).rejects.toThrow(/API Key 无效/);
  });

  it('结果在 TTL 内命中缓存，force 可强制刷新', async () => {
    const fetchMock = stubFetch(() => ({ ok: true, status: 200, body: { data: [{ id: 'glm-4.6' }] } }));
    await fetchProviderModels('zhipu', { apiKey: 'id.secret' });
    await fetchProviderModels('zhipu', { apiKey: 'id.secret' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fetchProviderModels('zhipu', { apiKey: 'id.secret', force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
