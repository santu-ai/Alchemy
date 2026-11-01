import "server-only";

import { RunError } from "./runs";

export function runFailure(error: unknown) {
  const status = error instanceof RunError ? error.status : 500;
  return Response.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function noStore(body: unknown) {
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
