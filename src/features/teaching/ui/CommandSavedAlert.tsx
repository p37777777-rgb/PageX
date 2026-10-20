import { IconCheck } from '@tabler/icons-react';
import type { SavedCommand } from '@/shared/contracts/teaching';
import { AnimatedToastStack } from '@/shared/ui/beui/animated-toast-stack';
//**「命令已保存」成功提示**小组件——教学功能里，
//当用户把录制的操作固化成一条可复用命令后，用它弹出一条成功通知。
export function CommandSavedAlert({ command }: { command: SavedCommand }) {
    return (
        <AnimatedToastStack
            placement="static"
            className="max-w-none"
            toasts={[
                {
                    id: `saved-${command.key}`,
                    title: '命令已保存',
                    description: (
                        <span>
              已固化到当前网站 Vault · <code className="font-mono text-foreground">/{command.key}</code>
            </span>
                    ),
                    status: 'success',
                    icon: <IconCheck size={14} />,
                    dismissible: false,
                },
            ]}
        />
    );
}
