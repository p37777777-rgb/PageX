import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
//拼成字符串并解决tailwind问题合并 className
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
//生成可读前缀的唯一 ID，格式 前缀_随机段+时间戳段
export function nowId(prefix = 'id'): string {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
//字符串过长截断加...
export function truncate(text: string, max = 4000): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max)}…`;
}
//输出带换行缩进
export function safeJson(value: unknown, max = 8000): string {
    try {
        return truncate(JSON.stringify(value, null, 2), max);
    } catch {
        return String(value);
    }
}
//解析 URL 返回 origin,非法 URL 返回 null
export function originOf(url: string): string | null {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
}
