import { describe, expect, it } from 'vitest';
import { isProtectedUrl, toErrorMessage, toUserErrorMessage } from '@/shared/contracts/errors';
import {
  assertNavigableUrl,
  isRepeatedAction,
  redactText,
  redactValue,
  sanitizeUrl,
} from '@/shared/contracts/policy';
import { DEFAULT_SETTINGS } from '@/shared/contracts/settings';
import { isRpcRequest, parseRpcPayload } from '@/shared/contracts/rpc';
import { renderMarkdown } from '@/shared/utils/markdown';

// ---------------------------------------------------------------------------
// 共享契约：脱敏 / 导航策略 / 重复检测 / 错误文案 / RPC 载荷 / Markdown 渲染
// ---------------------------------------------------------------------------

describe('policy: 敏感信息脱敏', () => {
  it('文本中的邮箱、手机号、密钥、令牌与长数字都会被占位符替换', () => {
    const source =
      '联系 support.team+ci@corp-example.cn，手机 15987654321，' +
      '密钥 rk-A1b2C3d4E5f6G7h2I3j4，令牌 ghp_0a1B2c3D4e5F6g7，卡号 4111111111111111';
    const output = redactText(source);

    expect(output).toContain('[redacted-email]');
    expect(output).toContain('[redacted-phone]');
    expect(output).toContain('[redacted-key]');
    expect(output).toContain('[redacted-token]');
    expect(output).toContain('[redacted-number]');
    expect(output).not.toContain('support.team+ci@corp-example.cn');
    expect(output).not.toContain('15987654321');
    expect(output).not.toContain('rk-A1b2C3d4E5f6G7h2I3j4');
  });

  it('普通文本原样返回，不引入占位符', () => {
    expect(redactText('普通说明文字，不含任何敏感字段')).toBe('普通说明文字，不含任何敏感字段');
  });

  it('递归脱敏嵌套对象与数组中的字符串', () => {
    const payload = {
      label: '收件人',
      contact: { mailbox: 'user.name@mail-provider.org' },
      history: ['13700200300', '安全文本'],
    };
    expect(redactValue(payload)).toEqual({
      label: '收件人',
      contact: { mailbox: '[redacted-email]' },
      history: ['[redacted-phone]', '安全文本'],
    });
  });

  it('sanitizeUrl 抹掉 userinfo 与敏感查询参数', () => {
    const cleaned = sanitizeUrl('https://bob:hunter2@example.org/pull?token=t0ps3cr3t&page=2');
    expect(cleaned).not.toContain('hunter2');
    expect(cleaned).not.toContain('t0ps3cr3t');
    expect(cleaned).toContain('%5Bredacted%5D');
    expect(cleaned).toContain('page=2');
  });
});

describe('policy: 导航安全策略', () => {
  it('放行普通 https 页面', () => {
    expect(() => assertNavigableUrl('https://docs.sample-site.dev/getting-started')).not.toThrow();
  });

  it('放行开启了跨域权限的非本地 http 页面', () => {
    expect(() =>
      assertNavigableUrl('http://intranet.lan/report', {
        ...DEFAULT_SETTINGS,
        allowCrossOrigin: true,
      }),
    ).not.toThrow();
  });

  it('放行 localhost 的 http 页面', () => {
    expect(() => assertNavigableUrl('http://localhost:5173/dev-preview')).not.toThrow();
  });

  it('拒绝无法解析的 URL 与非 http(s) 协议', () => {
    expect(() => assertNavigableUrl('not a valid url')).toThrow();
    expect(() => assertNavigableUrl('chrome://settings')).toThrow();
    expect(() => assertNavigableUrl('about:blank')).toThrow();
  });

  it('拒绝浏览器商店域名', () => {
    expect(() => assertNavigableUrl('https://chromewebstore.google.com/detail/pagex')).toThrow();
    expect(() => assertNavigableUrl('https://microsoftedge.microsoft.com/addons')).toThrow();
  });

  it('拒绝密码、支付、验证类敏感路径', () => {
    expect(() => assertNavigableUrl('https://shop.sample.dev/payment')).toThrow();
    expect(() => assertNavigableUrl('https://id.sample.dev/signin?next=/account/2fa')).toThrow();
  });

  it('未开启跨域权限时拒绝非本地 http 页面', () => {
    expect(() =>
      assertNavigableUrl('http://news.sample.dev/', {
        ...DEFAULT_SETTINGS,
        allowCrossOrigin: false,
      }),
    ).toThrow();
  });
});

describe('policy: 重复动作检测', () => {
  const click = (elementId: string) => ({ name: 'dom_click', args: JSON.stringify({ elementId }) });

  it('尾部连续三次同名同参动作判为循环', () => {
    const history = [click('btn-ok'), click('btn-ok'), click('btn-ok')];
    expect(isRepeatedAction(history, 'dom_click', { elementId: 'btn-ok' })).toBe(true);
  });

  it('只有两次相同动作、或参数不同时不算循环', () => {
    expect(
      isRepeatedAction([click('btn-ok'), click('btn-ok')], 'dom_click', { elementId: 'btn-ok' }),
    ).toBe(false);
    expect(
      isRepeatedAction([click('btn-ok'), click('btn-ok'), click('btn-cancel')], 'dom_click', {
        elementId: 'btn-ok',
      }),
    ).toBe(false);
  });

  it('尾部包含不同名动作时不算循环', () => {
    const history = [click('btn-ok'), click('btn-ok'), { name: 'dom_type', args: '{}' }];
    expect(isRepeatedAction(history, 'dom_click', { elementId: 'btn-ok' })).toBe(false);
  });
});

describe('errors: 保护页面与错误文案', () => {
  it('浏览器内部协议页判定为受保护，普通站点不受保护', () => {
    expect(isProtectedUrl('chrome://extensions')).toBe(true);
    expect(isProtectedUrl('edge://version')).toBe(true);
    expect(isProtectedUrl('about:blank')).toBe(true);
    expect(isProtectedUrl('chrome-extension://abc/popup.html')).toBe(true);
    expect(isProtectedUrl('https://example.org/home')).toBe(false);
  });

  it('无法解析的 URL 一律视为受保护', () => {
    expect(isProtectedUrl('::not-a-url::')).toBe(true);
  });

  it('toErrorMessage 提取 Error 消息并字符串化未知值', () => {
    expect(toErrorMessage(new Error('网络中断'))).toBe('网络中断');
    expect(toErrorMessage(42)).toBe('42');
    expect(toErrorMessage({ code: 7 })).toBe('[object Object]');
  });

  it('调试器缺失的错误被翻译成包含「重新加载」的用户提示', () => {
    expect(toUserErrorMessage(new Error('Cannot access chrome.debugger here'))).toContain('重新加载');
  });

  it('递归上限与限流错误各有专属提示', () => {
    expect(toUserErrorMessage(new Error('Recursion limit reached'))).toContain('拆解');
    expect(toUserErrorMessage(new Error('MODEL_RATE_LIMIT'))).toContain('429');
  });

  it('普通错误原样透传', () => {
    expect(toUserErrorMessage(new Error('别的地方出错了'))).toBe('别的地方出错了');
  });
});

describe('rpc: 载荷模式校验', () => {
  it('dom.search 接受合法查询并拒绝空查询', () => {
    expect(parseRpcPayload('dom.search', { query: '订阅按钮', maxResults: 5, caseSensitive: true })).toEqual({
      query: '订阅按钮',
      maxResults: 5,
      caseSensitive: true,
    });
    expect(() => parseRpcPayload('dom.search', { query: '' })).toThrow();
    expect(() => parseRpcPayload('dom.search', { query: 'ok', maxResults: 999 })).toThrow();
  });

  it('dom.observe 接受观测缘由、上限与范围', () => {
    expect(
      parseRpcPayload('dom.observe', { reason: 'user-request', maxElements: 120, scope: 'interaction' }),
    ).toEqual({ reason: 'user-request', maxElements: 120, scope: 'interaction' });
  });

  it('dom.elementTree 接受字段过滤与深度限制，拒绝非法属性名', () => {
    expect(
      parseRpcPayload('dom.elementTree', {
        elementId: 'node_9',
        fields: { text: true, coordinates: false, attributes: ['data-role', 'title'] },
        maxDepth: 3,
        maxLength: 256,
      }),
    ).toEqual({
      elementId: 'node_9',
      fields: { text: true, coordinates: false, attributes: ['data-role', 'title'] },
      maxDepth: 3,
      maxLength: 256,
    });
    expect(() =>
      parseRpcPayload('dom.elementTree', {
        elementId: 'node_9',
        fields: { attributes: ['9 starts-with-digit'] },
      }),
    ).toThrow();
  });

  it('dom.script 拒绝内置脚本清单之外的名字', () => {
    expect(() => parseRpcPayload('dom.script', { name: 'eval' })).toThrow();
  });

  it('page.source 接受过滤与分页，拒绝未知类型与空 grep', () => {
    expect(
      parseRpcPayload('page.source', {
        type: 'text',
        grep: 'theme-color',
        regex: false,
        caseSensitive: true,
        limit: 50,
        offset: 100,
      }),
    ).toEqual({
      type: 'text',
      grep: 'theme-color',
      regex: false,
      caseSensitive: true,
      limit: 50,
      offset: 100,
    });
    expect(() => parseRpcPayload('page.source', { type: 'wat' })).toThrow();
    expect(() => parseRpcPayload('page.source', { grep: '' })).toThrow();
  });

  it('cdp 网络/控制台/请求详情载荷各自校验', () => {
    expect(
      parseRpcPayload('cdp.network', { urlIncludes: '/graphql', method: 'POST', failedOnly: false, limit: 10 }),
    ).toEqual({ urlIncludes: '/graphql', method: 'POST', failedOnly: false, limit: 10 });
    expect(parseRpcPayload('cdp.console', { level: 'warn', textIncludes: 'deprecat', limit: 3 })).toEqual({
      level: 'warn',
      textIncludes: 'deprecat',
      limit: 3,
    });
    expect(parseRpcPayload('cdp.networkRequest', { requestId: 'req-77', includeBody: false })).toEqual({
      requestId: 'req-77',
      includeBody: false,
    });
    expect(() => parseRpcPayload('cdp.networkRequest', { requestId: '' })).toThrow();
  });

  it('agent.start 接受 @ 引用的附加上下文与会话延续', () => {
    const parsed = parseRpcPayload('agent.start', {
      prompt: '对比这两个页面的价格',
      context: '用户通过 @ 附加了两个标签页。',
      conversationId: 'conv-42',
      history: [
        { id: 'h1', role: 'user', content: '先打开列表页' },
        { id: 'h2', role: 'assistant', content: '已打开' },
      ],
    });
    expect(parsed).toMatchObject({
      prompt: '对比这两个页面的价格',
      context: '用户通过 @ 附加了两个标签页。',
      conversationId: 'conv-42',
    });
    expect(parsed.history?.[0]).toMatchObject({ id: 'h1', role: 'user', content: '先打开列表页' });
    expect(parsed.history).toHaveLength(2);
  });

  it('agent.start 接受徽标与引用项三种类型', () => {
    const parsed = parseRpcPayload('agent.start', {
      prompt: '关注我标记的位置',
      badges: [
        { type: 'tab', id: 3, title: '控制台' },
        { type: 'command', key: 'translate', name: '翻译本页' },
        { type: 'element', name: '搜索框', tag: 'input' },
      ],
      references: [
        { type: 'page', tabId: 3, title: '控制台', url: 'https://app.sample.dev/console' },
        { type: 'command', key: 'translate', name: '翻译本页', prompt: '把页面翻译成中文' },
        { type: 'element', tag: 'form' },
      ],
    });
    expect(parsed.badges).toHaveLength(3);
    expect(parsed.references).toHaveLength(3);
    expect(parsed.badges?.[0]).toEqual({ type: 'tab', id: 3, title: '控制台' });
    expect(parsed.references?.[1]).toMatchObject({ type: 'command', key: 'translate' });
  });

  it('agent.start 的图片附件必须是 data:image 地址', () => {
    expect(
      parseRpcPayload('agent.start', { prompt: '看截图', imageDataUrl: 'data:image/jpeg;base64,zzz' }),
    ).toMatchObject({ imageDataUrl: 'data:image/jpeg;base64,zzz' });
    expect(() =>
      parseRpcPayload('agent.start', { prompt: '看图', imageDataUrl: 'https://cdn.example.com/x.jpg' }),
    ).toThrow();
  });

  it('agent.start 拒绝空 prompt', () => {
    expect(() => parseRpcPayload('agent.start', { prompt: '' })).toThrow();
  });

  it('tabs.snapshot 允许 1~8 个标签页，越界即拒绝', () => {
    expect(parseRpcPayload('tabs.snapshot', { tabIds: [11, 12] })).toEqual({ tabIds: [11, 12] });
    expect(() => parseRpcPayload('tabs.snapshot', { tabIds: [] })).toThrow();
    expect(() =>
      parseRpcPayload('tabs.snapshot', { tabIds: Array.from({ length: 9 }, (_, i) => i + 1) }),
    ).toThrow();
  });

  it('screenshot.capture 接受整页与原始图开关', () => {
    expect(parseRpcPayload('screenshot.capture', { fullPage: true, raw: false })).toEqual({
      fullPage: true,
      raw: false,
    });
  });

  it('session.saveStore 接受携带页面 URL 的存储快照', () => {
    expect(
      parseRpcPayload('session.saveStore', {
        activeId: 'conv-42',
        conversations: [],
        url: 'https://app.sample.dev/dashboard',
        revision: 3,
      }),
    ).toMatchObject({
      activeId: 'conv-42',
      url: 'https://app.sample.dev/dashboard',
      revision: 3,
    });
  });

  it('conversations.list/get 的归档查询载荷校验', () => {
    expect(parseRpcPayload('conversations.list', {})).toEqual({});
    expect(parseRpcPayload('conversations.get', { ids: ['k1', 'k2'], includeImages: false })).toEqual({
      ids: ['k1', 'k2'],
      includeImages: false,
    });
    expect(() => parseRpcPayload('conversations.get', { ids: [] })).toThrow();
    expect(() => parseRpcPayload('conversations.get', { ids: [''] })).toThrow();
  });

  it('teaching 与 commands 载荷校验', () => {
    expect(
      parseRpcPayload('teaching.start', { url: 'https://form.sample.dev/apply', conversationId: 'conv-42' }),
    ).toEqual({ url: 'https://form.sample.dev/apply', conversationId: 'conv-42' });
    expect(parseRpcPayload('teaching.revise', { request: '把第三步改成下拉选择' })).toEqual({
      request: '把第三步改成下拉选择',
    });
    expect(parseRpcPayload('commands.list', { url: 'https://form.sample.dev/apply' })).toEqual({
      url: 'https://form.sample.dev/apply',
    });
    expect(() => parseRpcPayload('teaching.start', { url: 'this is not a url' })).toThrow();
    expect(() => parseRpcPayload('teaching.revise', { request: '' })).toThrow();
  });

  it('isRpcRequest 只认完整信封', () => {
    expect(
      isRpcRequest({
        channel: 'PageX',
        kind: 'rpc',
        id: 'rpc-9',
        name: 'settings.get',
        payload: {},
      }),
    ).toBe(true);
    expect(isRpcRequest({ kind: 'rpc', id: 'x' })).toBe(false);
    expect(isRpcRequest(null)).toBe(false);
    expect(isRpcRequest('rpc')).toBe(false);
  });
});

describe('markdown: 渲染与安全', () => {
  it('渲染加粗、行内代码与列表等常见排版', () => {
    const html = renderMarkdown('**注意**用 `npm run dev`\n\n- 第一步\n- 第二步');
    expect(html).toContain('<strong>注意</strong>');
    expect(html).toContain('<code>npm run dev</code>');
    expect(html).toContain('<li>第一步</li>');
  });

  it('http(s) 链接安全打开，javascript: 链接被丢弃只留文字', () => {
    const html = renderMarkdown('[帮助](https://help.sample.dev) [陷阱](javascript:alert(9))');
    expect(html).toContain('href="https://help.sample.dev"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).not.toContain('javascript:');
  });

  it('原始 script 标签被剥除但保留文本', () => {
    const html = renderMarkdown('前文 <script>alert(9)</script> 后文');
    expect(html).not.toContain('<script');
    expect(html).toContain('前文');
  });

  it('补齐分隔行列数后仍能渲染缺列的 GFM 表格', () => {
    const html = renderMarkdown('|名称|状态|备注|\n|---|\n|任务A|进行中|今天交付|');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>名称</th>');
    expect(html).toContain('<td>任务A</td>');
    expect(html).not.toContain('|---|');
  });

  it('规范表格正常渲染', () => {
    const html = renderMarkdown('| 名词 | 解释 |\n| --- | --- |\n| RPC | 远程调用 |');
    expect(html).toContain('<th>名词</th>');
    expect(html).toContain('<td>远程调用</td>');
  });

  it('代码围栏内的表格样文本不会被改写为表格', () => {
    const html = renderMarkdown('```\n|a|b|c|\n|--|--|\n```');
    expect(html).toContain('|a|b|c|');
    expect(html).not.toContain('<table>');
  });
});
