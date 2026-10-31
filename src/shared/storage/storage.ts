//local:持久化
//session会话级
import { storage } from 'wxt/utils/storage';
import {
    adoptTabStore,
    conversationPageKey,
    conversationTabKey,
    isSparseStore,
} from '@/features/agent/session/conversations';
import { flattenStoredConversations } from '@/features/settings/conversation-archive';
import {
    idbDelete,
    idbDeleteKeys,
    idbGet,
    idbGetAll,
    idbReplaceAll,
    idbSet,
    migrateLegacyPagentDbIfNeeded,
    resetSessionDbForTests,
    SESSION_STORES,
} from './idb';
import {
    applySettingsPatch,
    DEFAULT_SETTINGS,
    normalizeCompressionSettings,
    PROVIDER_IDS,
    snapshotProviderProfile,
    type AgentSettings,
    type AgentSettingsPatch,
    type SecretMap,
} from '@/shared/contracts/settings';
import { EMPTY_MCP_CONFIG, mcpConfigSchema, type McpConfig } from '@/shared/contracts/mcp';
import type {
    Checkpoint,
    DomainVault,
    PageConversation,
    PageConversationStore,
    VaultMap,
} from '@/shared/contracts/session';
import { applyVaultStoreUpdate, conversationVaultKey, viewForVault } from '@/features/agent/session/vault';

export const settingsItem = storage.defineItem<AgentSettings>('local:pagex-settings', {
    fallback: DEFAULT_SETTINGS,
});

export const mcpConfigItem = storage.defineItem<McpConfig>('local:pagex-mcp-config', {
    fallback: EMPTY_MCP_CONFIG,
});

export const checkpointsItem = storage.defineItem<Record<string, Checkpoint>>(
    'local:pagex-checkpoints',
    { fallback: {} },
);

export const secretsItem = storage.defineItem<SecretMap>('session:pagex-secrets', {
    fallback: {},
});

export const persistedSecretsItem = storage.defineItem<SecretMap>('local:pagex-secrets', {
    fallback: {},
});

export const memorySecretItem = storage.defineItem<string>('local:pagex-memory-secret', {
    fallback: '',
});

const pageConversationsItem = storage.defineItem<Record<string, PageConversationStore>>(
    'session:pagex-page-conversations',
    { fallback: {} },
);

const vaultsItem = storage.defineItem<VaultMap>('local:pagex-vaults', {
    fallback: {},
});

const tabUiItem = storage.defineItem<Record<string, { panelOpen?: boolean }>>('session:pagex-tab-ui', {
    fallback: {},
});

const sessionScopeItem = storage.defineItem<string>('session:pagex-session-scope', {
    fallback: '',
});

let vaultWrite: Promise<unknown> = Promise.resolve();
const conversationWrites = new Map<string, Promise<unknown>>();
let ready: Promise<void> | null = null;

function withVaultLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = vaultWrite.then(fn, fn);
    vaultWrite = run.then(
        () => undefined,
        () => undefined,
    );
    return run;
}

// ---------- pagent -> PageX 的 chrome.storage key 迁移 ----------
// pagent 时代的设置、密钥、检查点等仍存在旧 key 下；PageX 改用了 pagex-* key。
// 这里把旧值搬到新 key：仅当新 key 还没有数据时才搬（幂等，不覆盖、不删除旧 key）。
// 会话/归档类数据不走这里——它们的权威源是旧 IndexedDB 库 'pagent'，由
// migrateLegacyPagentDbIfNeeded 导入。
type WxtStorageKey = `local:${string}` | `session:${string}`;

const LEGACY_STORAGE_KEYS: Array<[WxtStorageKey, WxtStorageKey]> = [
    ['local:pagent-settings', 'local:pagex-settings'],
    ['local:pagent-mcp-config', 'local:pagex-mcp-config'],
    ['local:pagent-checkpoints', 'local:pagex-checkpoints'],
    ['local:pagent-secrets', 'local:pagex-secrets'],
    ['local:pagent-memory-secret', 'local:pagex-memory-secret'],
    ['local:pagent:permanently-hidden', 'local:pagex:permanently-hidden'],
    ['session:pagent-secrets', 'session:pagex-secrets'],
];

function legacyValueExists(value: unknown): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === 'object' && Object.keys(value as object).length === 0) return false;
    if (typeof value === 'string' && value === '') return false;
    return true;
}

async function migrateLegacyChromeStorageIfNeeded(): Promise<void> {
    await Promise.all(
        LEGACY_STORAGE_KEYS.map(async ([legacyKey, currentKey]) => {
            const legacyItem = storage.defineItem<unknown>(legacyKey);
            const currentItem = storage.defineItem<unknown>(currentKey);
            const [legacyValue, currentValue] = await Promise.all([
                legacyItem.getValue(),
                currentItem.getValue(),
            ]);
            if (!legacyValueExists(legacyValue)) return;
            if (legacyValueExists(currentValue)) return;
            await currentItem.setValue(legacyValue);
        }),
    );
}

//检查是否已经迁移过
async function ensureSessionStorage(): Promise<void> {
    if (!ready) {
        ready = migrateLegacyChromeStorageIfNeeded()
            .then(() => migrateLegacyPagentDbIfNeeded())
            .then(() => migrateChromeSessionIfNeeded())
            .then(() => reconcileTabScopedSession())
            .catch((error) => {
                ready = null;
                throw error;
            });
    }
    await ready;
}

async function migrateChromeSessionIfNeeded(): Promise<void> {
    if (await idbGet<boolean>(SESSION_STORES.meta, 'chrome-migrated')) return;

    const [conversations, vaults, tabUi] = await Promise.all([
        pageConversationsItem.getValue(),
        vaultsItem.getValue(),
        tabUiItem.getValue(),
    ]);

    if (Object.keys(conversations).length) {
        await idbReplaceAll(SESSION_STORES.conversations, conversations);
    }
    if (Object.keys(vaults).length) {
        await idbReplaceAll(SESSION_STORES.vaults, vaults);
    }
    if (Object.keys(tabUi).length) {
        await idbReplaceAll(SESSION_STORES.tabUi, tabUi);
    }

    await idbSet(SESSION_STORES.meta, 'chrome-migrated', true);
    await Promise.all([
        pageConversationsItem.setValue({}),
        vaultsItem.setValue({}),
        tabUiItem.setValue({}),
    ]);
}

async function reconcileTabScopedSession(): Promise<void> {
    let scope = await sessionScopeItem.getValue();
    if (!scope) {
        scope = `s_${Date.now().toString(36)}`;
        await sessionScopeItem.setValue(scope);
    }

    const previous = await idbGet<string>(SESSION_STORES.meta, 'session-scope');
    if (previous && previous !== scope) {
        const conversations = await idbGetAll<PageConversationStore>(SESSION_STORES.conversations);
        const tabKeys = Object.keys(conversations).filter((key) => key.startsWith('tab:'));
        await Promise.all([
            idbDeleteKeys(SESSION_STORES.conversations, tabKeys),
            idbReplaceAll(SESSION_STORES.tabUi, {}),
        ]);
    }
    await idbSet(SESSION_STORES.meta, 'session-scope', scope);
}

export async function loadPageConversations(pageKey: string): Promise<PageConversationStore | null> {
    await ensureSessionStorage();
    return (await idbGet<PageConversationStore>(SESSION_STORES.conversations, pageKey)) ?? null;
}

export async function loadTabConversations(
    tabId: number,
    url?: string,
): Promise<PageConversationStore | null> {
    await ensureSessionStorage();
    const tabStore = await idbGet<PageConversationStore>(
        SESSION_STORES.conversations,
        conversationTabKey(tabId),
    );
    if (tabStore) return tabStore;
    if (!url) return null;
    const pageStore = await idbGet<PageConversationStore>(
        SESSION_STORES.conversations,
        conversationPageKey(url),
    );
    return pageStore && !isSparseStore(pageStore) ? pageStore : null;
}

export async function savePageConversations(
    pageKey: string,
    store: PageConversationStore,
): Promise<void> {
    const previous = conversationWrites.get(pageKey) ?? Promise.resolve();
    const write = previous.then(async () => {
        await ensureSessionStorage();
        const current = await idbGet<PageConversationStore>(SESSION_STORES.conversations, pageKey);
        await idbSet(
            SESSION_STORES.conversations,
            pageKey,
            current ? adoptTabStore(store, current) : store,
        );
    });
    conversationWrites.set(pageKey, write);
    try {
        await write;
    } finally {
        if (conversationWrites.get(pageKey) === write) conversationWrites.delete(pageKey);
    }
}

export async function loadTabUi(tabId: number): Promise<{ panelOpen?: boolean } | null> {
    await ensureSessionStorage();
    return (await idbGet<{ panelOpen?: boolean }>(SESSION_STORES.tabUi, conversationTabKey(tabId))) ?? null;
}

export async function saveTabUi(tabId: number, ui: { panelOpen?: boolean }): Promise<void> {
    await ensureSessionStorage();
    const key = conversationTabKey(tabId);
    const current = (await idbGet<{ panelOpen?: boolean }>(SESSION_STORES.tabUi, key)) ?? {};
    await idbSet(SESSION_STORES.tabUi, key, { ...current, ...ui });
}

export async function clearTabUi(tabId: number): Promise<void> {
    await ensureSessionStorage();
    await idbDelete(SESSION_STORES.tabUi, conversationTabKey(tabId));
}

export async function loadVault(domain: string): Promise<DomainVault | null> {
    await ensureSessionStorage();
    return (await idbGet<DomainVault>(SESSION_STORES.vaults, domain)) ?? null;
}

export async function loadPersistedConversationSources(): Promise<{
    vaults: VaultMap;
    stores: Record<string, PageConversationStore>;
}> {
    await ensureSessionStorage();
    const [vaults, stores] = await Promise.all([
        idbGetAll<DomainVault>(SESSION_STORES.vaults),
        idbGetAll<PageConversationStore>(SESSION_STORES.conversations),
    ]);
    return { vaults, stores };
}

export async function listPersistedConversations(): Promise<PageConversation[]> {
    const { vaults, stores } = await loadPersistedConversationSources();
    return flattenStoredConversations(vaults, stores);
}

export async function getPersistedConversations(ids: string[]): Promise<PageConversation[]> {
    const wanted = new Set(ids);
    return (await listPersistedConversations()).filter((item) => wanted.has(item.id));
}

export async function saveVaultFromStore(
    urlOrDomain: string,
    store: PageConversationStore,
    options?: { deleteMissing?: boolean },
): Promise<DomainVault | null> {
    const domain = conversationVaultKey(urlOrDomain) ?? (/^[a-z0-9.-]+(?::\d+)?$/i.test(urlOrDomain) ? urlOrDomain.toLowerCase() : null);
    if (!domain) return null;
    return withVaultLock(async () => {
        await ensureSessionStorage();
        const all = await idbGetAll<DomainVault>(SESSION_STORES.vaults);
        const next = applyVaultStoreUpdate(all, domain, store, options);
        if (!next[domain]?.conversations.length) delete next[domain];
        await idbReplaceAll(SESSION_STORES.vaults, next);
        return next[domain] ?? null;
    });
}

export async function loadConversationsForPage(
    tabId: number,
    url?: string,
    live?: PageConversationStore | null,
): Promise<PageConversationStore | null> {
    const domain = url ? conversationVaultKey(url) : null;
    const sessionStore = await loadTabConversations(tabId, url);
    if (!domain) {
        return live ?? sessionStore;
    }
    const vault = await loadVault(domain);
    return viewForVault(domain, vault, live ?? sessionStore);
}

export async function loadSettings(): Promise<AgentSettings> {
    const stored = await settingsItem.getValue();
    const settings: AgentSettings = {
        ...DEFAULT_SETTINGS,
        ...stored,
        model: { ...DEFAULT_SETTINGS.model, ...stored.model },
        memory: { ...DEFAULT_SETTINGS.memory, ...stored.memory },
        compression: normalizeCompressionSettings(stored.compression),
        providerProfiles: { ...DEFAULT_SETTINGS.providerProfiles, ...stored.providerProfiles },
    };
    // @langchain/openai 1.5 only recognizes OpenAI reasoning-summary events,
    // while DeepSeek Responses streams response.reasoning_text.delta.
    // Use Chat Completions so reasoning_content reaches the thinking UI.
    if (settings.model.provider === 'deepseek' && settings.model.apiProtocol === 'responses') {
        settings.model.apiProtocol = 'chat-completions';
    }
    if (!settings.providerProfiles[settings.model.provider]) {
        settings.providerProfiles = {
            ...settings.providerProfiles,
            [settings.model.provider]: snapshotProviderProfile(settings.model),
        };
    }
    return settings;
}

export async function saveSettings(patch: AgentSettingsPatch): Promise<AgentSettings> {
    const next = applySettingsPatch(await loadSettings(), patch);
    await settingsItem.setValue(next);
    return next;
}

export async function loadMcpConfig(): Promise<McpConfig> {
    const stored = await mcpConfigItem.getValue();
    const parsed = mcpConfigSchema.safeParse(stored);
    return parsed.success ? parsed.data : EMPTY_MCP_CONFIG;
}

export async function saveMcpConfig(config: McpConfig): Promise<McpConfig> {
    const parsed = mcpConfigSchema.parse(config);
    await mcpConfigItem.setValue(parsed);
    return parsed;
}

export async function loadSecrets(): Promise<SecretMap> {
    const persisted = await persistedSecretsItem.getValue();
    const session = await secretsItem.getValue();
    const merged = { ...persisted, ...session };
    if (Object.values(session).some(Boolean)) {
        await persistedSecretsItem.setValue(merged);
        await secretsItem.setValue({});
    }
    return merged;
}

export async function saveSecret(provider: keyof SecretMap, apiKey: string): Promise<void> {
    const persisted = await persistedSecretsItem.getValue();
    persisted[provider] = apiKey;
    await persistedSecretsItem.setValue(persisted);
    const session = await secretsItem.getValue();
    if (session[provider]) {
        delete session[provider];
        await secretsItem.setValue(session);
    }
}

export async function clearSecrets(provider?: keyof SecretMap): Promise<void> {
    if (!provider) {
        await secretsItem.setValue({});
        await persistedSecretsItem.setValue({});
        return;
    }
    const session = await loadSecrets();
    delete session[provider];
    await secretsItem.setValue(session);
    const persisted = await persistedSecretsItem.getValue();
    delete persisted[provider];
    await persistedSecretsItem.setValue(persisted);
}

export async function secretPresence(): Promise<Record<string, boolean>> {
    const secrets = await loadSecrets();
    return Object.fromEntries(PROVIDER_IDS.map((id) => [id, Boolean(secrets[id])]));
}

export async function loadMemorySecret(): Promise<string> {
    return memorySecretItem.getValue();
}

export async function saveMemorySecret(apiKey: string): Promise<void> {
    await memorySecretItem.setValue(apiKey);
}

export async function clearMemorySecret(): Promise<void> {
    await memorySecretItem.setValue('');
}

export function resetSessionReadyForTests(): void {
    ready = null;
    vaultWrite = Promise.resolve();
    conversationWrites.clear();
}

export async function resetSessionStorageForTests(): Promise<void> {
    resetSessionReadyForTests();
    await resetSessionDbForTests();
    await Promise.all([
        pageConversationsItem.setValue({}),
        vaultsItem.setValue({}),
        tabUiItem.setValue({}),
        sessionScopeItem.setValue(''),
        checkpointsItem.setValue({}),
    ]);
}

export const chromeSessionItemsForTests = {
    pageConversationsItem,
    vaultsItem,
    tabUiItem,
    sessionScopeItem,
};
