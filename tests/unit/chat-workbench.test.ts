import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/shared/contracts/session-messages';
import {
  applyComposerInsertion,
  clampMentionMenuHeight,
  composerNeedsFullWidth,
  filterBrowserTabs,
  filterSlashCommands,
  mergeComposerContexts,
  MENTION_MENU_MAX_HEIGHT,
  normalizeBrowserTabs,
  parseComposerToken,
  SLASH_COMMANDS,
  slashCommandContext,
  tabHost,
  visiblePrompt,
} from '@/features/agent/session/composer';
import {
  lastRoundStartIndex,
  messagesAfter,
  olderRoundStartId,
  visibleWindow,
  visibleWindowStartId,
  windowStartIndex,
} from '@/features/agent/ui/message-window';
import { isScrolledToBottom, nextStickPinned } from '@/features/agent/ui/hooks/useStickToBottom';
import {
  applyAgentEventToConversations,
  applyStreamPending,
  patchConversation,
} from '@/features/agent/ui/hooks/agent-session-reducer';
import {
  toolChip,
  toolDetailLines,
  toolElapsedLine,
  toolKind,
  toolLabel,
  toolUsesMono,
} from '@/features/agent/session/tool-display';

describe('输入框令牌', () => {
  it('识别行首或空白后的 @ 与 / 令牌，忽略普通文本中间的符号', () => {
    expect(parseComposerToken('@仓库')).toEqual({ kind: 'at', query: '仓库', start: 0 });
    expect(parseComposerToken('看下 @工单')).toEqual({ kind: 'at', query: '工单', start: 3 });
    expect(parseComposerToken('/帮助')).toEqual({ kind: 'slash', query: '帮助', start: 0 });
    expect(parseComposerToken('接着 /net')).toEqual({ kind: 'slash', query: 'net', start: 3 });
    expect(parseComposerToken('mail@corp.io')).toBeNull();
    expect(parseComposerToken('斜杠/在中间')).toBeNull();
    expect(parseComposerToken('普通一句话。')).toBeNull();
  });

  it('用命令替换斜杠令牌，用空串清掉 @ 提及', () => {
    expect(applyComposerInsertion('看下 @工单', parseComposerToken('看下 @工单'), '')).toBe('看下 ');
    expect(applyComposerInsertion('/net', parseComposerToken('/net'), '网络请求')).toBe('网络请求 ');
  });
});

describe('输入框布局', () => {
  it('空草稿在面板宽度未知时也保持折叠', () => {
    expect(composerNeedsFullWidth('', 0, 0, 0)).toBe(false);
  });

  it('只有换行或文本超出内联宽度时才展开为整行', () => {
    expect(composerNeedsFullWidth('一句话', 36, 380, 100)).toBe(false);
    expect(composerNeedsFullWidth('一段明显放不下的长输入', 320, 380, 100)).toBe(true);
    expect(composerNeedsFullWidth('第一段\n第二段', 36, 380, 100)).toBe(true);
  });
});

describe('斜杠命令', () => {
  it('按命令名或中文描述过滤', () => {
    expect(filterSlashCommands(SLASH_COMMANDS, 'net').map((item) => item.key)).toEqual(['network']);
    expect(filterSlashCommands(SLASH_COMMANDS, '表单').map((item) => item.key)).toEqual(['forms']);
    expect(filterSlashCommands(SLASH_COMMANDS, '标题').map((item) => item.key)).toEqual(['headings']);
    expect(filterSlashCommands(SLASH_COMMANDS, '').length).toBe(SLASH_COMMANDS.length);
  });

  it('命令展示名不带斜杠前缀且为中文', () => {
    expect(SLASH_COMMANDS.every((command) => !command.name.startsWith('/'))).toBe(true);
    expect(SLASH_COMMANDS.map((command) => command.name)).toContain('搜索文本');
    expect(SLASH_COMMANDS.map((command) => command.key)).toContain('observe');
  });

  it('命令说明与标签页、元素上下文合并后互不丢失', () => {
    const command = slashCommandContext({
      key: 'console',
      name: '控制台',
      desc: '重点汇报错误和警告',
      prompt: '读取控制台输出，汇总所有报错。',
    });
    const context = mergeComposerContexts('标签页概览文本', command, '选中的提交按钮');
    expect(context).toContain('标签页概览文本');
    expect(context).toContain('<command_instructions>');
    expect(context).toContain('读取控制台输出，汇总所有报错。');
    expect(context).toContain('选中的提交按钮');
  });
});

describe('标签页提及', () => {
  const tabs = [
    { id: 1, title: '代码仓库', url: 'https://gitlab.dev/team/app', active: true },
    { id: 2, title: '帮助中心', url: 'https://support.site.cn/manual' },
  ];

  it('规范化标签页数据并丢弃无效行', () => {
    expect(
      normalizeBrowserTabs([
        { id: 5, title: '  控制面板  ', url: 'https://admin.test.io/home', active: true, windowId: 2 },
        { title: '缺少 id' },
        '垃圾数据',
      ]),
    ).toEqual([{ id: 5, title: '控制面板', url: 'https://admin.test.io/home', active: true }]);
    expect(normalizeBrowserTabs([{ id: 6, url: 'https://bare.dev/page' }])).toEqual([
      { id: 6, title: '无标题', url: 'https://bare.dev/page', active: false },
    ]);
    expect(normalizeBrowserTabs({ tabs: [] })).toEqual([]);
  });

  it('按标题、主机名或完整地址过滤标签页', () => {
    expect(filterBrowserTabs(tabs, '帮助').map((tab) => tab.id)).toEqual([2]);
    expect(filterBrowserTabs(tabs, 'gitlab.dev').map((tab) => tab.id)).toEqual([1]);
    expect(tabHost('https://support.site.cn/manual')).toBe('support.site.cn');
    expect(tabHost('http://localhost:5173/dev')).toBe('localhost:5173');
    expect(tabHost('')).toBe('未知地址');
  });

  it('被提及的标签页不会进入用户可见的提示词', () => {
    expect(visiblePrompt('概括这个页面', [tabs[0]!])).toBe('概括这个页面');
    expect(visiblePrompt('   ', [tabs[1]!])).toBe('请查看这些标签页。');
    expect(visiblePrompt('只分析当前页', [])).toBe('只分析当前页');
  });

  it('@ 菜单高度被限制在面板可容纳的范围内', () => {
    expect(clampMentionMenuHeight(900)).toBe(MENTION_MENU_MAX_HEIGHT);
    expect(clampMentionMenuHeight(150)).toBe(150);
    expect(clampMentionMenuHeight(-30)).toBe(0);
    expect(clampMentionMenuHeight(99.9)).toBe(99);
  });
});

describe('消息窗口', () => {
  function message(id: string, role: ChatMessage['role']): ChatMessage {
    return { id, role, content: `内容-${id}` };
  }
  // s* 为用户消息，t* 为助手消息，共三轮
  const rounds = [
    message('s1', 'user'),
    message('t1', 'assistant'),
    message('s2', 'user'),
    message('t2', 'assistant'),
    message('s3', 'user'),
    message('t3', 'assistant'),
  ];

  it('messagesAfter 保留截断点之后的消息，截断点不存在时返回全部', () => {
    expect(messagesAfter(rounds, 't1').map((item) => item.id)).toEqual(['s2', 't2', 's3', 't3']);
    expect(messagesAfter(rounds, undefined)).toEqual(rounds);
    expect(messagesAfter(rounds, '不存在')).toEqual(rounds);
  });

  it('最近一条用户消息是当前轮次的起点', () => {
    expect(lastRoundStartIndex(rounds)).toBe(4);
    expect(lastRoundStartIndex([message('t0', 'assistant'), ...rounds.slice(0, 2)])).toBe(1);
  });

  it('默认只渲染最后一轮，指定 fromId 后从该处渲染到结尾', () => {
    expect(visibleWindow(rounds).map((item) => item.id)).toEqual(['s3', 't3']);
    expect(visibleWindow(rounds, 's2').map((item) => item.id)).toEqual(['s2', 't2', 's3', 't3']);
  });

  it('先固定当前窗口起点，再追加新一轮时窗口不漂移', () => {
    const fromId = visibleWindowStartId(rounds);
    const appended = [...rounds, message('s4', 'user')];
    expect(fromId).toBe('s3');
    expect(visibleWindow(appended, fromId).map((item) => item.id)).toEqual(['s3', 't3', 's4']);
  });

  it('向前加载历史时一轮一轮回退，到顶后返回 undefined', () => {
    expect(olderRoundStartId(rounds)).toBe('s2');
    expect(olderRoundStartId(rounds, 's2')).toBe('s1');
    expect(olderRoundStartId(rounds, 's1')).toBeUndefined();
  });

  it('fromId 找不到时回退到最后一轮', () => {
    expect(windowStartIndex(rounds, '消失了')).toBe(4);
    expect(visibleWindow(rounds, '消失了').map((item) => item.id)).toEqual(['s3', 't3']);
  });

  it('开头的助手消息归属上一轮而不是当前轮', () => {
    const leading = [message('t0', 'assistant'), ...rounds.slice(0, 2)];
    expect(visibleWindow(leading).map((item) => item.id)).toEqual(['s1', 't1']);
    expect(olderRoundStartId(leading)).toBe('t0');
  });
});

describe('滚动吸底', () => {
  it('距底部不超过阈值时视为贴底', () => {
    expect(isScrolledToBottom({ scrollHeight: 1500, scrollTop: 1460, clientHeight: 40 }, 48)).toBe(true);
    expect(isScrolledToBottom({ scrollHeight: 1500, scrollTop: 900, clientHeight: 400 }, 48)).toBe(false);
  });

  it('内容在贴底状态下增高不会解除吸底', () => {
    expect(
      nextStickPinned({
        pinned: true,
        atBottom: false,
        scrollTop: 500,
        lastScrollTop: 500,
        heightChanged: true,
      }),
    ).toBe(true);
  });

  it('只有用户向上滚动才解除吸底，向下滚动保持原状', () => {
    expect(
      nextStickPinned({
        pinned: true,
        atBottom: false,
        scrollTop: 300,
        lastScrollTop: 900,
        heightChanged: false,
      }),
    ).toBe(false);
    expect(
      nextStickPinned({
        pinned: false,
        atBottom: false,
        scrollTop: 800,
        lastScrollTop: 300,
        heightChanged: false,
      }),
    ).toBe(false);
  });

  it('用户滚回底部时重新吸底', () => {
    expect(
      nextStickPinned({
        pinned: false,
        atBottom: true,
        scrollTop: 1460,
        lastScrollTop: 300,
        heightChanged: false,
      }),
    ).toBe(true);
  });
});

describe('会话事件归约', () => {
  function conversation(id: string) {
    return {
      id,
      title: '会话 1',
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      tasks: [],
      error: '',
      thinking: '',
      running: true,
      budget: { modelCalls: 0, toolCalls: 0 },
      vaults: [],
    };
  }
  type PageConversationLike = ReturnType<typeof conversation>;

  it('只修补目标会话并递增其修订号，其余会话保持原样', () => {
    const list = [conversation('conv-a'), conversation('conv-b')];
    const next = patchConversation(list, 'conv-a', (item) => ({ ...item, thinking: '处理中' }));
    expect(next[0]?.thinking).toBe('处理中');
    expect(next[0]?.revision).toBe(1);
    expect(next[1]?.revision).toBeUndefined();
    expect(next[1]?.thinking).toBe('');
  });

  it('流式待定内容被折入目标会话的消息', () => {
    const next = applyStreamPending([conversation('conv-a')], {
      targetId: 'conv-a',
      token: '面板已展开',
      reasoning: '',
      tools: [],
    });
    expect(next[0]?.messages.at(-1)?.content).toContain('面板已展开');
  });

  it('thinking 事件写入目标会话并递增修订号', () => {
    const next = applyAgentEventToConversations([conversation('conv-a')], 'conv-a', {
      type: 'thinking',
      text: '正在分析面板结构',
    });
    expect(next[0]?.thinking).toBe('正在分析面板结构');
    expect(next[0]?.revision).toBe(1);
  });
});

describe('工具展示', () => {
  it('每个内置工具都有中文标题，未知工具回退为去下划线的原名', () => {
    expect(toolLabel('navigate')).toBe('打开网页');
    expect(toolLabel('type_text')).toBe('输入文字');
    expect(toolLabel('list_tabs')).toBe('列出标签页');
    expect(toolLabel('memory_search')).toBe('查询记忆');
    expect(toolLabel('mystery_step')).toBe('mystery step');
  });

  it('用动作描述代替终端式调用串', () => {
    expect(toolChip('observe_page', { reason: '确认登录态' })).toBe('确认登录态');
    expect(toolChip('observe_page', {}, 'running')).toBe('查看当前页面');
    expect(toolChip('search_page_text', {})).toBe('全文查找');
    expect(toolChip('scroll_page', { direction: 'top' })).toBe('回到顶部');
    expect(toolChip('wait_for', { ms: 800 })).toBe('等待 800 毫秒');
    expect(toolChip('navigate', { url: 'https://news.portals.io/tech' })).toBe('news.portals.io/tech');
    expect(toolChip('press_key', {})).toBe('发送按键');
    expect(toolChip('execute_named_script', { name: 'page_stats' })).toBe('页面统计');
    expect(toolChip('get_source', { type: 'text' })).toBe('可见正文');
    expect(toolChip('get_source', { type: 'stylesheets', grep: 'theme' })).toBe('stylesheets 搜索「theme」');
    expect(toolChip('hover_element', { elementId: 'el_menu' })).toBe('目标 el_menu');
  });

  it('只有页面脚本类工具使用等宽字体', () => {
    expect(toolKind('search_page_text')).toBe('search');
    expect(toolUsesMono('search_page_text')).toBe(false);
    expect(toolKind('execute_cdp_command')).toBe('script');
    expect(toolUsesMono('execute_cdp_command')).toBe(true);
  });

  it('参数、结果与状态压缩成单行详情', () => {
    expect(toolDetailLines({ keyword: '价格', limit: 5 }, undefined, 'running')).toEqual([
      '{"keyword":"价格","limit":5}',
    ]);
    expect(toolDetailLines({}, '第 1 条结果', 'done')).toEqual(['第 1 条结果']);
    expect(toolDetailLines(undefined, '第一行\n第二行', 'done')).toEqual(['第一行 第二行']);
    expect(toolDetailLines(undefined, undefined, 'error')).toEqual(['调用失败']);
    expect(toolDetailLines(undefined, undefined, 'running')).toEqual(['正在执行…']);
  });

  it('耗时行单独一行且排在结果之前，正文已有耗时行时不重复', () => {
    expect(toolElapsedLine(undefined)).toBe('');
    expect(toolElapsedLine(0)).toBe('');
    expect(toolElapsedLine(-3)).toBe('');
    expect(toolElapsedLine(Number.NaN)).toBe('');
    expect(toolElapsedLine(250)).toBe('当前任务已耗时 250ms，请注意控制时间。');
    expect(toolElapsedLine(2_500)).toBe('当前任务已耗时 2.5s，请注意控制时间。');
    expect(toolElapsedLine(125_000)).toBe('当前任务已耗时 2m 5s，请注意控制时间。');

    expect(toolDetailLines({}, '标题已读取', 'done', 2_500)).toEqual([
      '当前任务已耗时 2.5s，请注意控制时间。',
      '标题已读取',
    ]);
    // 结果正文里已带耗时行时先剥掉再统一追加，避免重复
    expect(toolDetailLines({}, '当前任务已耗时 2.5s\n标题已读取', 'done', 2_500)).toEqual([
      '当前任务已耗时 2.5s，请注意控制时间。',
      '标题已读取',
    ]);
    expect(toolDetailLines(undefined, undefined, 'error', 1_800)).toEqual([
      '当前任务已耗时 1.8s，请注意控制时间。',
      '调用失败',
    ]);
  });
});
