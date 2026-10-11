/*
- 获取当前标签页、查询标签页列表
- 创建、关闭、切换标签页
- 导航：跳转、前进、后退、刷新
- 获取标签页信息：URL、标题、隐私模式
- 判断受限页面（chrome://、edge:// 等）
* */
export async function getActiveTab() {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('找不到当前标签页');
    return tab;
}

export async function listTabs() {
    const tabs = await browser.tabs.query({ currentWindow: true });
    return tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        active: tab.active,
        windowId: tab.windowId,
    }));
}

export async function createTab(url?: string) {
    return browser.tabs.create({ url, active: true });
}

export async function switchTab(tabId: number) {
    const tab = await browser.tabs.get(tabId);
    if (tab.windowId != null) await browser.windows.update(tab.windowId, { focused: true });
    await browser.tabs.update(tabId, { active: true });
    return tab;
}

export async function closeTab(tabId: number) {
    await browser.tabs.remove(tabId);
}

export async function navigateTab(tabId: number, url: string) {
    return browser.tabs.update(tabId, { url });
}

export async function goBack(tabId: number) {
    await browser.tabs.goBack(tabId);
}

export async function goForward(tabId: number) {
    await browser.tabs.goForward(tabId);
}

export async function reloadTab(tabId: number) {
    await browser.tabs.reload(tabId);
}
