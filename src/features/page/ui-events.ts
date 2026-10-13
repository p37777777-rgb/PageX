export const uiEvents = new EventTarget();
//页面内部的一组界面事件：打开、收起、隐藏面板，以及开始和结束圈选。这里只发事件，不创建面板。
export type UiCommand =
    | 'ui.toggle'
    | 'ui.open'
    | 'ui.collapse'
    | 'ui.hide'
    | 'ui.capture.start'
    | 'ui.capture.end';

export function dispatchUiCommand(name: UiCommand) {
    if (name === 'ui.toggle') uiEvents.dispatchEvent(new CustomEvent('toggle'));
    if (name === 'ui.open') uiEvents.dispatchEvent(new CustomEvent('open'));
    if (name === 'ui.collapse') uiEvents.dispatchEvent(new CustomEvent('collapse'));
    if (name === 'ui.hide') uiEvents.dispatchEvent(new CustomEvent('hide'));
    if (name === 'ui.capture.start') uiEvents.dispatchEvent(new CustomEvent('capture-start'));
    if (name === 'ui.capture.end') uiEvents.dispatchEvent(new CustomEvent('capture-end'));
}
