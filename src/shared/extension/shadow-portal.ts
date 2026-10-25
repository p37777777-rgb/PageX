//在页面里建一个隔离的 Shadow DOM 容器，放后面的面板。
//负责挂载、样式隔离和销毁。页面自己的样式不能漏进来，面板的样式也不要漏出去。
export function resolveShadowPortal(anchor?: Element | null): HTMLElement | undefined {
    const root = anchor?.getRootNode();
    if (!(root instanceof ShadowRoot)) return undefined;

    const existing = root.querySelector<HTMLElement>('[data-pagex-portals]');
    if (existing) {
        existing.classList.toggle('dark', root.host.classList.contains('dark'));
        return existing;
    }

    const host = document.createElement('div');
    host.dataset.pagexPortals = 'true';
    host.classList.toggle('dark', root.host.classList.contains('dark'));
    host.style.position = 'fixed';
    host.style.inset = 'auto';
    host.style.pointerEvents = 'none';
    host.style.zIndex = '2147483647';
    root.append(host);
    return host;
}