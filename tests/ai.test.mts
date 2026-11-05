import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  generateArtwork,
  MissingApiKeyError,
  NoUsableModelError,
} from "../src/lib/ai.ts";

/** The exact body OpenAI returns for an unverified account. */
const MODEL_MISSING = JSON.stringify({
  error: {
    message: "The model 'gpt-image-1' does not exist.",
    type: "image_generation_user_error",
    param: "model",
    code: "invalid_value",
  },
});

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Stands in for api.openai.com and records what each model was sent. */
async function mockOpenAi(
  t: { after: (fn: () => unknown) => void },
  handler: (model: string, body: Record<string, unknown>) =>
    | { status: number; body: string }
    | { status: 200; json: unknown },
) {
  const seen: Record<string, unknown>[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      seen.push(body);
      const out = handler(String(body.model), body);
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end("json" in out ? JSON.stringify(out.json) : out.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  return { seen, base: `http://127.0.0.1:${port}` };
}

/* The endpoint is a module constant, so point fetch at the mock instead. */
function patchFetch(base: string, t: { after: (fn: () => unknown) => void }) {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.openai.com")) {
      return real(url.replace("https://api.openai.com", base), init);
    }
    return real(input as never, init);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = real;
  });
}

test("falls back to dall-e-3 when gpt-image-1 is not available", async (t) => {
  const { seen, base } = await mockOpenAi(t, (model) =>
    model === "gpt-image-1"
      ? { status: 400, body: MODEL_MISSING }
      : { status: 200, json: { data: [{ b64_json: PNG_B64 }] } },
  );
  patchFetch(base, t);
  process.env.OPENAI_API_KEY = "test-key";
  t.after(() => {
    delete process.env.OPENAI_API_KEY;
  });

  const { image, model } = await generateArtwork({
    prompt: "a gold lion",
    size: "1536x1024",
    quality: "high",
  });

  assert.equal(model, "dall-e-3");
  assert.ok(image.length > 0);
  assert.deepEqual(seen.map((s) => s.model), ["gpt-image-1", "dall-e-3"]);

  // Each model must get parameters it actually accepts.
  const gpt = seen[0];
  assert.equal(gpt.size, "1536x1024");
  assert.equal(gpt.quality, "high");
  assert.equal("response_format" in gpt, false, "gpt-image-1 rejects response_format");

  const dalle = seen[1];
  assert.equal(dalle.size, "1792x1024", "dall-e-3 landscape is 1792x1024");
  assert.equal(dalle.quality, "hd", "high maps to hd");
  assert.equal(dalle.response_format, "b64_json");
});

test("dall-e-2 gets no quality parameter and only square sizes", async (t) => {
  const { seen, base } = await mockOpenAi(t, (model) =>
    model === "dall-e-2"
      ? { status: 200, json: { data: [{ b64_json: PNG_B64 }] } }
      : { status: 400, body: MODEL_MISSING },
  );
  patchFetch(base, t);
  process.env.OPENAI_API_KEY = "test-key";
  t.after(() => {
    delete process.env.OPENAI_API_KEY;
  });

  const { model } = await generateArtwork({
    prompt: "x",
    size: "1536x1024",
    quality: "low",
  });
  assert.equal(model, "dall-e-2");
  const d2 = seen[2];
  assert.equal(d2.size, "1024x1024");
  assert.equal("quality" in d2, false, "dall-e-2 has no quality parameter");
});

test("OPENAI_IMAGE_MODEL pins one model and skips the others", async (t) => {
  const { seen, base } = await mockOpenAi(t, () => ({
    status: 200,
    json: { data: [{ b64_json: PNG_B64 }] },
  }));
  patchFetch(base, t);
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_IMAGE_MODEL = "dall-e-3";
  t.after(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_IMAGE_MODEL;
  });

  const { model } = await generateArtwork({ prompt: "x", size: "1024x1024", quality: "medium" });
  assert.equal(model, "dall-e-3");
  assert.deepEqual(seen.map((s) => s.model), ["dall-e-3"]);
});

test("when no model is available the error says why and what to do", async (t) => {
  const { base } = await mockOpenAi(t, () => ({ status: 400, body: MODEL_MISSING }));
  patchFetch(base, t);
  process.env.OPENAI_API_KEY = "test-key";
  t.after(() => {
    delete process.env.OPENAI_API_KEY;
  });

  await assert.rejects(
    () => generateArtwork({ prompt: "x", size: "1024x1024", quality: "low" }),
    (err: Error) => {
      assert.ok(err instanceof NoUsableModelError);
      assert.match(err.message, /gpt-image-1, dall-e-3, dall-e-2/);
      assert.match(err.message, /organisation verification/);
      assert.match(err.message, /OPENAI_IMAGE_MODEL/);
      return true;
    },
  );
});

test("a real failure is surfaced, not swallowed as a missing model", async (t) => {
  const { seen, base } = await mockOpenAi(t, () => ({
    status: 429,
    body: JSON.stringify({ error: { message: "Rate limit reached" } }),
  }));
  patchFetch(base, t);
  process.env.OPENAI_API_KEY = "test-key";
  t.after(() => {
    delete process.env.OPENAI_API_KEY;
  });

  await assert.rejects(
    () => generateArtwork({ prompt: "x", size: "1024x1024", quality: "low" }),
    /429.*Rate limit/s,
  );
  assert.equal(seen.length, 1, "a rate limit must not cascade through every model");
});

test("a missing key fails before any request", async (t) => {
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => {
    if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
  });
  await assert.rejects(
    () => generateArtwork({ prompt: "x", size: "1024x1024", quality: "low" }),
    MissingApiKeyError,
  );
});
