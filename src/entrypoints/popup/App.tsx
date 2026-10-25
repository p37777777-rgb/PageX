import { useEffect, useState } from 'react';
import { rpc } from '@/shared/extension/rpc-client';
import { applyDocumentTheme, resolveThemeClass } from '@/shared/extension/theme';
import type { AgentSettings } from '@/shared/contracts/settings';
import { Button } from '@/shared/ui/beui/button';
import { Switch } from '@/shared/ui/beui/switch';

export function PopupApp() {
    const [settings, setSettings] = useState<AgentSettings>();
    const [currentHidden, setCurrentHidden] = useState(false);
    const [permanentlyHidden, setPermanentlyHidden] = useState(false);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        void Promise.all([rpc('settings.get', {}), rpc('menu.getState', {})])
            .then(([settingsValue, menuValue]) => {
                const menu = menuValue as { currentHidden?: boolean; permanentlyHidden?: boolean };
                setSettings(settingsValue as AgentSettings);
                setCurrentHidden(Boolean(menu.currentHidden));
                setPermanentlyHidden(Boolean(menu.permanentlyHidden));
            })
            .catch((item) => setError(item instanceof Error ? item.message : String(item)));
    }, []);

    useEffect(() => {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const sync = () =>
            applyDocumentTheme(resolveThemeClass(settings?.theme ?? 'system', media.matches));
        sync();
        media.addEventListener('change', sync);
        return () => media.removeEventListener('change', sync);
    }, [settings?.theme]);

    const run = async (name: string, action: () => Promise<unknown>, close = true) => {
        setBusy(name);
        setError('');
        try {
            await action();
            if (close) window.close();
        } catch (item) {
            setError(item instanceof Error ? item.message : String(item));
        } finally {
            setBusy('');
        }
    };

    return (
        <main className="w-89 bg-surface text-ink">
            <section>
                <div className="h-1 w-full bg-[linear-gradient(90deg,#ff00f0_0_33.33%,#fffa00_33.33%_66.66%,#00ffa2_66.66%)]" aria-hidden />
                <header className="pagex-industrial-header flex items-center gap-3 px-4 py-3.5">
          <span className="pagex-brand" aria-hidden>PX</span>
                    <div className="min-w-0 flex-1">
                        <div className="pagex-eyebrow text-white/65">PAGEX / QUICK ACCESS</div>
                        <h1 className="text-[16px] font-bold tracking-[0.02em]">页面 Agent</h1>
                        <p className="truncate text-[11px] text-white/65">
                            {settings ? `${settings.model.provider} · ${settings.model.model}` : '页面内智能 Agent'}
                        </p>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="pagex-cut-button h-8 min-h-0 px-2.5 text-[11.5px]"
                        onClick={() => void browser.runtime.openOptionsPage()}
                    >
                        设置
                    </Button>
                </header>

                <div className="p-4">
                    <Button
                        disabled={Boolean(busy)}
                        onClick={() => void run('open', () => rpc('menu.openCurrent', {}))}
                        className="h-10 w-full rounded-xl text-[13px] font-semibold"
                    >
                        {busy === 'open' ? '正在打开…' : '在当前页面打开'}
                    </Button>

                    <div className="my-4 h-px bg-line" />

                    <div className="mb-2 text-[10px] font-semibold tracking-[0.08em] text-ink-3 uppercase">
                        显示设置
                    </div>
                    <div className="flex items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-medium">在当前页面隐藏</span>
              <span className="mt-0.5 block text-[10.5px] leading-4 text-ink-3">刷新页面后自动恢复显示</span>
            </span>
                        <Switch
                            checked={currentHidden}
                            disabled={Boolean(busy) || permanentlyHidden}
                            onCheckedChange={(hidden) => {
                                setCurrentHidden(hidden);
                                void run(
                                    'current',
                                    () => rpc(hidden ? 'menu.hideCurrent' : 'menu.openCurrent', {}),
                                    false,
                                );
                            }}
                            aria-label="在当前页面隐藏"
                        />
                    </div>

                    <div className="flex items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-medium">永久隐藏悬浮入口</span>
              <span className="mt-0.5 block text-[10.5px] leading-4 text-ink-3">
                在所有网页隐藏，可随时从此处恢复
              </span>
            </span>
                        <Switch
                            checked={permanentlyHidden}
                            disabled={Boolean(busy)}
                            onCheckedChange={(hidden) =>
                                void run(
                                    'permanent',
                                    async () => {
                                        await rpc('menu.setPermanentlyHidden', { hidden });
                                        setPermanentlyHidden(hidden);
                                    },
                                    false,
                                )
                            }
                            aria-label="永久隐藏悬浮入口"
                        />
                    </div>
                </div>
            </section>

            {error && (
                <p role="alert" className="mx-4 mb-4 rounded-lg bg-red-tint px-3 py-2 text-[11px] leading-4 text-red">
                    {error}
                </p>
            )}
        </main>
    );
}
