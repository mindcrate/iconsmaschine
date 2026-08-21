"use client";

/** Turn a data: URL from the AI generator into something FormData can send. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? "image/png";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`);
  return json as T;
}

export async function sendForm<T>(
  url: string,
  form: FormData,
  method: "POST" | "PUT" = "POST",
): Promise<T> {
  const res = await fetch(url, { method, body: form });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`);
  return json as T;
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status}).`);
  return json as T;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
