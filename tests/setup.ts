import 'fake-indexeddb/auto';

/*
 * happy-dom 的 WAAPI Animation.cancel() 会 reject 其 finished promise；
 * motion 组件取消动画时不捕获这个 AbortError，会在测试进程里留下
 * unhandled rejection 并让 vitest 以非零码退出。
 * 这里给测试环境创建的每个动画的 finished / ready promise 挂上静默
 * catch：只影响测试运行器，不改变真实浏览器行为。
 */
const originalAnimate = Element.prototype.animate;
if (originalAnimate) {
    Element.prototype.animate = function animate(...args) {
        const animation = originalAnimate.apply(this, args);
        animation.finished?.catch(() => undefined);
        animation.ready?.catch(() => undefined);
        return animation;
    };
}
