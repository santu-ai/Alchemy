"use client";

import { SlidersHorizontalIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_SETTINGS, readSettings, settingsStore, type ChatSettings } from "@/lib/client/chat-store";
import { useLocalStore } from "@/lib/client/local-store";
import { useModels } from "@/lib/client/use-api";
import { CONTEXT_OPTIONS } from "@/lib/context";
import { formatContext } from "@/lib/format";
import { thinkLabel } from "@/lib/think";
import type { ThinkMode } from "@/lib/types";

const BASE_THINK: { value: ThinkMode; label: string }[] = [
  { value: "default", label: "跟随模型默认" },
  { value: "on", label: "开启思考" },
  { value: "off", label: "关闭思考" },
];

const SYSTEM_PRESETS = [
  { label: "简洁助手", value: "你是一个简洁、准确的中文助手。回答先给结论，再给必要的理由。" },
  { label: "编程导师", value: "你是一名资深软件工程师。解释代码时给出可运行的示例，并指出常见坑。" },
  { label: "产品经理", value: "你是一名经验丰富的 AI 产品经理。帮助用户把想法拆成用户场景、核心功能和验证方式。" },
];

export function SettingsSheet() {
  const stored = useLocalStore(settingsStore);
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  const { data } = useModels();
  const selected = data?.models.find((model) => model.id === settings.model);
  const levels = (selected?.thinkingValues ?? []).filter((value): value is string => typeof value === "string");
  const thinkOptions = [
    BASE_THINK[0],
    ...levels
      .filter((level) => level !== "on" && level !== "off")
      .map((level) => ({ value: level, label: `思考档 ${thinkLabel(level)}` })),
    ...BASE_THINK.slice(1),
  ];
  const update = (patch: Partial<ChatSettings>) => settingsStore.set((prev) => ({ ...readSettings(), ...prev, ...patch }));

  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" size="sm" />}>
        <SlidersHorizontalIcon />
        <span className="hidden sm:inline">参数</span>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>对话参数</SheetTitle>
          <SheetDescription>这些设置对所有对话生效，保存在本机浏览器里。</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-6">
          <div className="flex flex-col gap-2">
            <Label htmlFor="system-prompt">系统提示词</Label>
            <Textarea
              id="system-prompt"
              value={settings.system}
              onChange={(event) => update({ system: event.target.value })}
              placeholder="例如：你是一名耐心的中文助手。"
              className="min-h-28"
            />
            <div className="flex flex-wrap gap-1.5">
              {SYSTEM_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  variant="secondary"
                  size="xs"
                  onClick={() => update({ system: preset.value })}
                >
                  {preset.label}
                </Button>
              ))}
              {settings.system ? (
                <Button variant="ghost" size="xs" onClick={() => update({ system: "" })}>
                  清空
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="temperature-switch">自定义温度</Label>
              <Switch
                id="temperature-switch"
                checked={settings.temperatureEnabled}
                onCheckedChange={(checked) => update({ temperatureEnabled: checked })}
              />
            </div>
            <div className="flex items-center gap-3">
              <Slider
                value={[settings.temperature]}
                min={0}
                max={2}
                step={0.1}
                disabled={!settings.temperatureEnabled}
                onValueChange={(value) => update({ temperature: Array.isArray(value) ? value[0] : value })}
                aria-label="温度"
              />
              <span className="w-8 text-right text-sm tabular-nums">{settings.temperature.toFixed(1)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              越低越稳定，越高越有创意。关闭时使用模型自己的默认值，部分推理模型不支持修改温度。
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>思考模式</Label>
            <Select
              items={thinkOptions}
              value={settings.think}
              onValueChange={(value) => value && update({ think: value })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {thinkOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {selected?.thinkingValues?.length
                ? `这个模型声明的档位：${selected.thinkingValues.map(thinkLabel).join(" / ")}，默认 ${thinkLabel(selected.thinkingDefault ?? "default")}。`
                : "档位来自 Ollama 的 /api/show。云端模型会把 low / medium / high 转成 reasoning_effort；不支持的模型请保持默认。"}
              {selected?.contextLength ? ` 模型窗口 ${formatContext(selected.contextLength)}。` : ""}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>上下文长度</Label>
            <Select
              items={CONTEXT_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
              value={String(settings.numCtx)}
              onValueChange={(value) => value && update({ numCtx: Number(value) })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {CONTEXT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              只对本地 Ollama 生效。36 GB 机器的默认档是 32k，开到 64k 会多占内存。模型主页上的 256k 不会自动生效。
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="tools-switch">本地工具</Label>
              <p className="text-xs text-muted-foreground">当前时间，以及读取这次附上的文本。只对 Ollama 生效。</p>
            </div>
            <Switch id="tools-switch" checked={settings.tools} onCheckedChange={(checked) => update({ tools: checked })} />
          </div>

          <Button variant="ghost" size="sm" className="self-start" onClick={() => settingsStore.set({ ...DEFAULT_SETTINGS, model: settings.model })}>
            恢复默认
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
