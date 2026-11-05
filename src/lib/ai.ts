/**
 * Artwork generation via the OpenAI images API.
 *
 * The key is read from the server environment only - it never reaches the
 * browser and never leaves this machine except in the request to OpenAI.
 *
 * Model availability varies by account: `gpt-image-1` needs organisation
 * verification and returns "model does not exist" otherwise. So the models are
 * tried in order of preference and the first one the account can use wins.
 * Each has different parameters, which is why they are described rather than
 * sharing one request shape.
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
      `None of these image models are available on your OpenAI account: ${tried.join(", ")}. ` +
        `Last error: ${detail} ` +
        `Note gpt-image-1 requires organisation verification; dall-e-3 usually does not. ` +
        `You can pin one with OPENAI_IMAGE_MODEL in .env.local.`,
    );
    this.name = "NoUsableModelError";
  }
}

interface ModelSpec {
  id: string;
  /** Maps our two shapes onto the sizes this model accepts. */
  size: (s: AiSize) => string;
  /** Omitted entirely when the model has no quality parameter. */
  quality?: (q: GenerateInput["quality"]) => string;
  /** gpt-image-1 always returns base64 and rejects response_format. */
  sendResponseFormat: boolean;
}

const MODELS: ModelSpec[] = [
  {
    id: "gpt-image-1",
    size: (s) => s,
    quality: (q) => q,
    sendResponseFormat: false,
  },
  {
    id: "dall-e-3",
    // dall-e-3's landscape is 1792x1024, not 1536x1024.
    size: (s) => (s === "1536x1024" ? "1792x1024" : "1024x1024"),
    quality: (q) => (q === "high" ? "hd" : "standard"),
    sendResponseFormat: true,
  },
  {
    id: "dall-e-2",
    size: () => "1024x1024",
    sendResponseFormat: true,
  },
];

const ENDPOINT = "https://api.openai.com/v1/images/generations";

/** True when the failure means "this account cannot use this model". */
function isModelUnavailable(status: number, body: string): boolean {
  if (status !== 400 && status !== 403 && status !== 404) return false;
  return /does not exist|do not have access|must be verified|unsupported.*model|invalid.*model/i.test(
    body,
  );
}

export interface GenerateResult {
  image: Buffer;
  model: string;
}

export async function generateArtwork(
  input: GenerateInput,
): Promise<GenerateResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new MissingApiKeyError();

  const pinned = process.env.OPENAI_IMAGE_MODEL?.trim();
  const candidates = pinned
    ? MODELS.filter((m) => m.id === pinned).concat(
        MODELS.some((m) => m.id === pinned)
          ? []
          : [{ id: pinned, size: (s) => s, quality: (q) => q, sendResponseFormat: false }],
      )
    : MODELS;

  const tried: string[] = [];
  let lastDetail = "";

  for (const model of candidates) {
    tried.push(model.id);

    const body: Record<string, unknown> = {
      model: model.id,
      prompt: input.prompt,
      size: model.size(input.size),
      n: 1,
    };
    if (model.quality) body.quality = model.quality(input.quality);
    if (model.sendResponseFormat) body.response_format = "b64_json";

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      lastDetail = detail.slice(0, 300);
      if (isModelUnavailable(res.status, detail)) continue; // try the next one
      throw new Error(`OpenAI image request failed (${res.status}). ${lastDetail}`);
    }

    const json = (await res.json()) as {
      data?: { b64_json?: string; url?: string }[];
    };
    const first = json.data?.[0];

    if (first?.b64_json) {
      return { image: Buffer.from(first.b64_json, "base64"), model: model.id };
    }
    if (first?.url) {
      const img = await fetch(first.url, { signal: AbortSignal.timeout(60_000) });
      if (!img.ok) throw new Error(`Could not download the generated image (${img.status}).`);
      return { image: Buffer.from(await img.arrayBuffer()), model: model.id };
    }
    throw new Error("OpenAI returned no image data.");
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
