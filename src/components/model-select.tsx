"use client";

import { useMemo } from "react";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ModelInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

export function chatModels(models: ModelInfo[] = []) {
  return models.filter((m) => !/embed/i.test(m.name));
}

export function pickDefaultModel(models: ModelInfo[], preferred?: string) {
  const usable = chatModels(models);
  if (preferred && usable.some((m) => m.id === preferred)) return preferred;
  return (usable.find((m) => m.provider === "ollama") ?? usable.find((m) => m.provider !== "demo") ?? usable[0])?.id;
}

export function ModelSelect({
  models,
  value,
  onChange,
  className,
  disabled,
  placeholder = "选择模型",
}: {
  models: ModelInfo[];
  value?: string;
  onChange: (id: string) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const usable = useMemo(() => chatModels(models), [models]);
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: ModelInfo[] }>();
    for (const model of usable) {
      const group = map.get(model.provider) ?? { label: model.providerLabel, items: [] };
      group.items.push(model);
      map.set(model.provider, group);
    }
    return [...map.values()];
  }, [usable]);
  const items = useMemo(() => usable.map((m) => ({ value: m.id, label: m.name })), [usable]);

  return (
    <Select
      items={items}
      value={value ?? null}
      onValueChange={(next) => next && onChange(next as string)}
      disabled={disabled || usable.length === 0}
    >
      <SelectTrigger className={cn("min-w-44 max-w-full", className)} aria-label="模型">
        <SelectValue placeholder={usable.length === 0 ? "暂无可用模型" : placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} className="max-h-80 min-w-56">
        {groups.map((group) => (
          <SelectGroup key={group.label}>
            <SelectLabel>{group.label}</SelectLabel>
            {group.items.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                <span className="truncate">{model.name}</span>
                {model.parameterSize ? (
                  <span className="text-xs text-muted-foreground">{model.parameterSize}</span>
                ) : null}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
