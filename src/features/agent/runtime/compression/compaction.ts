/*决定压缩哪一段、保留哪一段，并把摘要和保留的消息重新拼成合法的消息序列。
只做纯计算，不调用模型，方便单测各种边界情况。*/
import {
    HumanMessage,
    RemoveMessage,
    ToolMessage,
    type BaseMessage,
    type MessageContent,
} from '@langchain/core/messages';
import { buildContextSummaryBlock } from '@/features/agent/runtime/prompts';
import { nowId } from '@/shared/utils/utils';
import { prependText } from './content';
import { estimateMessageTokens, estimateMessagesTokens } from './tokens';

/**
 * LangGraph messagesStateReducer 的“全部删除”标记（@langchain/langgraph 的 REMOVE_ALL_MESSAGES）。
 * langgraph 只是 langchain 的间接依赖，这里固定成同一个值，避免为一个常量引入直接依赖。
 */
export const REMOVE_ALL_MESSAGES = '__remove_all__';

/** 写在摘要消息 additional_kwargs 里的来源标记；各服务商的消息转换都不会把它发出去。 */
const SUMMARY_SOURCE = 'pagex-compression';

export function isSummaryMessage(message: BaseMessage): boolean {
    return HumanMessage.isInstance(message) && message.additional_kwargs?.lc_source === SUMMARY_SOURCE;
}

export type CompactionPlan = {
    /** 要交给压缩模型总结的早期消息。 */
    head: BaseMessage[];
    /** 原样保留的最近消息，第一条一定不是孤立的工具结果。 */
    tail: BaseMessage[];
    headTokens: number;
};

/**
 * 从后往前保留不超过 keepTokens 的最近消息，其余作为 head。
 * 切点不会落在工具结果上，否则保留段会出现找不到对应调用的 ToolMessage，各家接口都会报错。
 * 至少保留最后一条消息；head 为空时返回 null。
 */
export function planCompaction(messages: readonly BaseMessage[], keepTokens: number): CompactionPlan | null {
    if (messages.length < 2) return null;
    let cut = messages.length - 1;
    let kept = estimateMessageTokens(messages[cut]!);
    while (cut > 0) {
        const cost = estimateMessageTokens(messages[cut - 1]!);
        if (kept + cost > keepTokens) break;
        kept += cost;
        cut -= 1;
    }
    while (cut > 0 && ToolMessage.isInstance(messages[cut])) cut -= 1;
    if (cut <= 0) return null;
    const head = messages.slice(0, cut);
    return { head, tail: messages.slice(cut), headTokens: estimateMessagesTokens(head) };
}

export type CompactionResult = {
    /** 作为 beforeModel 的状态更新返回：先清空，再写入新序列。 */
    update: BaseMessage[];
    /** 新序列开头的消息：摘要块加上被它取代的那条用户消息原文。 */
    opener: HumanMessage;
    /** opener 合并前的用户消息原文；下次压缩时用它取回原话，避免旧摘要被一层层嵌套。 */
    openerOriginal?: MessageContent;
};

/**
 * 把摘要和保留段拼成新的消息序列。新序列总以一条用户消息开头（部分服务商要求），
 * 并且用户本轮的原始请求总是原样保留，不被摘要改写：
 * - 保留段以用户消息开头：摘要并入这条消息；
 * - 保留段里没有用户消息：取 head 中最后一条用户消息，摘要并入它；
 * - 其他情况：摘要单独成为一条用户消息。
 */
export function buildCompactedMessages(
    plan: CompactionPlan,
    summary: string,
    originalContent: (message: BaseMessage) => MessageContent = (message) => message.content as MessageContent,
): CompactionResult {
    let rest = plan.tail;
    let anchor: BaseMessage | undefined;
    if (HumanMessage.isInstance(plan.tail[0])) {
        anchor = plan.tail[0];
        rest = plan.tail.slice(1);
    } else if (!plan.tail.some((message) => HumanMessage.isInstance(message))) {
        anchor = plan.head.findLast((message) => HumanMessage.isInstance(message));
    }

    const block = buildContextSummaryBlock(summary);
    const openerOriginal = anchor ? originalContent(anchor) : undefined;
    const opener = new HumanMessage({
        id: nowId('summary'),
        content: openerOriginal === undefined ? block : prependText(openerOriginal, block),
        additional_kwargs: { lc_source: SUMMARY_SOURCE },
    });
    return {
        update: [new RemoveMessage({ id: REMOVE_ALL_MESSAGES }), opener, ...rest],
        opener,
        openerOriginal,
    };
}
