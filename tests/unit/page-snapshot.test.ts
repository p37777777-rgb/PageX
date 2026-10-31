import { describe, expect, it } from 'vitest';
import {
  diffPageChanges,
  PageChangeTracker,
  type PageChangeSnapshot,
} from '@/features/page/change-tracker';
import { implicitRole, pageObserver, PageObserver, visibleText } from '@/features/page/observer';

/*
 * 页面快照层：观察器的元素语义提取 + 变更追踪器的差异归纳。
 * 快照类用例用真实 DOM 安装追踪器；对比类用例直接构造快照契约。
 */
function pinRect(el: Element, width = 180, height = 46) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 12, y: 24, top: 24, left: 12,
      right: 12 + width, bottom: 24 + height,
      width, height, toJSON: () => ({}),
    }),
  });
}

function makeSnapshot(
  nodes: PageChangeSnapshot['nodes'],
  overrides: Partial<PageChangeSnapshot> = {},
): PageChangeSnapshot {
  return {
    watchId: 'watch-A1',
    documentId: 'doc-A1',
    cursor: 10,
    mutationCount: 2,
    maxNodes: 300,
    url: 'https://sample.dev/dashboard',
    title: '控制台',
    viewport: { scrollX: 0, scrollY: 0 },
    nodes,
    ...overrides,
  };
}

describe('PageObserver 观察', () => {
  it('为元素分配稳定编号，bump 后旧 revision 读取失效', () => {
    document.body.innerHTML = `
      <button id="confirm">确认预约</button>
      <input aria-label="手机号" />
      <a href="https://sample.dev/help">帮助中心</a>
    `;
    const observer = new PageObserver();
    const first = observer.observe();
    expect(first.revision).toBe(1);
    expect(first.elements.length).toBeGreaterThan(0);
    const button = first.elements.find((item) => item.name.includes('确认预约'));
    expect(button).toBeTruthy();
    const node = observer.getElement(button!.id, first.revision);
    expect(node.textContent).toContain('确认预约');

    observer.bump();
    expect(() => observer.getElement(button!.id, first.revision)).toThrow(/过期/);
  });

  it('visibleText 折叠空白，implicitRole 推导原生角色', () => {
    const anchor = document.createElement('a');
    anchor.textContent = '  阅读 指南  ';
    expect(visibleText(anchor)).toBe('阅读 指南');
    expect(implicitRole(anchor)).toBe('link');

    const editor = document.createElement('textarea');
    expect(implicitRole(editor)).toBe('textbox');
  });

  it('从原生标签与约束提炼控件的紧凑语义', () => {
    document.body.innerHTML = `
      <label for="country">国家</label>
      <select id="country" required>
        <option value="cn">中国</option>
        <option value="jp" selected>日本</option>
      </select>
      <input id="amount" type="range" min="0" max="500" step="25" value="200" />
    `;
    const result = new PageObserver().observe();
    const country = result.elements.find((item) => item.label === '国家');
    const amount = result.elements.find((item) => item.role === 'slider');

    expect(country).toMatchObject({
      role: 'combobox',
      value: 'jp',
      valueText: '日本',
      required: true,
      actionable: true,
    });
    expect(country?.options?.find((option) => option.selected)?.label).toBe('日本');
    expect(amount).toMatchObject({
      min: 0,
      max: 500,
      step: 25,
      actions: expect.arrayContaining(['set-value']),
    });
    expect(result.totalElements).toBeGreaterThanOrEqual(2);
  });

  it('能观察到开放 shadow root 内的控件', () => {
    document.body.innerHTML = '<div id="mount"></div>';
    const shadow = document.getElementById('mount')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button aria-label="关闭弹层">知道了</button>';
    const result = new PageObserver().observe();
    expect(result.elements.some((item) => item.name === '关闭弹层')).toBe(true);
  });

  it('识别临时交互层并把扫描范围收窄到其中', () => {
    document.body.innerHTML = `
      <button>页面外操作</button>
      <div role="dialog" aria-label="临时选择">
        <ul><li id="choice" style="cursor: pointer">选项一</li></ul>
        <button>确定</button>
      </div>
    `;
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    pinRect(dialog, 220, 220);
    const choice = document.getElementById('choice') as HTMLElement;
    choice.tabIndex = -1;
    pinRect(choice, 110, 30);

    const result = new PageObserver().observe();

    expect(result.interactionContext?.name).toBe('临时选择');
    expect(result.scope).toBe('interaction-context');
    expect(result.fallbackApplied).toBe(false);
    expect(result.elements.some((item) => item.name === '页面外操作')).toBe(false);
    expect(result.elements.find((item) => item.name === '选项一')).toMatchObject({
      clickable: true,
      actionable: true,
      visibility: 'visible',
      actions: expect.arrayContaining(['activate']),
    });
  });

  it('扩展自身 UI 不构成交互层', () => {
    document.body.innerHTML = `
      <button>页面按钮</button>
      <pagex-root popover><button>扩展按钮</button></pagex-root>
    `;
    const extensionRoot = document.querySelector('pagex-root') as HTMLElement;
    pinRect(extensionRoot, 220, 220);

    const result = new PageObserver().observe();

    expect(result.scope).toBe('page');
    expect(result.interactionContext).toBeUndefined();
    expect(result.elements.some((item) => item.name === '页面按钮')).toBe(true);
    expect(result.elements.some((item) => item.name === '扩展按钮')).toBe(false);
  });

  it('常驻导航菜单不算临时交互层', () => {
    document.body.innerHTML = `
      <aside><div role="menu"><a role="menuitem" href="/reports">数据报表</a></div></aside>
      <main><button>时间范围 近7天</button></main>
    `;
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    pinRect(menu, 236, 800);

    const result = new PageObserver().observe();

    expect(result.scope).toBe('page');
    expect(result.interactionContext).toBeUndefined();
    expect(result.elements.some((item) => item.name === '时间范围 近7天')).toBe(true);
  });

  it('允许调用方强制整页扫描', () => {
    document.body.innerHTML = `
      <button>页面外操作</button>
      <div role="dialog" aria-label="临时选择"><button>确定</button></div>
    `;
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    pinRect(dialog, 220, 220);

    const result = new PageObserver().observe(document, 140, 'page');

    expect(result.scope).toBe('page');
    expect(result.scopeReason).toContain('强制扫描整页');
    expect(result.elements.some((item) => item.name === '页面外操作')).toBe(true);
  });

  it('临时层无可操作目标时自动回退整页', () => {
    document.body.innerHTML = `
      <button>页面按钮</button>
      <div role="dialog" aria-label="空提示"><li>仅有一段说明文字</li></div>
    `;
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    pinRect(dialog, 220, 220);

    const result = new PageObserver().observe();

    expect(result.scope).toBe('page');
    expect(result.fallbackApplied).toBe(true);
    expect(result.scopeReason).toContain('自动回退');
    expect(result.elements.some((item) => item.name === '页面按钮')).toBe(true);
  });

  it('记录 cursor 属性并识别整页上的指针目标', () => {
    document.body.innerHTML = `
      <div id="cover" style="cursor: pointer">图库封面</div>
      <div id="handle" style="cursor: grab">进度手柄</div>
    `;
    pinRect(document.getElementById('cover')!, 200, 50);
    pinRect(document.getElementById('handle')!, 200, 40);

    const result = new PageObserver().observe();
    const cover = result.elements.find((item) => item.name === '图库封面');
    const handle = result.elements.find((item) => item.name === '进度手柄');

    expect(cover).toMatchObject({
      clickable: true,
      actionable: true,
      cursor: 'pointer',
      actions: expect.arrayContaining(['activate']),
    });
    expect(handle).toMatchObject({
      clickable: true,
      actionable: true,
      cursor: 'grab',
      actions: expect.arrayContaining(['activate']),
    });
  });
});

describe('PageChangeTracker 变更对比', () => {
  it('归纳语义级节点差异并统计变更数量', () => {
    const baseline = makeSnapshot([
      { id: 'btn-pay', tag: 'button', role: 'button', name: '去付款', visible: true, disabled: true },
    ]);
    const current = makeSnapshot(
      [
        { id: 'btn-pay', tag: 'button', role: 'button', name: '支付处理中', visible: true, disabled: false },
        { id: 'toast-1', tag: 'p', role: 'status', name: '订单已提交', visible: true },
      ],
      { cursor: 12, mutationCount: 6 },
    );

    const result = diffPageChanges(baseline, current);
    expect(result.changed).toBe(true);
    expect(result.mutationCount).toBe(4);
    expect(result.changes.map((change) => change.kind)).toEqual([
      'text_changed',
      'state_changed',
      'added',
    ]);
    expect(result.summary).toContain('新增 1 处');
  });

  it('捕获表单输入且不推进观察器 revision', async () => {
    document.body.innerHTML = '<input aria-label="昵称" value="" />';
    const tracker = new PageChangeTracker();
    const release = tracker.install();
    const baseline = tracker.snapshot();
    const revisionBefore = pageObserver.revision;
    const input = document.querySelector('input')!;
    input.value = 'night-owl';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const result = await tracker.read(baseline, { timeoutMs: 300, quietMs: 50 });
    release();

    expect(result.settled).toBe(true);
    expect(result.changes.some((change) => change.kind === 'state_changed')).toBe(true);
    expect(pageObserver.revision).toBe(revisionBefore);
  });

  it('密码字段值一律脱敏', () => {
    document.body.innerHTML = '<input type="password" value="top-secret-999">';
    const value = new PageChangeTracker().snapshot().nodes[0]?.value;
    expect(value).toBe('[redacted-present]');
    expect(value).not.toContain('top-secret-999');
  });

  it('跨文档视为导航变化', () => {
    const baseline = makeSnapshot([]);
    const current = makeSnapshot([], {
      documentId: 'doc-B2',
      url: 'https://sample.dev/detail',
      title: '详情',
    });
    expect(diffPageChanges(baseline, current).changes[0]).toMatchObject({
      kind: 'navigation',
      before: { url: 'https://sample.dev/dashboard' },
      after: { url: 'https://sample.dev/detail' },
    });
  });

  it('容器类元素也纳入快照', () => {
    document.body.innerHTML = '<div><span>已同步</span></div>';
    pinRect(document.querySelector('div')!);
    pinRect(document.querySelector('span')!);
    const nodes = new PageChangeTracker().snapshot().nodes;
    expect(nodes.some((node) => node.tag === 'span' && node.name === '已同步' && node.visible)).toBe(true);
    expect(nodes.some((node) => node.tag === 'div')).toBe(true);
  });

  it('捕捉透明度带来的可见性翻转', async () => {
    document.body.innerHTML = '<div><span id="chip" style="opacity: 0">草稿已保存</span></div>';
    pinRect(document.getElementById('chip')!);
    const tracker = new PageChangeTracker();
    const release = tracker.install();
    const baseline = tracker.snapshot();
    expect(baseline.nodes.some((node) => node.tag === 'span' && !node.visible)).toBe(true);

    document.getElementById('chip')!.style.opacity = '1';
    const result = await tracker.read(baseline, { timeoutMs: 500, quietMs: 50 });
    release();

    expect(result.settled).toBe(true);
    expect(result.changes).toContainEqual(
      expect.objectContaining({ kind: 'visibility_changed', before: false, after: true }),
    );
  });

  it('捕捉 inline display 由隐藏到显示的新增', async () => {
    document.body.innerHTML = '<section id="drawer" style="display: none">抽屉内容</section>';
    pinRect(document.getElementById('drawer')!);
    const tracker = new PageChangeTracker();
    const release = tracker.install();
    const baseline = tracker.snapshot();
    expect(baseline.nodes.some((node) => node.name === '抽屉内容')).toBe(false);

    document.getElementById('drawer')!.style.display = 'block';
    const result = await tracker.read(baseline, { timeoutMs: 500, quietMs: 50 });
    release();

    expect(result.settled).toBe(true);
    expect(
      result.changes.some((change) => change.kind === 'added' && change.target?.name === '抽屉内容'),
    ).toBe(true);
  });
});
