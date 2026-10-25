import { useEffect, useState } from 'react';
import { IconMessage2, IconSettings } from '@tabler/icons-react';
import { SettingsPanel } from './SettingsPanel';
import { ConversationArchive } from './ConversationArchive';
import { rpc } from '@/shared/extension/rpc-client';
import { applyDocumentTheme, resolveThemeClass } from '@/shared/extension/theme';
import { DEFAULT_SETTINGS, type AgentSettings } from '@/shared/contracts/settings';
//是扩展设置页的根组件：用 URL hash 在「常规」和「聊天记录」两个分区间切换，
// 分别渲染 SettingsPanel 与 ConversationArchive，
// 并负责加载/保存设置、同步主题、提供顶栏与侧边导航布局。
export type OptionsSection = 'general' | 'archive';

function sectionFromHash(): OptionsSection {
    return window.location.hash === '#archive' ? 'archive' : 'general';
}

const NAV = [
    { id: 'general' as const, label: '常规', description: '模型、执行、记忆与权限', icon: IconSettings },
    { id: 'archive' as const, label: '聊天记录', description: '浏览、筛选并导出会话', icon: IconMessage2 },
];

export function OptionsApp() {
    const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS);
    const [section, setSection] = useState<OptionsSection>(sectionFromHash);

    useEffect(() => {
        void rpc('settings.get', {}).then((value) => setSettings(value as AgentSettings));
    }, []);

    useEffect(() => {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const sync = () => applyDocumentTheme(resolveThemeClass(settings.theme, media.matches));
        sync();
        media.addEventListener('change', sync);
        return () => media.removeEventListener('change', sync);
    }, [settings.theme]);

    useEffect(() => {
        const sync = () => setSection(sectionFromHash());
        window.addEventListener('hashchange', sync);
        return () => window.removeEventListener('hashchange', sync);
    }, []);

    const openSection = (next: OptionsSection) => {
        setSection(next);
        const hash = next === 'archive' ? '#archive' : '#general';
        if (window.location.hash !== hash) {
            window.history.replaceState(null, '', hash);
        }
    };

    return (
        <div className="min-h-screen bg-canvas text-ink">
            <div className="h-1 w-full bg-[linear-gradient(90deg,#ff00f0_0_33.33%,#fffa00_33.33%_66.66%,#00ffa2_66.66%)]" aria-hidden />
            <header className="pagex-industrial-header sticky top-0 z-20">
                <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <span className="pagex-brand" aria-hidden>PX</span>
                    <div className="min-w-0">
                        <div className="pagex-eyebrow text-white/65">PAGEX / CONTROL</div>
                        <h1 className="text-[18px] font-bold tracking-[0.02em]">设置 / 控制台</h1>
                    </div>
                </div>
            </header>

            <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-10 lg:px-8 lg:py-8">
                <nav className="w-full shrink-0 lg:w-56" aria-label="设置分类">
                    <div className="grid grid-cols-2 gap-2 lg:sticky lg:top-24 lg:block lg:space-y-1">
                        {NAV.map((item) => {
                            const active = section === item.id;
                            const Icon = item.icon;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    aria-current={active ? 'page' : undefined}
                                    onClick={() => openSection(item.id)}
                                    className={`pagex-nav-item flex w-full items-start gap-2.5 px-3 py-3 text-left transition-colors ${
                                        active ? 'is-current' : ''
                                    }`}
                                >
                                    <Icon className="mt-0.5 size-4 shrink-0" stroke={1.9} />
                                    <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{item.label}</span>
                    <span className="mt-0.5 block text-[11.5px] leading-4 text-ink-3">{item.description}</span>
                  </span>
                                </button>
                            );
                        })}
                    </div>
                </nav>

                <main className="min-w-0 flex-1 pb-16 lg:max-w-[calc(100%-16.5rem)]">
                    {section === 'general' ? (
                        <div className="space-y-5">
                            <div className="max-w-3xl">
                                <h2 className="text-lg font-semibold text-ink">常规</h2>
                                <p className="mt-1 text-[13px] leading-5 text-ink-2">
                                    配置模型、执行方式、记忆和权限。这些选项与悬浮面板里的快捷设置同步。
                                </p>
                            </div>
                            <div className="pagex-settings-layout">
                                <div className="min-w-0">
                                    <SettingsPanel settings={settings} onChange={setSettings} variant="page" />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <ConversationArchive />
                    )}
                </main>
            </div>
        </div>
    );
}
