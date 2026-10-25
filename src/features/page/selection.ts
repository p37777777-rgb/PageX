const EDITABLE_SELECTOR = [
    'input',
    'textarea',
    'select',
    'option',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[role="textbox"]',
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="option"]',
    '[role="switch"]',
    '[data-slot^="select"]',
    '[data-slot="switch"]',
].join(',');
//记录选择
type SelectionListener = () => void;

let lastText = '';
let lastRange: Range | null = null;
let lastPage = '';
let pagexUntil = 0;
let installed = false;
const listeners = new Set<SelectionListener>();

export function isEditableTarget(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest(EDITABLE_SELECTOR));
}

export function retainPageSelectionOnPointerDown(event: {
    target: EventTarget | null;
    preventDefault: () => void;
}) {
    notePagexInteraction();
    if (isEditableTarget(event.target)) return;
    event.preventDefault();
}

export function notePagexInteraction() {
    pagexUntil = Date.now() + 800;
}

export function getRememberedSelection(): string {
    return readLivePageSelection() || lastText;
}

export function subscribePageSelection(listener: SelectionListener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function clearRememberedSelection() {
    lastText = '';
    lastRange = null;
    window.getSelection()?.removeAllRanges();
    notify();
}

export function shouldPreservePagexFocus(target: EventTarget | null = document.activeElement): boolean {
    return isEditableTarget(target) || isEditableTarget(document.activeElement);
}

export function restoreRememberedSelection(event?: { target?: EventTarget | null }) {
    if (shouldPreservePagexFocus(event?.target ?? document.activeElement)) return;
    if (!lastText || !lastRange || !rangeStillValid()) return;
    if (readLivePageSelection()) return;
    const selection = window.getSelection();
    if (!selection) return;
    try {
        selection.removeAllRanges();
        selection.addRange(lastRange);
    } catch {
        lastRange = null;
    }
}

export function installPageSelectionTracker() {
    if (installed) return;
    installed = true;
    lastPage = location.href;
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    window.addEventListener('popstate', onNavigate);
    window.addEventListener('hashchange', onNavigate);
}

function onDocumentPointerDown(event: PointerEvent) {
    if (eventTouchesPageX(event)) {
        notePagexInteraction();
        return;
    }
    pagexUntil = 0;
}

function onNavigate() {
    if (location.href === lastPage) return;
    lastPage = location.href;
    lastText = '';
    lastRange = null;
    notify();
}

function onSelectionChange() {
    if (location.href !== lastPage) {
        lastPage = location.href;
        lastText = '';
        lastRange = null;
    }

    const live = readLivePageSelection();
    if (live) {
        lastText = live;
        lastRange = cloneCurrentRange();
        notify();
        return;
    }

    if (Date.now() < pagexUntil || isPagexNode(document.activeElement)) return;

    if (lastText) {
        lastText = '';
        lastRange = null;
        notify();
    }
}

function readLivePageSelection(): string {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return '';
    if (isPagexNode(selection.anchorNode)) return '';
    return selection.toString();
}

function cloneCurrentRange(): Range | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    try {
        return selection.getRangeAt(0).cloneRange();
    } catch {
        return null;
    }
}

function rangeStillValid(): boolean {
    return Boolean(
        lastRange &&
        document.contains(lastRange.startContainer) &&
        document.contains(lastRange.endContainer),
    );
}

function isPagexNode(node: Node | null): boolean {
    if (!node) return false;
    const root = node.getRootNode();
    if (root instanceof ShadowRoot && root.host.localName === 'pagex-root') return true;
    const element = node instanceof Element ? node : node.parentElement;
    return Boolean(element?.closest('pagex-root'));
}

function eventTouchesPageX(event: Event): boolean {
    return event.composedPath().some((item) => item instanceof Element && item.localName === 'pagex-root');
}

function notify() {
    for (const listener of listeners) listener();
}
