import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAgent, tool } from 'langchain';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { resetSessionDbForTests } from '@/shared/storage/idb';
import { IdbCheckpointSaver } from './idb-saver';
import { createResumeGuardMiddleware, readResumeState } from './resume';

type Reply = AIMessage | (() => Promise<AIMessage>);

/** 按顺序返回预设回复的模型，并记下每次收到的消息。 */
class ScriptedModel extends BaseChatModel {
    calls: BaseMessage[][] = [];
    private readonly replies: Reply[];

    constructor(replies: Reply[]) {
        super({});
        this.replies = [...replies];
    }

    _llmType(): string {
        return 'scripted';
    }

    override bindTools(): this {
        return this;
    }

    async _generate(messages: BaseMessage[]): Promise<ChatResult> {
        this.calls.push(messages);
        const next = this.replies.shift();
        if (!next) throw new Error('没有预设回复');
        const message = typeof next === 'function' ? await next() : next;
        return { generations: [{ text: String(message.content), message }] };
    }
}

const never = () => new Promise<never>(() => {});
const runConfig = (thread_id: string) => ({ configurable: { thread_id }, durability: 'sync' as const });
const callTools = (...calls: Array<{ id: string; name: string }>) =>
    new AIMessage({ content: '', tool_calls: calls.map((call) => ({ ...call, args: {}, type: 'tool_call' as const })) });

function countingTool(name: string, hangOnFirstCall: boolean) {
    const counter = { calls: 0 };
    const instance = tool(
        async () => {
            counter.calls += 1;
            if (hangOnFirstCall && counter.calls === 1) await never();
            return `${name} 完成`;
        },
        { name, description: name, schema: z.object({}) },
    );
    return { tool: instance, counter };
}

afterEach(async () => {
    await resetSessionDbForTests();
});

/*
 * 用真实的 createAgent 模拟后台被回收：第一次运行卡在某一步永远不返回（相当于进程被杀，
 * 不会再写任何东西），然后用一个新的存储实例和新的 agent 从 IndexedDB 里的检查点继续。
 */
describe('resume from an IndexedDB checkpoint', () => {
    it('does not re-run a tool that was executing when the run died', async () => {
        const fill = countingTool('fill', true);
        const first = new ScriptedModel([callTools({ id: 'c1', name: 'fill' })]);
        void createAgent({ model: first, tools: [fill.tool], checkpointer: new IdbCheckpointSaver() })
            .invoke({ messages: [new HumanMessage('填写报名表')] }, runConfig('t1'))
            .catch(() => undefined);
        await vi.waitFor(() => expect(fill.counter.calls).toBe(1));

        const saver = new IdbCheckpointSaver();
        const state = await readResumeState(saver, 't1');
        expect(state).toEqual({ interruptedToolCallIds: ['c1'], rerunsModel: false });

        const second = new ScriptedModel([new AIMessage('已确认表单状态，报名完成')]);
        const result = await createAgent({
            model: second,
            tools: [fill.tool],
            checkpointer: saver,
            middleware: [createResumeGuardMiddleware(state!.interruptedToolCallIds)],
        }).invoke(null, runConfig('t1'));

        expect(fill.counter.calls).toBe(1);
        const seen = second.calls[0]!;
        expect(String(seen[0]?.content)).toContain('resume_notice');
        const interrupted = seen.find((message) => ToolMessage.isInstance(message)) as ToolMessage | undefined;
        expect(interrupted?.tool_call_id).toBe('c1');
        expect(String(interrupted?.content)).toContain('无法确认');
        expect(result.messages.at(-1)?.content).toBe('已确认表单状态，报名完成');
    });

    it('keeps finished parallel tool results and only stubs the unfinished one', async () => {
        const read = countingTool('read_page', false);
        const fill = countingTool('fill', true);
        const first = new ScriptedModel([callTools({ id: 'r1', name: 'read_page' }, { id: 'f1', name: 'fill' })]);
        const saver = new IdbCheckpointSaver();
        void createAgent({ model: first, tools: [read.tool, fill.tool], checkpointer: saver })
            .invoke({ messages: [new HumanMessage('读页面并填写')] }, runConfig('t2'))
            .catch(() => undefined);
        await vi.waitFor(async () => {
            expect((await readResumeState(saver, 't2'))?.interruptedToolCallIds).toEqual(['f1']);
        });

        const second = new ScriptedModel([new AIMessage('完成')]);
        await createAgent({
            model: second,
            tools: [read.tool, fill.tool],
            checkpointer: new IdbCheckpointSaver(),
            middleware: [createResumeGuardMiddleware(['f1'])],
        }).invoke(null, runConfig('t2'));

        expect(read.counter.calls).toBe(1);
        expect(fill.counter.calls).toBe(1);
        const results = second.calls[0]!.filter((message) => ToolMessage.isInstance(message)) as ToolMessage[];
        expect(results.map((message) => [message.tool_call_id, message.status])).toEqual(
            expect.arrayContaining([['r1', 'success'], ['f1', 'error']]),
        );
    });

    it('re-runs the model call when the run died while waiting for the model', async () => {
        const first = new ScriptedModel([never]);
        void createAgent({ model: first, tools: [], checkpointer: new IdbCheckpointSaver() })
            .invoke({ messages: [new HumanMessage('总结页面')] }, runConfig('t3'))
            .catch(() => undefined);
        await vi.waitFor(() => expect(first.calls).toHaveLength(1));

        const saver = new IdbCheckpointSaver();
        const state = await readResumeState(saver, 't3');
        expect(state).toEqual({ interruptedToolCallIds: [], rerunsModel: true });

        const second = new ScriptedModel([new AIMessage('页面摘要')]);
        const result = await createAgent({
            model: second,
            tools: [],
            checkpointer: saver,
            middleware: [createResumeGuardMiddleware([])],
        }).invoke(null, runConfig('t3'));

        expect(second.calls).toHaveLength(1);
        expect(second.calls[0]!.some((message) => message.content === '总结页面')).toBe(true);
        expect(result.messages.at(-1)?.content).toBe('页面摘要');
    });

    it('reports no resume state for an unknown thread', async () => {
        expect(await readResumeState(new IdbCheckpointSaver(), 'missing')).toBeNull();
    });
});
