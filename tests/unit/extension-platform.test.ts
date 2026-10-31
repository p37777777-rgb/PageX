import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { isTransientRuntimeError, shouldRetryRpc } from '@/shared/extension/keepalive';
import {
    isTeachingCommentDirectHotkey,
    isTeachingCommentElementHotkey,
    isTogglePanelHotkey,
} from '@/shared/extension/hotkey';
import { applyTopLayerHostStyles, placeHostLast, promoteHostToTopLayer } from '@/shared/extension/top-layer';
import {
    clampFabPosition,
    clampPanelPosition,
    clampPanelWidth,
    collapsedPosition,
    defaultPanelPosition,
    FAB_SIZE,
    isPanelDragTarget,
    loadPanelPosition,
    nextPanelResize,
    panelPositionFromFab,
    savePanelLayout,
} from '@/shared/extension/panel-position';
import { handleContentCommand } from '@/features/page/content-command-handler';
import { dispatchUiCommand, uiEvents } from '@/features/page/ui-events';
import { retargetAgent, running } from '@/features/agent/background/agent-controller';
import { tabStores } from '@/features/agent/background/tab-store';
import { useAgentEventConsumer } from '@/features/agent/ui/hooks/useAgentEventConsumer';
import {
    useAgentSessionStore,
    resetAgentSessionStore,
} from '@/features/agent/ui/store/agent-session-store';
import * as contentBridge from '@/features/agent/background/content-bridge';
import * as storage from '@/shared/storage/storage';
import { CHANNEL } from '@/shared/contracts/channel';
import { resolveDebuggerApi } from '@/shared/browser/cdp';
import {
    MAX_NETWORK_ENTRIES,
    applyCdpEvent,
    createDevtoolsStore,
    getNetworkEntry,
    isTextualMime,
    listConsole,
    listNetwork,
    redactHeaders,
    summarizeNetwork,
} from '@/shared/browser/devtools-log';

// @ts-expect-error test environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type KeyParts = {
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    code: string;
    key: string;
};

const chord = (parts: KeyParts) => ({
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...parts,
});

describe('扩展平台层（外壳 / 布局 / 调试）', () => {
    it('后台瞬时断连错误可重试，业务错误不可重试', () => {
        expect(
            isTransientRuntimeError(new Error('Error: Could not establish connection. Receiving end does not exist.')),
        ).toBe(true);
        expect(isTransientRuntimeError(new Error('The message port closed before a response was received.'))).toBe(true);
        expect(isTransientRuntimeError('The message port closed before a response was received.')).toBe(true);
        expect(isTransientRuntimeError(new Error('模型密钥缺失，无法调用'))).toBe(false);
    });

    it('agent.start / agent.stop 永不重试，其余 RPC 断连时可重试', () => {
        const broken = new Error('Could not establish connection. Receiving end does not exist.');
        expect(shouldRetryRpc('agent.start', broken)).toBe(false);
        expect(shouldRetryRpc('agent.stop', broken)).toBe(false);
        expect(shouldRetryRpc('settings.load', broken)).toBe(true);
    });

    it('面板开关快捷键 Alt+P：code 或 key 命中皆可，混入其他修饰键则失效', () => {
        expect(isTogglePanelHotkey(chord({ code: 'KeyP', key: 'p', altKey: true }))).toBe(true);
        expect(isTogglePanelHotkey(chord({ code: 'KeyP', key: 'π', altKey: true }))).toBe(true);
        expect(isTogglePanelHotkey(chord({ code: 'Semicolon', key: 'P', altKey: true }))).toBe(true);
        expect(isTogglePanelHotkey(chord({ code: 'KeyP', key: 'p', altKey: true, ctrlKey: true }))).toBe(false);
        expect(isTogglePanelHotkey(chord({ code: 'KeyO', key: 'o', altKey: true }))).toBe(false);
    });

    it('教学注释快捷键：Alt+X 圈选元素、Alt+C 直接添加', () => {
        expect(isTeachingCommentElementHotkey(chord({ code: 'KeyX', key: 'x', altKey: true }))).toBe(true);
        expect(isTeachingCommentElementHotkey(chord({ code: 'KeyX', key: '≈', altKey: true }))).toBe(true);
        expect(isTeachingCommentElementHotkey(chord({ code: 'KeyX', key: 'x' }))).toBe(false);

        expect(isTeachingCommentDirectHotkey(chord({ code: 'KeyC', key: 'c', altKey: true }))).toBe(true);
        expect(isTeachingCommentDirectHotkey(chord({ code: 'KeyC', key: 'ç', altKey: true }))).toBe(true);
        expect(isTeachingCommentDirectHotkey(chord({ code: 'KeyC', key: 'c', altKey: true, metaKey: true }))).toBe(false);
        expect(isTeachingCommentDirectHotkey(chord({ code: 'KeyD', key: 'd', altKey: true }))).toBe(false);
    });
});

describe('顶层宿主节点', () => {
    afterEach(() => {
        document.querySelectorAll('pagex-root').forEach((node) => node.remove());
    });

    it('后续插入的高层级遮罩不会盖住宿主，宿主始终是最后一个子节点', () => {
        const host = document.createElement('pagex-root');
        const overlay = document.createElement('div');
        overlay.style.zIndex = '2147483646';
        document.documentElement.append(host, overlay);

        placeHostLast(host);

        expect(document.documentElement.lastElementChild).toBe(host);
    });

    it('宿主样式铺满视口并以 important 优先级压过 popover UA 默认值', () => {
        const host = document.createElement('pagex-root');
        applyTopLayerHostStyles(host);
        expect(host.style.position).toBe('fixed');
        expect(host.style.inset).toBe('0px');
        expect(host.style.width).toBe('100vw');
        expect(host.style.background).toBe('transparent');
        expect(host.style.pointerEvents).toBe('none');
        expect(host.style.getPropertyPriority('z-index')).toBe('important');
    });

    it('宿主已连接时提升到顶层不抛错，且停留在文档末尾', () => {
        const host = document.createElement('pagex-root');
        document.documentElement.append(host);
        expect(() => promoteHostToTopLayer(host)).not.toThrow();
        expect(document.documentElement.lastElementChild).toBe(host);
        expect(host.style.position).toBe('fixed');
    });
});

describe('面板与悬浮球布局', () => {
    it('拖出视口的面板位置被钳制回可视范围', () => {
        expect(
            clampPanelPosition({ x: -12, y: 1500 }, { width: 360, height: 560 }, { width: 1000, height: 640 }),
        ).toEqual({ x: 8, y: 72 });
    });

    it('默认位置落在视口右下角附近', () => {
        expect(defaultPanelPosition({ width: 360, height: 560 }, { width: 1000, height: 640 })).toEqual({
            x: 620,
            y: 60,
        });
    });

    it('自定义宽度被限制在 [320, min(720, 视口-40)] 区间', () => {
        expect(clampPanelWidth(600, { width: 1200 })).toBe(600);
        expect(clampPanelWidth(100, { width: 1200 })).toBe(320);
        expect(clampPanelWidth(1000, { width: 600 })).toBe(560);
    });

    it('从左边缘拖拽：宽度增大，左边界跟随指针、右边界不动', () => {
        expect(
            nextPanelResize(
                'left',
                { pointerX: 900, width: 320, left: 900, top: 60 },
                850,
                500,
                { width: 1600, height: 800 },
            ),
        ).toEqual({ width: 370, position: { x: 850, y: 60 } });
    });

    it('从右边缘拖拽：宽度增大，左边界保持原位', () => {
        expect(
            nextPanelResize(
                'right',
                { pointerX: 1000, width: 320, left: 640, top: 40 },
                1060,
                500,
                { width: 1600, height: 800 },
            ),
        ).toEqual({ width: 380, position: { x: 640, y: 40 } });
    });

    it('收起后悬浮球停靠在面板右下角', () => {
        expect(
            collapsedPosition({ x: 520, y: 60 }, { width: 360, height: 520 }, { width: 1000, height: 640 }),
        ).toEqual({ x: 520 + 360 - FAB_SIZE, y: 60 + 520 - FAB_SIZE });
    });

    it('默认布局下悬浮球收在距右下边缘 20px 处', () => {
        const size = { width: 360, height: 520 };
        const viewport = { width: 1000, height: 640 };
        expect(collapsedPosition(defaultPanelPosition(size, viewport), size, viewport)).toEqual({
            x: viewport.width - FAB_SIZE - 20,
            y: viewport.height - FAB_SIZE - 20,
        });
    });

    it('面板平移多少，悬浮球就跟随平移多少', () => {
        const size = { width: 360, height: 520 };
        const viewport = { width: 1800, height: 1000 };
        const from = collapsedPosition({ x: 150, y: 90 }, size, viewport);
        const to = collapsedPosition({ x: 230, y: 140 }, size, viewport);
        expect(to).toEqual({ x: from.x + 80, y: from.y + 50 });
    });

    it('由悬浮球反推面板位置后，收起操作能还原到同一个球心', () => {
        const size = { width: 360, height: 520 };
        const fab = { x: 260, y: 380 };
        const panel = panelPositionFromFab(fab, size);
        expect(panel).toEqual({
            x: fab.x + FAB_SIZE - size.width,
            y: fab.y + FAB_SIZE - size.height,
        });
        expect(collapsedPosition(panel, size, { width: 2000, height: 2000 })).toEqual(fab);
    });

    it('悬浮球同样不会拖出视口', () => {
        expect(clampFabPosition({ x: -30, y: 1200 }, { width: 900, height: 500 })).toEqual({
            x: 8,
            y: 500 - FAB_SIZE - 8,
        });
    });

    it('离屏坐标也能写入会话存储并原样读回，供拖走的球恢复', () => {
        const key = 'PageX-panel-pos';
        const previous = sessionStorage.getItem(key);
        try {
            savePanelLayout({ x: -120, y: -80 }, 480);
            expect(loadPanelPosition()).toEqual({ x: -120, y: -80 });
        } finally {
            if (previous == null) sessionStorage.removeItem(key);
            else sessionStorage.setItem(key, previous);
        }
    });

    it('只有携带 data-panel-drag 的元素才能发起面板拖拽', () => {
        const title = document.createElement('span');
        const bar = document.createElement('div');
        const resizeEdge = document.createElement('div');
        const grip = document.createElement('button');
        resizeEdge.setAttribute('data-panel-resize', 'right');
        grip.setAttribute('data-panel-drag', 'true');
        bar.append(title, grip);
        expect(isPanelDragTarget(title)).toBe(false);
        expect(isPanelDragTarget(resizeEdge)).toBe(false);
        expect(isPanelDragTarget(bar)).toBe(false);
        expect(isPanelDragTarget(grip)).toBe(true);
    });
});

describe('跨标签页任务接管', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        resetAgentSessionStore();
        tabStores.clear();
    });

    it('ui.* 内容命令返回 ok 并原样回显命令名', () => {
        expect(handleContentCommand('ui.collapse', {})).toEqual({ ok: true, uiCommand: 'ui.collapse' });
        expect(handleContentCommand('ui.open', {})).toEqual({ ok: true, uiCommand: 'ui.open' });
        expect(handleContentCommand('ui.toggle', {})).toEqual({ ok: true, uiCommand: 'ui.toggle' });
    });

    it('dispatchUiCommand 会在页面事件总线上派发 collapse 事件', () => {
        let collapsed = false;
        const onCollapse = () => {
            collapsed = true;
        };
        uiEvents.addEventListener('collapse', onCollapse);
        dispatchUiCommand('ui.collapse');
        uiEvents.removeEventListener('collapse', onCollapse);
        expect(collapsed).toBe(true);
    });

    it('retargetAgent：旧标签页收起、控制权与新标签页展开依次完成', async () => {
        const fromTabId = 7;
        const toTabId = 42;

        const fromStore = {
            activeId: 'conv-7',
            conversations: [
                {
                    id: 'conv-7',
                    title: '接管演练',
                    createdAt: 9,
                    updatedAt: 9,
                    messages: [],
                    tasks: [],
                    error: '',
                    thinking: '',
                    running: true,
                    budget: { modelCalls: 0, toolCalls: 0 },
                    vaults: [],
                },
            ],
            panelOpen: true,
            sessionId: 'sess-7',
            revision: 1,
        };

        const control = {
            abort: new AbortController(),
            conversationId: 'conv-7',
            sessionId: 'sess-7',
            store: fromStore,
            tabId: fromTabId,
        };

        running.clear();
        running.set(fromTabId, control);
        tabStores.set(fromTabId, fromStore);

        const sendToContentSpy = vi.spyOn(contentBridge, 'sendToContent').mockResolvedValue({ ok: true });
        const ensureContentScriptSpy = vi.spyOn(contentBridge, 'ensureContentScript').mockResolvedValue(undefined);
        const saveTabUiSpy = vi.spyOn(storage, 'saveTabUi').mockResolvedValue(undefined);

        const sentMessages: Array<{ tabId: number; message: unknown }> = [];
        browser.tabs.sendMessage = vi.fn(async (tabId: number, message: unknown) => {
            sentMessages.push({ tabId, message });
        }) as unknown as typeof browser.tabs.sendMessage;
        browser.tabs.get = vi.fn(
            async () => ({ id: toTabId, url: 'https://sample.dev/page' }),
        ) as unknown as typeof browser.tabs.get;

        await retargetAgent(fromTabId, toTabId);

        // 控制权迁移
        expect(running.has(fromTabId)).toBe(false);
        expect(running.get(toTabId)?.tabId).toBe(toTabId);

        // 旧页收起
        expect(fromStore.panelOpen).toBe(false);
        expect(saveTabUiSpy).toHaveBeenCalledWith(fromTabId, { panelOpen: false });
        expect(sendToContentSpy).toHaveBeenCalledWith(fromTabId, 'ui.collapse', {});
        expect(sentMessages).toContainEqual({
            tabId: fromTabId,
            message: expect.objectContaining({
                channel: CHANNEL,
                kind: 'agent-retarget',
                working: false,
            }),
        });

        // 新页展开
        expect(ensureContentScriptSpy).toHaveBeenCalledWith(toTabId);
        expect(saveTabUiSpy).toHaveBeenCalledWith(toTabId, { panelOpen: true });
        expect(sendToContentSpy).toHaveBeenCalledWith(toTabId, 'ui.open', {});
        expect(sentMessages).toContainEqual({
            tabId: toTabId,
            message: expect.objectContaining({
                channel: CHANNEL,
                kind: 'agent-event',
                store: expect.objectContaining({ panelOpen: true }),
            }),
        });
    });

    it('useAgentEventConsumer 收到 agent-retarget 后把当前页标记为空闲', async () => {
        let messageListener: ((message: unknown) => void) | undefined;
        browser.runtime.onMessage.addListener = vi.fn((fn) => {
            messageListener = fn;
        }) as unknown as typeof browser.runtime.onMessage.addListener;
        browser.runtime.onMessage.removeListener = vi.fn() as unknown as typeof browser.runtime.onMessage.removeListener;

        useAgentSessionStore.setState({ runningId: 'conv-9', revision: 2, sessionId: 'sess-9', conversations: [] });

        function ConsumerHost() {
            useAgentEventConsumer();
            return null;
        }

        const container = document.createElement('div');
        const root = createRoot(container);
        await act(async () => {
            root.render(createElement(ConsumerHost));
        });

        expect(browser.runtime.onMessage.addListener).toHaveBeenCalled();
        expect(messageListener).toBeDefined();

        await act(async () => {
            messageListener!({
                channel: CHANNEL,
                kind: 'agent-retarget',
                working: false,
                agentActive: true,
            });
        });

        const state = useAgentSessionStore.getState();
        expect(state.runningId).toBe(null);
        expect(state.workingOnThisPage).toBe(false);
        expect(state.agentActive).toBe(true);

        await act(async () => {
            root.unmount();
        });
    });
});

describe('CDP 调试器 API 解析', () => {
    it('优先读取 chrome.debugger，且在调用时才解析', () => {
        const api = {
            attach() {},
            detach() {},
            sendCommand() {},
            onDetach: { addListener() {} },
            onEvent: { addListener() {} },
        };
        expect(resolveDebuggerApi({ chrome: { debugger: api } })).toBe(api);
    });

    it('chrome.debugger 缺失时回落到 browser.debugger', () => {
        const api = { attach() {}, detach() {}, sendCommand() {}, onDetach: { addListener() {} } };
        expect(resolveDebuggerApi({ browser: { debugger: api } })).toBe(api);
    });

    it('两边都没有时返回 undefined', () => {
        expect(resolveDebuggerApi({})).toBeUndefined();
    });
});

describe('DevTools 日志存储', () => {
    it('一条请求从发出到完成：方法大写、时长累计、敏感头与邮箱脱敏', () => {
        const store = createDevtoolsStore(5_000);
        applyCdpEvent(
            store,
            'Network.requestWillBeSent',
            {
                requestId: 'req-alpha',
                type: 'Fetch',
                request: {
                    url: 'https://api.test.dev/v1/orders',
                    method: 'post',
                    headers: { Authorization: 'Bearer token-xyz', Accept: 'text/html' },
                    postData: 'user=bob@corp.test',
                },
                initiator: {
                    type: 'script',
                    stack: { callFrames: [{ url: 'https://app.test.dev/main.js', lineNumber: 5 }] },
                },
            },
            5_000,
        );
        applyCdpEvent(store, 'Network.responseReceived', {
            requestId: 'req-alpha',
            type: 'Fetch',
            response: {
                status: 200,
                statusText: 'OK',
                mimeType: 'text/html',
                protocol: 'h2',
                headers: { 'set-cookie': 'sid=zzz', 'content-type': 'text/html' },
            },
        });
        applyCdpEvent(store, 'Network.loadingFinished', { requestId: 'req-alpha', encodedDataLength: 512 }, 5_180);

        const [entry] = listNetwork(store);
        expect(entry).toBeDefined();
        expect(entry).toMatchObject({
            requestId: 'req-alpha',
            method: 'POST',
            url: 'https://api.test.dev/v1/orders',
            status: 200,
            type: 'Fetch',
            encodedDataLength: 512,
            durationMs: 180,
        });
        expect(entry!.requestHeaders).toEqual({
            Authorization: '[redacted]',
            Accept: 'text/html',
        });
        expect(entry!.responseHeaders?.['set-cookie']).toBe('[redacted]');
        expect(entry!.postData).toContain('[redacted-email]');
        expect(entry!.initiator).toContain('script');
        expect(summarizeNetwork(entry!)).not.toHaveProperty('requestHeaders');
    });

    it('失败请求带 errorText，过滤器支持 failedOnly / urlIncludes / method', () => {
        const store = createDevtoolsStore();
        applyCdpEvent(store, 'Network.requestWillBeSent', {
            requestId: 'good',
            request: { url: 'https://cdn.test.dev/a.png', method: 'GET' },
        });
        applyCdpEvent(store, 'Network.requestWillBeSent', {
            requestId: 'broken',
            request: { url: 'https://api.test.dev/fail', method: 'GET' },
        });
        applyCdpEvent(store, 'Network.loadingFailed', {
            requestId: 'broken',
            errorText: 'net::ERR_CONNECTION_RESET',
            canceled: false,
        });

        expect(listNetwork(store, { failedOnly: true })).toEqual([
            expect.objectContaining({ requestId: 'broken', failed: true, errorText: 'net::ERR_CONNECTION_RESET' }),
        ]);
        expect(listNetwork(store, { urlIncludes: 'cdn.test.dev' })).toHaveLength(1);
        expect(listNetwork(store, { method: 'POST' })).toHaveLength(0);
    });

    it('data:/blob: 等噪音 URL 默认被隐藏，includeNoise 时可见', () => {
        const store = createDevtoolsStore();
        applyCdpEvent(store, 'Network.requestWillBeSent', {
            requestId: 'inline',
            request: { url: 'data:text/plain,hello', method: 'GET' },
        });
        applyCdpEvent(store, 'Network.requestWillBeSent', {
            requestId: 'real',
            request: { url: 'https://test.dev/home', method: 'GET' },
        });
        expect(listNetwork(store).map((item) => item.requestId)).toEqual(['real']);
        expect(listNetwork(store, { includeNoise: true })).toHaveLength(2);
    });

    it('控制台输出、未捕获异常与浏览器日志分来源记录，且支持级别与文本过滤', () => {
        const store = createDevtoolsStore();
        applyCdpEvent(store, 'Runtime.consoleAPICalled', {
            type: 'warning',
            args: [{ type: 'string', value: 'lag' }, { type: 'object', description: 'Object' }],
            stackTrace: { callFrames: [{ url: 'https://app.test.dev/main.js', lineNumber: 3 }] },
        });
        applyCdpEvent(store, 'Runtime.exceptionThrown', {
            exceptionDetails: {
                text: 'Uncaught',
                url: 'https://app.test.dev/main.js',
                lineNumber: 44,
                exception: { description: 'TypeError: y is undefined' },
            },
        });
        applyCdpEvent(store, 'Log.entryAdded', {
            entry: { level: 'error', text: 'Blocked by CORS', url: 'https://api.test.dev' },
        });
        applyCdpEvent(store, 'Page.frameNavigated', {});

        expect(listConsole(store)).toEqual([
            expect.objectContaining({ id: 'c1', level: 'warning', source: 'console', text: 'lag Object' }),
            expect.objectContaining({ source: 'exception', text: expect.stringContaining('TypeError') }),
            expect.objectContaining({ source: 'browser', text: 'Blocked by CORS' }),
        ]);
        expect(listConsole(store, { level: 'warning' })).toHaveLength(1);
        expect(listConsole(store, { textIncludes: 'cors' })).toHaveLength(1);
    });

    it('网络环形缓冲写满后淘汰最早的请求', () => {
        const store = createDevtoolsStore();
        for (let i = 0; i < MAX_NETWORK_ENTRIES + 3; i += 1) {
            applyCdpEvent(store, 'Network.requestWillBeSent', {
                requestId: `req-${i}`,
                request: { url: `https://test.dev/p/${i}`, method: 'GET' },
            });
        }
        expect(store.networkOrder).toHaveLength(MAX_NETWORK_ENTRIES);
        expect(getNetworkEntry(store, 'req-0')).toBeUndefined();
        expect(getNetworkEntry(store, `req-${MAX_NETWORK_ENTRIES + 2}`)).toBeTruthy();
    });

    it('敏感请求头脱敏，文本类 MIME 与二进制 MIME 判定正确', () => {
        expect(redactHeaders({ Cookie: 'sid=1', Accept: 'text/html' })).toEqual({
            Cookie: '[redacted]',
            Accept: 'text/html',
        });
        expect(isTextualMime('text/html')).toBe(true);
        expect(isTextualMime('application/json')).toBe(true);
        expect(isTextualMime('image/webp')).toBe(false);
    });
});
