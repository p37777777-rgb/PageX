//跳转到扩展的完整设置页面（options.html）
//是打开/聚焦扩展完整设置页的辅助函数：
// 生成带分区锚点的 options.html 地址，若已打开则复用并定位，否则新建标签页打开。

export async function openDetailedSettings(section: 'general' | 'archive' = 'general') {
    const url = browser.runtime.getURL(`/options.html#${section}`);
    const existing = await browser.tabs.query({ url: browser.runtime.getURL('/options.html') });
    const current = existing[0];
    if (current?.id) {
        await browser.tabs.update(current.id, { url, active: true });
        if (current.windowId != null) await browser.windows.update(current.windowId, { focused: true });
        return;
    }
    await browser.tabs.create({ url, active: true });
}
