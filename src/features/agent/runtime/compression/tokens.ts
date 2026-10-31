/*上下文 token 估算。只用于判断是否需要压缩、压缩到多大，不追求精确。
langchain 自带的估算按 4 字符 = 1 token 计，中文会严重低估，所以这里把 CJK 字符单独按 1 token 计。*/
import { ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { contentText, countImageParts, toolCallsText } from './content';

/** 每条消息的角色、分隔符等固定开销。 */
const MESSAGE_OVERHEAD_TOKENS = 4;
/** 一张图片按常见视觉模型的中等分辨率估算。 */
const IMAGE_TOKENS = 1_000;

function isWideChar(code: number): boolean {
    return (
        (code >= 0x2e80 && code <= 0x9fff) // CJK 部首、符号、假名、统一汉字
        || (code >= 0xac00 && code <= 0xd7af) // 韩文音节
        || (code >= 0xf900 && code <= 0xfaff) // CJK 兼容汉字
        || (code >= 0xff00 && code <= 0xffef) // 全角符号
        || code >= 0x20000 // 扩展区汉字
    );
}

export function estimateTextTokens(text: string): number {
    if (!text) return 0;
    let wide = 0;
    let narrow = 0;
    for (const char of text) {
        if (isWideChar(char.codePointAt(0) ?? 0)) wide += 1;
        else narrow += 1;
    }
    return wide + Math.ceil(narrow / 4);
}

export function estimateMessageTokens(message: BaseMessage): number {
    let text = contentText(message.content) + toolCallsText(message);
    if (ToolMessage.isInstance(message)) text += message.tool_call_id ?? '';
    return MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(text) + countImageParts(message.content) * IMAGE_TOKENS;
}

export function estimateMessagesTokens(messages: readonly BaseMessage[]): number {
    return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}
