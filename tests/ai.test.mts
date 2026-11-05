import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  generateArtwork,
  MissingApiKeyError,
  NoUsableModelError,
} from "../src/lib/ai.ts";

/** The exact body reported from the live API. */
const UNKNOWN_RESPONSE_FORMAT = JSON.stringify({
  error: {
    message: "Unknown parameter: 'response_format'.",
    type: "invalid_request_error",
    param: "response_format",
    code: "unknown_parameter",
  },
});
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

interface Mock {
  models?: string[];
  onGenerate: (
    body: Record<string, unknown>,
    attempt: number,
  ) => { status: number; body: string } | { status: 200; json: unknown };
}

async function mockOpenAi(t: { after: (fn: () => unknown) => void }, mock: Mock) {
  const seen: Record<string, unknown>[] = [];
  let attempt = 0;
  const server = http.createServer((req, res) => {
    if (req.url?.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          data: (mock.models ?? []).map((id) => ({ id })),
        }),
      );
      return;
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      seen.push(body);
      const out = mock.onGenerate(body, attempt++);
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end("json" in out ? JSON.stringify(out.json) : out.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  t.after(() => new Promise<void>((r) => server.close(() => r())));

  const real = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.openai.com")) {
      return real(url.replace("https://api.openai.com", `http://127.0.0.1:${port}`), init);
    }
    return real(input as never, init);
  }) as typeof fetch;

  process.env.OPENAI_API_KEY = "test-key";
  t.after(() => {
    globalThis.fetch = real;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_IMAGE_MODEL;
  });
  return { seen };
}

test("response_format is never sent - the GPT image models reject it", async (t) => {
  const { seen } = await mockOpenAi(t, {
    models: ["gpt-image-1.5", "gpt-4o"],
    onGenerate: (body) =>
      "response_format" in body
        ? { status: 400, body: UNKNOWN_RESPONSE_FORMAT }
        : { status: 200, json: { data: [{ b64_json: PNG_B64 }] } },
  });

  const { model } = await generateArtwork({
    prompt: "a gold lion",
    size: "1536x1024",
    quality: "high",
  });
  assert.equal(model, "gpt-image-1.5");
  assert.equal(seen.length, 1, "it should succeed first time");
  assert.equal("response_format" in seen[0], false);
});

test("models are discovered from the account, newest preferred", async (t) => {
  const { seen } = await mockOpenAi(t, {
    // Deliberately unordered, and including a non-image model.
    models: ["dall-e-3", "gpt-image-1", "gpt-4o", "gpt-image-2", "whisper-1"],
    onGenerate: () => ({ status: 200, json: { data: [{ b64_json: PNG_B64 }] } }),
  });

  const { model } = await generateArtwork({ prompt: "x", size: "1024x1024", quality: "low" });
  assert.equal(model, "gpt-image-2", "the newest preferred model wins");
  assert.equal(seen.length, 1);
});

test("a retired model is skipped for the next candidate", async (t) => {
  const { seen } = await mockOpenAi(t, {
    models: ["gpt-image-2", "gpt-image-1.5"],
    onGenerate: (body) =>
      body.model === "gpt-image-2"
        ? { status: 400, body: MODEL_MISSING }
        : { status: 200, json: { data: [{ b64_json: PNG_B64 }] } },
  });

  const { model } = await generateArtwork({ prompt: "x", size: "1024x1024", quality: "low" });
  // gpt-image-2 is preferred, fails as retired, so 1.5 is used instead.
  assert.equal(model, "gpt-image-1.5");
  assert.deepEqual(seen.map((s) => s.model), ["gpt-image-2", "gpt-image-1.5"]);
});

test("a rejected parameter is dropped and the call retried", async (t) => {
  const { seen } = await mockOpenAi(t, {
    models: ["gpt-image-2"],
    onGenerate: (body) =>
      "quality" in body
        ? {
            status: 400,
            body: JSON.stringify({
              error: { message: "Unknown parameter: 'quality'.", param: "quality" },
            }),
          }
        : { status: 200, json: { data: [{ b64_json: PNG_B64 }] } },
  });

  const { model, dropped } = await generateArtwork({
    prompt: "x",
    size: "1024x1024",
    quality: "high",
  });
  assert.equal(model, "gpt-image-2");
  assert.deepEqual(dropped, ["quality"]);
  assert.equal(seen.length, 2);
  assert.equal("quality" in seen[1], false);
});

test("model and prompt are never dropped, however the API complains", async (t) => {
  const { seen } = await mockOpenAi(t, {
    models: ["gpt-image-2"],
    onGenerate: () => ({
      status: 400,
      body: JSON.stringify({ error: { message: "Unknown parameter: 'prompt'.", param: "prompt" } }),
    }),
  });

  await assert.rejects(
    () => generateArtwork({ prompt: "x", size: "1024x1024", quality: "low" }),
    /OpenAI image request failed \(400\)/,
  );
  assert.ok(seen.every((s) => "prompt" in s && "model" in s));
});

test("a rate limit surfaces immediately, without cascading", async (t) => {
  const { seen } = await mockOpenAi(t, {
    models: ["gpt-image-2", "gpt-image-1.5", "gpt-image-1"],
    onGenerate: () => ({
      status: 429,
      body: JSON.stringify({ error: { message: "Rate limit reached" } }),
    }),
  });

  await assert.rejects(
    () => generateArtwork({ prompt: "x", size: "1024x1024", quality: "low" }),
    /429.*Rate limit/s,
  );
  assert.equal(seen.length, 1, "it must not try every model on a rate limit");
});

test("OPENAI_IMAGE_MODEL pins one model and skips discovery", async (t) => {
  const { seen } = await mockOpenAi(t, {
    models: ["gpt-image-2"],
    onGenerate: () => ({ status: 200, json: { data: [{ b64_json: PNG_B64 }] } }),
  });
  process.env.OPENAI_IMAGE_MODEL = "my-private-model";

  const { model } = await generateArtwork({ prompt: "x", size: "1024x1024", quality: "low" });
  assert.equal(model, "my-private-model");
  assert.deepEqual(seen.map((s) => s.model), ["my-private-model"]);
});

test("a url response is downloaded, for any model that still returns one", async (t) => {
  const png = Buffer.from(PNG_B64, "base64");
  const fileServer = http.createServer((_q, res) => {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(png);
  });
  await new Promise<void>((r) => fileServer.listen(0, "127.0.0.1", r));
  const filePort = (fileServer.address() as { port: number }).port;
  t.after(() => new Promise<void>((r) => fileServer.close(() => r())));

  await mockOpenAi(t, {
    models: ["gpt-image-2"],
    onGenerate: () => ({
      status: 200,
      json: { data: [{ url: `http://127.0.0.1:${filePort}/out.png` }] },
    }),
  });

  const { image } = await generateArtwork({ prompt: "x", size: "1024x1024", quality: "low" });
  assert.equal(image.equals(png), true);
});

test("when every model fails the error says what was tried", async (t) => {
  await mockOpenAi(t, {
    models: ["gpt-image-2", "gpt-image-1"],
    onGenerate: () => ({ status: 400, body: MODEL_MISSING }),
  });

  await assert.rejects(
    () => generateArtwork({ prompt: "x", size: "1024x1024", quality: "low" }),
    (err: Error) => {
      assert.ok(err instanceof NoUsableModelError);
      assert.match(err.message, /gpt-image-2/);
      assert.match(err.message, /OPENAI_IMAGE_MODEL/);
      return true;
    },
  );
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
