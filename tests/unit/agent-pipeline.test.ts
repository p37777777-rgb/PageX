import { describe, expect, it, vi } from 'vitest';
import {
  isRateLimitError,
  isUnrecoverableToolError,
  parseRetryAfterMs,
  retryWithBackoff,
  toolFailureContent,
  toolMadeProgress,
  withElapsedPrefix,
} from '@/features/agent/runtime/middleware';
import {
  applyTokenDelta,
  createStreamToolState,
  extractText,
  interpretStreamChunk,
} from '@/features/agent/runtime/stream';
import {
  extractTurnUsage,
  formatCacheHitRate,
  formatDuration,
  formatTokenCount,
  formatTurnUsageParts,
  hasTurnUsage,
  mergeTurnUsage,
  preferRicherUsage,
  withTurnTiming,
} from '@/features/agent/runtime/usage';
import { toUserErrorMessage } from '@/shared/contracts/errors';

describe('工具错误的可恢复性', () => {
  it('普通业务错误视为可恢复，失败消息带中文工具名', () => {
    const boom = new Error('找不到元素 e12');
    expect(isUnrecoverableToolError(boom)).toBe(false);
    const content = toolFailureContent('click_element', boom);
    expect(content).toContain('调用失败');
    expect(content).toContain('点击');
  });

  it('中断类错误（AbortError / 停止消息 / is_bubble_up）必须向上冒泡', () => {
    const abort = new Error('任务已停止');
    abort.name = 'AbortError';
    expect(isUnrecoverableToolError(abort)).toBe(true);
    expect(isUnrecoverableToolError(new Error('任务已停止'))).toBe(true);
    expect(isUnrecoverableToolError(Object.assign(new Error('interrupt'), { is_bubble_up: true }))).toBe(true);
  });
});

describe('工具结果的耗时前缀', () => {
  it('纯文本结果在毫秒以上时加前缀，0ms 时不加', () => {
    expect(withElapsedPrefix('{"ok":true}', 3_200)).toBe('当前任务已耗时 3.2s，请注意控制时间。\n{"ok":true}');
    expect(withElapsedPrefix('{"ok":true}', 0)).toBe('{"ok":true}');
  });

  it('message 的字符串与内容块数组都会被加前缀', () => {
    const textMessage = { content: '以下是页面观察数据…' };
    expect(withElapsedPrefix(textMessage, 1_500).content).toBe(
      '当前任务已耗时 1.5s，请注意控制时间。\n以下是页面观察数据…',
    );

    const blockMessage = {
      content: [
        { type: 'text', text: '截图完成' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      ],
    };
    expect(withElapsedPrefix(blockMessage, 800).content).toEqual([
      { type: 'text', text: '当前任务已耗时 800ms，请注意控制时间。\n截图完成' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
    ]);
  });
});

describe('工具进展判定', () => {
  it('只有目标状态真正变化才计入进展，命中与成功都不算', () => {
    expect(toolMadeProgress('search_page_text', { content: '{"total":0,"count":0}' })).toBe(false);
    expect(toolMadeProgress('search_page_text', { content: '{"total":3,"count":3}' })).toBe(false);
    expect(toolMadeProgress('get_source', { content: '{"content":"有用文本"}' })).toBe(false);
    expect(toolMadeProgress('click_element', { content: '{"ok":true}' })).toBe(false);
    expect(toolMadeProgress('observe_page_changes', { content: '{"changed":true}' })).toBe(true);
    expect(toolMadeProgress('interact_elements', { content: '{"satisfied":true,"changed":false}' })).toBe(false);
    expect(toolMadeProgress('interact_elements', { content: '{"satisfied":true,"changed":true}' })).toBe(true);
  });
});

describe('限流识别与重试等待', () => {
  it('按消息关键字或 status=429 识别限流错误', () => {
    expect(isRateLimitError(new Error('429 Individual quota reached.'))).toBe(true);
    expect(isRateLimitError(new Error('Rate limit exceeded'))).toBe(true);
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError(new Error('Other error'))).toBe(false);
  });

  it('从错误消息中解析重置时长，分钟级最长等 60 秒', () => {
    expect(parseRetryAfterMs(new Error('Resets in 16m37s.'))).toBe(60000);
    expect(parseRetryAfterMs(new Error('resets in 5s.'))).toBe(5000);
    expect(parseRetryAfterMs(new Error('retry after 12s.'))).toBe(12000);
  });

  it('限流错误按退避重试直到成功，并通过 onRetry 上报尝试', async () => {
    let calls = 0;
    const attempts: number[] = [];
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 4) throw new Error('429 Too Many Requests. Resets in 1s');
      return 'done';
    });
    const result = await retryWithBackoff(fn, {
      maxRetries: 5,
      delayMs: 10,
      onRetry: (attempt) => attempts.push(attempt),
    });
    expect(result).toBe('done');
    expect(calls).toBe(4);
    expect(attempts).toEqual([1, 2, 3]);
  });
});

describe('流事件解析：messages 通道', () => {
  it('把 LangGraph 消息元组中的 AI 内容转成 token 事件', () => {
    expect(
      interpretStreamChunk(['messages', [{ type: 'ai', content: '你好' }, { langgraph_node: 'model' }]]),
    ).toEqual([{ type: 'token', text: '你好' }]);
  });

  it('tool_calls 与 tool_call_chunks 在名字出现时立即发 tool-start', () => {
    expect(
      interpretStreamChunk([
        'messages',
        [{ type: 'ai', content: '', tool_calls: [{ id: 'c1', name: 'observe_page', args: {} }] }],
      ]),
    ).toEqual([{ type: 'tool-start', id: 'c1', name: 'observe_page', args: {} }]);
    expect(
      interpretStreamChunk([
        'messages',
        [
          {
            type: 'ai',
            content: '',
            tool_call_chunks: [{ id: 'c1', name: 'execute_cdp_script', args: '', index: 0 }],
          },
        ],
      ]),
    ).toEqual([{ type: 'tool-start', id: 'c1', name: 'execute_cdp_script', args: {} }]);
  });

  it('流式拼接工具参数：首次亮相与 JSON 拼完整时各发一次事件', () => {
    const state = createStreamToolState();
    expect(
      interpretStreamChunk(
        [
          'messages',
          [
            {
              type: 'ai',
              content: '',
              tool_call_chunks: [{ id: 'c1', name: 'execute_cdp_script', args: '{"expression":"', index: 0 }],
            },
          ],
        ],
        state,
      ),
    ).toEqual([
      { type: 'tool-start', id: 'c1', name: 'execute_cdp_script', args: '{"expression":"' },
    ]);
    expect(
      interpretStreamChunk(
        ['messages', [{ type: 'ai', content: '', tool_call_chunks: [{ args: 'document.', index: 0 }] }]],
        state,
      ),
    ).toEqual([]);
    expect(
      interpretStreamChunk(
        ['messages', [{ type: 'ai', content: '', tool_call_chunks: [{ args: 'title"}', index: 0 }] }]],
        state,
      ),
    ).toEqual([
      { type: 'tool-start', id: 'c1', name: 'execute_cdp_script', args: { expression: 'document.title' } },
    ]);
  });

  it('从内容块与 additional_kwargs 中提取 reasoning，且正文只保留 text', () => {
    expect(
      interpretStreamChunk([
        'messages',
        [
          {
            type: 'ai',
            content: [
              { type: 'reasoning', reasoning: '先看页面结构。' },
              { type: 'text', text: '接下来点击登录。' },
            ],
          },
        ],
      ]),
    ).toEqual([
      { type: 'reasoning', text: '先看页面结构。' },
      { type: 'token', text: '接下来点击登录。' },
    ]);
    expect(
      interpretStreamChunk([
        'messages',
        [{ type: 'ai', content: '', additional_kwargs: { reasoning_content: '我先观察。' } }],
      ]),
    ).toEqual([{ type: 'reasoning', text: '我先观察。' }]);
    expect(
      interpretStreamChunk([
        'messages',
        [
          {
            type: 'ai',
            content: '好了',
            additional_kwargs: { reasoning: { summary: [{ type: 'summary_text', text: '先核对标题。' }] } },
          },
        ],
      ]),
    ).toEqual([
      { type: 'reasoning', text: '先核对标题。' },
      { type: 'token', text: '好了' },
    ]);
    expect(
      extractText([
        { type: 'reasoning', text: '不该出现在正文里' },
        { type: 'text', text: '可见正文' },
      ]),
    ).toBe('可见正文');
  });

  it('AI 消息块携带 usage_metadata 时发 usage 事件', () => {
    expect(
      interpretStreamChunk([
        'messages',
        [
          {
            type: 'ai',
            content: '好了',
            usage_metadata: {
              input_tokens: 40,
              output_tokens: 6,
              total_tokens: 46,
              input_token_details: { cache_read: 20 },
            },
          },
        ],
      ]),
    ).toEqual([
      { type: 'token', text: '好了' },
      {
        type: 'usage',
        usage: {
          inputTokens: 40,
          outputTokens: 6,
          totalTokens: 46,
          cachedTokens: 20,
          reasoningTokens: 0,
          durationMs: 0,
          modelCalls: 0,
          toolCalls: 0,
        },
      },
    ]);
  });

  it('快照与增量文本正确合并出 delta', () => {
    expect(applyTokenDelta('', '你')).toEqual({ next: '你', delta: '你' });
    expect(applyTokenDelta('你', '你好')).toEqual({ next: '你好', delta: '好' });
    expect(applyTokenDelta('你好', '好')).toEqual({ next: '你好', delta: '' });
  });
});

describe('流事件解析：updates 通道', () => {
  it('model 节点的完整消息只发一次 tool-start', () => {
    expect(
      interpretStreamChunk([
        'updates',
        { model: { messages: [{ type: 'ai', tool_calls: [{ id: 'c9', name: 'observe_page', args: {} }] }] } },
      ]),
    ).toEqual([{ type: 'tool-start', id: 'c9', name: 'observe_page', args: {} }]);
  });

  it('工具消息转成 tool-end，不重复产出 token', () => {
    expect(
      interpretStreamChunk([
        'updates',
        { tools: { messages: [{ type: 'tool', name: 'observe_page', tool_call_id: 'c9', content: 'ok' }] } },
      ]),
    ).toEqual([{ type: 'tool-end', id: 'c9', name: 'observe_page', output: 'ok' }]);
  });

  it('status=error 的工具消息转成 tool-error', () => {
    expect(
      interpretStreamChunk([
        'updates',
        {
          tools: {
            messages: [
              { type: 'tool', name: 'click_element', tool_call_id: 'c10', status: 'error', content: '找不到元素' },
            ],
          },
        },
      ]),
    ).toEqual([{ type: 'tool-error', id: 'c10', name: 'click_element', output: '找不到元素' }]);
  });

  it('递归超限错误改写成用户可读的提示', () => {
    expect(
      toUserErrorMessage(new Error('Recursion limit of 25 reached without hitting a stop condition.')),
    ).toMatch(/步骤过多/);
  });
});

describe('轮次用量提取', () => {
  it('读取 LangChain usage_metadata，含缓存命中与推理 token', () => {
    expect(
      extractTurnUsage({
        type: 'ai',
        usage_metadata: {
          input_tokens: 1200,
          output_tokens: 80,
          total_tokens: 1280,
          input_token_details: { cache_read: 900 },
          output_token_details: { reasoning: 20 },
        },
      }),
    ).toMatchObject({
      inputTokens: 1200,
      outputTokens: 80,
      totalTokens: 1280,
      cachedTokens: 900,
      reasoningTokens: 20,
    });
  });

  it('兼容 OpenAI / Anthropic / DeepSeek / Gemini 的原生字段', () => {
    expect(
      extractTurnUsage({
        response_metadata: { tokenUsage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 } },
      }),
    ).toMatchObject({ inputTokens: 10, outputTokens: 4, totalTokens: 14 });
    expect(
      extractTurnUsage({
        usage: { input_tokens: 40, output_tokens: 6, cache_read_input_tokens: 22 },
      }),
    ).toMatchObject({ inputTokens: 40, outputTokens: 6, totalTokens: 46, cachedTokens: 22 });
    expect(
      extractTurnUsage({
        usage: { prompt_tokens: 80, completion_tokens: 9, prompt_cache_hit_tokens: 50 },
      }),
    ).toMatchObject({ inputTokens: 80, outputTokens: 9, totalTokens: 89, cachedTokens: 50 });
    expect(
      extractTurnUsage({
        usageMetadata: {
          promptTokenCount: 30,
          candidatesTokenCount: 5,
          totalTokenCount: 35,
          cachedContentTokenCount: 12,
        },
      }),
    ).toMatchObject({ inputTokens: 30, outputTokens: 5, totalTokens: 35, cachedTokens: 12 });
  });

  it('mergeTurnUsage 累加多次调用，preferRicherUsage 保留更完整的快照', () => {
    const first = extractTurnUsage({
      usage_metadata: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
    })!;
    const second = extractTurnUsage({
      usage_metadata: {
        input_tokens: 200,
        output_tokens: 20,
        total_tokens: 220,
        input_token_details: { cache_read: 80 },
      },
    })!;
    expect(mergeTurnUsage(first, second)).toMatchObject({
      inputTokens: 300,
      outputTokens: 30,
      totalTokens: 330,
      cachedTokens: 80,
    });
    expect(preferRicherUsage(first, second).totalTokens).toBe(220);
  });
});

describe('轮次用量格式化', () => {
  it('按开始时间打上耗时戳并输出紧凑页脚', () => {
    const usage = withTurnTiming(
      {
        inputTokens: 1024,
        outputTokens: 256,
        totalTokens: 1280,
        cachedTokens: 800,
        reasoningTokens: 0,
        durationMs: 0,
        modelCalls: 2,
        toolCalls: 3,
      },
      { startedAt: 1_000, now: 3_400, modelCalls: 2, toolCalls: 3 },
    );
    expect(usage.durationMs).toBe(2_400);
    expect(hasTurnUsage(usage)).toBe(true);
    expect(formatDuration(usage.durationMs)).toBe('2.4s');
    expect(formatCacheHitRate(usage)).toBe('缓存命中率 78%');
    expect(formatTurnUsageParts(usage)).toEqual([
      '输入 1.02K (缓存 800)',
      '输出 256',
      '缓存命中率 78%',
      '2.4s',
      '2 次模型',
      '3 次工具',
    ]);
  });

  it('小用量只输出基础三段，缓存为零时不带缓存括号', () => {
    expect(
      formatTurnUsageParts({
        inputTokens: 40,
        outputTokens: 6,
        totalTokens: 46,
        cachedTokens: 0,
        durationMs: 0,
        modelCalls: 1,
        toolCalls: 0,
      }),
    ).toEqual(['输入 40', '输出 6', '缓存命中率 0%']);
  });

  it('token 数量按 K / M 缩写', () => {
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(1_200)).toBe('1.2K');
    expect(formatTokenCount(48_600)).toBe('48.6K');
    expect(formatTokenCount(1_250_000)).toBe('1.25M');
  });
});
