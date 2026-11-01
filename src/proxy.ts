import { NextResponse, type NextRequest } from "next/server";

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function deny(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

function hostnameOf(host: string) {
  return host.replace(/:\d+$/, "").toLowerCase();
}

/**
 * 这些接口能下载模型、派发会写代码的 Agent。只接受本机地址、同源请求，
 * 写操作必须是 JSON，这样跨站请求一定会触发预检并被浏览器拦下。
 */
export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!LOCAL_HOSTNAMES.has(hostnameOf(host))) {
    return deny(421, "只接受通过 127.0.0.1 或 localhost 访问");
  }

  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return deny(403, "不接受跨站请求");
  }

  const origin = request.headers.get("origin");
  if (origin !== null) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {}
    if (originHost.toLowerCase() !== host.toLowerCase()) return deny(403, "不接受跨站请求");
  }

  if (BODY_METHODS.has(request.method)) {
    const type = request.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("application/json")) {
      return deny(415, "请求必须是 application/json");
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
