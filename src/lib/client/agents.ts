"use client";

export async function sendJson<T>(url: string, method: "POST" | "DELETE", body: unknown = {}) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `请求失败（${res.status}）`);
  return data;
}
