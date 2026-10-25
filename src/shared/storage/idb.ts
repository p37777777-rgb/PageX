const DB_NAME = 'PageX';
const DB_VERSION = 3;
//封装的IndexedDB API
export const SESSION_STORES = {
    conversations: 'conversations',
    vaults: 'vaults',
    tabUi: 'tabUi',
    meta: 'meta',
    teaching: 'teaching',
    commands: 'commands',
    memories: 'memories',
} as const;

export type SessionStoreName = (typeof SESSION_STORES)[keyof typeof SESSION_STORES];
//打开数据库
let dbPromise: Promise<IDBDatabase> | null = null;
//IndexedDB 原生 API 使用回调，这个函数把它转成 async/await 友好的 Promise
function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
    });
}

function complete(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务中止'));
    });
}

export function openSessionDb(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
        return Promise.reject(new Error('当前环境不支持 IndexedDB'));
    }
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                for (const name of Object.values(SESSION_STORES)) {
                    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
                }
            };
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => {
                    db.close();
                    dbPromise = null;
                };
                resolve(db);
            };
            request.onerror = () => reject(request.error ?? new Error('无法打开会话数据库'));
        });
    }
    return dbPromise;
}
//读取单个值
export async function idbGet<T>(store: SessionStoreName, key: string): Promise<T | undefined> {
    const db = await openSessionDb();
    const tx = db.transaction(store, 'readonly');
    const value = await requestToPromise(tx.objectStore(store).get(key));
    await complete(tx);
    return value as T | undefined;
}
//保存单个值
export async function idbSet<T>(store: SessionStoreName, key: string, value: T): Promise<void> {
    const db = await openSessionDb();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    await complete(tx);
}
//删除单个值
export async function idbDelete(store: SessionStoreName, key: string): Promise<void> {
    const db = await openSessionDb();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await complete(tx);
}
//获取所有数据
export async function idbGetAll<T>(store: SessionStoreName): Promise<Record<string, T>> {
    const db = await openSessionDb();
    const tx = db.transaction(store, 'readonly');
    const objectStore = tx.objectStore(store);
    const [keys, values] = await Promise.all([
        requestToPromise(objectStore.getAllKeys()),
        requestToPromise(objectStore.getAll()),
    ]);
    await complete(tx);
    const result: Record<string, T> = {};
    keys.forEach((item, index) => {
        result[String(item)] = values[index] as T;
    });
    return result;
}
//替换所有数据
export async function idbReplaceAll<T>(store: SessionStoreName, next: Record<string, T>): Promise<void> {
    const db = await openSessionDb();
    const tx = db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    objectStore.clear();
    for (const [key, value] of Object.entries(next)) {
        objectStore.put(value, key);
    }
    await complete(tx);
}
//批量删除
export async function idbDeleteKeys(store: SessionStoreName, keys: string[]): Promise<void> {
    if (!keys.length) return;
    const db = await openSessionDb();
    const tx = db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    for (const key of keys) objectStore.delete(key);
    await complete(tx);
}

export async function resetSessionDbForTests(): Promise<void> {
    if (dbPromise) {
        const db = await dbPromise.catch(() => null);
        db?.close();
        dbPromise = null;
    }
    if (typeof indexedDB === 'undefined') return;
    await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error('无法删除会话数据库'));
        request.onblocked = () => resolve();
    });
}

// ---------- pagent -> PageX 一次性迁移 ----------
// PageX 由 pagent 重写而来，IndexedDB 库名从 'pagent' 改为 'PageX'。
// 这里把旧库中 conversations / vaults / memories 等数据导入新库：
// - 只在新库对应 store 为空时导入，绝不覆盖 PageX 已产生的新数据；
// - meta 不迁移（chrome-migrated / session-scope 等标志由 PageX 自己维护）；
// - 旧库保留不删，方便回退到 pagent。
const LEGACY_DB_NAME = 'pagent';
export const LEGACY_DB_MIGRATED_FLAG = 'legacy-pagent-migrated';

async function openLegacyDb(): Promise<IDBDatabase | null> {
    return new Promise((resolve, reject) => {
        // 不带版本号打开；若旧库不存在，upgradeneeded 会尝试创建，立即中止以回滚创建
        const request = indexedDB.open(LEGACY_DB_NAME);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('无法打开旧版数据库'));
        request.onupgradeneeded = () => {
            request.transaction?.abort();
        };
    });
}

export async function migrateLegacyPagentDbIfNeeded(): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    if (await idbGet<boolean>(SESSION_STORES.meta, LEGACY_DB_MIGRATED_FLAG)) return;
    let migrated = false;
    try {
        const legacy = await openLegacyDb();
        if (legacy) {
            try {
                for (const name of Object.values(SESSION_STORES)) {
                    if (name === SESSION_STORES.meta) continue;
                    if (!legacy.objectStoreNames.contains(name)) continue;
                    const existing = await idbGetAll(name);
                    if (Object.keys(existing).length) continue;
                    const tx = legacy.transaction(name, 'readonly');
                    const [keys, values] = await Promise.all([
                        requestToPromise(tx.objectStore(name).getAllKeys()),
                        requestToPromise(tx.objectStore(name).getAll()),
                    ]);
                    await complete(tx);
                    if (!keys.length) continue;
                    const incoming: Record<string, unknown> = {};
                    keys.forEach((key, index) => {
                        incoming[String(key)] = values[index];
                    });
                    await idbReplaceAll(name, incoming);
                    migrated = true;
                }
            } finally {
                legacy.close();
            }
        }
    } catch {
        // 旧库不存在或读取失败：不重试、不抛错，迁移流程静默结束
    }
    void migrated;
    await idbSet(SESSION_STORES.meta, LEGACY_DB_MIGRATED_FLAG, true);
}
