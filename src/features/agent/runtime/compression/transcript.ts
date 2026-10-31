/*把要压缩的消息排成纯文本记录交给压缩模型。
工具输出（尤其整页快照）最占空间，所以先逐级截短单条消息；仍然超出预算时，
保留开头的用户目标和最近的消息，省略中间部分。*/
import { AIMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { contentText, countImageParts, toolCallsText } from './content';
import { isSummaryMessage } from './compaction';
import { estimateTextTokens } from './tokens';

/** 截图常以 data URL 文本出现在工具结果里，原样交给压缩模型毫无意义。 */
const DATA_URL_PATTERN = /data:[\w.+-]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g;

type ClipLimits = { tool: number; other: number };

/** 逐级收紧的单条消息长度上限（字符数）。 */
const CLIP_STEPS: readonly ClipLimits[] = [
    { tool: 6_000, other: 12_000 },
    { tool: 2_000, other: 6_000 },
    { tool: 600, other: 2_000 },
    { tool: 200, other: 800 },
];

/** 保留首尾、省略中间：工具输出的结论和用户请求的要点常在两端。 */
export function clipMiddle(text: string, limit: number): string {
    if (text.length <= limit) return text;
    const head = Math.ceil(limit * 0.6);
    const tail = Math.max(0, limit - head);
    return `${text.slice(0, head)}…（省略 ${text.length - head - tail} 字）…${text.slice(text.length - tail)}`;
}

function messageLine(message: BaseMessage, limits: ClipLimits): string {
    if (SystemMessage.isInstance(message)) return '';
    const raw = contentText(message.content).replace(DATA_URL_PATTERN, '[图片]');
    const images = countImageParts(message.content);
    const imageNote = images ? ` [附图 ${images} 张]` : '';
    if (ToolMessage.isInstance(message)) {
        const name = message.name ? ` ${message.name}` : '';
        return `Tool${name}: ${clipMiddle(raw, limits.tool)}${imageNote}`;
    }
    if (AIMessage.isInstance(message)) {
        const calls = toolCallsText(message);
        const parts = [clipMiddle(raw, limits.other), calls && `[调用工具] ${clipMiddle(calls, limits.tool)}`];
        return `AI: ${parts.filter(Boolean).join('\n')}`;
    }
    // 旧摘要本身就是浓缩过的信息，按更宽的上限保留。
    if (isSummaryMessage(message)) return `Human（含此前摘要）: ${clipMiddle(raw, limits.other * 2)}${imageNote}`;
    return `Human: ${clipMiddle(raw, limits.other)}${imageNote}`;
}

function render(messages: readonly BaseMessage[], limits: ClipLimits): string[] {
    return messages.map((message) => messageLine(message, limits)).filter(Boolean);
}

/** 生成不超过 budgetTokens 的记录文本。 */
export function formatTranscript(messages: readonly BaseMessage[], budgetTokens: number): string {
    let lines: string[] = [];
    for (const limits of CLIP_STEPS) {
        lines = render(messages, limits);
        const text = lines.join('\n\n');
        if (estimateTextTokens(text) <= budgetTokens) return text;
    }
    return keepEnds(lines, budgetTokens);
}

/** 最后手段：第一条（用户目标或旧摘要）加上尽量多的最近消息。 */
function keepEnds(lines: string[], budgetTokens: number): string {
    if (!lines.length) return '';
    const first = lines[0]!;
    let remaining = budgetTokens - estimateTextTokens(first);
    const recent: string[] = [];
    for (let index = lines.length - 1; index > 0; index -= 1) {
        const cost = estimateTextTokens(lines[index]!);
        if (cost > remaining) break;
        recent.unshift(lines[index]!);
        remaining -= cost;
    }
    const omitted = lines.length - 1 - recent.length;
    const marker = omitted > 0 ? [`…（中间省略 ${omitted} 条消息）…`] : [];
    return [first, ...marker, ...recent].join('\n\n');
}
