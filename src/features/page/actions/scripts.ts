//只读脚本：提取链接、标题、表单结构、可交互元素
import { pageObserver } from '../observer';
import { getRememberedSelection } from '../selection';
import type { NamedScript, ObservationScope } from '@/shared/contracts/page';

export function runNamedScript(
    name: NamedScript,
    options: { scope?: ObservationScope } = {},
) {
    switch (name) {
        //提取链接
        case 'extract_links':
            return Array.from(document.links)
                .slice(0, 80)
                .map((link) => ({ text: link.textContent?.trim(), href: link.href }));//
        //提取标题层级
        case 'extract_headings':
            return Array.from(document.querySelectorAll('h1,h2,h3,h4')).map((node) => ({
                tag: node.tagName.toLowerCase(),
                text: node.textContent?.trim(),
            }));
        //提取表单结构
        case 'extract_forms':
            return Array.from(document.forms).map((form, index) => ({
                index,
                action: form.action,
                method: form.method,
                fields: Array.from(form.elements).map((el) => ({
                    tag: el.tagName.toLowerCase(),
                    name: (el as HTMLInputElement).name,
                    type: (el as HTMLInputElement).type,
                })),
            }));
        //提取可交互元素
        case 'extract_interactions': {
            const observation = pageObserver.observe(document, 400, options.scope);
            return {
                url: observation.url,
                title: observation.title,
                revision: observation.revision,
                scope: observation.scope,
                scopeReason: observation.scopeReason,
                fallbackApplied: observation.fallbackApplied,
                interactionContext: observation.interactionContext,
                total: observation.totalElements,
                truncated: observation.truncated,
                elements: observation.elements.filter((element) => element.actionable),
            };
        }
        //提取页面元信息
        case 'extract_meta':
            return {
                title: document.title,
                description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
                language: document.documentElement.lang,
                canonical: (document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null)?.href,
            };
        //页面统计
        case 'page_stats':
            return {
                url: location.href,
                buttons: document.querySelectorAll('button').length,
                links: document.links.length,
                inputs: document.querySelectorAll('input,textarea,select').length,
                images: document.images.length,
                textLength: document.body.innerText.length,
            };
        //读取用户选中文本
        case 'get_selection':
            return { selection: getRememberedSelection() };
        default:
            throw new Error(`未知命名脚本：${name}`);
    }
}
