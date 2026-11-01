import { connection } from "next/server";

import { listCloudModels } from "@/lib/server/cloud-models";
import { enrichOllamaModels, listOllamaModels } from "@/lib/server/ollama";
import { getProviders, publicProvider } from "@/lib/server/providers";
import type { ModelInfo, ModelsResponse } from "@/lib/types";

export async function GET() {
  await connection();
  const providers = getProviders();
  const errors: ModelsResponse["errors"] = [];

  const results = await Promise.all(
    providers
      .filter((p) => p.configured)
      .map(async (provider): Promise<ModelInfo[]> => {
        try {
          if (provider.kind === "ollama") return await enrichOllamaModels(await listOllamaModels());
          if (provider.kind === "demo") {
            return [
              {
                id: "demo/workbench-demo",
                provider: "demo",
                providerLabel: provider.label,
                name: "演示模型",
                local: true,
              },
            ];
          }
          return await listCloudModels(provider);
        } catch (error) {
          errors.push({
            provider: provider.id,
            message: error instanceof Error ? error.message : String(error),
          });
          return [];
        }
      }),
  );

  const body: ModelsResponse = {
    models: results.flat(),
    providers: providers.map(publicProvider),
    errors,
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
