import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const png = (r: number, g: number, b: number) =>
  sharp({ create: { width: 64, height: 64, channels: 4, background: { r, g, b, alpha: 1 } } })
    .png()
    .toBuffer();

async function packWithLogo(t: { after: (fn: () => unknown) => void }) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "im-route-"));
  process.env.ICONMASCHINE_HOME = home;
  t.after(async () => {
    delete process.env.ICONMASCHINE_HOME;
    await fs.rm(home, { recursive: true, force: true });
  });
  const { savePack } = await import("../src/lib/store.ts");
  const now = new Date().toISOString();
  await savePack(
    {
      id: "p1", name: "Logo Pack", kitType: "sample_kit", vendor: "", product: "Logo Pack", nks2: true,
      background: null, padding: 0.08, fileType: "", categories: [], shortName: null,
      bgColor: "000000", author: "", share: false, tags: [], nestImage: false, overlay: null,
      crops: {}, installedAs: null, hasLogo: true, createdAt: now, updatedAt: now,
    },
    { artwork: await png(255, 0, 0), logo: await png(0, 0, 255) },
  );
  return path.join(home, "packs", "p1", "source-logo.png");
}

/** What the page's "Build the images" sends for an opened pack: no new images. */
function rebuildForm(extra: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ kitType: "sample_kit", product: "Logo Pack", name: "Logo Pack", ...extra })) {
    form.set(k, v);
  }
  form.set("artwork", new Blob(), "artwork.png");
  form.set("logo", new Blob(), "logo.png");
  return form;
}

const put = async (form: FormData) => {
  const { PUT } = await import("../src/app/api/packs/[id]/route.ts");
  return PUT(new Request("http://x/api/packs/p1", { method: "PUT", body: form }), {
    params: Promise.resolve({ id: "p1" }),
  });
};

test("rebuilding a pack without a new logo keeps its stored logo", async (t) => {
  const logo = await packWithLogo(t);
  const res = await put(rebuildForm());
  assert.equal(res.status, 200);
  assert.ok(await fs.stat(logo), "source-logo.png survives the rebuild");
  assert.equal((await res.json()).pack.hasLogo, true);
});

test("clearLogo still removes the logo", async (t) => {
  const logo = await packWithLogo(t);
  const res = await put(rebuildForm({ clearLogo: "true" }));
  assert.equal(res.status, 200);
  await assert.rejects(fs.stat(logo));
  assert.equal((await res.json()).pack.hasLogo, false);
});
