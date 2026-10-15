//对 Radix UI 的 Label 做了一层轻封装，统一了表单标签的样式（text-xs font-medium）并
//支持传入自定义 className 的通用标签组件
import * as LabelPrimitive from '@radix-ui/react-label';
import type { ComponentProps } from 'react';
import { cn } from '@/shared/utils/utils';

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
    return (
        <LabelPrimitive.Root
            data-slot="label"
            className={cn(
                'text-xs font-medium text-ink-2 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
                className,
            )}
            {...props}
        />
    );
}