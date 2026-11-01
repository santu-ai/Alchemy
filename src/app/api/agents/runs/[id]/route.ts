import type { NextRequest } from "next/server";

import { noStore, runFailure } from "@/lib/server/agents/respond";
import { discardRun, getRun } from "@/lib/server/agents/runs";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/agents/runs/[id]">) {
  const { id } = await ctx.params;
  const offset = Number(request.nextUrl.searchParams.get("offset") ?? 0) || 0;
  try {
    return noStore(await getRun(id, offset));
  } catch (error) {
    return runFailure(error);
  }
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/agents/runs/[id]">) {
  const { id } = await ctx.params;
  try {
    return noStore({ run: await discardRun(id) });
  } catch (error) {
    return runFailure(error);
  }
}
