export function stripDataUrl(value: string) {
  const comma = value.indexOf(",");
  if (value.startsWith("data:") && comma >= 0) return value.slice(comma + 1);
  return value;
}

export function mediaTypeOf(value: string) {
  const match = /^data:([^;,]+)[;,]/i.exec(value);
  return match?.[1] || "image/png";
}

export function ensureDataUrl(value: string) {
  if (value.startsWith("data:")) return value;
  return `data:image/png;base64,${value}`;
}
