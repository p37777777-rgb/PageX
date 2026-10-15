//统一了圆角边框、聚焦环、禁用态等样式的原生 <textarea> 输入框组件
import type { ComponentProps } from 'react';
import { cn } from '@/shared/utils/utils';

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
    return (
        <textarea
            data-slot="textarea"
            className={cn(
                'flex min-h-16 w-full resize-none rounded-md border border-input bg-field px-2.5 py-2 text-sm text-ink shadow-xs',
                'placeholder:text-ink-3 focus-visible:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                'disabled:cursor-not-allowed disabled:opacity-50',
                className,
            )}
            {...props}
        />
    );
}
