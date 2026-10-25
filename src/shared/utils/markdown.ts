import DOMPurify from 'dompurify';
import { Marked, Renderer } from 'marked';
//防注入
function escapeAttr(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
//只允许 http(s):、mailto:
function safeHref(href: string | null | undefined): string | null {
    if (!href) return null;
    const trimmed = href.trim();
    return /^(https?:|mailto:|#)/i.test(trimmed) ? trimmed : null;
}
//把表格行按 | 拆成单元格
function tableCells(line: string): string[] {
    const trimmed = line.trim();
    if (!trimmed.includes('|')) return [];
    const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
    return inner.split('|').map((cell) => cell.trim());
}
//判断是否是代码围栏行
function isFenceLine(line: string): boolean {
    return /^(```|~~~)/.test(line.trim());
}
//检查一行是否是有效的 Markdown 表格分隔行，确保每个单元格都是由短横线和可选的冒号组成的
//方便解析
function isDelimiterRow(line: string): boolean {
    //一行文本分割成表格单元格
    const cells = tableCells(line);
    return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell.replaceAll(' ', '')));
}
//修复不规范的 Markdown 表格
/*
| 姓名 | 年龄 | 城市 |          ->| 姓名 | 年龄 | 城市 |
| --- | --- |                   | --- | --- | --- |
 */
export function normalizeGfmTables(source: string): string {
    const lines = source.replaceAll('\r\n', '\n').split('\n');
    let inFence = false;
    for (let index = 0; index < lines.length - 1; index += 1) {
        const line = lines[index]!;
        if (isFenceLine(line)) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;
        const delimiter = lines[index + 1]!;
        if (!line.includes('|') || !isDelimiterRow(delimiter)) continue;
        const columns = tableCells(line).length;
        if (columns === 0) continue;
        const cells = tableCells(delimiter);
        if (cells.length === columns) continue;
        while (cells.length < columns) cells.push('---');
        cells.length = columns;
        lines[index + 1] = `|${cells.map((cell) => cell || '---').join('|')}|`;
    }
    return lines.join('\n');
}
//把每种 token转成html
const defaultRenderer = new Renderer();

const marked = new Marked({
    //同步解析，直接返回promise
    async: false,
    gfm: true,
    breaks: true,
    silent: true,
    renderer: {
        html({ text }) {
            return escapeAttr(text);
        },
        link({ href, title, tokens }) {
            const label = this.parser.parseInline(tokens);
            const url = safeHref(href);
            if (!url) return label;
            const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
            return `<a href="${escapeAttr(url)}"${titleAttr} target="_blank" rel="noreferrer noopener">${label}</a>`;
        },
        image({ href, title, text }) {
            const url = safeHref(href);
            if (!url) return escapeAttr(text);
            const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
            return `<img src="${escapeAttr(url)}" alt="${escapeAttr(text)}"${titleAttr} />`;
        },
        table(token) {
            return `<div class="pagex-md-table">${defaultRenderer.table.call(this, token)}</div>`;
        },
    },
});

export function renderMarkdown(source: string): string {
    const html = marked.parse(normalizeGfmTables(source ?? ''), { async: false });
    return DOMPurify.sanitize(typeof html === 'string' ? html : '', {
        USE_PROFILES: { html: true },
        ADD_ATTR: ['target', 'rel'],
    });
}
