import { Component, type ErrorInfo, type ReactNode } from 'react';

//兜住子树的渲染错误：没有它时，任何一处异常都会让 React 卸载整棵树，页内面板直接消失。
export class ErrorBoundary extends Component<
    { label: string; children: ReactNode },
    { error: Error | null }
> {
    override state: { error: Error | null } = { error: null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    override componentDidCatch(error: Error, info: ErrorInfo) {
        console.error(`[PageX] ${this.props.label}渲染失败`, error, info.componentStack);
    }

    override render() {
        const { error } = this.state;
        if (!error) return this.props.children;
        return (
            <div role="alert" className="space-y-2 rounded-card border border-line bg-surface p-3 text-sm text-ink">
                <p className="font-semibold">{this.props.label}加载失败</p>
                <p className="break-all text-[11.5px] leading-5 text-ink-3">{error.message}</p>
                <button
                    type="button"
                    className="rounded border border-line px-2 py-1 text-xs text-ink-2 hover:bg-canvas"
                    onClick={() => this.setState({ error: null })}
                >
                    重试
                </button>
            </div>
        );
    }
}
