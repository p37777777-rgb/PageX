import { describe, expect, it, beforeEach } from 'vitest';
import { PageObserver, pageObserver } from '@/features/page/observer';
import { searchPageText } from '@/features/page/search';

describe('searchPageText', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.assign(pageObserver, new PageObserver());
  });

  it('finds visible text and returns a usable elementId', () => {
    document.body.innerHTML = `
      <p>欢迎使用 PageX 页面助手</p>
      <button>提交订单</button>
    `;
    const result = searchPageText('PageX');
    expect(result.total).toBe(1);
    expect(result.hits[0]).toMatchObject({
      match: 'PageX',
      tag: 'p',
    });
    expect(result.hits[0]?.snippet).toContain('PageX');
    const node = pageObserver.getElement(result.hits[0]!.elementId, result.revision);
    expect(node.textContent).toContain('PageX');
  });

  it('searches input values and respects case sensitivity', () => {
    document.body.innerHTML = '<input value="HelloPageX" />';
    expect(searchPageText('hellopagex').total).toBe(1);
    expect(searchPageText('hellopagex', { caseSensitive: true }).total).toBe(0);
    expect(searchPageText('HelloPageX', { caseSensitive: true }).total).toBe(1);
  });

  it('searches element ids and names for structural lookup', () => {
    document.body.innerHTML = '<input id="birthday" name="birthDate" />';
    expect(searchPageText('birthday').hits[0]).toMatchObject({ tag: 'input' });
    expect(searchPageText('birthDate').hits[0]).toMatchObject({ tag: 'input' });
  });

  it('skips the extension UI and caps results', () => {
    document.body.innerHTML = `
      <pagex-root><p>PageX secret</p></pagex-root>
      <p>one PageX</p>
      <p>two PageX</p>
      <p>three PageX</p>
    `;
    const result = searchPageText('PageX', { maxResults: 2 });
    expect(result.hits.every((hit) => !hit.snippet.includes('secret'))).toBe(true);
    expect(result.count).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.total).toBeGreaterThan(2);
  });

  it('can bypass an active interaction context with page scope', () => {
    document.body.innerHTML = `
      <p>页面正文里的统计结果</p>
      <div role="dialog"><button>确定</button></div>
    `;
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.getBoundingClientRect = () => ({
      x: 10, y: 10, top: 10, left: 10, right: 210, bottom: 210, width: 200, height: 200,
      toJSON: () => ({}),
    });

    expect(searchPageText('统计结果').total).toBe(0);
    expect(searchPageText('统计结果', { scope: 'page' }).total).toBe(1);
  });
});
