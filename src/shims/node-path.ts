// 用 path.join 把目录和文件名拼成一个完整路径
export function join(...parts: string[]): string {
    return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

export default { join };
