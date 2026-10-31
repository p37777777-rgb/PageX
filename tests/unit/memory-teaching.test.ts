import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cosineSimilarity, embeddingFingerprint, searchMemories } from '@/features/memory/retrieval';
import {
  getMemory,
  listMemoriesForDomain,
  putMemory,
  resetMemoryStorageForTests,
} from '@/features/memory/storage';
import { writeMemory } from '@/features/memory/service';
import { sanitizeUrl } from '@/shared/contracts/policy';
import { DEFAULT_SETTINGS } from '@/shared/contracts/settings';
import {
  clearMemorySecret,
  resetSessionStorageForTests,
  saveMemorySecret,
} from '@/shared/storage/storage';
import {
  commandKey,
  createDetailedFallbackDraft,
} from '@/features/teaching/background/flow-summarizer';
import {
  createTeachingRecorder,
  sanitizeRecordedUrl,
  stableSelector,
} from '@/features/teaching/content/recorder';
import {
  clearTeachingSession,
  loadCommands,
  loadTeachingSession,
  saveCommand,
  saveTeachingSession,
} from '@/features/teaching/storage';
import type { MemoryRecord } from '@/shared/contracts/memory';
import type { SavedCommand, TeachingSession } from '@/shared/contracts/teaching';

const memorySettings = DEFAULT_SETTINGS.memory;

function buildRecord(
  id: string,
  scope: 'global' | 'local',
  vector: number[],
  domain?: string,
): MemoryRecord {
  const embedding = new Float32Array(vector);
  return {
    id,
    content: id,
    scope,
    domain,
    embedding: embedding.buffer.slice(0) as ArrayBuffer,
    embeddingModel: embeddingFingerprint(memorySettings),
    createdAt: 7,
    updatedAt: 7,
  };
}

describe('记忆存储与可见域', () => {
  beforeEach(async () => {
    resetMemoryStorageForTests();
    await resetSessionStorageForTests();
    await clearMemorySecret();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('向量以二进制 ArrayBuffer 形式落库并可原样读回', async () => {
    await putMemory(buildRecord('bin-1', 'global', [0.5, -0.25]));
    const loaded = await getMemory('bin-1');
    expect(loaded?.embedding).toBeInstanceOf(ArrayBuffer);
    expect([...new Float32Array(loaded!.embedding)]).toEqual([0.5, -0.25]);
  });

  it('候选范围 = 全局记忆加当前域的局部记忆，不跨域泄露', async () => {
    await putMemory(buildRecord('shared', 'global', [1, 0]));
    await putMemory(buildRecord('mine', 'local', [1, 0], 'app.test'));
    await putMemory(buildRecord('theirs', 'local', [1, 0], 'rival.test'));
    const visible = await listMemoriesForDomain('app.test');
    expect(visible).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'shared' }),
        expect.objectContaining({ id: 'mine' }),
      ]),
    );
    expect(visible.some((item) => item.id === 'theirs')).toBe(false);
  });
});

describe('记忆检索排序', () => {
  beforeEach(async () => {
    resetMemoryStorageForTests();
    await resetSessionStorageForTests();
    await clearMemorySecret();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('重排服务不可用时按余弦相似度回退，且结果不携带时间戳', async () => {
    await putMemory(buildRecord('closer', 'global', [1, 0]));
    await putMemory(buildRecord('farther', 'global', [0, 1]));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: [1, 0] }] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'reranker down',
      }));
    const results = await searchMemories({
      query: '部署步骤',
      domain: 'app.test',
      settings: memorySettings,
      apiKey: 'secret-embed-key',
    });
    expect(results.map((item) => item.id)).toEqual(['closer', 'farther']);
    expect(results[0]).not.toHaveProperty('createdAt');
    expect(results[0]).not.toHaveProperty('updatedAt');
  });

  it('重排分数低于 0.2 的记忆被丢弃', async () => {
    await putMemory(buildRecord('relevant', 'global', [1, 0]));
    await putMemory(buildRecord('noise', 'global', [0, 1]));
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: [1, 0] }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { index: 0, relevance_score: 0.9 },
            { index: 1, relevance_score: 0.15 },
          ],
        }),
      }));
    const results = await searchMemories({
      query: '发票抬头',
      domain: 'app.test',
      settings: memorySettings,
      apiKey: 'secret-embed-key',
    });
    expect(results).toEqual([
      expect.objectContaining({ id: 'relevant', score: 0.9 }),
    ]);
  });
});

describe('记忆写入与脱敏', () => {
  beforeEach(async () => {
    resetMemoryStorageForTests();
    await resetSessionStorageForTests();
    await clearMemorySecret();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('局部记忆带上脱敏后的来源 URL，并生成二进制向量', async () => {
    await saveMemorySecret('embed-secret-001');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0, 0, 1] }] }),
    }));
    const saved = await writeMemory({
      content: '结算页要选电子发票',
      scope: 'local',
      url: 'https://portal.test/invoice?session=sid-9&step=2',
    });
    const loaded = await getMemory(saved.id);
    expect(saved.domain).toBe('portal.test');
    expect(saved.sourceUrl).toContain('session=%5Bredacted%5D');
    expect(loaded?.embedding.byteLength).toBe(12);
  });

  it('URL 凭证、敏感参数值与密钥串都被清洗', () => {
    const value = sanitizeUrl('https://alice:hush@example.net/a?email=bill@corp.com&note=rk-abcdefghijklmnopqrst');
    expect(value).not.toContain('alice:hush');
    expect(value).toContain('email=%5Bredacted%5D');
    expect(value).toContain('[redacted-key]');
    expect(cosineSimilarity(new Float32Array([0.5, 0.5]), new Float32Array([0.5, 0.5]))).toBe(1);
  });
});

describe('示教录制器', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/checkout?secret=hush&step=2');
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('录制 URL 剥离凭证与敏感查询值', () => {
    expect(sanitizeRecordedUrl('https://dev:pw@shop.test/list?secret=abc&step=2')).toBe(
      'https://shop.test/list?secret=%5Bredacted%5D&step=2',
    );
  });

  it('稳定选择器优先采用语义化属性', () => {
    const submit = document.createElement('button');
    submit.dataset.testid = 'submit-order';
    document.body.append(submit);
    expect(stableSelector(submit)).toBe('button[data-testid="submit-order"]');
  });

  it('点击被记录，密码输入值被替换为 redacted', async () => {
    const emitted: Array<{ kind: string; value?: string; redacted?: boolean }> = [];
    const recorder = createTeachingRecorder((actions) => emitted.push(...actions));
    const submit = document.createElement('button');
    submit.textContent = '提交订单';
    const pin = document.createElement('input');
    pin.type = 'password';
    pin.value = 'hunter-two';
    document.body.append(submit, pin);

    recorder.start();
    submit.click();
    pin.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(700);
    recorder.stop();

    expect(emitted).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'click' }),
      expect.objectContaining({ kind: 'input', value: '[redacted]', redacted: true }),
    ]));
  });

  it('备注可以直接记录，也可以挂在目标元素上', () => {
    const emitted: Array<{ kind: string; value?: string; target?: unknown }> = [];
    const recorder = createTeachingRecorder((actions) => emitted.push(...actions));
    const confirm = document.createElement('button');
    confirm.textContent = '确认弹窗';
    document.body.append(confirm);

    recorder.start();
    recorder.recordComment('这一步前要等弹窗出现');
    recorder.recordComment('务必先核对金额', confirm);
    recorder.stop();

    expect(emitted).toEqual([
      expect.objectContaining({
        kind: 'comment',
        value: '这一步前要等弹窗出现',
        target: undefined,
      }),
      expect.objectContaining({
        kind: 'comment',
        value: '务必先核对金额',
        target: expect.objectContaining({
          tag: 'button',
          text: '确认弹窗',
        }),
      }),
    ]);
  });
});

describe('示教存储', () => {
  beforeEach(resetSessionStorageForTests);
  afterEach(resetSessionStorageForTests);

  it('进行中的录制会话可恢复，清除后读不到', async () => {
    const session: TeachingSession = {
      id: 'teach-77',
      status: 'recording',
      originTabId: 7,
      originUrl: 'https://shop.test/checkout',
      originDomain: 'shop.test',
      tabIds: [7],
      actions: [],
      startedAt: 10,
      updatedAt: 10,
    };
    await saveTeachingSession(session);
    await expect(loadTeachingSession()).resolves.toEqual(session);
    await clearTeachingSession();
    await expect(loadTeachingSession()).resolves.toBeNull();
  });

  it('已保存命令按保险箱域隔离，互不可见', async () => {
    const command: SavedCommand = {
      id: 'cmd-77',
      vaultDomain: 'shop.test',
      originUrl: 'https://shop.test/checkout',
      name: '结算购物车',
      key: 'checkout-cart',
      desc: '完成购物车结算流程',
      prompt: '请协助我结算当前购物车。',
      steps: [],
      createdAt: 10,
      updatedAt: 10,
    };
    await saveCommand(command);
    await expect(loadCommands('shop.test')).resolves.toEqual([command]);
    await expect(loadCommands('mall.test')).resolves.toEqual([]);
  });
});

describe('示教流程总结', () => {
  it('命令关键字归一为合法短横线形式', () => {
    expect(commandKey(' Checkout_Flow #1 ')).toBe('checkout-flow-1');
    expect(commandKey('提交 周报')).toBe('提交-周报');
  });

  it('兜底草稿保留页面、目标与输入值细节', () => {
    const draft = createDetailedFallbackDraft({
      id: 'teach-fallback-9',
      status: 'summarizing',
      originTabId: 3,
      originUrl: 'https://shop.test/checkout',
      originDomain: 'shop.test',
      tabIds: [3],
      actions: [{
        id: 'act-1',
        at: 10,
        kind: 'input',
        page: { url: 'https://shop.test/checkout', title: '结算页' },
        target: {
          tag: 'input',
          name: '收货地址',
          placeholder: '省市区街道',
          selector: 'input[name="address"]',
        },
        value: '北京市朝阳区',
      }],
      startedAt: 10,
      updatedAt: 11,
    });
    expect(draft.steps[0]?.detail).toContain('收货地址');
    expect(draft.steps[0]?.detail).toContain('https://shop.test/checkout');
    expect(draft.steps[0]?.detail).toContain('值=北京市朝阳区');
    expect(draft.steps[0]?.detail).toContain('input[name="address"]');
  });
});
