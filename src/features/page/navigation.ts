export const PAGE_NAVIGATION_EVENT = 'pagex:page-navigation';

type NavigationWindow = Window & {
    __pagexNavigationEvents?: boolean;
    navigation?: EventTarget;
};

export function installPageNavigationEvents(target: Window = window): void {
    const state = target as NavigationWindow;
    if (state.__pagexNavigationEvents) return;
    state.__pagexNavigationEvents = true;
    const notify = () => target.dispatchEvent(new Event(PAGE_NAVIGATION_EVENT));
    const targetHistory = target.history;
    const pushState = targetHistory.pushState.bind(targetHistory);
    targetHistory.pushState = (data, unused, url) => {
        pushState(data, unused, url);
        queueMicrotask(notify);
    };
    const replaceState = targetHistory.replaceState.bind(targetHistory);
    targetHistory.replaceState = (data, unused, url) => {
        replaceState(data, unused, url);
        queueMicrotask(notify);
    };
    state.navigation?.addEventListener('navigatesuccess', notify);
}
