/**
 * Image search via SerpAPI's Google Images engine.
 *
 * The key is read from the server environment only - it is never sent to the
 * browser. Results are returned as metadata; the bytes are fetched separately
 * through `fetchRemoteImage` so every download goes through one guarded path.
 */

export interface ImageHit {
  title: string;
  /** Small preview, safe to show directly in the browser. */
  thumbnail: string;
  /** Full-size original, fetched server-side when chosen. */
  original: string;
  width: number | null;
  height: number | null;
  source: string;
}

export class MissingSerpKeyError extends Error {
  constructor() {
    super(
      "No SERPAPI_API_KEY found. Add it to .env.local and restart the app, or upload artwork instead.",
    );
    this.name = "MissingSerpKeyError";
  }
}

const ENDPOINT = "https://serpapi.com/search.json";

export interface SearchOptions {
  query: string;
  /** Google's "transparent background" filter. */
  transparent?: boolean;
  /** Bias toward large images, which survive the 1280px banners. */
  large?: boolean;
  limit?: number;
}

export async function searchImages(opts: SearchOptions): Promise<ImageHit[]> {
  const key = process.env.SERPAPI_API_KEY;
  if (!key) throw new MissingSerpKeyError();

  // tbs stacks Google's image filters: ic:trans = transparent, isz:l = large.
  const filters: string[] = [];
  if (opts.transparent) filters.push("ic:trans");
  if (opts.large) filters.push("isz:l");

  const url = new URL(ENDPOINT);
  url.searchParams.set("engine", "google_images");
  url.searchParams.set("q", opts.query);
  url.searchParams.set("api_key", key);
  if (filters.length) url.searchParams.set("tbs", filters.join(","));

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `SerpAPI returned ${res.status}. ${detail.slice(0, 300)}`,
    );
  }

  const json = (await res.json()) as {
    error?: string;
    images_results?: {
      title?: string;
      thumbnail?: string;
      original?: string;
      original_width?: number;
      original_height?: number;
      source?: string;
    }[];
  };

  if (json.error) throw new Error(`SerpAPI: ${json.error}`);

  return (json.images_results ?? [])
    .filter((r) => r.original && r.thumbnail)
    .slice(0, opts.limit ?? 24)
    .map((r) => ({
      title: r.title ?? "",
      thumbnail: r.thumbnail!,
      original: r.original!,
      width: r.original_width ?? null,
      height: r.original_height ?? null,
      source: r.source ?? "",
    }));
}

/** Blocks loopback, link-local and private ranges so a crafted result URL
 *  cannot make the local server fetch something on this machine or LAN. */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (h === "0.0.0.0" || h === "::1" || h === "[::1]") return true;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 0) return true;
  }
  return false;
}

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/** Downloads a search result's full-size image, server-side. */
export async function fetchRemoteImage(raw: string): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That is not a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs can be fetched.");
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error("Refusing to fetch from a private or local address.");
  }

  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    redirect: "follow",
    headers: { accept: "image/*" },
  });
  if (!res.ok) throw new Error(`Image download failed (${res.status}).`);

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES) {
    throw new Error(`That image is ${(declared / 1e6).toFixed(1)} MB - too large.`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error("That image is too large.");
  }
  if (buf.length === 0) throw new Error("The download was empty.");
  return buf;
}
