import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_SETTINGS, type AgentSettings } from '@/shared/contracts/settings';
import { SettingsPanel } from './SettingsPanel';

vi.mock('@/shared/extension/rpc-client', () => ({
    rpc: vi.fn(async (name: string) => {
        if (name === 'mcp.getState') return { config: { mcpServers: {} }, servers: [] };
        if (name === 'permissions.get') return { allSites: false, debugger: false, tabs: false, origins: [] };
        return {};
    }),
}));

// @ts-expect-error test environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('SettingsPanel', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('renders the settings sections', async () => {
        await act(async () => root.render(<SettingsPanel settings={DEFAULT_SETTINGS} onChange={() => {}} />));
        expect(container.textContent).toContain('前文压缩');
        expect(container.textContent).toContain('服务商');
    });

    it('shows an error card instead of unmounting the whole tree when a section throws', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const broken = { ...DEFAULT_SETTINGS, model: { ...DEFAULT_SETTINGS.model, provider: 'minimax' } } as unknown as AgentSettings;
        await act(async () => root.render(<SettingsPanel settings={broken} onChange={() => {}} />));
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('设置加载失败');
    });
});
