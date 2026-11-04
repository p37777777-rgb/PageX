import { afterEach, describe, expect, it } from 'vitest';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { emptyCheckpoint, type Checkpoint } from '@langchain/langgraph-checkpoint';
import { resetSessionDbForTests } from '@/shared/storage/idb';
import { IdbCheckpointSaver } from './idb-saver';

const config = (thread_id: string, checkpoint_id?: string) => ({
    configurable: { thread_id, checkpoint_ns: '', ...(checkpoint_id ? { checkpoint_id } : {}) },
});

function checkpoint(id: string, messages: unknown[]): Checkpoint {
    return { ...emptyCheckpoint(), id, channel_values: { messages }, channel_versions: { messages: 1 } };
}

const metadata = { source: 'loop' as const, step: 1, parents: {} };

afterEach(async () => {
    await resetSessionDbForTests();
});

describe('IdbCheckpointSaver', () => {
    it('restores checkpoints and LangChain messages from IndexedDB in a new instance', async () => {
        const first = new IdbCheckpointSaver();
        await first.put(
            config('t1'),
            checkpoint('0001', [new HumanMessage('填表'), new AIMessage({ content: '', tool_calls: [{ id: 'c1', name: 'fill', args: { v: 1 } }] })]),
            metadata,
        );

        // 模拟后台重启：新实例只能从 IndexedDB 读到数据。
        const tuple = await new IdbCheckpointSaver().getTuple(config('t1'));
        const messages = tuple?.checkpoint.channel_values.messages as unknown[];
        expect(tuple?.config.configurable?.checkpoint_id).toBe('0001');
        expect(HumanMessage.isInstance(messages[0] as HumanMessage)).toBe(true);
        expect((messages[1] as AIMessage).tool_calls?.[0]).toMatchObject({ id: 'c1', name: 'fill', args: { v: 1 } });
        expect(tuple?.metadata).toMatchObject(metadata);
    });

    it('keeps only the latest checkpoint and links it to its parent', async () => {
        const saver = new IdbCheckpointSaver();
        const next = await saver.put(config('t1'), checkpoint('0001', []), metadata);
        await saver.put(next, checkpoint('0002', [new HumanMessage('x')]), metadata);

        const latest = await saver.getTuple(config('t1'));
        expect(latest?.checkpoint.id).toBe('0002');
        expect(latest?.parentConfig?.configurable?.checkpoint_id).toBe('0001');
        expect(await saver.getTuple(config('t1', '0001'))).toBeUndefined();
        const listed = [];
        for await (const item of saver.list(config('t1'))) listed.push(item.checkpoint.id);
        expect(listed).toEqual(['0002']);
    });

    it('returns pending writes for the latest checkpoint and drops writes of replaced ones', async () => {
        const saver = new IdbCheckpointSaver();
        const saved = await saver.put(config('t1'), checkpoint('0001', []), metadata);
        const result = new ToolMessage({ content: 'ok', tool_call_id: 'c1', name: 'fill' });
        await saver.putWrites(saved, [['messages', [result]]], 'task-1');
        // 同一位置的普通写入只记第一次，与 MemorySaver 一致。
        await saver.putWrites(saved, [['messages', [new ToolMessage({ content: 'again', tool_call_id: 'c1' })]]], 'task-1');

        const tuple = await saver.getTuple(config('t1'));
        expect(tuple?.pendingWrites).toHaveLength(1);
        const [taskId, channel, value] = tuple!.pendingWrites![0]!;
        expect([taskId, channel]).toEqual(['task-1', 'messages']);
        expect((value as ToolMessage[])[0]?.content).toBe('ok');

        await saver.put(saved, checkpoint('0002', []), metadata);
        expect((await saver.getTuple(config('t1')))?.pendingWrites).toEqual([]);
    });

    it('serializes concurrent writes from parallel tool calls without losing any', async () => {
        const saver = new IdbCheckpointSaver();
        const saved = await saver.put(config('t1'), checkpoint('0001', []), metadata);
        await Promise.all(
            ['a', 'b', 'c', 'd'].map((id) =>
                saver.putWrites(saved, [['messages', [new ToolMessage({ content: id, tool_call_id: id })]]], `task-${id}`),
            ),
        );
        expect((await saver.getTuple(config('t1')))?.pendingWrites).toHaveLength(4);
    });

    it('requires a thread id to save', async () => {
        const saver = new IdbCheckpointSaver();
        await expect(saver.put({ configurable: {} }, checkpoint('0001', []), metadata)).rejects.toThrow('thread_id');
        await expect(saver.putWrites({ configurable: { thread_id: 't1' } }, [], 'task')).rejects.toThrow('checkpoint_id');
    });

    it('deletes threads and prunes only threads that are neither kept nor written this lifetime', async () => {
        const before = new IdbCheckpointSaver();
        for (const id of ['old-a', 'old-b', 'keep']) await before.put(config(id), checkpoint('0001', []), metadata);

        const saver = new IdbCheckpointSaver();
        await saver.put(config('fresh'), checkpoint('0001', []), metadata);
        expect(await saver.pruneThreads(new Set(['keep']))).toBe(2);
        expect(await saver.hasThread('old-a')).toBe(false);
        expect(await saver.hasThread('keep')).toBe(true);
        expect(await saver.hasThread('fresh')).toBe(true);

        await saver.deleteThread('keep');
        expect(await saver.hasThread('keep')).toBe(false);
    });
});
