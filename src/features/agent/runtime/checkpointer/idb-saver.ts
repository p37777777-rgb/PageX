/*把 LangGraph 的检查点存进 IndexedDB，扩展后台被回收后能从最后一步接着跑。
每个线程只保留最新的检查点和它的待写入结果：恢复只需要这些，全部历史会随步数平方增长。
createAgent 的 messages 通道每次都保存完整值，不依赖祖先检查点，所以只留最新一个是安全的。*/
import {
    BaseCheckpointSaver,
    WRITES_IDX_MAP,
    copyCheckpoint,
    getCheckpointId,
    type Checkpoint,
    type CheckpointListOptions,
    type CheckpointMetadata,
    type CheckpointPendingWrite,
    type CheckpointTuple,
    type PendingWrite,
    type SerializerProtocol,
} from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import { idbDelete, idbGet, idbGetAllKeys, idbSet, SESSION_STORES } from '@/shared/storage/idb';

type Serialized = { type: string; data: Uint8Array | string };

type StoredCheckpoint = {
    id: string;
    parentId?: string;
    checkpoint: Serialized;
    metadata: Serialized;
};

type StoredWrite = { taskId: string; channel: string; value: Serialized };

type NamespaceRecord = {
    checkpoint?: StoredCheckpoint;
    /** 按 checkpoint id 分组；写入可能先于对应检查点到达，所以不只存最新 id 的。 */
    writes: Record<string, Record<string, StoredWrite>>;
};

export type ThreadRecord = {
    threadId: string;
    updatedAt: number;
    namespaces: Record<string, NamespaceRecord>;
};

/** 存储后端。默认是 IndexedDB，测试里可以换成内存实现。 */
export type ThreadStore = {
    get(threadId: string): Promise<ThreadRecord | undefined>;
    set(threadId: string, record: ThreadRecord): Promise<void>;
    delete(threadId: string): Promise<void>;
    keys(): Promise<string[]>;
};

export const idbThreadStore: ThreadStore = {
    get: (threadId) => idbGet<ThreadRecord>(SESSION_STORES.agentThreads, threadId),
    set: (threadId, record) => idbSet(SESSION_STORES.agentThreads, threadId, record),
    delete: (threadId) => idbDelete(SESSION_STORES.agentThreads, threadId),
    keys: () => idbGetAllKeys(SESSION_STORES.agentThreads),
};

function requireThreadId(config: RunnableConfig, action: string): string {
    const threadId = config.configurable?.thread_id;
    if (typeof threadId !== 'string' || !threadId) {
        throw new Error(`${action}失败：RunnableConfig.configurable 缺少 thread_id`);
    }
    return threadId;
}

function namespaceOf(config: RunnableConfig): string {
    const ns = config.configurable?.checkpoint_ns;
    return typeof ns === 'string' ? ns : '';
}

function emptyNamespace(): NamespaceRecord {
    return { writes: {} };
}

export class IdbCheckpointSaver extends BaseCheckpointSaver {
    private readonly store: ThreadStore;
    private queue: Promise<unknown> = Promise.resolve();
    /** 本次后台生命周期里写过的线程；清理孤儿线程时跳过它们，避免误删正在跑的任务。 */
    private readonly touched = new Set<string>();

    constructor(options: { store?: ThreadStore; serde?: SerializerProtocol } = {}) {
        super(options.serde);
        this.store = options.store ?? idbThreadStore;
    }

    /** 所有读写排成一队，避免并行工具调用同时 putWrites 时互相覆盖。 */
    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        const run = this.queue.then(task, task);
        this.queue = run.catch(() => undefined);
        return run;
    }

    private async serialize(value: unknown): Promise<Serialized> {
        const [type, data] = await this.serde.dumpsTyped(value);
        return { type, data };
    }

    private async mutate(threadId: string, change: (record: ThreadRecord) => void): Promise<void> {
        this.touched.add(threadId);
        await this.enqueue(async () => {
            const record = (await this.store.get(threadId)) ?? { threadId, updatedAt: 0, namespaces: {} };
            change(record);
            record.updatedAt = Date.now();
            await this.store.set(threadId, record);
        });
    }

    private async toTuple(threadId: string, ns: string, entry: NamespaceRecord): Promise<CheckpointTuple | undefined> {
        const stored = entry.checkpoint;
        if (!stored) return undefined;
        const [checkpoint, metadata, pendingWrites] = await Promise.all([
            this.serde.loadsTyped(stored.checkpoint.type, stored.checkpoint.data) as Promise<Checkpoint>,
            this.serde.loadsTyped(stored.metadata.type, stored.metadata.data) as Promise<CheckpointMetadata>,
            Promise.all(
                Object.values(entry.writes[stored.id] ?? {}).map(
                    async (write): Promise<CheckpointPendingWrite> => [
                        write.taskId,
                        write.channel,
                        await this.serde.loadsTyped(write.value.type, write.value.data),
                    ],
                ),
            ),
        ]);
        const tuple: CheckpointTuple = {
            config: { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: stored.id } },
            checkpoint,
            metadata,
            pendingWrites,
        };
        if (stored.parentId) {
            tuple.parentConfig = {
                configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: stored.parentId },
            };
        }
        return tuple;
    }

    async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
        const threadId = config.configurable?.thread_id;
        if (typeof threadId !== 'string' || !threadId) return undefined;
        const ns = namespaceOf(config);
        const record = await this.enqueue(() => this.store.get(threadId));
        const entry = record?.namespaces[ns];
        if (!entry?.checkpoint) return undefined;
        const wanted = getCheckpointId(config);
        if (wanted && wanted !== entry.checkpoint.id) return undefined;
        return this.toTuple(threadId, ns, entry);
    }

    async *list(config: RunnableConfig, options: CheckpointListOptions = {}): AsyncGenerator<CheckpointTuple> {
        let remaining = options.limit;
        if (remaining !== undefined && remaining <= 0) return;
        const threadId = config.configurable?.thread_id;
        const threadIds =
            typeof threadId === 'string' && threadId ? [threadId] : await this.enqueue(() => this.store.keys());
        const wantedNs = config.configurable?.checkpoint_ns;
        const wantedId = config.configurable?.checkpoint_id;
        const beforeId = options.before?.configurable?.checkpoint_id;
        for (const id of threadIds) {
            const record = await this.enqueue(() => this.store.get(id));
            if (!record) continue;
            for (const [ns, entry] of Object.entries(record.namespaces)) {
                const stored = entry.checkpoint;
                if (!stored) continue;
                if (typeof wantedNs === 'string' && ns !== wantedNs) continue;
                if (wantedId && stored.id !== wantedId) continue;
                if (beforeId && stored.id >= beforeId) continue;
                const tuple = await this.toTuple(id, ns, entry);
                if (!tuple) continue;
                if (
                    options.filter &&
                    !Object.entries(options.filter).every(
                        ([key, value]) => (tuple.metadata as Record<string, unknown> | undefined)?.[key] === value,
                    )
                ) {
                    continue;
                }
                yield tuple;
                if (remaining !== undefined && (remaining -= 1) <= 0) return;
            }
        }
    }

    async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<RunnableConfig> {
        const threadId = requireThreadId(config, '保存检查点');
        const ns = namespaceOf(config);
        const parentId = config.configurable?.checkpoint_id as string | undefined;
        const [serializedCheckpoint, serializedMetadata] = await Promise.all([
            this.serialize(copyCheckpoint(checkpoint)),
            this.serialize(metadata),
        ]);
        await this.mutate(threadId, (record) => {
            const entry = (record.namespaces[ns] ??= emptyNamespace());
            entry.checkpoint = {
                id: checkpoint.id,
                parentId,
                checkpoint: serializedCheckpoint,
                metadata: serializedMetadata,
            };
            // 旧检查点已被取代，它的待写入结果也不会再被读取；比新检查点更晚的写入（理论上不会出现）同样保留。
            for (const id of Object.keys(entry.writes)) {
                if (id < checkpoint.id) delete entry.writes[id];
            }
        });
        return { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: checkpoint.id } };
    }

    async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
        const threadId = requireThreadId(config, '保存中间结果');
        const checkpointId = config.configurable?.checkpoint_id;
        if (typeof checkpointId !== 'string' || !checkpointId) {
            throw new Error('保存中间结果失败：RunnableConfig.configurable 缺少 checkpoint_id');
        }
        const ns = namespaceOf(config);
        const serialized = await Promise.all(
            writes.map(async ([channel, value], index) => ({
                key: `${taskId},${WRITES_IDX_MAP[channel] ?? index}`,
                keepExisting: (WRITES_IDX_MAP[channel] ?? index) >= 0,
                write: { taskId, channel, value: await this.serialize(value) },
            })),
        );
        await this.mutate(threadId, (record) => {
            const entry = (record.namespaces[ns] ??= emptyNamespace());
            const bucket = (entry.writes[checkpointId] ??= {});
            const existing = new Set(Object.keys(bucket));
            for (const { key, keepExisting, write } of serialized) {
                // 与 MemorySaver 一致：普通写入同一位置只记第一次，错误/中断等特殊写入允许覆盖。
                if (keepExisting && existing.has(key)) continue;
                bucket[key] = write;
            }
        });
    }

    async deleteThread(threadId: string): Promise<void> {
        await this.enqueue(() => this.store.delete(threadId));
    }

    async hasThread(threadId: string): Promise<boolean> {
        const record = await this.enqueue(() => this.store.get(threadId));
        return Boolean(record && Object.values(record.namespaces).some((entry) => entry.checkpoint));
    }

    /** 删除既不在 keep 里、本次后台生命周期也没写过的线程，返回删掉的数量。 */
    async pruneThreads(keep: ReadonlySet<string>): Promise<number> {
        const ids = await this.enqueue(() => this.store.keys());
        let removed = 0;
        for (const id of ids) {
            if (keep.has(id) || this.touched.has(id)) continue;
            await this.deleteThread(id);
            removed += 1;
        }
        return removed;
    }
}
