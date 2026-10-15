import type { AgentSettings } from '@/shared/contracts/settings';
import type { McpToolMeta } from '@/shared/contracts/mcp';
import type { MemoryScope } from '@/shared/contracts/memory';
/*定义工具和页面之间的桥。工具不直接碰浏览器 API，
而是通过这层去要当前标签页、执行页面命令、截图、导航和读取设置。*/
export type ToolBridge = {
    tabId: number;
    settings: AgentSettings;
    content: <T>(name: string, payload?: unknown) => Promise<T>;
    /** raw=true 时返回完整未截断的 data URL（供作为图片传给模型） */
    screenshot: (fullPage?: boolean, raw?: boolean) => Promise<string>;
    navigate: (url: string) => Promise<unknown>;
    back: () => Promise<unknown>;
    forward: () => Promise<unknown>;
    reload: () => Promise<unknown>;
    tabs: {
        query: () => Promise<unknown>;
        create: (url?: string) => Promise<unknown>;
        switch: (tabId: number) => Promise<unknown>;
        close: (tabId: number) => Promise<unknown>;
    };
    cdp: {
        script: (expression: string, awaitPromise?: boolean) => Promise<unknown>;
        command: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
        input: (payload: { x: number; y: number; type?: string; text?: string }) => Promise<unknown>;
        network: (filter?: {
            urlIncludes?: string;
            method?: string;
            resourceType?: string;
            failedOnly?: boolean;
            includeNoise?: boolean;
            limit?: number;
        }) => Promise<unknown>;
        console: (filter?: {
            level?: string;
            textIncludes?: string;
            limit?: number;
        }) => Promise<unknown>;
        request: (requestId: string, includeBody?: boolean) => Promise<unknown>;
    };
    mcp: {
        listTools: () => Promise<McpToolMeta[]>;
        callTool: (name: string, args: unknown) => Promise<string>;
    };
    memory: {
        search: (query: string, limit?: number) => Promise<unknown>;
        write: (content: string, scope: MemoryScope, memoryId?: string) => Promise<unknown>;
    };
};

export type TrackActionFn = <T>(action: () => Promise<T>) => Promise<T>;
export type StartChangeWatchFn = () => Promise<{ watchId: string; cursor?: unknown }>;
