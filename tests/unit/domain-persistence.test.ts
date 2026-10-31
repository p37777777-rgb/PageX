import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyConversation, createPageStore } from '@/features/agent/session/conversations';
import {
  adoptTabStore,
  mergeConversationStores,
  nextConversationTitle,
} from '@/features/agent/session/conversations';
import {
  applyVaultStoreUpdate,
  archiveActiveConversations,
  conversationInVault,
  conversationVaultKey,
  filterStoreForVault,
  removeConversationFromVaults,
  vaultToStore,
  viewForVault,
} from '@/features/agent/session/vault';
import {
  checkpointKey,
  clearCheckpoint,
  loadCheckpoints,
  saveCheckpoint,
} from '@/features/agent/session/checkpoint';
import { applySettingsPatch, DEFAULT_SETTINGS } from '@/shared/contracts/settings';
import type { PageConversationStore, VaultMap, Checkpoint } from '@/shared/contracts/session';
import {
  chromeSessionItemsForTests,
  clearTabUi,
  loadPageConversations,
  loadSettings,
  loadTabConversations,
  loadTabUi,
  loadVault,
  listPersistedConversations,
  resetSessionReadyForTests,
  resetSessionStorageForTests,
  savePageConversations,
  saveSettings,
  saveTabUi,
  saveVaultFromStore,
  settingsItem,
} from '@/shared/storage/storage';

// ---------------------------------------------------------------------------
// 共享持久化：会话 IndexedDB / 域名金库 / 中断检查点 / 会话合并管线 / 设置
// ---------------------------------------------------------------------------

function storeWith(title: string, domain = 'example.com'): PageConversationStore {
  const item = emptyConversation(title, [domain]);
  item.messages = [{ id: 'msg-1', role: 'user', content: '继续之前的任务' }];
  return { activeId: item.id, conversations: [item] };
}

describe('persistence: IndexedDB 会话存储', () => {
  beforeEach(async () => {
    await resetSessionStorageForTests();
  });

  afterEach(async () => {
    await resetSessionStorageForTests();
  });

  it('按标签页键写入并回读，其他标签页读不到', async () => {
    const store = storeWith('排查白屏问题');
    await savePageConversations('tab:31', store);
    await expect(loadPageConversations('tab:31')).resolves.toMatchObject({ activeId: store.activeId });
    await expect(loadTabConversations(31)).resolves.toMatchObject({ activeId: store.activeId });
    await expect(loadTabConversations(32)).resolves.toBeNull();
  });

  it('低修订版本的迟到快照不会覆盖高修订版本', async () => {
    const fresh = storeWith('最新进度');
    fresh.revision = 6;
    const stale = storeWith('落后进度');
    stale.revision = 2;
    await savePageConversations('tab:31', fresh);
    await savePageConversations('tab:31', stale);
    await expect(loadTabConversations(31)).resolves.toMatchObject({
      activeId: fresh.activeId,
      revision: 6,
    });
  });

  it('域名金库与标签页会话各自独立落盘', async () => {
    const store = storeWith('部署排错笔记', 'ops.example.net');
    await saveVaultFromStore('https://ops.example.net/runbook', store);
    const vault = await loadVault('ops.example.net');
    expect(vault?.conversations[0]?.title).toBe('部署排错笔记');
    expect(vault?.conversations[0]?.vaults).toContain('ops.example.net');
  });

  it('标签页面板状态可以保存、读取再清除', async () => {
    await saveTabUi(8, { panelOpen: true });
    await expect(loadTabUi(8)).resolves.toEqual({ panelOpen: true });
    await clearTabUi(8);
    await expect(loadTabUi(8)).resolves.toBeNull();
  });

  it('首次访问时把旧 chrome.storage 的会话与金库迁入 IndexedDB 并清空来源', async () => {
    const live = storeWith('待迁移会话');
    const archived = emptyConversation('待迁移归档', ['old-forum.dev']);
    archived.messages = [{ id: 'msg-2', role: 'user', content: '历史消息' }];
    await chromeSessionItemsForTests.pageConversationsItem.setValue({ 'tab:44': live });
    await chromeSessionItemsForTests.vaultsItem.setValue({
      'old-forum.dev': {
        domain: 'old-forum.dev',
        updatedAt: Date.now(),
        activeId: archived.id,
        conversations: [archived],
      },
    });

    await expect(loadTabConversations(44)).resolves.toMatchObject({ activeId: live.activeId });
    await expect(loadVault('old-forum.dev')).resolves.toMatchObject({ activeId: archived.id });
    await expect(chromeSessionItemsForTests.pageConversationsItem.getValue()).resolves.toEqual({});
    await expect(chromeSessionItemsForTests.vaultsItem.getValue()).resolves.toEqual({});
  });

  it('浏览器重启（会话范围刷新）清掉标签页数据，但金库保留', async () => {
    const live = storeWith('重启前的会话');
    await savePageConversations('tab:17', live);
    await saveVaultFromStore('https://sample.org/readme', live);
    await saveTabUi(17, { panelOpen: true });

    await chromeSessionItemsForTests.sessionScopeItem.setValue('');
    resetSessionReadyForTests();

    await expect(loadTabConversations(17)).resolves.toBeNull();
    await expect(loadTabUi(17)).resolves.toBeNull();
    await expect(loadVault('sample.org')).resolves.toMatchObject({
      conversations: [expect.objectContaining({ title: '重启前的会话' })],
    });
  });

  it('归档列表能同时枚举金库与标签页里的会话', async () => {
    const docs = storeWith('接口联调记录', 'docs.example.net');
    const live = storeWith('正在进行的会话', 'app.example.net');
    await saveVaultFromStore('https://docs.example.net/api', docs);
    await savePageConversations('tab:23', live);
    const items = await listPersistedConversations();
    expect(items.map((item) => item.title).sort()).toEqual(['接口联调记录', '正在进行的会话']);
  });
});

describe('persistence: 域名金库', () => {
  it('金库键取主机名：忽略大小写与默认端口，保留非默认端口，非 http(s) 返回空', () => {
    expect(conversationVaultKey('https://Docs.Sample.Org/guide#top')).toBe('docs.sample.org');
    expect(conversationVaultKey('https://sample.org:443/a')).toBe('sample.org');
    expect(conversationVaultKey('http://sample.org:8080/app')).toBe('sample.org:8080');
    expect(conversationVaultKey('file:///tmp/notes.html')).toBeNull();
    expect(conversationVaultKey('不合法输入')).toBeNull();
  });

  it('归档时把活跃会话标记到本次导航的域名，无关会话不受影响', () => {
    const active = emptyConversation('跨站调研', ['gitlab.io']);
    active.messages = [{ id: 'msg-a', role: 'user', content: '打开 wiki' }];
    const idle = emptyConversation('只在 GitLab', ['gitlab.io']);
    idle.messages = [{ id: 'msg-b', role: 'user', content: '本地草稿' }];
    const archived = archiveActiveConversations(
      { activeId: active.id, conversations: [active, idle] },
      'en.wikipedia.org',
    );
    expect(archived.conversations[0]?.vaults).toEqual(['gitlab.io', 'en.wikipedia.org']);
    expect(archived.conversations[1]?.vaults).toEqual(['gitlab.io']);
  });

  it('按域名过滤后只剩该域名的会话，且 activeId 指向过滤结果', () => {
    const shared = emptyConversation('两边都可见', ['gitlab.io', 'en.wikipedia.org']);
    const local = emptyConversation('只在 GitLab', ['gitlab.io']);
    const viewed = filterStoreForVault(
      { activeId: local.id, conversations: [shared, local] },
      'en.wikipedia.org',
    );
    expect(viewed.conversations.map((item) => item.id)).toEqual([shared.id]);
    expect(viewed.conversations.every((item) => conversationInVault(item, 'en.wikipedia.org'))).toBe(true);
  });

  it('在另一站点关闭会话时，先前域名仍保留该会话并回收标记', () => {
    const shared = emptyConversation('共享任务', ['gitlab.io', 'en.wikipedia.org']);
    shared.messages = [{ id: 'msg-a', role: 'user', content: '跨站进行中' }];
    const onlyWiki = emptyConversation('只在 Wiki', ['en.wikipedia.org']);
    onlyWiki.messages = [{ id: 'msg-b', role: 'user', content: '本地' }];
    let all: VaultMap = applyVaultStoreUpdate({}, 'en.wikipedia.org', {
      activeId: shared.id,
      conversations: [shared, onlyWiki],
    });
    expect(all['gitlab.io']?.conversations.map((item) => item.id)).toEqual([shared.id]);
    expect(all['en.wikipedia.org']?.conversations).toHaveLength(2);

    all = applyVaultStoreUpdate(all, 'en.wikipedia.org', {
      activeId: onlyWiki.id,
      conversations: [onlyWiki],
    });
    expect(all['en.wikipedia.org']?.conversations.map((item) => item.id)).toEqual([onlyWiki.id]);
    expect(all['gitlab.io']?.conversations.map((item) => item.id)).toEqual([shared.id]);
    expect(all['gitlab.io']?.conversations[0]?.vaults).toEqual(['gitlab.io']);
  });

  it('再次进入域名时保留历史会话，并把 activeId 指向最新会话', () => {
    const older = emptyConversation('上周的会话', ['en.wikipedia.org']);
    older.messages = [{ id: 'msg-0', role: 'user', content: '旧消息' }];
    const active = emptyConversation('本次会话', ['en.wikipedia.org']);
    active.messages = [{ id: 'msg-1', role: 'user', content: '新消息' }];
    const persisted = applyVaultStoreUpdate({}, 'en.wikipedia.org', {
      activeId: active.id,
      conversations: [older, active],
    });
    const restored = viewForVault('en.wikipedia.org', persisted['en.wikipedia.org'], null);
    expect(restored.activeId).toBe(active.id);
    expect(restored.conversations.map((item) => item.id).sort()).toEqual([older.id, active.id].sort());
  });

  it('金库里记录的 panelOpen 不会污染下一次访问', () => {
    const session = emptyConversation('带着面板的会话', ['en.wikipedia.org']);
    session.messages = [{ id: 'msg-1', role: 'user', content: '进行中' }];
    const persisted = applyVaultStoreUpdate({}, 'en.wikipedia.org', {
      activeId: session.id,
      conversations: [session],
      panelOpen: true,
    });
    expect(viewForVault('en.wikipedia.org', persisted['en.wikipedia.org'], null).panelOpen).toBeFalsy();
    expect(viewForVault('gitlab.io', persisted['gitlab.io'], null).panelOpen).toBeFalsy();
    expect(
      viewForVault('gitlab.io', persisted['gitlab.io'], {
        activeId: session.id,
        conversations: [session],
        panelOpen: true,
      }).panelOpen,
    ).toBe(true);
  });

  it('模拟重启后从金库重建视图，其他站点拿到带域名标记的空白会话', () => {
    const session = emptyConversation('重启后仍在', ['en.wikipedia.org']);
    session.messages = [{ id: 'msg-1', role: 'user', content: '还在这里' }];
    const persisted = applyVaultStoreUpdate({}, 'en.wikipedia.org', {
      activeId: session.id,
      conversations: [session],
    });

    const restored = viewForVault('en.wikipedia.org', persisted['en.wikipedia.org'], null);
    expect(restored.conversations).toHaveLength(1);
    expect(restored.conversations[0]?.messages[0]?.content).toBe('还在这里');

    const other = viewForVault('gitlab.io', persisted['gitlab.io'], null);
    expect(other.conversations[0]?.messages).toEqual([]);
    expect(conversationInVault(other.conversations[0]!, 'gitlab.io')).toBe(true);
  });

  it('deleteMissing 关闭时归档只新增不删除既有会话', () => {
    const existing = emptyConversation('先前的会话', ['en.wikipedia.org']);
    existing.messages = [{ id: 'msg-0', role: 'user', content: '早先' }];
    const incoming = emptyConversation('刚导航过来', ['gitlab.io']);
    incoming.messages = [{ id: 'msg-1', role: 'user', content: '新进入' }];
    const all = applyVaultStoreUpdate({}, 'en.wikipedia.org', {
      activeId: existing.id,
      conversations: [existing],
    });
    const next = applyVaultStoreUpdate(
      all,
      'en.wikipedia.org',
      { activeId: incoming.id, conversations: [incoming] },
      { deleteMissing: false },
    );
    expect(next['en.wikipedia.org']?.conversations.map((item) => item.title).sort()).toEqual([
      '先前的会话',
      '刚导航过来',
    ]);  });

  it('从单个金库删除会话后条目本身仍然存在', () => {
    const item = emptyConversation('将被移除', ['alpha.dev']);
    const all: VaultMap = {
      'alpha.dev': { domain: 'alpha.dev', updatedAt: 1, conversations: [item], activeId: item.id },
    };
    const next = removeConversationFromVaults(all, 'alpha.dev', item.id);
    expect(next['alpha.dev']?.conversations).toEqual([]);
    expect(Object.keys(next)).toContain('alpha.dev');
  });
});

describe('persistence: 中断检查点', () => {
  beforeEach(async () => {
    await resetSessionStorageForTests();
  });

  function checkpointOf(tabId: number, sessionId: string, conversationId: string): Checkpoint {
    return {
      tabId,
      sessionId,
      conversationId,
      updatedAt: Date.now(),
      running: true,
      messages: [],
      tasks: [],
      modelCalls: 2,
      toolCalls: 1,
    };
  }

  it('并发会话的检查点互不干扰，按会话键精确清理', async () => {
    const first = checkpointOf(2, 'run-alpha', 'conv-alpha');
    const second = checkpointOf(3, 'run-beta', 'conv-beta');
    await Promise.all([saveCheckpoint(first), saveCheckpoint(second)]);
    expect(Object.keys(await loadCheckpoints()).sort()).toEqual(['run-alpha', 'run-beta']);

    await clearCheckpoint(checkpointKey(first));
    expect(Object.keys(await loadCheckpoints())).toEqual(['run-beta']);
  });

  it('checkpointKey 缺省会退回到标签页与对话组合键', () => {
    expect(checkpointKey({ tabId: 5, conversationId: 'conv-x', sessionId: '' })).toBe('5:conv-x');
    expect(checkpointKey({ tabId: 5, sessionId: '' })).toBe('5:active');
  });
});

describe('persistence: 会话合并管线', () => {
  it('新建会话经过 adoptTabStore → 归档 → 金库合并后仍是活跃会话', () => {
    const url = 'http://127.0.0.1:4173/workspace.html';
    const domain = conversationVaultKey(url)!;
    const initial = createPageStore(domain);
    const fresh = emptyConversation(
      nextConversationTitle(initial.conversations.map((item) => item.title)),
      [domain],
    );
    const saved = adoptTabStore(
      {
        activeId: fresh.id,
        conversations: [...initial.conversations, fresh],
        revision: 1,
        panelOpen: true,
      },
      initial,
    );
    const fromVault = vaultToStore(null, domain);
    const archived = archiveActiveConversations(saved, domain);
    const merged = mergeConversationStores(
      { ...fromVault, panelOpen: undefined },
      { ...archived, panelOpen: undefined },
    );

    expect(saved.conversations).toHaveLength(2);
    expect(merged.conversations.length).toBeGreaterThanOrEqual(2);
    expect(merged.conversations.every((item) => conversationInVault(item, domain))).toBe(true);
    expect(merged.activeId).toBe(fresh.id);

    const viewed = filterStoreForVault(merged, domain);
    expect(viewed.conversations).toHaveLength(2);
    expect(viewForVault(domain, null, saved).activeId).toBe(fresh.id);
  });
});

describe('persistence: 设置补丁', () => {
  it('切换服务商再切回时，恢复该服务商自定义的模型、URL 与协议', () => {
    const customized = applySettingsPatch(DEFAULT_SETTINGS, {
      model: {
        provider: 'zhipu',
        model: 'glm-5.3-flash',
        baseURL: 'https://glm-proxy.internal/api/paas/v4',
        apiProtocol: 'chat-completions',
      },
    });
    const switched = applySettingsPatch(customized, { model: { provider: 'ark' } });
    expect(switched.model).toMatchObject({
      provider: 'ark',
      model: 'doubao-seed-1-8-251228',
    });
    expect(switched.model.baseURL).toBeUndefined();
    expect(switched.providerProfiles.zhipu).toEqual({
      model: 'glm-5.3-flash',
      baseURL: 'https://glm-proxy.internal/api/paas/v4',
      apiProtocol: 'chat-completions',
    });

    const restored = applySettingsPatch(switched, { model: { provider: 'zhipu' } });
    expect(restored.model).toMatchObject({
      provider: 'zhipu',
      model: 'glm-5.3-flash',
      baseURL: 'https://glm-proxy.internal/api/paas/v4',
      apiProtocol: 'chat-completions',
    });
  });

  it('首次选用某服务商时使用预设模型且不带 URL', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, { model: { provider: 'qwen' } });
    expect(next.model).toMatchObject({
      provider: 'qwen',
      model: 'qwen3.7-plus',
      apiProtocol: 'chat-completions',
    });
    expect(next.model.baseURL).toBeUndefined();
  });

  it('修改 baseURL 同步写入当前服务商的 profile', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, {
      model: { baseURL: 'https://openai-relay.local/v2' },
    });
    expect(next.model.baseURL).toBe('https://openai-relay.local/v2');
    expect(next.providerProfiles.openai?.baseURL).toBe('https://openai-relay.local/v2');
  });

  it('恢复出厂设置时清空自定义 profile 并回到默认模型', () => {
    const customized = applySettingsPatch(DEFAULT_SETTINGS, {
      model: {
        provider: 'ollama',
        model: 'mistral:7b',
        baseURL: 'http://127.0.0.1:11434/v1',
      },
    });
    const reset = applySettingsPatch(customized, {
      ...DEFAULT_SETTINGS,
      model: { ...DEFAULT_SETTINGS.model, baseURL: undefined },
      providerProfiles: {},
    });
    expect(reset.model).toEqual(DEFAULT_SETTINGS.model);
    expect(reset.providerProfiles).toEqual({
      openai: { model: 'gpt-5.2', apiProtocol: 'chat-completions' },
    });
  });

  it('切到原生 SDK 服务商时不会继承上一个服务商的 URL', () => {
    const withUrl = applySettingsPatch(DEFAULT_SETTINGS, {
      model: { baseURL: 'https://glm-proxy.internal/api/paas/v4' },
    });
    const google = applySettingsPatch(withUrl, { model: { provider: 'google' } });
    expect(google.model.baseURL).toBeUndefined();
  });
});

describe('persistence: 设置读写', () => {
  beforeEach(async () => {
    await resetSessionStorageForTests();
    await settingsItem.setValue(DEFAULT_SETTINGS);
  });

  it('saveSettings/loadSettings 跨服务商保存并恢复各自的模型配置', async () => {
    await saveSettings({
      model: { model: 'grok-4.7', baseURL: 'https://relay.example.net/v1', apiProtocol: 'responses' },
    });
    await saveSettings({ model: { provider: 'ollama' } });
    await saveSettings({ model: { model: 'deepseek-r1:7b' } });

    const local = await loadSettings();
    expect(local.model).toMatchObject({
      provider: 'ollama',
      model: 'deepseek-r1:7b',
      apiProtocol: 'chat-completions',
    });

    await saveSettings({ model: { provider: 'openai' } });
    const cloud = await loadSettings();
    expect(cloud.model).toMatchObject({
      provider: 'openai',
      model: 'grok-4.7',
      baseURL: 'https://relay.example.net/v1',
      apiProtocol: 'responses',
    });
  });

  it('存量存储里的模型配置会在读取时播种到当前服务商 profile', async () => {
    await settingsItem.setValue({
      ...DEFAULT_SETTINGS,
      model: {
        provider: 'ark',
        model: 'doubao-seed-2-0-lite',
        baseURL: 'https://ark-relay.example.net/api/v3',
        apiProtocol: 'chat-completions',
        persistKey: true,
      },
      providerProfiles: {},
    });
    const loaded = await loadSettings();
    expect(loaded.providerProfiles.ark).toEqual({
      model: 'doubao-seed-2-0-lite',
      baseURL: 'https://ark-relay.example.net/api/v3',
      apiProtocol: 'chat-completions',
    });
  });
});
