import { setting } from "./settings";

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
      "No OpenAI key is set. Add it in Settings, or upload artwork instead.",
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
          `You can pin a specific one with the image model field in Settings (OPENAI_IMAGE_MODEL).`,
    );
    this.name = "NoUsableModelError";
  }
}

const BASE = "https://api.openai.com/v1";

/**
 * Newest first; anything else the account lists is tried after these.
 *
 * Matched as PREFIXES, so dated snapshots (gpt-image-2.5-flare-2026-09-08)
 * rank with their base model rather than falling to the unranked tail.
 *
 * The lineup moves fast - dall-e-2/3 were removed in May 2026, gpt-image-1 in
 * October, and gpt-image-1.5 / -1-mini retire on 2026-12-01 - so this list is
 * only a fallback. Discovery from /v1/models is what normally decides.
 */
const PREFERRED = [
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5",
  "gpt-image-2",
];

const IMAGE_MODEL_RE = /^gpt-image/i;

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

    // Prefix match, so dated snapshots rank with their base model. Within a
    // rank, the undated id sorts first - it tracks the current snapshot.
    const ranked: string[] = [];
    for (const prefix of PREFERRED) {
      const matches = ids
        .filter((id) => id === prefix || id.startsWith(prefix + "-"))
        .filter((id) => !ranked.includes(id))
        .sort((a, b) => a.length - b.length || a.localeCompare(b));
      ranked.push(...matches);
    }
    const rest = ids
      .filter((id) => !ranked.includes(id))
      .sort((a, b) => b.localeCompare(a));
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
  if (!name) return null;
  // `model` and `prompt` are what the request IS. `quality` is a cost guard:
  // the current models default to `high`, which is around 35x the price of
  // `low`, so silently dropping it could turn a cheap call expensive with no
  // error. Better to fail loudly than to bill by accident.
  if (name === "model" || name === "prompt" || name === "quality") return null;
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
  const key = setting("OPENAI_API_KEY");
  if (!key) throw new MissingApiKeyError();

  const pinned = setting("OPENAI_IMAGE_MODEL");
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
