/**
 * Artwork generation via the OpenAI images API.
 *
 * The key is read from the local environment on the server side only - it is
 * never sent to the browser and never leaves this machine except in the request
 * to OpenAI.
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

const ENDPOINT = "https://api.openai.com/v1/images/generations";

export async function generateArtwork(input: GenerateInput): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new MissingApiKeyError();

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt: input.prompt,
      size: input.size,
      quality: input.quality,
      n: 1,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `OpenAI image request failed (${res.status}). ${detail.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as {
    data?: { b64_json?: string; url?: string }[];
  };
  const first = json.data?.[0];

  if (first?.b64_json) return Buffer.from(first.b64_json, "base64");

  if (first?.url) {
    const img = await fetch(first.url);
    if (!img.ok) throw new Error(`Could not download generated image (${img.status}).`);
    return Buffer.from(await img.arrayBuffer());
  }

  throw new Error("OpenAI returned no image data.");
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
