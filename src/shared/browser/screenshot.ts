//页面截图能力
//captureVisibleTab使用 CDP 截取整个页面
export async function captureVisibleTab(windowId?: number): Promise<string> {
    if (windowId == null) {
        return browser.tabs.captureVisibleTab({ format: 'png' });
    }
    return browser.tabs.captureVisibleTab(windowId, { format: 'png' });
}

export function trimDataUrl(dataUrl: string, max = 180_000): string {
    if (dataUrl.length <= max) return dataUrl;
    return `${dataUrl.slice(0, max)}…[truncated ${dataUrl.length - max} chars]`;
}
