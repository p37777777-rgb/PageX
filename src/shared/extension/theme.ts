//取并应用浅色、深色或跟随系统。系统主题变化时跟着变。主题存在已有存储里，不要另起一套键。
export function resolveThemeClass(theme: 'light' | 'dark' | 'system', systemDark = false): string {
    if (theme === 'dark') return 'dark';
    if (theme === 'light') return '';
    return systemDark ? 'dark' : '';
}

export function applyDocumentTheme(themeClass: string) {
    document.documentElement.classList.toggle('dark', themeClass === 'dark');
    document.documentElement.style.colorScheme = themeClass === 'dark' ? 'dark' : 'light';
}

export function applyShadowTheme(anchor: Element | null, themeClass: string) {
    const root = anchor?.getRootNode();
    if (!(root instanceof ShadowRoot)) return;
    const dark = themeClass === 'dark';
    root.host.classList.toggle('dark', dark);
    root.querySelector('[data-pagex-ui]')?.classList.toggle('dark', dark);
    root.querySelector('[data-pagex-portals]')?.classList.toggle('dark', dark);
}
