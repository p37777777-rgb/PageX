import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { running } from '@/features/agent/background/agent-controller';
import * as agentController from '@/features/agent/background/agent-controller';
import { tabStores } from '@/features/agent/background/tab-store';
import * as contentBridge from '@/features/agent/background/content-bridge';
import { emptyConversation } from '@/features/agent/session/conversations';
import {
  dispatchHostTask,
  getHostSession,
  listHostTabs,
} from '@/features/mcp/background/host-handlers';
import { discoverMcpHost } from '@/features/mcp/background/host-discover';
import { jsonSchemaToZod } from '@/features/mcp/json-schema-to-zod';
import { serializeMcpResult } from '@/features/mcp/serialize';
import { DEFAULT_SETTINGS } from '@/shared/contracts/settings';
import {
  DEFAULT_MCP_HOST_PORT,
  MCP_HOST_PORT_COUNT,
  MCP_HOST_PROTOCOL,
  MCP_HOST_SERVICE,
  isMcpHostHealth,
  mcpHostPortRangeLabel,
  mcpHostPorts,
  preferMcpHost,
} from '@/shared/contracts/mcp-host';
import * as storage from '@/shared/storage/storage';
import * as tabs from '@/shared/browser/tabs';
import { mcpConfigSchema } from '@/shared/contracts/mcp';
import type { PageConversationStore } from '@/shared/contracts/session';
import { createExtensionRpc } from '../../mcp/extension-rpc';
import { listenFirstFree } from '../../mcp/listen';
import { createPagexMcpServer } from '../../mcp/server';
import { getUsageGuide } from '../../mcp/usage';

function fakeStore(overrides?: Partial<PageConversationStore>): PageConversationStore {
  const conversation = emptyConversation('补全收货信息', ['mall.test']);
  conversation.id = 'c_running';
  conversation.thinking = '正在定位地址输入框';
  conversation.running = true;
  conversation.messages = [
    { id: 'a1', role: 'user', content: '把地址改成北京市朝阳区' },
    { id: 'a2', role: 'assistant', content: '收到，我先检查当前表单状态' },
  ];
  conversation.tasks = [{ id: 'k1', title: '检查表单', status: 'running' }];
  return {
    activeId: conversation.id,
    conversations: [conversation],
    sessionId: 's_running',
    revision: 4,
    panelOpen: true,
    ...overrides,
  };
}

function seedControl(tabId: number, store: PageConversationStore) {
  running.set(tabId, {
    abort: new AbortController(),
    conversationId: store.conversations[0]!.id,
    sessionId: store.sessionId!,
    store,
    tabId,
  });
  tabStores.set(tabId, store);
}

function healthPayload(port: number, extensionConnected: boolean) {
  return new Response(
    JSON.stringify({
      ok: true,
      name: 'pagex',
      service: MCP_HOST_SERVICE,
      version: '0.2.0',
      protocol: MCP_HOST_PROTOCOL,
      extensionConnected,
      port,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

async function connectClient(callExtension: Parameters<typeof createPagexMcpServer>[0]) {
  const server = createPagexMcpServer(callExtension);
  const client = new Client({ name: 'probe', version: '1.2.3' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

describe('mcp 配置契约', () => {
  it('按服务器保存被禁用的工具名列表', () => {
    const parsed = mcpConfigSchema.parse({
      mcpServers: {
        docs: {
          url: 'https://docs.internal/mcp',
          disabledTools: ['purge_cache'],
        },
      },
    });
    expect(parsed.mcpServers.docs?.disabledTools).toEqual(['purge_cache']);
  });
});

describe('json schema 转 zod', () => {
  it('对象字段依据 required 划分必填与可选', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        limit: { type: 'integer' },
        labels: { type: 'array', items: { type: 'string' } },
      },
    });
    expect(schema.safeParse({ title: '报告' }).success).toBe(true);
    expect(schema.safeParse({ title: '报告', limit: 5, labels: ['q1'] }).success).toBe(true);
    expect(schema.safeParse({ limit: 5 }).success).toBe(false);
    expect(schema.safeParse({ title: '报告', limit: 1.5 }).success).toBe(false);
  });

  it('多值枚举收敛为选项集合，单值枚举退化为字面量', () => {
    const multi = jsonSchemaToZod({ type: 'string', enum: ['png', 'svg'] });
    expect(multi.safeParse('png').success).toBe(true);
    expect(multi.safeParse('gif').success).toBe(false);
    const single = jsonSchemaToZod({ type: 'string', enum: ['grid'] });
    expect(single.safeParse('grid').success).toBe(true);
    expect(single.safeParse('list').success).toBe(false);
  });

  it('未声明或未支持的 schema 放行为任意值', () => {
    expect(jsonSchemaToZod(undefined).safeParse(42).success).toBe(true);
    expect(jsonSchemaToZod({ type: 'object', properties: {} }).safeParse({}).success).toBe(true);
    const bool = jsonSchemaToZod({ type: 'boolean' });
    expect(bool.safeParse(true).success).toBe(true);
    expect(bool.safeParse(0).success).toBe(false);
  });
});

describe('工具结果序列化', () => {
  it('把多段文本按换行拼接', () => {
    expect(
      serializeMcpResult({
        content: [
          { type: 'text', text: '上半段' },
          { type: 'text', text: '下半段' },
        ],
      }),
    ).toBe('上半段\n下半段');
  });

  it('图片段被摘要，错误结果加失败前缀', () => {
    const text = serializeMcpResult({
      isError: true,
      content: [
        { type: 'text', text: '上游超时' },
        { type: 'image', mimeType: 'image/jpeg', data: 'BBBB' },
      ],
    });
    expect(text).toContain('工具执行失败');
    expect(text).toContain('上游超时');
    expect(text).toContain('[图片 image/jpeg');
  });

  it('空值转占位文本，标量直接字符串化，空 content 回退 JSON', () => {
    expect(serializeMcpResult(null)).toBe('(无内容)');
    expect(serializeMcpResult(7)).toBe('7');
    expect(serializeMcpResult({ content: [] })).toContain('content');
  });
});

describe('宿主方法：list_tabs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    running.clear();
    tabStores.clear();
    vi.spyOn(storage, 'loadSettings').mockResolvedValue(DEFAULT_SETTINGS);
    vi.spyOn(contentBridge, 'ensureContentScript').mockResolvedValue(undefined);
    vi.spyOn(contentBridge, 'sendToContent').mockResolvedValue({ ok: true });
  });

  it('标注 Agent 工作状态并把受限页面标记为 protected', async () => {
    const store = fakeStore();
    seedControl(31, store);
    browser.tabs.query = vi.fn(async () => [
      {
        id: 31,
        title: '订单后台',
        url: 'https://mall.test/orders',
        active: true,
        windowId: 2,
        status: 'complete',
        pinned: false,
      },
      {
        id: 32,
        title: '文档页',
        url: 'https://docs.test/readme',
        active: false,
        windowId: 2,
        status: 'complete',
        pinned: true,
      },
      {
        id: 33,
        title: '浏览器设置',
        url: 'chrome://version',
        active: false,
        windowId: 2,
        status: 'complete',
      },
    ]) as unknown as typeof browser.tabs.query;

    const { tabs: hostTabs } = await listHostTabs();
    expect(hostTabs).toHaveLength(3);
    expect(hostTabs[0]).toMatchObject({
      tabId: 31,
      title: '订单后台',
      agent: {
        working: true,
        sessionId: 's_running',
        conversationId: 'c_running',
        title: '补全收货信息',
        thinking: '正在定位地址输入框',
      },
      protected: false,
    });
    expect(hostTabs[1]?.agent.working).toBe(false);
    expect(hostTabs[2]).toMatchObject({
      tabId: 33,
      protected: true,
      agent: { working: false },
    });
  });
});

describe('宿主方法：dispatch_task', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    running.clear();
    tabStores.clear();
    vi.spyOn(storage, 'loadSettings').mockResolvedValue(DEFAULT_SETTINGS);
    vi.spyOn(contentBridge, 'ensureContentScript').mockResolvedValue(undefined);
    vi.spyOn(contentBridge, 'sendToContent').mockResolvedValue({ ok: true });
  });

  it('无参派发落在活动标签页并新建会话', async () => {
    vi.spyOn(tabs, 'getActiveTab').mockResolvedValue({
      id: 27,
      url: 'https://mall.test/cart',
    } as Awaited<ReturnType<typeof tabs.getActiveTab>>);
    browser.tabs.get = vi.fn(async () => ({
      id: 27,
      url: 'https://mall.test/cart',
    })) as unknown as typeof browser.tabs.get;
    const startSpy = vi.spyOn(agentController, 'startAgent').mockResolvedValue({
      ok: true,
      tabId: 27,
      sessionId: 's_spawned',
      conversationId: 'c_spawned',
    });

    const result = await dispatchHostTask({ prompt: '清空购物车' });
    expect(result).toEqual({
      ok: true,
      tabId: 27,
      sessionId: 's_spawned',
      conversationId: 'c_spawned',
    });
    expect(contentBridge.ensureContentScript).toHaveBeenCalledWith(27);
    expect(contentBridge.sendToContent).toHaveBeenCalledWith(27, 'ui.open', {});
    expect(startSpy).toHaveBeenCalledWith(27, '清空购物车', expect.stringMatching(/^c_/));
  });

  it('带 url 时新建标签页并续用传入会话', async () => {
    vi.spyOn(tabs, 'createTab').mockResolvedValue({
      id: 41,
      url: 'https://sheet.test/draft',
    } as Awaited<ReturnType<typeof tabs.createTab>>);
    browser.tabs.get = vi.fn(async () => ({
      id: 41,
      url: 'https://sheet.test/draft',
    })) as unknown as typeof browser.tabs.get;
    vi.spyOn(agentController, 'startAgent').mockResolvedValue({
      ok: true,
      tabId: 41,
      sessionId: 's_sheet',
      conversationId: 'c_resume',
    });

    const result = await dispatchHostTask({
      prompt: '整理透视表',
      url: 'https://sheet.test/draft',
      conversationId: 'c_resume',
    });
    expect(tabs.createTab).toHaveBeenCalledWith('https://sheet.test/draft');
    expect(result.tabId).toBe(41);
    expect(agentController.startAgent).toHaveBeenCalledWith(41, '整理透视表', 'c_resume');
  });

  it('对受保护页面派发直接拒绝', async () => {
    browser.tabs.get = vi.fn(async () => ({
      id: 9,
      url: 'chrome://settings',
    })) as unknown as typeof browser.tabs.get;
    await expect(dispatchHostTask({ prompt: 'y', tabId: 9 })).rejects.toThrow('受浏览器保护');
  });
});

describe('宿主方法：get_session', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    running.clear();
    tabStores.clear();
  });

  it('按 sessionId 命中运行中的会话并带出消息角色', async () => {
    const store = fakeStore();
    seedControl(55, store);
    browser.tabs.get = vi.fn(async () => ({
      id: 55,
      title: '订单后台',
      url: 'https://mall.test/orders',
    })) as unknown as typeof browser.tabs.get;

    const status = await getHostSession({ sessionId: 's_running' });
    expect(status).toMatchObject({
      found: true,
      running: true,
      tabId: 55,
      sessionId: 's_running',
      conversationId: 'c_running',
      conversationTitle: '补全收货信息',
      thinking: '正在定位地址输入框',
      url: 'https://mall.test/orders',
    });
    expect(status.messages?.map((item) => item.role)).toEqual(['user', 'assistant']);
  });

  it('Agent 结束后改从标签页存储回退命中', async () => {
    const store = fakeStore();
    store.conversations[0]!.running = false;
    store.conversations[0]!.thinking = '';
    tabStores.set(66, store);
    browser.tabs.get = vi.fn(async () => ({
      id: 66,
      title: '已归档',
      url: 'https://done.test/summary',
    })) as unknown as typeof browser.tabs.get;

    const status = await getHostSession({ conversationId: 'c_running' });
    expect(status).toMatchObject({
      found: true,
      running: false,
      tabId: 66,
      conversationId: 'c_running',
    });
  });

  it('查无此会话时返回未找到', async () => {
    await expect(getHostSession({ sessionId: 'ghost' })).resolves.toEqual({
      found: false,
      running: false,
    });
  });
});

describe('宿主端口规划', () => {
  it('端口段从默认基址连续铺开 16 个', () => {
    const ports = mcpHostPorts();
    expect(ports).toHaveLength(MCP_HOST_PORT_COUNT);
    expect(ports[0]).toBe(DEFAULT_MCP_HOST_PORT);
    expect(ports.at(-1)).toBe(DEFAULT_MCP_HOST_PORT + MCP_HOST_PORT_COUNT - 1);
    expect(mcpHostPortRangeLabel()).toBe('17342-17357');
  });

  it('粘滞端口存活则吸附，否则取未挂扩展的最低端口', () => {
    const hosts = [
      { port: 17352, extensionConnected: true },
      { port: 17354, extensionConnected: false },
      { port: 17351, extensionConnected: false },
    ];
    expect(preferMcpHost(hosts)?.port).toBe(17351);
    expect(preferMcpHost(hosts, 17352)?.port).toBe(17352);
    expect(preferMcpHost(hosts.filter((item) => item.extensionConnected))?.port).toBe(17352);
  });

  it('健康载荷必须声明 pagex-host 服务且协议版本匹配', () => {
    expect(
      isMcpHostHealth({
        ok: true,
        name: 'pagex',
        service: MCP_HOST_SERVICE,
        protocol: MCP_HOST_PROTOCOL,
        port: 17350,
      }),
    ).toBe(true);
    expect(isMcpHostHealth({ ok: true, name: 'pagex', protocol: MCP_HOST_PROTOCOL, port: 17350 })).toBe(false);
    expect(isMcpHostHealth({ ok: true, service: MCP_HOST_SERVICE, protocol: 9, name: 'pagex', port: 2 })).toBe(false);
  });
});

describe('宿主发现', () => {
  it('并行探测端口段并选中未挂扩展的宿主', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('17345')) return healthPayload(17345, true);
      if (url.includes('17348')) return healthPayload(17348, false);
      if (url.includes('17349')) return new Response('stranger', { status: 200 });
      throw new Error('ECONNREFUSED');
    });
    const port = await discoverMcpHost({
      fetch: fetchImpl as typeof fetch,
      ports: [17342, 17345, 17348, 17349],
    });
    expect(port).toBe(17348);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('粘滞端口依旧健康时直接复用', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('17345')) return healthPayload(17345, true);
      if (url.includes('17348')) return healthPayload(17348, false);
      throw new Error('ECONNREFUSED');
    });
    const port = await discoverMcpHost({
      fetch: fetchImpl as typeof fetch,
      ports: [17345, 17348],
      preferPort: 17345,
    });
    expect(port).toBe(17345);
  });

  it('整段端口无宿主时返回 null', async () => {
    const port = await discoverMcpHost({
      fetch: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch,
      ports: [17342, 17343],
    });
    expect(port).toBeNull();
  });
});

describe('端口监听', () => {
  it('被占端口跳过，落到下一个空闲端口', async () => {
    const { createServer } = await import('node:http');
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', () => resolve()));
    const busyPort = (occupied.address() as AddressInfo).port;
    const placeholder = createServer();
    await new Promise<void>((resolve) => placeholder.listen(0, '127.0.0.1', () => resolve()));
    const freePort = (placeholder.address() as AddressInfo).port;
    await new Promise<void>((resolve) => placeholder.close(() => resolve()));

    const server = createServer();
    try {
      const bound = await listenFirstFree(server, [busyPort, freePort]);
      expect(bound).toBe(freePort);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  });
});

describe('MCP 服务器工具面', () => {
  it('注册四个工具并按各自超时转发 list_tabs 与 dispatch_task', async () => {
    const callExtension = vi.fn(async (method: string) => {
      if (method === 'list_tabs') return { tabs: [{ tabId: 5, agent: { working: false } }] };
      if (method === 'dispatch_task') return { ok: true, tabId: 5, sessionId: 'sx1', conversationId: 'cx1' };
      return { found: true, running: true, sessionId: 'sx1' };
    });
    const { server, client } = await connectClient(callExtension);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      'dispatch_task',
      'get_session',
      'get_usage',
      'list_tabs',
    ]);

    const tabsResult = await client.callTool({ name: 'list_tabs', arguments: {} });
    expect(tabsResult.content).toEqual([
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('"tabId": 5'),
      }),
    ]);
    expect(callExtension).toHaveBeenCalledWith('list_tabs', {}, 15_000);

    const dispatched = await client.callTool({
      name: 'dispatch_task',
      arguments: { prompt: '切换深色模式', tabId: 6 },
    });
    expect(JSON.stringify(dispatched)).toContain('sx1');
    expect(callExtension).toHaveBeenCalledWith(
      'dispatch_task',
      { prompt: '切换深色模式', tabId: 6, url: undefined, conversationId: undefined },
      45_000,
    );

    await client.close();
    await server.close();
  });

  it('扩展未连接时工具返回 isError 而非抛异常', async () => {
    const rpc = createExtensionRpc();
    const { server, client } = await connectClient(rpc.callExtension);

    const result = await client.callTool({ name: 'list_tabs', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('扩展未连接');

    await client.close();
    await server.close();
  });

  it('get_usage 不触碰扩展且支持单节裁剪', async () => {
    const callExtension = vi.fn();
    const { server, client } = await connectClient(callExtension);

    const full = await client.callTool({ name: 'get_usage', arguments: {} });
    expect(full.isError).toBeFalsy();
    expect(JSON.stringify(full)).toContain('dispatch_task');
    expect(JSON.stringify(full)).toContain('本地 Agent');

    const section = await client.callTool({
      name: 'get_usage',
      arguments: { topic: 'workflow' },
    });
    expect(JSON.stringify(section)).toContain('推荐流程');
    expect(callExtension).not.toHaveBeenCalled();

    await client.close();
    await server.close();
  });
});

describe('用法指南', () => {
  it('单节只含该主题，全文含所有章节标题', () => {
    expect(getUsageGuide('list_tabs')).toContain('agent.working');
    expect(getUsageGuide()).toContain('## overview');
    expect(getUsageGuide()).toContain('## get_session');
  });
});

describe('扩展 RPC 长轮询', () => {
  it('请求排队、扩展取走并回包后调用方拿到结果', async () => {
    const rpc = createExtensionRpc();
    rpc.touch();
    const pending = rpc.callExtension('get_session', { sessionId: 'sx1' }, 1_000);
    const request = await rpc.takeRequest(200);
    expect(request).toMatchObject({
      v: MCP_HOST_PROTOCOL,
      method: 'get_session',
      params: { sessionId: 'sx1' },
    });
    rpc.complete({
      v: MCP_HOST_PROTOCOL,
      id: request!.id,
      ok: true,
      result: { found: true, running: true, sessionId: 'sx1' },
    });
    await expect(pending).resolves.toEqual({ found: true, running: true, sessionId: 'sx1' });
  });

  it('扩展回执 ok=false 时调用方收到拒绝', async () => {
    const rpc = createExtensionRpc();
    rpc.touch();
    const pending = rpc.callExtension('dispatch_task', { prompt: 'n' }, 1_000);
    const request = await rpc.takeRequest(200);
    rpc.complete({
      v: MCP_HOST_PROTOCOL,
      id: request!.id,
      ok: false,
      error: '目标标签页已关闭',
    });
    await expect(pending).rejects.toThrow('目标标签页已关闭');
  });
});
