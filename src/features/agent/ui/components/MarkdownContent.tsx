import { renderMarkdown } from '@/shared/utils/markdown';
import { cn } from '@/shared/utils/utils';
//Markdown 文本渲染成 HTML 的展示组件——用在 AI 回复的地方（助手消息）
export function MarkdownContent({
                                    text,
                                    streaming,
                                }: {
    text: string;
    streaming?: boolean;
}) {
    return (
        <div
            className={cn(
                'pagex-md',
                streaming && 'is-streaming',
            )}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
        />
    );
}
