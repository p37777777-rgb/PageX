export type MenuBox = {
    left: number;
    top: number;
    width: number;
    maxHeight: number;
};

type Frame = { left: number; top: number; right: number; bottom: number; width: number };

function frameOf(trigger: HTMLElement): Frame {
    const panel = trigger.closest('.pagex-window');
    if (panel instanceof HTMLElement) {
        const rect = panel.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width };
    }
    return {
        left: 8,
        top: 8,
        right: window.innerWidth - 8,
        bottom: window.innerHeight - 8,
        width: window.innerWidth - 16,
    };
}

/** Keep a menu inside the extension panel, or inside the viewport when there is no panel. */
export function placeOverlayMenu(trigger: HTMLElement, minWidth = 196): MenuBox {
    const rect = trigger.getBoundingClientRect();
    const bounds = frameOf(trigger);
    const pad = 8;
    const gap = 4;
    const maxWidth = Math.max(120, bounds.width - pad * 2);
    const width = Math.min(Math.max(rect.width, minWidth), maxWidth);
    const left = Math.min(Math.max(bounds.left + pad, rect.left), bounds.left + bounds.width - pad - width);
    const spaceBelow = bounds.bottom - pad - rect.bottom - gap;
    const spaceAbove = rect.top - gap - (bounds.top + pad);
    const openUp = spaceBelow < 120 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(72, Math.min(220, openUp ? spaceAbove : spaceBelow));
    const top = openUp
        ? Math.max(bounds.top + pad, rect.top - gap - maxHeight)
        : Math.min(rect.bottom + gap, bounds.bottom - pad - maxHeight);
    return { left, top, width, maxHeight };
}

export function clampToViewport(left: number, top: number, width: number, height: number) {
    return {
        left: Math.min(Math.max(8, left), Math.max(8, window.innerWidth - width - 8)),
        top: Math.min(Math.max(8, top), Math.max(8, window.innerHeight - height - 8)),
    };
}

/** `document.getElementById` cannot see nodes inside the extension shadow root. */
export function elementById(from: Node | null | undefined, id: string): HTMLElement | null {
    const root = from?.getRootNode();
    if (root instanceof ShadowRoot || root instanceof Document) return root.getElementById(id);
    return document.getElementById(id);
}
