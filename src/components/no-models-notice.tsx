import Link from "next/link";
import { InfoIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ModelsResponse } from "@/lib/types";

export function NoModelsNotice({ data }: { data?: ModelsResponse }) {
  if (!data) return null;
  const real = data.models.filter((m) => m.provider !== "demo" && !/embed/i.test(m.name));
  if (real.length > 0) return null;
  const ollamaDown = data.errors.some((e) => e.provider === "ollama");

  return (
    <Alert>
      <InfoIcon />
      <AlertTitle>{ollamaDown ? "Ollama 没有连接上" : "还没有可用的真实模型"}</AlertTitle>
      <AlertDescription>
        现在只能使用演示模型。
        {ollamaDown ? "请先打开 Ollama 应用，" : ""}
        到
        <Link href="/models" className="mx-1 font-medium text-foreground underline underline-offset-4">
          模型管理
        </Link>
        下载本地模型，或在 <code className="rounded bg-muted px-1">.env.local</code> 里配置云端 API Key。
      </AlertDescription>
    </Alert>
  );
}
