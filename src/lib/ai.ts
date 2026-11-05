/**
 * Artwork generation via the OpenAI images API.
 *
 * The key is read from the server environment only - it never reaches the
 * browser and never leaves this machine except in the request to OpenAI.
 *
 * This API moves. `gpt-image-1` needs organisation verification, the DALL-E
 * models have been retired, and `response_format` is rejected by the GPT image
 * models (they always return base64). Rather than hardcode a lineup that will
 * age, this:
 *
 *   1. asks /v1/models what the account can actually use,
 *   2. orders those by preference, newest first,
 *   3. never sends `response_format`, and
 *   4. drops any parameter the API rejects as unknown and retries.
 *
 * That last step means a future rename or removal of `quality` degrades to a
 * working request instead of a hard failure.
 */

export type AiSize = "1024x1024" | "1536x1024";

export interface GenerateInput {
  prompt: string;
  size: AiSize;
  quality: "low" | "medium" | "high";
}

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "No OPENAI_API_KEY found. Add it to .env.local and restart the app, or upload artwork instead.",
    );
    this.name = "MissingApiKeyError";
  }
}

export class NoUsableModelError extends Error {
  constructor(tried: string[], detail: string) {
    super(
      tried.length === 0
        ? `Your OpenAI account lists no image models. Last error: ${detail}`
        : `None of these image models worked: ${tried.join(", ")}. Last error: ${detail} ` +
          `You can pin a specific one with OPENAI_IMAGE_MODEL in .env.local.`,
    );
    this.name = "NoUsableModelError";
  }
}

const BASE = "https://api.openai.com/v1";

/** Newest first. Anything else the account lists is tried after these. */
const PREFERRED = [
  "gpt-image-2.5",
  "gpt-image-2",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
];

const IMAGE_MODEL_RE = /^(gpt-image|dall-e)/i;

async function listImageModels(key: string): Promise<string[]> {
  try {
    const res = await fetch(`${BASE}/models`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { id?: string }[] };
    const ids = (json.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && IMAGE_MODEL_RE.test(id));

    const ranked = PREFERRED.filter((p) => ids.includes(p));
    const rest = ids
      .filter((id) => !ranked.includes(id))
      // Prefer gpt-image over the older dall-e names.
      .sort((a, b) => {
        const score = (s: string) => (s.startsWith("gpt-image") ? 0 : 1);
        return score(a) - score(b) || b.localeCompare(a);
      });
    return [...ranked, ...rest];
  } catch {
    return [];
  }
}

/** Pulls the offending parameter out of an "unknown parameter" style error. */
function rejectedParameter(body: string): string | null {
  const m =
    /(?:unknown|unsupported|unrecognized) parameter:?\s*'?"?([a-z_]+)"?'?/i.exec(body) ??
    /"param"\s*:\s*"([a-z_]+)"/i.exec(body);
  const name = m?.[1];
  // Never drop the two things the request cannot work without.
  if (!name || name === "model" || name === "prompt") return null;
  return name;
}

function isModelUnavailable(status: number, body: string): boolean {
  if (status !== 400 && status !== 403 && status !== 404) return false;
  return /does not exist|do not have access|must be verified|deprecated|retired|unsupported.*model|invalid.*model|model_not_found/i.test(
    body,
  );
}

export interface GenerateResult {
  image: Buffer;
  model: string;
  /** Parameters the API rejected and we dropped, for transparency. */
  dropped: string[];
}

export async function generateArtwork(
  input: GenerateInput,
): Promise<GenerateResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new MissingApiKeyError();

  const pinned = process.env.OPENAI_IMAGE_MODEL?.trim();
  const candidates = pinned ? [pinned] : await listImageModels(key);

  if (candidates.length === 0) {
    // Discovery failed or returned nothing: still try the preferred list.
    candidates.push(...PREFERRED);
  }

  const tried: string[] = [];
  let lastDetail = "";

  for (const model of candidates.slice(0, 8)) {
    tried.push(model);

    // response_format is deliberately absent: the GPT image models reject it
    // and always return base64 anyway.
    const body: Record<string, unknown> = {
      model,
      prompt: input.prompt,
      size: input.size,
      quality: input.quality,
      n: 1,
    };
    const dropped: string[] = [];

    // Up to three attempts, shedding one rejected parameter each time.
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${BASE}/images/generations`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });

      if (res.ok) {
        const json = (await res.json()) as {
          data?: { b64_json?: string; url?: string }[];
        };
        const first = json.data?.[0];
        if (first?.b64_json) {
          return { image: Buffer.from(first.b64_json, "base64"), model, dropped };
        }
        if (first?.url) {
          const img = await fetch(first.url, { signal: AbortSignal.timeout(60_000) });
          if (!img.ok) throw new Error(`Could not download the image (${img.status}).`);
          return { image: Buffer.from(await img.arrayBuffer()), model, dropped };
        }
        throw new Error("OpenAI returned no image data.");
      }

      const detail = await res.text().catch(() => "");
      lastDetail = detail.slice(0, 300);

      if (isModelUnavailable(res.status, detail)) break; // next model

      const bad = rejectedParameter(detail);
      if (res.status === 400 && bad && bad in body) {
        delete body[bad];
        dropped.push(bad);
        continue; // retry this model without it
      }

      // A real failure - rate limit, bad key, content policy. Surface it.
      throw new Error(`OpenAI image request failed (${res.status}). ${lastDetail}`);
    }
  }

  throw new NoUsableModelError(tried, lastDetail || "(no detail returned)");
}

/** Nudges the model toward art that survives being cropped to a 96x47 tile. */
export function decoratePrompt(prompt: string): string {
  return [
    prompt.trim(),
    "Album-cover style artwork for a music sample pack.",
    "Bold, high contrast, strong central subject, no text or lettering,",
    "important detail kept away from the edges so it survives tight cropping.",
  ].join(" ");
}
