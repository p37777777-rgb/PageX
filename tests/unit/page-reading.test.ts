import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNamedScript } from '@/features/page/actions/scripts';
import { installPageNavigationEvents, PAGE_NAVIGATION_EVENT } from '@/features/page/navigation';
import { PageObserver, pageObserver } from '@/features/page/observer';
import { searchPageText } from '@/features/page/search';
import {
  isEditableTarget,
  restoreRememberedSelection,
  retainPageSelectionOnPointerDown,
  shouldPreservePagexFocus,
} from '@/features/page/selection';
import { compileMatcher, getPageSource, serializeLiveDom } from '@/features/page/source';

/*
 * 页面读取层：文本检索、内容源读取、选区/焦点保留、导航事件与交互元素提取。
 * 共享观察器在每个用例前重置，检索/提取结果中的编号才与本用例的 DOM 对应。
 */
beforeEach(() => {
  document.title = '';
  document.body.innerHTML = '';
  for (const node of Array.from(document.head.querySelectorAll('link[rel~="stylesheet"]'))) {
    node.remove();
  }
  Object.assign(pageObserver, new PageObserver());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function pinRect(el: Element, width = 120, height = 36) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 8, y: 16, top: 16, left: 8,
      right: 8 + width, bottom: 16 + height,
      width, height, toJSON: () => ({}),
    }),
  });
}

describe('searchPageText 文本检索', () => {
  it('命中可见正文并返回可用的元素编号', () => {
    document.body.innerHTML = `
      <p>本助手由 PageX 团队维护</p>
      <button>立即体验</button>
    `;
    const result = searchPageText('PageX');
    expect(result.total).toBe(1);
    expect(result.hits[0]).toMatchObject({ match: 'PageX', tag: 'p' });
    expect(result.hits[0]?.snippet).toContain('PageX');
    const node = pageObserver.getElement(result.hits[0]!.elementId, result.revision);
    expect(node.textContent).toContain('PageX');
  });

  it('检索输入框取值并区分大小写', () => {
    document.body.innerHTML = '<input value="ApiToken42" />';
    expect(searchPageText('apitoken42').total).toBe(1);
    expect(searchPageText('apitoken42', { caseSensitive: true }).total).toBe(0);
    expect(searchPageText('ApiToken42', { caseSensitive: true }).total).toBe(1);
  });

  it('能按元素 id 与 name 做结构性查找', () => {
    document.body.innerHTML = '<input id="order-no" name="orderNumber" />';
    expect(searchPageText('order-no').hits[0]).toMatchObject({ tag: 'input' });
    expect(searchPageText('orderNumber').hits[0]).toMatchObject({ tag: 'input' });
  });

  it('跳过扩展自身 UI 并按上限截断结果', () => {
    document.body.innerHTML = `
      <pagex-root><p>PageX 机密内容</p></pagex-root>
      <p>alpha PageX</p>
      <p>beta PageX</p>
      <p>gamma PageX</p>
    `;
    const result = searchPageText('PageX', { maxResults: 2 });
    expect(result.hits.every((hit) => !hit.snippet.includes('机密'))).toBe(true);
    expect(result.count).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.total).toBeGreaterThan(2);
  });

  it('默认收窄到交互层，page 作用域可绕过', () => {
    document.body.innerHTML = `
      <p>页面正文包含报告数据</p>
      <div role="dialog"><button>知道了</button></div>
    `;
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    pinRect(dialog, 220, 220);

    expect(searchPageText('报告数据').total).toBe(0);
    expect(searchPageText('报告数据', { scope: 'page' }).total).toBe(1);
  });
});

describe('getPageSource 内容读取', () => {
  it('读取地址与标题', async () => {
    document.title = '读取源码示例';
    const url = await getPageSource({ type: 'url' });
    expect(url.value).toContain(location.href);
    expect(url.total).toBe(1);

    const title = await getPageSource({ type: 'title' });
    expect(title.value).toBe('读取源码示例');
  });

  it('实时 DOM 不包含扩展自身 UI', async () => {
    document.body.innerHTML = `
      <main id="shell"><h1>概览</h1></main>
      <pagex-root><div data-pagex-ui="true">PageX 机密</div></pagex-root>
    `;
    const result = await getPageSource({ type: 'dom' });
    expect(result.content).toContain('<main id="shell">');
    expect(result.content).toContain('概览');
    expect(result.content).not.toContain('机密');
    expect(result.content).not.toContain('pagex-root');
  });

  it('实时 DOM 剔除脚本、样式与图形的执行体', async () => {
    document.body.innerHTML = `
      <main><button>继续操作</button></main>
      <style>.banner { color: blue; }</style>
      <script>window.__payload = "${'y'.repeat(1500)}";</script>
      <svg aria-label="示意图"><path d="M5 5 L90 90"></path></svg>
    `;
    const result = await getPageSource({ type: 'dom' });

    expect(result.content).toContain('<button>继续操作</button>');
    expect(result.content).toContain('<style></style>');
    expect(result.content).toContain('<script></script>');
    expect(result.content).toContain('<svg aria-label="示意图"></svg>');
    expect(result.content).not.toContain('.banner');
    expect(result.content).not.toContain('__payload');
    expect(result.content).not.toContain('M5 5');
  });

  it('可见正文读取邮箱脱敏，并跳过脚本与扩展 UI', async () => {
    document.body.innerHTML = `
      <p>支持邮箱 support@sample.org 咨询</p>
      <script>const token = 'rk-abcdefghijklmnop';</script>
      <pagex-root>面板文案</pagex-root>
    `;
    const result = await getPageSource({ type: 'text' });
    expect(result.content).toContain('支持邮箱');
    expect(result.content).toContain('[redacted-email]');
    expect(result.content).not.toContain('面板文案');
    expect(result.content).not.toContain('rk-abcdefghijklmnop');
  });

  it('提取链接、脚本与样式表并隐藏资源体', async () => {
    document.body.innerHTML = `
      <a href="https://sample.dev/guide">使用指南</a>
      <script>window.__entry = true;</script>
      <style>.nav { color: green; }</style>
    `;
    const external = document.createElement('script');
    external.type = 'text/plain';
    external.setAttribute('src', '/vendor.js');
    document.body.append(external);
    const theme = document.createElement('link');
    theme.rel = 'alternate stylesheet';
    theme.setAttribute('href', '/theme.css');
    document.head.append(theme);

    const links = await getPageSource({ type: 'links' });
    expect(links.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: expect.stringContaining('/guide'), text: '使用指南' }),
      ]),
    );

    const scripts = await getPageSource({ type: 'scripts' });
    expect(scripts.total).toBe(2);
    expect(scripts.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inline: false, href: expect.stringContaining('/vendor.js') }),
        expect.objectContaining({ inline: true, preview: expect.stringContaining('__entry') }),
      ]),
    );
    expect(scripts.items?.every((item) => typeof item === 'object' && !('body' in item))).toBe(true);

    const styles = await getPageSource({ type: 'stylesheets' });
    expect(styles.total).toBe(2);
    expect(styles.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inline: false, href: expect.stringContaining('/theme.css') }),
        expect.objectContaining({ inline: true, preview: expect.stringContaining('.nav') }),
      ]),
    );
  });

  it('支持子串、正则与大小写过滤', async () => {
    document.body.innerHTML = `
      <a href="https://sample.dev/signin">登录</a>
      <a href="https://sample.dev/guide">指南</a>
      <script>function AuthPanel() {}</script>
    `;

    const links = await getPageSource({ type: 'links', grep: 'signin' });
    expect(links.total).toBe(1);
    expect(links.items?.[0]).toMatchObject({ href: expect.stringContaining('/signin') });

    const strict = await getPageSource({
      type: 'scripts',
      grep: 'authpanel',
      caseSensitive: true,
    });
    expect(strict.total).toBe(0);

    const pattern = await getPageSource({ type: 'dom', grep: '登[录錄]', regex: true });
    expect(pattern.matches?.some((item) => item.match.includes('登录'))).toBe(true);
  });

  it('正则样式字面量无命中时提示改用 regex 模式', async () => {
    document.body.innerHTML = '<form><input /><textarea></textarea></form>';
    const result = await getPageSource({ type: 'dom', grep: 'input|textarea' });
    expect(result.total).toBe(0);
    expect(result.hint).toContain('regex=true');
  });

  it('长文本默认分页，可从 nextOffset 续读直至读完', async () => {
    document.body.innerHTML = `<pre>${'Z'.repeat(8_000)}</pre>`;
    const first = await getPageSource({ type: 'text' });
    expect(first.total).toBeGreaterThan(4_000);
    expect(first.limit).toBe(4_000);
    expect(first.hasMore).toBe(true);
    expect(first.nextOffset).toBe(first.offset + first.count);
    expect(first.content?.length).toBe(first.count);

    const second = await getPageSource({ type: 'text', offset: first.nextOffset, limit: 4_000 });
    expect(second.offset).toBe(first.nextOffset);
    expect(second.content?.length).toBeGreaterThan(0);

    const tail = await getPageSource({ type: 'text', offset: first.total, limit: 4_000 });
    expect(tail.hasMore).toBe(false);
    expect(tail.count).toBe(0);
  });

  it('grep 命中与列表条目均可分页', async () => {
    document.body.innerHTML = `<pre>${Array.from({ length: 10 }, (_, index) => `row-${index} payload`).join('\n')}</pre>`;
    const page1 = await getPageSource({ type: 'text', grep: 'row-', limit: 4 });
    expect(page1.total).toBe(10);
    expect(page1.count).toBe(4);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextOffset).toBe(4);

    const page2 = await getPageSource({ type: 'text', grep: 'row-', offset: 4, limit: 4 });
    expect(page2.count).toBe(4);
    expect(page2.hasMore).toBe(true);

    document.body.innerHTML = Array.from(
      { length: 6 },
      (_, index) => `<a href="/detail-${index}">条目 ${index}</a>`,
    ).join('');
    const links = await getPageSource({ type: 'links', grep: 'detail', limit: 2 });
    expect(links.total).toBe(6);
    expect(links.count).toBe(2);
    expect(links.nextOffset).toBe(2);
  });

  it('原始 HTML 抓取失败时回退到实时 DOM', async () => {
    document.body.innerHTML = '<article>抓取失败时回退到实时 DOM</article>';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const result = await getPageSource({ type: 'page' });
    expect(result.content).toContain('抓取失败时回退到实时 DOM');
  });

  it('原始 HTML 抓取成功时优先使用远端内容', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => '<!DOCTYPE html><html><body>远端原始标记</body></html>',
      })),
    );
    const result = await getPageSource({ type: 'page', grep: '远端' });
    expect(result.matches?.[0]?.snippet).toContain('远端原始标记');
  });

  it('非法正则直接抛错', () => {
    expect(() => compileMatcher({ grep: '(open', regex: true })).toThrow(/非法正则/);
  });

  it('序列化实时 DOM 时带上 doctype', () => {
    const html = serializeLiveDom(document);
    expect(html).toContain('<html');
  });
});

describe('选区与焦点保留', () => {
  it('表单控件视为可编辑目标', () => {
    const field = document.createElement('input');
    const wrap = document.createElement('div');
    wrap.append(field);
    document.body.append(wrap);
    expect(isEditableTarget(field)).toBe(true);
    expect(isEditableTarget(wrap)).toBe(false);
  });

  it('pointerdown 时对普通按钮阻止默认，对开关与输入框放行', () => {
    const plain = document.createElement('button');
    const toggle = document.createElement('button');
    toggle.setAttribute('role', 'switch');
    const editor = document.createElement('textarea');
    let blocked = 0;
    const fakeEvent = (target: Element) => ({
      target,
      preventDefault: () => {
        blocked += 1;
      },
    });

    retainPageSelectionOnPointerDown(fakeEvent(plain));
    expect(blocked).toBe(1);

    retainPageSelectionOnPointerDown(fakeEvent(toggle));
    retainPageSelectionOnPointerDown(fakeEvent(editor));
    expect(blocked).toBe(1);
  });

  it('编辑器持有焦点时保留焦点而不是恢复页面选区', () => {
    const editor = document.createElement('textarea');
    document.body.append(editor);
    editor.focus();
    expect(shouldPreservePagexFocus(editor)).toBe(true);
    restoreRememberedSelection({ target: editor });
    expect(document.activeElement).toBe(editor);

    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    expect(shouldPreservePagexFocus(trigger)).toBe(false);
  });
});

describe('页面导航事件', () => {
  it('pushState 与 replaceState 提交新地址后都会广播事件', async () => {
    const seen: string[] = [];
    window.addEventListener(PAGE_NAVIGATION_EVENT, () => seen.push(location.href));
    installPageNavigationEvents();

    history.pushState({}, '', '/route-a');
    await vi.waitFor(() => expect(seen.at(-1)).toContain('/route-a'));

    history.replaceState({}, '', '/route-b');
    await vi.waitFor(() => expect(seen.at(-1)).toContain('/route-b'));
  });
});

describe('extract_interactions 交互元素提取', () => {
  it('把带 pointer 光标的普通元素提取为可操作目标，忽略普通文本', () => {
    document.body.innerHTML = `
      <div id="tile" style="cursor: pointer">自绘瓷片</div>
      <span id="pill" style="cursor: pointer">胶囊按钮</span>
      <div id="caption">说明文字</div>
    `;
    pinRect(document.getElementById('tile')!);
    pinRect(document.getElementById('pill')!);
    pinRect(document.getElementById('caption')!);

    const result = runNamedScript('extract_interactions') as {
      elements: Array<{ tag: string; name: string; cursor?: string; clickable: boolean; actionable: boolean; actions: string[] }>;
    };

    const tile = result.elements.find((el) => el.name === '自绘瓷片');
    const pill = result.elements.find((el) => el.name === '胶囊按钮');
    const caption = result.elements.find((el) => el.name === '说明文字');

    expect(tile).toMatchObject({
      tag: 'div',
      clickable: true,
      actionable: true,
      cursor: 'pointer',
      actions: expect.arrayContaining(['activate']),
    });
    expect(pill).toMatchObject({
      tag: 'span',
      clickable: true,
      actionable: true,
      cursor: 'pointer',
    });
    expect(caption).toBeUndefined();
  });

  it('识别 grab、zoom-in、col-resize 等交互光标', () => {
    document.body.innerHTML = `
      <div id="grip" style="cursor: grab">拖拽排序</div>
      <div id="preview" style="cursor: zoom-in">放大预览</div>
      <div id="divider" style="cursor: col-resize">调整列宽</div>
    `;
    pinRect(document.getElementById('grip')!);
    pinRect(document.getElementById('preview')!);
    pinRect(document.getElementById('divider')!);

    const result = runNamedScript('extract_interactions') as {
      elements: Array<{ name: string; cursor?: string; clickable: boolean; actionable: boolean; actions: string[] }>;
    };

    expect(result.elements.find((el) => el.name === '拖拽排序')).toMatchObject({
      clickable: true,
      actionable: true,
      cursor: 'grab',
      actions: expect.arrayContaining(['activate']),
    });
    expect(result.elements.find((el) => el.name === '放大预览')).toMatchObject({
      clickable: true,
      actionable: true,
      cursor: 'zoom-in',
    });
    expect(result.elements.find((el) => el.name === '调整列宽')).toMatchObject({
      clickable: true,
      actionable: true,
      cursor: 'col-resize',
    });
  });

  it('default、text、not-allowed 等非交互光标被忽略', () => {
    document.body.innerHTML = `
      <div id="idle" style="cursor: default">常规光标</div>
      <div id="prose" style="cursor: text">文本光标</div>
      <div id="blocked" style="cursor: not-allowed">禁止光标</div>
    `;
    pinRect(document.getElementById('idle')!);
    pinRect(document.getElementById('prose')!);
    pinRect(document.getElementById('blocked')!);

    const result = runNamedScript('extract_interactions') as {
      elements: Array<{ name: string }>;
    };

    expect(result.elements.some((el) => el.name === '常规光标')).toBe(false);
    expect(result.elements.some((el) => el.name === '文本光标')).toBe(false);
    expect(result.elements.some((el) => el.name === '禁止光标')).toBe(false);
  });

  it('继承光标的子元素去重，只收集光标起点容器', () => {
    document.body.innerHTML = `
      <div id="panel" style="cursor: pointer">
        <h3>面板标题</h3>
        <p>面板说明 <span>角标</span></p>
      </div>
    `;
    pinRect(document.getElementById('panel')!);
    pinRect(document.querySelector('h3')!);
    pinRect(document.querySelector('p')!);
    pinRect(document.querySelector('span')!);

    const result = runNamedScript('extract_interactions') as {
      elements: Array<{ tag: string; cursor?: string }>;
    };

    expect(result.elements.some((el) => el.tag === 'div' && el.cursor === 'pointer')).toBe(true);
    expect(result.elements.some((el) => el.tag === 'h3')).toBe(false);
    expect(result.elements.some((el) => el.tag === 'p')).toBe(false);
    expect(result.elements.some((el) => el.tag === 'span')).toBe(false);
  });

  it('显式声明交互光标的内层元素与原生控件仍会被收集', () => {
    document.body.innerHTML = `
      <div id="wrap" style="cursor: pointer">
        <span id="plain">纯文本标题</span>
        <button id="buy">立即购买</button>
        <span id="fav" style="cursor: pointer">收藏</span>
      </div>
    `;
    pinRect(document.getElementById('wrap')!);
    pinRect(document.getElementById('plain')!);
    pinRect(document.getElementById('buy')!);
    pinRect(document.getElementById('fav')!);

    const result = runNamedScript('extract_interactions') as {
      elements: Array<{ id: string; tag: string; name: string }>;
    };

    expect(result.elements.some((el) => el.id.length > 0 && el.tag === 'div')).toBe(true);
    expect(result.elements.some((el) => el.name === '纯文本标题')).toBe(false);
    expect(result.elements.some((el) => el.name === '立即购买' && el.tag === 'button')).toBe(true);
    expect(result.elements.some((el) => el.name === '收藏' && el.tag === 'span')).toBe(true);
  });
});
