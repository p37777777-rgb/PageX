import { useState } from 'react';
//页面上的示教入口。负责开始、暂停和结束的显示
export function TeachingOrb({
                                summarizing,
                                onFinish,
                                onCancel,
                            }: {
    summarizing?: boolean;
    onFinish: () => void;
    onCancel: () => void;
}) {
    const [menuOpen, setMenuOpen] = useState(false);

    return (
        <div className={`pagex-teaching-orb-wrap ${summarizing ? 'is-summarizing' : ''}`}>
            {menuOpen && !summarizing && (
                <div className="pagex-teaching-menu" role="dialog" aria-label="示教控制">
                    <div>
                        <strong>正在示教</strong>
                        <span>操作会持续记录</span>
                        <span>Alt+X 选元素备注，Alt+C 直接备注</span>
                    </div>
                    <button type="button" className="is-primary" onClick={onFinish}>结束并总结</button>
                    <button type="button" onClick={onCancel}>取消</button>
                </div>
            )}
            <button
                type="button"
                className="pagex-teaching-orb"
                aria-label={summarizing ? '正在总结示教流程' : '打开示教控制'}
                aria-expanded={menuOpen}
                onClick={() => {
                    if (!summarizing) setMenuOpen((open) => !open);
                }}
            >
                <span className="pagex-fab-word" aria-hidden>{summarizing ? '…' : '录'}</span>
            </button>
        </div>
    );
}
