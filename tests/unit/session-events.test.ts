import { describe, expect, it } from 'vitest';
import { emptyConversation } from '@/features/agent/session/conversations';
import {
  adoptLiveStore,
  applyAgentEventToStore,
  sessionIsOnTab,
  shouldRestoreLiveSession,
} from '@/features/agent/session/session-live';
import {
  applyAssistantFinalText,
  applyAssistantThinking,
  applyAssistantToken,
  applyAssistantToolResult,
  applyAssistantToolStart,
  applyAssistantUsage,
  messageBlocks,
  settleAssistantMessages,
  shouldHoldToolGroupOpen,
  toModelMessages,
} from '@/features/agent/session/messages';
import type { ChatMessage } from '@/shared/contracts/session-messages';
import type { PageConversationStore } from '@/shared/contracts/session';

/** 追加若干段流式文本，返回最终消息列表 */
function streamed(...chunks: string[]): ChatMessage[] {
  return chunks.reduce<ChatMessage[]>((list, chunk) => applyAssistantToken(list, chunk, 'asst-1'), []);
}

describe('助手消息的流式部件', () => {
  it('最终快照比已流式文本短时保留较长版本，更长时才更新', () => {
    const messages = streamed('当前支持的浏览器：`chrome` 与 `edge`');
    // 更短且是前缀的快照不应回退内容
    expect(applyAssistantFinalText(messages, '当前支持的浏览器：`chrom', 'asst-1')[0]?.content).toContain(
      'edge',
    );
    // 更长的快照应被接受
    expect(
      applyAssistantFinalText(messages, '当前支持的浏览器：`chrome` 与 `edge` 以及 `firefox`', 'asst-1')[0]
        ?.content,
    ).toContain('firefox');
  });

  it('工具块夹在前后文本之间，content 仍是无缝拼接的纯文本', () => {
    let messages: ChatMessage[] = [{ id: 'ask-1', role: 'user', content: '检查表单' }];
    messages = applyAssistantToken(messages, '先读取页面。', 'asst-1');
    messages = applyAssistantToolStart(
      messages,
      { id: 'wk-1', name: 'search_page_text', args: {}, status: 'running' },
      'asst-1',
    );
    messages = applyAssistantToolResult(messages, 'wk-1', 'done', '命中 2 处');
    messages = applyAssistantToken(messages, '再提交表单。', 'asst-1');

    const assistant = messages.at(-1)!;
    expect(messageBlocks(assistant)).toEqual([
      { type: 'text', text: '先读取页面。' },
      {
        type: 'tools',
        tools: [
          {
            type: 'tool',
            id: 'wk-1',
            name: 'search_page_text',
            args: {},
            status: 'done',
            output: '命中 2 处',
          },
        ],
      },
      { type: 'text', text: '再提交表单。' },
    ]);
    expect(assistant.content).toBe('先读取页面。再提交表单。');
  });

  it('最终快照恰好是整段回复时，前面的文本块不会重复出现', () => {
    let messages: ChatMessage[] = [];
    messages = applyAssistantToken(messages, '先读取页面。', 'asst-1');
    messages = applyAssistantToolStart(
      messages,
      { id: 'wk-1', name: 'search_page_text', args: {}, status: 'running' },
      'asst-1',
    );
    messages = applyAssistantToolResult(messages, 'wk-1', 'done', '命中 2 处');
    messages = applyAssistantToken(messages, '处理完毕。', 'asst-1');

    messages = applyAssistantFinalText(messages, '先读取页面。处理完毕。', 'asst-1');

    expect(messages[0]?.content).toBe('先读取页面。处理完毕。');
    expect(messageBlocks(messages[0]!)).toEqual([
      { type: 'text', text: '先读取页面。' },
      {
        type: 'tools',
        tools: [
          {
            type: 'tool',
            id: 'wk-1',
            name: 'search_page_text',
            args: {},
            status: 'done',
            output: '命中 2 处',
          },
        ],
      },
      { type: 'text', text: '处理完毕。' },
    ]);
  });

  it('连续的工具聚合进同一个工具块，之后的文本排在工具后面', () => {
    let messages: ChatMessage[] = [];
    messages = applyAssistantToolStart(
      messages,
      { id: 'wk-1', name: 'observe_page', status: 'running' },
      'asst-1',
    );
    messages = applyAssistantToolStart(
      messages,
      { id: 'wk-2', name: 'click', status: 'running' },
      'asst-1',
    );
    messages = applyAssistantToken(messages, '搞定了。', 'asst-1');

    expect(messageBlocks(messages[0]!)).toEqual([
      {
        type: 'tools',
        tools: [
          { type: 'tool', id: 'wk-1', name: 'observe_page', status: 'running' },
          { type: 'tool', id: 'wk-2', name: 'click', status: 'running' },
        ],
      },
      { type: 'text', text: '搞定了。' },
    ]);
  });

  it('思考块始终排在工具与正文之前', () => {
    let messages: ChatMessage[] = [];
    messages = applyAssistantThinking(messages, '先定位搜索框。', 'asst-1');
    messages = applyAssistantToolStart(
      messages,
      { id: 'wk-1', name: 'observe_page', status: 'running' },
      'asst-1',
    );
    messages = applyAssistantToken(messages, '已找到目标。', 'asst-1');

    const assistant = messages.at(-1)!;
    expect(messageBlocks(assistant)).toEqual([
      { type: 'thinking', text: '先定位搜索框。' },
      {
        type: 'tools',
        tools: [{ type: 'tool', id: 'wk-1', name: 'observe_page', status: 'running' }],
      },
      { type: 'text', text: '已找到目标。' },
    ]);
    expect(assistant.thinking).toBe('先定位搜索框。');
    expect(assistant.content).toBe('已找到目标。');
  });

  it('流式中的工具组保持展开，直到正文出现或回合结束', () => {
    const tools = {
      type: 'tools' as const,
      tools: [{ type: 'tool' as const, id: 'wk-1', name: 'click', status: 'done' as const }],
    };
    const reasoning = { type: 'thinking' as const, text: '看下返回值。' };
    const answer = { type: 'text' as const, text: '登录框已经打开。' };

    expect(shouldHoldToolGroupOpen(true, [])).toBe(true);
    expect(shouldHoldToolGroupOpen(true, [reasoning])).toBe(true);
    expect(shouldHoldToolGroupOpen(true, [answer])).toBe(false);
    expect(shouldHoldToolGroupOpen(false, [])).toBe(false);
    expect(shouldHoldToolGroupOpen(true, [tools])).toBe(true);
  });

  it('回合结束后遗留的运行中工具被落定为完成', () => {
    let messages: ChatMessage[] = [];
    messages = applyAssistantToolStart(
      messages,
      { id: 'wk-1', name: 'press_key', status: 'running' },
      'asst-1',
    );
    messages = settleAssistantMessages(messages);
    expect(messages[0]?.parts?.[0]).toMatchObject({ id: 'wk-1', status: 'done' });
  });

  it('旧格式消息（thinking/tools 字段）按思考、工具、正文的顺序渲染', () => {
    expect(
      messageBlocks({
        id: 'asst-1',
        role: 'assistant',
        content: '完成了',
        thinking: '先想想',
        tools: [{ id: 'wk-1', name: 'click', status: 'done' }],
      }),
    ).toEqual([
      { type: 'thinking', text: '先想想' },
      { type: 'tools', tools: [{ type: 'tool', id: 'wk-1', name: 'click', status: 'done' }] },
      { type: 'text', text: '完成了' },
    ]);
  });
});

describe('模型消息转换', () => {
  it('把历史轮转成模型消息并去掉与最新提示重复的尾项', () => {
    expect(
      toModelMessages(
        [
          { id: 'ask-1', role: 'user', content: ' 先检查登录框 ' },
          { id: 'asst-1', role: 'assistant', content: '  已填写邮箱。  ' },
          { id: 'ask-2', role: 'user', content: '再点提交' },
        ],
        '再点提交',
      ),
    ).toEqual([
      { role: 'user', content: '先检查登录框' },
      { role: 'assistant', content: '已填写邮箱。' },
    ]);
  });

  it('带截图的用户消息转换为多模态内容数组', () => {
    expect(
      toModelMessages([
        {
          id: 'ask-1',
          role: 'user',
          content: '这张截图里的问题',
          imageDataUrl: 'data:image/png;base64,QkE=',
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '这张截图里的问题' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,QkE=' },
          },
        ],
      },
    ]);
  });

  it('页面引用与命令引用被格式化成 runtime_context 前缀', () => {
    expect(
      toModelMessages([
        {
          id: 'ask-1',
          role: 'user',
          content: '帮我提取',
          references: [
            {
              type: 'page',
              tabId: 12,
              title: '开发文档',
              url: 'https://docs.sample.dev/guide',
              content: 'Guide page content',
            },
            {
              type: 'command',
              key: 'links',
              name: '提取链接',
              prompt: '按用途分组列出主要链接。',
            },
          ],
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: [
          '<runtime_context>',
          '<reference_page>',
          '- tabId: 12',
          '- title: 开发文档',
          '- url: https://docs.sample.dev/guide',
          '- content:',
          'Guide page content',
          '</reference_page>',
          '<reference_command>',
          '用户明确选择了命令 /links（提取链接）。',
          '必须结合用户当前补充要求，按照以下命令说明执行；不要向用户复述整段说明。',
          '<command_instructions>',
          '按用途分组列出主要链接。',
          '</command_instructions>',
          '</reference_command>',
          '</runtime_context>',
          '帮我提取',
        ].join('\n'),
      },
    ]);
  });
});

describe('工具参数与回合用量', () => {
  it('已上屏的工具收到后续 start 事件时原地更新参数', () => {
    let messages: ChatMessage[] = [];
    messages = applyAssistantToolStart(
      messages,
      { id: 'wk-1', name: 'type_text', args: '{"text":"用户', status: 'running' },
      'asst-1',
    );
    messages = applyAssistantToolStart(
      messages,
      { id: 'wk-1', name: 'type_text', args: { text: '完整内容' }, status: 'running' },
      'asst-1',
    );

    expect(messages[0]?.parts?.[0]).toMatchObject({
      id: 'wk-1',
      args: { text: '完整内容' },
      status: 'running',
    });
  });

  it('后续 start 事件参数为空时保留更完整的旧参数', () => {
    let messages: ChatMessage[] = [];
    messages = applyAssistantToolStart(
      messages,
      { id: 'wk-1', name: 'search_page_text', args: { query: '价格区间' }, status: 'running' },
      'asst-1',
    );
    messages = applyAssistantToolStart(
      messages,
      { id: 'wk-1', name: 'search_page_text', args: {}, status: 'running' },
      'asst-1',
    );

    expect(messages[0]?.parts?.[0]).toMatchObject({
      id: 'wk-1',
      args: { query: '价格区间' },
    });
  });

  it('回合用量挂在最新的 assistant 消息上，且不被后续 token 冲掉', () => {
    const usage = {
      inputTokens: 30,
      outputTokens: 7,
      totalTokens: 37,
      cachedTokens: 9,
      durationMs: 2400,
      modelCalls: 2,
      toolCalls: 1,
    };
    let messages: ChatMessage[] = streamed('先读取页面。');
    messages = applyAssistantUsage(messages, usage, 'asst-1');
    expect(messages[0]).toMatchObject({ content: '先读取页面。', usage });
    messages = applyAssistantToken(messages, '再提交表单。', 'asst-1');
    expect(messages[0]?.usage).toEqual(usage);
  });
});

describe('活跃会话归属', () => {
  it('只有正在运行且属于当前标签页的会话才算在本页', () => {
    expect(sessionIsOnTab({ tabId: 21, sessionTabId: 21, running: true })).toBe(true);
    expect(sessionIsOnTab({ tabId: 21, sessionTabId: 34, running: true })).toBe(false);
    expect(sessionIsOnTab({ tabId: 21, sessionTabId: 21, running: false })).toBe(false);
    expect(sessionIsOnTab({ tabId: 21, running: true })).toBe(true);
  });

  it('本标签页成为活跃会话或会话 id 发生变化时需要恢复', () => {
    const incoming = { tabId: 11, sessionTabId: 11, running: true, conversationId: 'conv-77' };
    expect(
      shouldRestoreLiveSession({
        alreadyAttached: false,
        context: incoming,
      }),
    ).toBe(true);
    expect(
      shouldRestoreLiveSession({
        alreadyAttached: true,
        attachedConversationId: 'conv-70',
        context: incoming,
      }),
    ).toBe(true);
    expect(
      shouldRestoreLiveSession({
        alreadyAttached: true,
        attachedConversationId: 'conv-77',
        context: incoming,
      }),
    ).toBe(false);
    expect(
      shouldRestoreLiveSession({
        alreadyAttached: false,
        context: { tabId: 11, sessionTabId: 12, running: true, conversationId: 'conv-77' },
      }),
    ).toBe(false);
  });

  it('把活跃会话采纳到目标标签页的存储中并保持面板打开', () => {
    const live = emptyConversation('跨标签页任务');
    live.messages = [{ id: 'msg-x', role: 'user', content: '把任务带过去' }];
    const local = emptyConversation('本页草稿');
    local.messages = [{ id: 'msg-y', role: 'user', content: '先看当前页' }];
    const adopted = adoptLiveStore(
      { activeId: local.id, conversations: [local] },
      { activeId: live.id, conversations: [live] },
      live.id,
    );
    expect(adopted.activeId).toBe(live.id);
    expect(adopted.panelOpen).toBe(true);
    expect(adopted.conversations.map((item) => item.id).sort()).toEqual([live.id, local.id].sort());
  });
});

describe('后台事件写入存储', () => {
  function storeWith(running = true): { store: PageConversationStore; conversationId: string } {
    const conversation = emptyConversation('后台无监听的任务');
    conversation.running = running;
    return {
      store: { activeId: conversation.id, conversations: [conversation], sessionId: 'sess-9', revision: 0 },
      conversationId: conversation.id,
    };
  }

  it('事件序列逐条累积，done 后收尾且修订号等于事件数', () => {
    const { store: initial, conversationId } = storeWith();
    let store = initial;
    store = applyAgentEventToStore(store, conversationId, {
      type: 'thinking',
      text: '正在读取页面结构',
    });
    store = applyAgentEventToStore(store, conversationId, {
      type: 'token',
      text: '后台生成的回答内容',
    });
    store = applyAgentEventToStore(store, conversationId, {
      type: 'tool-start',
      id: 'wk-1',
      name: 'page_info',
      args: {},
    });
    store = applyAgentEventToStore(store, conversationId, {
      type: 'tool-end',
      id: 'wk-1',
      name: 'page_info',
      output: '读取完成',
      elapsedMs: 900,
    });
    store = applyAgentEventToStore(store, conversationId, {
      type: 'usage',
      usage: {
        inputTokens: 55,
        outputTokens: 11,
        totalTokens: 66,
        cachedTokens: 20,
        durationMs: 900,
        modelCalls: 1,
        toolCalls: 1,
      },
    });
    store = applyAgentEventToStore(store, conversationId, { type: 'done' });

    expect(store.revision).toBe(6);
    expect(store.conversations[0]).toMatchObject({
      running: false,
      thinking: '',
      tasks: [{ id: 'wk-1', status: 'done', detail: '读取完成' }],
    });
    expect(store.conversations[0]?.messages[0]).toMatchObject({
      content: '后台生成的回答内容',
      usage: { totalTokens: 66, cachedTokens: 20, durationMs: 900 },
      tools: [{ id: 'wk-1', status: 'done', output: '读取完成', elapsedMs: 900 }],
    });
  });

  it('错误事件同样会收尾会话并记录错误信息', () => {
    const { store: initial, conversationId } = storeWith();
    const store = applyAgentEventToStore(initial, conversationId, {
      type: 'error',
      message: '与模型的连接中断',
    });
    expect(store.conversations[0]).toMatchObject({
      running: false,
      error: '与模型的连接中断',
    });
  });
});
