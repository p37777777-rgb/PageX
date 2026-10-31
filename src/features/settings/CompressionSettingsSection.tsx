import { useEffect, useState } from 'react';
import { Button } from '@/shared/ui/beui/button';
import { Input } from '@/shared/ui/beui/input';
import { Switch } from '@/shared/ui/beui/switch';
import { Label } from '@/shared/ui/label';
import { rpc } from '@/shared/extension/rpc-client';
import {
    clampCompressionTrigger,
    COMPRESSION_TRIGGER_LIMITS,
    defaultCompressionModel,
    PROVIDER_PRESETS,
    type AgentSettings,
    type AgentSettingsPatch,
    type CompressionSettings,
    type CompressionTestResult,
} from '@/shared/contracts/settings';

//前文压缩设置：开关、当前服务商下的压缩模型（留空自动选择）、触发阈值，以及测试压缩模型是否可用。
//模型名和阈值在失焦或回车时才保存，避免逐字保存时被清洗后的值打断输入。
export function CompressionSettingsSection({
                                               settings,
                                               onPatch,
                                           }: {
    settings: AgentSettings;
    onPatch: (patch: AgentSettingsPatch) => Promise<void>;
}) {
    const compression = settings.compression;
    const provider = settings.model.provider;
    const savedModel = compression.models[provider] ?? '';
    const [model, setModel] = useState(savedModel);
    const [trigger, setTrigger] = useState(String(compression.triggerTokens));
    const [status, setStatus] = useState('');
    const [testing, setTesting] = useState(false);

    useEffect(() => setModel(savedModel), [provider, savedModel]);
    useEffect(() => setTrigger(String(compression.triggerTokens)), [compression.triggerTokens]);

    const patchCompression = (patch: Partial<CompressionSettings>) =>
        onPatch({ compression: { ...compression, ...patch } });

    const commitModel = async () => {
        const next = model.trim();
        setModel(next);
        if (next === savedModel) return;
        const models = { ...compression.models };
        if (next) models[provider] = next;
        else delete models[provider];
        await patchCompression({ models });
    };

    const commitTrigger = async () => {
        const parsed = Number(trigger.replace(/[,，_\s]/g, ''));
        if (!Number.isFinite(parsed)) {
            setTrigger(String(compression.triggerTokens));
            return;
        }
        const next = clampCompressionTrigger(parsed);
        setTrigger(String(next));
        if (next !== compression.triggerTokens) await patchCompression({ triggerTokens: next });
    };

    const testCompressionModel = async () => {
        setTesting(true);
        setStatus('正在测试压缩模型…');
        try {
            await commitModel();
            const result = (await rpc('compression.test', {})) as CompressionTestResult;
            if (!result.ok) {
                setStatus(`压缩模型均不可用：${(result.errors ?? []).join('；')}`);
            } else if (result.fallback) {
                setStatus(`首选模型不可用，已回退到 ${result.model}（关闭思考）`);
            } else {
                setStatus(`压缩模型可用：${result.model}`);
            }
        } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error));
        } finally {
            setTesting(false);
        }
    };

    const autoModel = defaultCompressionModel(provider) ?? settings.model.model;

    return (
        <section className="space-y-2.5 rounded-card border border-line bg-surface p-3">
            <h3 className="text-xs font-semibold tracking-wide text-ink-2">前文压缩</h3>
            <div className="flex items-center justify-between gap-3">
                <Label className="min-w-0 flex-1 leading-5 text-ink-2">上下文过长时自动压缩前文</Label>
                <Switch
                    checked={compression.enabled}
                    onCheckedChange={(enabled) => void patchCompression({ enabled })}
                    aria-label="上下文过长时自动压缩前文"
                />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="compression-model">压缩模型（{PROVIDER_PRESETS[provider].label}）</Label>
                <Input
                    id="compression-model"
                    value={model}
                    disabled={!compression.enabled}
                    onValueChange={setModel}
                    onBlur={() => void commitModel()}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') void commitModel();
                    }}
                    placeholder={`留空自动选择：${autoModel}`}
                />
                <p className="text-[11.5px] leading-5 text-ink-3">
                    使用当前服务商的 API Key 和地址。指定的模型不可用时，会改用当前对话模型并关闭思考来压缩。
                </p>
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="compression-trigger">触发阈值（估算 token 数）</Label>
                <Input
                    id="compression-trigger"
                    inputMode="numeric"
                    value={trigger}
                    disabled={!compression.enabled}
                    onValueChange={setTrigger}
                    onBlur={() => void commitTrigger()}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') void commitTrigger();
                    }}
                />
                <p className="text-[11.5px] leading-5 text-ink-3">
                    范围 {COMPRESSION_TRIGGER_LIMITS.min.toLocaleString()}～{COMPRESSION_TRIGGER_LIMITS.max.toLocaleString()}。
                    上下文窗口较小的模型（如本地 Ollama）请调低。
                </p>
            </div>
            <Button
                size="sm"
                variant="outline"
                disabled={!compression.enabled || testing}
                onClick={() => void testCompressionModel()}
            >
                {testing ? '测试中…' : '测试压缩模型'}
            </Button>
            {status && <p className="text-[11.5px] leading-5 text-ink-2">{status}</p>}
        </section>
    );
}
