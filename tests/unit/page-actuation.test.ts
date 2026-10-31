import { beforeEach, describe, expect, it } from 'vitest';
import {
  clickElement,
  findCommonAncestor,
  inspectElementTree,
  interactElements,
  typeText,
} from '@/features/page/actions';
import { PageObserver, pageObserver } from '@/features/page/observer';

/*
 * 页面执行层：单点动作、批量交互、局部结构树与共同祖先定位。
 * 每个用例都通过共享观察器拿到元素编号后再驱动真实 DOM。
 */
beforeEach(() => {
  document.body.innerHTML = '';
  Object.assign(pageObserver, new PageObserver());
});

describe('批量交互 interactElements', () => {
  it('按步骤写入文本与勾选状态，并回传每步的后置校验', async () => {
    document.body.innerHTML = `
      <label for="nickname">昵称</label>
      <input id="nickname" value="" />
      <label><input id="weekly" type="checkbox" />订阅周报</label>
    `;
    const observation = pageObserver.observe();
    const nickname = observation.elements.find((item) => item.label === '昵称')!;
    const weekly = observation.elements.find(
      (item) => item.id !== nickname.id && item.role === 'checkbox',
    )!;

    const results = await interactElements([
      { elementId: nickname.id, intent: 'set-value', value: '林小满' },
      { elementId: weekly.id, intent: 'set-checked', value: true },
    ]);

    expect(results).toEqual([
      expect.objectContaining({ ok: true, changed: true, satisfied: true }),
      expect.objectContaining({ ok: true, changed: true, satisfied: true }),
    ]);
    expect((document.getElementById('nickname') as HTMLInputElement).value).toBe('林小满');
    expect((document.getElementById('weekly') as HTMLInputElement).checked).toBe(true);
  });

  it('对原生下拉框按 value 选中选项', async () => {
    document.body.innerHTML = `
      <select aria-label="配送地区">
        <option value="east">华东</option>
        <option value="north">华北</option>
      </select>
    `;
    const observation = pageObserver.observe();
    const region = observation.elements.find((item) => item.name === '配送地区')!;
    expect(region.options).toHaveLength(2);

    const [result] = await interactElements([
      { elementId: region.id, intent: 'choose-option', value: 'north' },
    ]);

    expect(result).toMatchObject({ ok: true, changed: true, satisfied: true });
    const select = document.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('north');
  });
});

describe('单点输入 typeText', () => {
  it('默认整段替换输入框内容', async () => {
    document.body.innerHTML = '<input id="clock" value="09:00" />';
    const field = pageObserver.observe().elements.find((item) => item.tag === 'input')!;

    const replaced = await typeText(field.id, '09:30');
    expect(replaced).toMatchObject({ changed: true, satisfied: true, value: '09:30' });
  });

  it('显式 append 模式在原值后追加', async () => {
    document.body.innerHTML = '<input id="clock" value="09:30" />';
    const field = pageObserver.observe().elements.find((item) => item.tag === 'input')!;

    const appended = await typeText(field.id, ' PST', { mode: 'append' });
    expect(appended).toMatchObject({ changed: true, satisfied: true, value: '09:30 PST' });
  });

  it('敏感字段写入后 satisfied 判定基于真实 DOM 值', async () => {
    document.body.innerHTML = '<input aria-label="工作邮箱" type="email" />';
    const field = pageObserver.observe().elements.find((item) => item.name === '工作邮箱')!;

    const [result] = await interactElements([
      { elementId: field.id, intent: 'set-value', value: 'staff@corp.example' },
    ]);

    expect(result?.satisfied).toBe(true);
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('staff@corp.example');
  });
});

describe('单点点击 clickElement', () => {
  it('目标状态因点击发生变化时上报 changed 与 after 快照', async () => {
    document.body.innerHTML = '<button aria-expanded="false">详细信息</button>';
    const button = document.querySelector('button')!;
    button.addEventListener('click', () => button.setAttribute('aria-expanded', 'true'));
    const target = pageObserver.observe().elements.find((item) => item.name === '详细信息')!;

    await expect(clickElement(target.id)).resolves.toMatchObject({
      ok: true,
      changed: true,
      after: expect.objectContaining({ expanded: true }),
    });
  });
});

describe('局部结构树 inspectElementTree', () => {
  it('按需输出字段并在深度耗尽处标记 more-level', () => {
    document.body.innerHTML = `
      <article data-probe="reading-pane">正文内容
        <div role="region">区域
          <span><b>深层加粗</b></span>
        </div>
      </article>
    `;
    const root = document.querySelector('article') as HTMLElement;
    root.getBoundingClientRect = () => ({
      x: 5, y: 15, top: 15, left: 5, right: 245, bottom: 135,
      width: 240, height: 120, toJSON: () => ({}),
    });
    const elementId = pageObserver.register(root);

    const result = inspectElementTree(elementId, {
      fields: { text: true, coordinates: true, attributes: ['data-probe'] },
      maxDepth: 1,
      maxLength: 20,
    });

    expect(result.tree).toContain(
      'article text="正文内容" box="5,15,240,120" data-probe="reading-pane"',
    );
    expect(result.tree).toContain('div role="region" text="区域"');
    expect(result.tree).toContain('more-level remaining-levels=2');
    expect(result.truncated).toBe(true);
  });

  it('标签数超上限时以 more-label 收尾', () => {
    document.body.innerHTML = `
      <ul>
        <li>甲</li>
        <li>乙</li>
        <li>丙</li>
        <li>丁</li>
      </ul>
    `;
    const elementId = pageObserver.register(document.querySelector('ul')!);

    const result = inspectElementTree(elementId, {
      fields: { text: true },
      maxDepth: 4,
      maxLength: 3,
    });

    expect(result.emittedLabels).toBe(3);
    expect(result.tree.split('\n')).toHaveLength(3);
    expect(result.tree).toContain('more-label remaining-labels=3');
  });
});

describe('共同祖先 findCommonAncestor', () => {
  it('两个元素向上聚合到最近公共容器', () => {
    document.body.innerHTML = `
      <section id="panel" aria-label="设置面板">
        <div class="head"><button id="save">保存</button></div>
        <div class="body"><span><button id="cancel">取消</button></span></div>
      </section>
    `;
    const panel = document.querySelector('#panel')!;
    const idSave = pageObserver.register(document.querySelector('#save')!);
    const idCancel = pageObserver.register(document.querySelector('#cancel')!);

    const result = findCommonAncestor([idSave, idCancel]);

    expect(result.elementId).toBe(pageObserver.register(panel));
    expect(result.tag).toBe('section');
    expect(result.name).toBe('设置面板');
    expect(result.sameElement).toBe(false);
    expect(result.depths).toEqual([2, 3]);
  });

  it('三个元素时先局部后整体聚合', () => {
    document.body.innerHTML = `
      <form id="wizard">
        <fieldset id="step-one">
          <input id="first-name" />
          <input id="last-name" />
        </fieldset>
        <button id="next">下一步</button>
      </form>
    `;
    const idFirst = pageObserver.register(document.querySelector('#first-name')!);
    const idLast = pageObserver.register(document.querySelector('#last-name')!);
    const idNext = pageObserver.register(document.querySelector('#next')!);

    const partial = findCommonAncestor([idFirst, idLast]);
    expect(partial.elementId).toBe(pageObserver.register(document.querySelector('#step-one')!));
    expect(partial.depths).toEqual([1, 1]);

    const whole = findCommonAncestor([idFirst, idLast, idNext]);
    expect(whole.elementId).toBe(pageObserver.register(document.querySelector('#wizard')!));
    expect(whole.depths).toEqual([2, 2, 1]);
  });

  it('入参全部指向同一元素时直接返回自身', () => {
    document.body.innerHTML = '<div><button id="solo">唯一目标</button></div>';
    const id = pageObserver.register(document.querySelector('#solo')!);

    const result = findCommonAncestor([id, id, id]);

    expect(result.sameElement).toBe(true);
    expect(result.depths).toEqual([0, 0, 0]);
    expect(result.elementId).toBe(id);
  });

  it('祖先链可以跨越 shadow root', () => {
    document.body.innerHTML = '<div id="host"></div><button id="outer">外侧按钮</button>';
    const shadow = document.querySelector('#host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button id="inner">内侧按钮</button>';
    const idInner = pageObserver.register(shadow.querySelector('#inner')!);
    const idOuter = pageObserver.register(document.querySelector('#outer')!);

    const result = findCommonAncestor([idInner, idOuter]);

    expect(result.elementId).toBe(pageObserver.register(document.body));
    expect(result.tag).toBe('body');
  });

  it('少于两个元素直接拒绝', () => {
    document.body.innerHTML = '<button id="only">单独一个</button>';
    const id = pageObserver.register(document.querySelector('#only')!);

    expect(() => findCommonAncestor([id])).toThrow('至少需要两个元素');
  });
});
