export const TOGGLE_PANEL_COMMAND = 'toggle-PageX';
export const TOGGLE_PANEL_HOTKEY_LABEL = 'Alt+P';
//快捷键检测模块alt+p快速开启
export function isTogglePanelHotkey(
    event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code' | 'key'>,
): boolean {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    return event.code === 'KeyP' || event.key.toLowerCase() === 'p';
}
//为代码元素添加教学注释alt+x
export function isTeachingCommentElementHotkey(
    event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code' | 'key'>,
): boolean {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    return event.code === 'KeyX' || event.key.toLowerCase() === 'x';
}
//Alt+C	直接添加教学注释
export function isTeachingCommentDirectHotkey(
    event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code' | 'key'>,
): boolean {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    return event.code === 'KeyC' || event.key.toLowerCase() === 'c';
}
