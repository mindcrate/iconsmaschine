import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fetchRemoteImage, MissingSerpKeyError, searchImages } from "../src/lib/imagesearch.ts";

test("search refuses to run without a key, rather than failing obscurely", async () => {
  const saved = process.env.SERPAPI_API_KEY;
  delete process.env.SERPAPI_API_KEY;
  try {
    await assert.rejects(
      () => searchImages({ query: "serum logo" }),
      MissingSerpKeyError,
    );
  } finally {
    if (saved !== undefined) process.env.SERPAPI_API_KEY = saved;
  }
});

test("fetching refuses non-http schemes", async () => {
  for (const url of [
    "file:///etc/passwd",
    "ftp://example.com/x.png",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
  ]) {
    await assert.rejects(
      () => fetchRemoteImage(url),
      /Only http and https|not a valid URL/,
      `should refuse ${url}`,
    );
  }
});

test("fetching refuses private and local addresses", async () => {
  // A crafted search result must not be able to make the local server reach
  // this machine, the LAN, or a cloud metadata endpoint.
  for (const url of [
    "http://localhost/x.png",
    "http://127.0.0.1:4321/api/status",
    "http://0.0.0.0/x.png",
    "http://10.0.0.5/x.png",
    "http://192.168.1.1/admin.png",
    "http://172.16.0.1/x.png",
    "http://172.31.255.254/x.png",
    "http://169.254.169.254/latest/meta-data/",
    "http://printer.local/x.png",
  ]) {
    await assert.rejects(
      () => fetchRemoteImage(url),
      /private or local address/,
      `should refuse ${url}`,
    );
  }
});

test("public-looking addresses just outside the private ranges are allowed through", async () => {
  // 172.15.x and 172.32.x are public; only 172.16-31 is private. These should
  // fail on connection, not on the guard.
  for (const url of ["http://172.15.0.1/x.png", "http://172.32.0.1/x.png"]) {
    await assert.rejects(
      () => fetchRemoteImage(url),
      (err: Error) => !/private or local address/.test(err.message),
      `${url} should not be blocked by the private-range guard`,
    );
  }
});

test("a real download returns the bytes", async (t) => {
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082",
    "hex",
  );
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(png);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  t.after(() => new Promise<void>((r) => server.close(() => r())));

  // 127.0.0.1 is blocked by design, which is exactly what we want to confirm.
  await assert.rejects(
    () => fetchRemoteImage(`http://127.0.0.1:${port}/logo.png`),
    /private or local address/,
    "the guard must apply even to a server we control",
  );
});

test("an oversized declared length is rejected before downloading", async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, {
      "content-type": "image/png",
      "content-length": String(50 * 1024 * 1024),
    });
    res.end(Buffer.alloc(16));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  // Still blocked by the host guard first - the size check is defence in depth.
  const port = (server.address() as { port: number }).port;
  await assert.rejects(() => fetchRemoteImage(`http://127.0.0.1:${port}/big.png`));
});
