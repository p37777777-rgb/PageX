import { describe, expect, it } from 'vitest';
import { emptyConversation } from '@/features/agent/session/conversations';
import {
  adoptTabStore,
  conversationPageKey,
  conversationTabKey,
  formatConversationTime,
  groupConversationsByTime,
  isRecentConversation,
  isSparseStore,
  latestRecentConversation,
  mergeConversationStores,
  nextConversationTitle,
  pickConversationStore,
  restoreConversationStore,
  settleFinishedConversation,
  titleFromPrompt,
  RECENT_TAB_WINDOW_MS,
} from '@/features/agent/session/conversations';
import {
  buildExportBundle,
  conversationPreview,
  conversationToMarkdown,
  conversationsToJsonl,
  exportFilename,
  flattenStoredConversations,
  listVaultSummaries,
  toConversationSummary,
  toExportedConversation,
} from '@/features/settings/conversation-archive';
import type { PageConversation, PageConversationStore, VaultMap } from '@/shared/contracts/session';

function withMessages(item: PageConversation, contents: string[]): PageConversation {
  return {
    ...item,
    messages: contents.map((content, index) => ({
      id: `${item.id}-m${index + 1}`,
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content,
    })),
  };
}

describe('会话存储键与近期窗口', () => {
  it('页面键保留 origin 加 path，标签页键使用 tab 前缀', () => {
    expect(conversationPageKey('https://wiki.test.org/entry?a=1#top')).toBe(
      'https://wiki.test.org/entry',
    );
    expect(conversationTabKey(9)).toBe('tab:9');
  });

  it('三小时窗口内的会话视为近期，并取其中最近更新的一个', () => {
    const now = 2_100_000_000_000;
    expect(isRecentConversation({ updatedAt: now - RECENT_TAB_WINDOW_MS + 1 }, now)).toBe(true);
    expect(isRecentConversation({ updatedAt: now - RECENT_TAB_WINDOW_MS }, now)).toBe(false);
    expect(isRecentConversation({ updatedAt: now }, now)).toBe(true);
    expect(isRecentConversation({ updatedAt: undefined }, now)).toBe(false);

    const stale = { id: 'gone', updatedAt: now - RECENT_TAB_WINDOW_MS };
    const mid = { id: 'mid', updatedAt: now - 6_000 };
    const fresh = { id: 'fresh', updatedAt: now - 2_000 };
    expect(latestRecentConversation([stale, mid, fresh], now)).toBe(fresh);
    expect(latestRecentConversation([stale], now)).toBeUndefined();
  });
});

describe('存储合并与采纳', () => {
  it('按会话 id 合并两个非空存储，活动会话跟随新存储', () => {
    const first = withMessages(emptyConversation('甲'), ['来自甲的消息']);
    const second = withMessages(emptyConversation('乙'), ['来自乙的消息']);
    const merged = mergeConversationStores(
      { activeId: first.id, conversations: [first] },
      { activeId: second.id, conversations: [second] },
    );
    expect(merged.conversations.map((item) => item.id).sort()).toEqual([first.id, second.id].sort());
    expect(merged.activeId).toBe(second.id);
  });

  it('已结束且更完整的回复优先于仍在流式的截断快照', () => {
    const streaming = emptyConversation('进行中');
    streaming.running = true;
    streaming.messages = [{ id: 'm1', role: 'assistant', content: '当前支持的主题：`dark`' }];
    const finished = emptyConversation('进行中');
    finished.id = streaming.id;
    finished.running = false;
    finished.messages = [
      { id: 'm1', role: 'assistant', content: '当前支持的主题：`dark` 与 `light`' },
    ];
    const merged = mergeConversationStores(
      { activeId: finished.id, conversations: [finished] },
      { activeId: streaming.id, conversations: [streaming] },
    );
    expect(merged.conversations[0]?.messages[0]?.content).toContain('light');
    expect(merged.conversations[0]?.running).toBe(false);
  });

  it('不会仅因为别的标签页或站点存储消息更多就采用它', () => {
    const empty = emptyConversation('空白');
    const filled = withMessages(emptyConversation('有内容'), ['继续任务']);
    const emptyStore = { activeId: empty.id, conversations: [empty] };
    const filledStore = { activeId: filled.id, conversations: [filled] };
    expect(isSparseStore(emptyStore)).toBe(true);
    expect(mergeConversationStores(filledStore, emptyStore).conversations[0]?.messages).toEqual(
      filled.messages,
    );
    // 本标签页的存储即使稀疏也优先于其他站点的富存储
    expect(
      pickConversationStore({ 'tab:5': emptyStore, 'https://a.test.org/list': filledStore }, 5, 'https://b.test.org/home')
        ?.activeId,
    ).toBe(empty.id);
    // 两边都对不上时返回 null
    expect(
      pickConversationStore(
        { 'tab:6': emptyStore, 'https://a.test.org/list': filledStore },
        8,
        'https://c.test.org/',
      ),
    ).toBeNull();
  });

  it('刷新后到达的稀疏快照不会覆盖已填充的标签页存储', () => {
    const filled = withMessages(emptyConversation('有内容'), ['还在继续']);
    const persisted = { activeId: filled.id, conversations: [filled], panelOpen: true };
    const incoming = { activeId: 'new-one', conversations: [emptyConversation('空白')] };
    const adopted = adoptTabStore(incoming, persisted);
    expect(adopted.conversations[0]?.messages[0]?.content).toBe('还在继续');
    expect(adopted.activeId).toBe(filled.id);
    expect(adopted.panelOpen).toBe(true);
  });

  it('后到的保存缺少 panelOpen 时沿用已有值', () => {
    const filled = withMessages(emptyConversation('有内容'), ['还在继续']);
    const adopted = adoptTabStore(
      { activeId: filled.id, conversations: [filled] },
      { activeId: filled.id, conversations: [filled], panelOpen: true },
    );
    expect(adopted.panelOpen).toBe(true);
    expect(adopted.conversations[0]?.messages[0]?.content).toBe('还在继续');
  });

  it('更高修订号的清空快照被接受，避免复活已删除的内容', () => {
    const filled = emptyConversation('有内容');
    filled.revision = 1;
    filled.messages = [{ id: 'm1', role: 'user', content: '这段该被清掉' }];
    const cleared = { ...filled, revision: 2, messages: [] };
    const adopted = adoptTabStore(
      { activeId: cleared.id, conversations: [cleared], revision: 2 },
      { activeId: filled.id, conversations: [filled], revision: 1 },
    );
    expect(adopted.conversations[0]?.messages).toEqual([]);
  });

  it('更高修订号的列表确实移除了某个会话时以新列表为准', () => {
    const dropped = withMessages(emptyConversation('待删除'), ['旧内容']);
    const kept = emptyConversation('保留项');
    const adopted = adoptTabStore(
      { activeId: kept.id, conversations: [kept], revision: 4 },
      { activeId: dropped.id, conversations: [dropped, kept], revision: 3 },
    );
    expect(adopted.conversations.map((item) => item.id)).toEqual([kept.id]);
  });

  it('修订号更高的完成会话覆盖同等长度的运行中快照', () => {
    const running = emptyConversation('运行项');
    running.revision = 6;
    running.running = true;
    running.messages = [{ id: 'm1', role: 'assistant', content: '一份完整回答' }];
    const finished = { ...running, revision: 7, running: false };
    const merged = mergeConversationStores(
      { activeId: running.id, conversations: [running] },
      { activeId: finished.id, conversations: [finished] },
    );
    expect(merged.conversations[0]?.running).toBe(false);
  });
});

describe('标题与时间分组', () => {
  it('分配下一个未被占用的默认标题', () => {
    expect(nextConversationTitle(['会话 1', '会话 4'])).toBe('会话 2');
  });

  it('历史会话按今天、昨天、过去 7 天、更早分组，组内较新的在前', () => {
    const now = Date.parse('2027-03-15T20:00:00+08:00');
    const today = { id: 't1', title: '今日会话', updatedAt: now - 8 * 60_000 };
    const yesterday = { id: 'y1', title: '昨日会话', updatedAt: now - 30 * 60 * 60_000 };
    const week = { id: 'w1', title: '本周会话', updatedAt: now - 3 * 86_400_000 };
    const older = { id: 'o1', title: '久远会话', updatedAt: now - 15 * 86_400_000 };
    expect(
      groupConversationsByTime([older, week, today, yesterday], now).map((group) => [
        group.label,
        group.items.map((item) => item.id),
      ]),
    ).toEqual([
      ['今天', ['t1']],
      ['昨天', ['y1']],
      ['过去 7 天', ['w1']],
      ['更早', ['o1']],
    ]);
    expect(formatConversationTime(today.updatedAt, now)).toMatch(/^\d{1,2}:\d{2}$/);
    expect(formatConversationTime(older.updatedAt, now)).toMatch(/\d+[/-月]/);
  });

  it('默认标题会被首条提示词改写，已有名字保持不变', () => {
    expect(titleFromPrompt('会话 2', '帮我把轮播图停住')).toBe('帮我把轮播图停住');
    expect(titleFromPrompt('自定义标题', '另一句话')).toBe('自定义标题');
  });
});

describe('会话收尾与恢复', () => {
  function dangling(): PageConversation {
    const item = emptyConversation('悬空会话');
    item.running = true;
    item.thinking = '正在执行 scroll_page…';
    item.tasks = [{ id: 'tk-9', title: 'scroll_page', status: 'running' }];
    item.messages = [
      {
        id: 'm1',
        role: 'assistant',
        content: '',
        parts: [{ type: 'tool', id: 'tk-9', name: 'scroll_page', status: 'running' }],
      },
    ];
    return item;
  }

  it('会话不再活跃时清理遗留的运行中状态', () => {
    const settled = settleFinishedConversation(dangling());
    expect(settled.running).toBe(false);
    expect(settled.thinking).toBe('');
    expect(settled.tasks[0]?.status).toBe('done');
    expect(settled.messages[0]?.parts?.[0]).toMatchObject({ id: 'tk-9', status: 'done' });
  });

  it('恢复时未在运行的会话不再保持 running', () => {
    const item = dangling();
    const store = { activeId: item.id, conversations: [item] };
    const restored = restoreConversationStore(store, { running: false, conversationId: store.activeId });
    expect(restored.conversations[0]?.running).toBe(false);
    expect(restored.conversations[0]?.thinking).toBe('');
    expect(restored.conversations[0]?.messages[0]?.parts?.[0]).toMatchObject({ status: 'done' });
  });
});

describe('会话归档', () => {
  function archived(title: string, vaults: string[], content = '先读一遍这个页面'): PageConversation {
    const item = emptyConversation(title, vaults);
    return withMessages(item, [content]);
  }

  it('压平 vault 与标签页存储，同一会话保留更丰富的副本', () => {
    const shared = archived('跨端任务', ['news.site.com']);
    const richer = {
      ...shared,
      revision: 3,
      messages: [
        { id: 'x1', role: 'user' as const, content: '打开列表页' },
        { id: 'x2', role: 'assistant' as const, content: '已打开' },
      ],
    };
    const localOnly = archived('只在本机', ['app.test.io'], '本地独有的草稿');
    const blank = emptyConversation('空壳', ['app.test.io']);
    const vaults: VaultMap = {
      'news.site.com': { domain: 'news.site.com', updatedAt: 30, conversations: [shared] },
      'app.test.io': { domain: 'app.test.io', updatedAt: 20, conversations: [localOnly, blank] },
    };
    const stores: Record<string, PageConversationStore> = {
      'tab:4': { activeId: richer.id, conversations: [richer] },
    };

    const items = flattenStoredConversations(vaults, stores);
    expect(items.map((item) => item.id).sort()).toEqual([localOnly.id, richer.id].sort());
    expect(items.find((item) => item.id === richer.id)?.messages).toHaveLength(2);
  });

  it('生成归档列表摘要，超长预览被截断', () => {
    const item = archived('提交工单', ['help.desk.cn'], `请帮我提交工单。${'补充说明。'.repeat(30)}`);
    const summary = toConversationSummary(item);
    expect(summary).toMatchObject({
      id: item.id,
      title: '提交工单',
      vaults: ['help.desk.cn'],
      messageCount: 1,
    });
    expect(summary.preview.endsWith('…')).toBe(true);
    expect(summary.preview.length).toBeLessThanOrEqual(81);
    expect(conversationPreview(emptyConversation('空会话', ['a.test']))).toBe('');
  });

  it('只列出非空 vault 并按域名排序', () => {
    const item = archived('读取表格', ['sheet.mirror.org']);
    expect(
      listVaultSummaries({
        'sheet.mirror.org': {
          domain: 'sheet.mirror.org',
          updatedAt: 7,
          conversations: [item],
        },
        'blank.mirror.org': {
          domain: 'blank.mirror.org',
          updatedAt: 9,
          conversations: [emptyConversation('空', ['blank.mirror.org'])],
        },
      }),
    ).toEqual([{ domain: 'sheet.mirror.org', conversationCount: 1, updatedAt: 7 }]);
  });

  it('导出记录默认剥离图片数据但保留 hasImage 标记', () => {
    const item = archived('截图排查', ['example.dev'], '看看这张截图');
    item.messages.push({
      id: 'm2',
      role: 'assistant',
      content: '发现了问题',
      thinking: '先检查布局',
      tools: [{ id: 'tk-1', name: 'search_page_text', status: 'done', output: '命中：价格' }],
      imageDataUrl: 'data:image/png;base64,WFla',
    });
    const exported = toExportedConversation(item);
    expect(exported.transcript[1]).toMatchObject({
      text: '发现了问题',
      thinking: '先检查布局',
      hasImage: true,
    });
    expect(exported.transcript[1]?.imageDataUrl).toBeUndefined();
    expect(exported.transcript[1]?.tools?.[0]).toMatchObject({ name: 'search_page_text', label: '搜索页面' });

    const withImage = toExportedConversation(item, { includeImages: true });
    expect(withImage.transcript[1]?.imageDataUrl).toBe('data:image/png;base64,WFla');
  });

  it('聚合回合用量，并脱敏工具参数与输出中的隐私信息', () => {
    const item = archived('含隐私的任务', ['example.dev'], '帮我登记 13911112222');
    item.budget = { modelCalls: 6, toolCalls: 6 };
    item.messages.push({
      id: 'm2',
      role: 'assistant',
      content: '已登记 user@corp.dev',
      tools: [
        {
          id: 'tk-1',
          name: 'type_text',
          status: 'done',
          args: { text: 'user@corp.dev' },
          output: '{"phone":"13911112222"}',
        },
      ],
      usage: {
        inputTokens: 22,
        outputTokens: 5,
        totalTokens: 27,
        cachedTokens: 0,
        reasoningTokens: 0,
        durationMs: 300,
        modelCalls: 2,
        toolCalls: 5,
      },
    });
    const exported = toExportedConversation(item);
    expect(exported.budget).toEqual({ modelCalls: 2, toolCalls: 5 });
    const dump = JSON.stringify(exported);
    expect(dump).not.toContain('user@corp.dev');
    expect(dump).not.toContain('13911112222');
  });

  it('JSON、JSONL 与 Markdown 导出都保留任务文本', () => {
    const item = archived('导出演示', ['example.dev'], '概括这个仪表盘');
    item.messages.push({
      id: 'm2',
      role: 'assistant',
      content: '这是一个监控面板',
      thinking: '需要先识别布局',
    });
    const bundle = buildExportBundle([item]);
    expect(bundle.source).toBe('pagex');
    expect(bundle.conversationCount).toBe(1);
    expect(bundle.conversations[0]?.title).toBe('导出演示');

    const jsonl = conversationsToJsonl([item]);
    expect(jsonl).toContain('"title":"导出演示"');
    expect(jsonl.trim().split('\n')).toHaveLength(1);

    const markdown = conversationToMarkdown(item);
    expect(markdown).toContain('# 导出演示');
    expect(markdown).toContain('概括这个仪表盘');
    expect(markdown).toContain('这是一个监控面板');
    expect(markdown).toContain('> 思考');
  });

  it('导出文件名使用本地时间戳', () => {
    expect(exportFilename('jsonl', new Date(2027, 11, 31, 23, 5))).toBe(
      'pagex-conversations-20271231-2305.jsonl',
    );
    expect(exportFilename('md', new Date(2026, 4, 9, 7, 42))).toBe(
      'pagex-conversations-20260509-0742.md',
    );
  });
});
