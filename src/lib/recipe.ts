import { thinkPayload } from "@/lib/think";
import type { ThinkMode } from "@/lib/types";

export interface RecipeInput {
  modelId: string;
  system: string;
  temperature?: number;
  think: ThinkMode;
  numCtx: number;
}

function splitModel(id: string) {
  const index = id.indexOf("/");
  if (index <= 0) return { provider: "ollama", name: id };
  return { provider: id.slice(0, index), name: id.slice(index + 1) };
}

/** 一段可以放进本项目 Route Handler 的草稿，按这次对比里选中的模型生成。 */
export function routeSnippet(input: RecipeInput) {
  const { provider, name } = splitModel(input.modelId);
  const think = thinkPayload(input.think);
  const effort = think === true ? "medium" : typeof think === "string" ? think : undefined;
  const system = input.system.trim();
  const temperature = input.temperature;

  if (provider === "ollama") {
    const options: Record<string, number> = { num_ctx: input.numCtx };
    if (temperature !== undefined) options.temperature = temperature;
    return `export async function POST(request: Request) {
  const { messages } = (await request.json()) as {
    messages: { role: string; content: string }[];
  };
  const system = ${JSON.stringify(system)};
  const chat = system ? [{ role: "system", content: system }, ...messages] : messages;
  const res = await fetch(\`\${process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434"}/api/chat\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ${JSON.stringify(name)},
      messages: chat,
      stream: true,
      ${think === undefined ? "" : `think: ${JSON.stringify(think)},`}
      options: ${JSON.stringify(options)},
    }),
  });
  if (!res.ok || !res.body) {
    return Response.json({ error: await res.text() }, { status: res.status || 502 });
  }
  return new Response(res.body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
`;
  }

  return `export async function POST(request: Request) {
  const { messages } = (await request.json()) as {
    messages: { role: string; content: string }[];
  };
  const system = ${JSON.stringify(system)};
  const chat = system ? [{ role: "system", content: system }, ...messages] : messages;
  const res = await fetch(process.env.${provider.toUpperCase()}_BASE_URL + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: \`Bearer \${process.env.${provider.toUpperCase()}_API_KEY}\`,
    },
    body: JSON.stringify({
      model: ${JSON.stringify(name)},
      messages: chat,
      stream: true,
      ${temperature === undefined ? "" : `temperature: ${temperature},`}
      ${effort === undefined ? "" : `reasoning_effort: ${JSON.stringify(effort)},`}
    }),
  });
  return new Response(res.body, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" },
  });
}
`;
}
