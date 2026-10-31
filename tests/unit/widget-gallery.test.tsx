import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/shared/ui/select';
import { BotIcon } from '@/shared/ui/BotIcon';

// @ts-expect-error test environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pointerDown = (target: Element) =>
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }));

const leftClick = (target: Element) =>
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

describe('组件库：Select 下拉选择', () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        window.HTMLElement.prototype.scrollIntoView = vi.fn();
        window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
        window.HTMLElement.prototype.setPointerCapture = vi.fn();
        window.HTMLElement.prototype.releasePointerCapture = vi.fn();
    });

    afterEach(() => {
        document.body.removeChild(container);
    });

    it('trigger 连续多轮点击始终稳定开合，不会闪开即关', async () => {
        const root = createRoot(container);
        let openState = false;

        function Demo() {
            return (
                <Select
                    onOpenChange={(next) => {
                        openState = next;
                    }}
                >
                    <SelectTrigger data-testid="trigger">
                        <SelectValue placeholder="选择模型" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="gpt-x">模型 X</SelectItem>
                        <SelectItem value="gpt-y">模型 Y</SelectItem>
                    </SelectContent>
                </Select>
            );
        }

        await act(async () => {
            root.render(<Demo />);
        });

        const trigger = container.querySelector('[data-testid="trigger"]') as HTMLButtonElement;
        expect(trigger).toBeTruthy();
        expect(trigger.getAttribute('data-state')).toBe('closed');

        // 第一轮：点开 → 保持展开
        await act(async () => {
            pointerDown(trigger);
        });
        await act(async () => {
            leftClick(trigger);
        });
        expect(trigger.getAttribute('data-state')).toBe('open');
        expect(openState).toBe(true);

        // 第一轮：再点 → 收起
        await act(async () => {
            pointerDown(trigger);
        });
        await act(async () => {
            leftClick(trigger);
        });
        expect(trigger.getAttribute('data-state')).toBe('closed');
        expect(openState).toBe(false);

        // 第二轮：再次展开并保持
        await act(async () => {
            pointerDown(trigger);
        });
        await act(async () => {
            leftClick(trigger);
        });
        expect(trigger.getAttribute('data-state')).toBe('open');
        expect(openState).toBe(true);

        // 第二轮：收起
        await act(async () => {
            pointerDown(trigger);
        });
        await act(async () => {
            leftClick(trigger);
        });
        expect(trigger.getAttribute('data-state')).toBe('closed');
        expect(openState).toBe(false);

        await act(async () => {
            root.unmount();
        });
    });

    it('下拉展开时点击组件外部区域会自动关闭', async () => {
        const root = createRoot(container);

        function Demo() {
            return (
                <div>
                    <button id="escape-hatch">外部按钮</button>
                    <Select>
                        <SelectTrigger data-testid="trigger">
                            <SelectValue placeholder="选择模型" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="gpt-x">模型 X</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            );
        }

        await act(async () => {
            root.render(<Demo />);
        });

        const trigger = container.querySelector('[data-testid="trigger"]') as HTMLButtonElement;
        const outsideBtn = container.querySelector('#escape-hatch') as HTMLButtonElement;

        await act(async () => {
            pointerDown(trigger);
        });
        await act(async () => {
            leftClick(trigger);
        });
        expect(trigger.getAttribute('data-state')).toBe('open');

        await act(async () => {
            pointerDown(outsideBtn);
        });

        expect(trigger.getAttribute('data-state')).toBe('closed');

        await act(async () => {
            root.unmount();
        });
    });

    it('展开状态下在 trigger 上按 Enter 会收起下拉', async () => {
        const root = createRoot(container);

        function Demo() {
            return (
                <Select>
                    <SelectTrigger data-testid="trigger">
                        <SelectValue placeholder="选择模型" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="gpt-x">模型 X</SelectItem>
                    </SelectContent>
                </Select>
            );
        }

        await act(async () => {
            root.render(<Demo />);
        });

        const trigger = container.querySelector('[data-testid="trigger"]') as HTMLButtonElement;

        await act(async () => {
            pointerDown(trigger);
        });
        await act(async () => {
            leftClick(trigger);
        });
        expect(trigger.getAttribute('data-state')).toBe('open');

        await act(async () => {
            trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        });
        expect(trigger.getAttribute('data-state')).toBe('closed');

        await act(async () => {
            root.unmount();
        });
    });

    it('挂载在 Shadow DOM 内时菜单浮层可见，点选后正常回填值并收起', async () => {
        const host = document.createElement('div');
        const shadow = host.attachShadow({ mode: 'open' });
        const mount = document.createElement('div');
        shadow.append(mount);
        document.body.append(host);
        const root = createRoot(mount);
        let picked = '';

        await act(async () => {
            root.render(
                <Select
                    onValueChange={(value) => {
                        picked = value;
                    }}
                >
                    <SelectTrigger data-testid="trigger">
                        <SelectValue placeholder="选择模型" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="gpt-x">模型 X</SelectItem>
                    </SelectContent>
                </Select>,
            );
        });

        const trigger = shadow.querySelector('[data-testid="trigger"]') as HTMLButtonElement;
        await act(async () => {
            pointerDown(trigger);
        });
        await act(async () => {
            leftClick(trigger);
        });

        const menu = shadow.querySelector('[role="listbox"]') as HTMLElement | null;
        expect(trigger.getAttribute('data-state')).toBe('open');
        expect(menu).toBeTruthy();
        expect(menu?.className).not.toContain('opacity-0');
        expect(menu?.className).toContain('fixed');
        expect(shadow.querySelector('[role="option"]')?.textContent).toContain('模型 X');

        const option = shadow.querySelector('[role="option"]') as HTMLButtonElement;
        await act(async () => {
            pointerDown(option);
        });
        await act(async () => {
            leftClick(option);
        });
        expect(picked).toBe('gpt-x');
        expect(trigger.getAttribute('data-state')).toBe('closed');

        await act(async () => {
            root.unmount();
        });
        host.remove();
    });
});

describe('组件库：BotIcon 机器人图标', () => {
    it('默认输出 56px 的可访问 SVG', () => {
        const html = renderToString(<BotIcon />);
        expect(html).toContain('<svg');
        expect(html).toContain('viewBox="0 0 56 56"');
        expect(html).toContain('width="56"');
        expect(html).toContain('height="56"');
        expect(html).toContain('role="img"');
        expect(html).toContain('aria-label="PageX Bot"');
    });

    it('自定义尺寸与附加类名会透传到根节点', () => {
        const html = renderToString(<BotIcon size={34} className="my-extra-layer" />);
        expect(html).toContain('width="34"');
        expect(html).toContain('height="34"');
        expect(html).toContain('my-extra-layer');
    });

    it('包含 face / eyes-container / eyes-orbit / 双眼等语义分层', () => {
        const html = renderToString(<BotIcon />);
        expect(html).toContain('data-part="face"');
        expect(html).toContain('data-part="eyes-container"');
        expect(html).toContain('data-part="eyes-orbit"');
        expect(html).toContain('data-part="eye-left"');
        expect(html).toContain('data-part="eye-right"');
    });

    it('裁剪与渐变资源均携带实例化前缀 ID', () => {
        const first = renderToString(<BotIcon />);
        const second = renderToString(<BotIcon />);
        expect(first).toContain('pagex-bot-clip-');
        expect(first).toContain('pagex-bot-base-');
        expect(second).toContain('pagex-bot-clip-');
        expect(second).toContain('pagex-bot-base-');
    });

    it('animated 开启时附加眼球动效类，关闭时完全移除', () => {
        const still = renderToString(<BotIcon animated={false} />);
        expect(still).not.toContain('pagex-fab-eyes');
        expect(still).not.toContain('pagex-fab-eyes-orbit');
        expect(still).not.toContain('pagex-fab-eye');

        const moving = renderToString(<BotIcon animated={true} />);
        expect(moving).toContain('pagex-fab-eyes');
        expect(moving).toContain('pagex-fab-eyes-orbit');
        expect(moving).toContain('pagex-fab-eye');
    });

    it('四种表情使用不同的眼型图元', () => {
        // normal：一对矩形胶囊
        const normalHtml = renderToString(<BotIcon expression="normal" />);
        expect(normalHtml).toContain('<rect data-part="eye-left"');
        expect(normalHtml).toContain('<rect data-part="eye-right"');

        // happy：两条弧线路径 (^ ^)
        const happyHtml = renderToString(<BotIcon expression="happy" />);
        expect(happyHtml).toContain('<path data-part="eye-left"');
        expect(happyHtml).toContain('<path data-part="eye-right"');

        // blink：压扁的矩形
        const blinkHtml = renderToString(<BotIcon expression="blink" />);
        expect(blinkHtml).toContain('height="2"');

        // wink：左矩形 + 右弧线
        const winkHtml = renderToString(<BotIcon expression="wink" />);
        expect(winkHtml).toContain('<rect data-part="eye-left"');
        expect(winkHtml).toContain('<path data-part="eye-right"');
    });

    it('children 会被渲染进 decorations 扩展插槽', () => {
        const html = renderToString(
            <BotIcon>
                <circle id="extra-pulse" cx="10" cy="10" r="2" fill="yellow" />
            </BotIcon>,
        );
        expect(html).toContain('data-part="decorations"');
        expect(html).toContain('id="extra-pulse"');
    });
});
