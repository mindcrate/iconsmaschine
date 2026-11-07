# Replace Image After Build Implementation Plan

> **For agentic workers:** Build this with `pstack:poteto-mode` (Tim's rule overrides the default
> sub-skill line). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the preview lightbox, replace the image of one output file, or of all artwork or all
logo files, using upload, AI, logo search or a library of images already saved in the app.

**Architecture:** A pack gains an optional `fileSources` map (output file -> image id, a sha256).
Per-file images live in the pack folder as `source-<sha256>.png`. `renderPack` uses a file's own image
first, then the logo or artwork as today, so old packs render unchanged. A new `src/lib/packimages.ts`
holds the replace, revert and library logic; two small routes expose it, and a dialog in the
lightbox drives it.

**Tech Stack:** Next.js route handlers (`runtime = "nodejs"`), React client components, `sharp`,
Node's `node:test`. Run tests with `npm test`, typecheck with `npx tsc --noEmit`.

**Spec:** `docs/prd-replace-image.md` (approved 2026-11-06).

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/lib/store.ts` | modify | `Pack.fileSources`; read per-file images; write, read and prune image files |
| `src/lib/render.ts` | modify | `renderPack` uses a file's own image first |
| `src/lib/build.ts` | modify | pass per-file images to `renderPack` |
| `src/lib/packimages.ts` | create | replace by scope, revert one file, list the library |
| `src/app/api/packs/[id]/images/route.ts` | create | POST replace, DELETE revert |
| `src/app/api/library/route.ts` | create | GET the library |
| `src/app/api/packs/[id]/source/route.ts` | modify | serve `which=artwork|logo|<image id>` |
| `src/components/LibraryPicker.tsx` | create | grid of library images |
| `src/components/ReplaceImageDialog.tsx` | create | picker tabs, scope choice, warnings, submit |
| `src/components/CropEditor.tsx` | modify | "Replace image…" and "Use the pack's image" buttons |
| `src/components/PreviewGrid.tsx` | modify | "own image" badge |
| `src/app/page.tsx` | modify | state for `fileSources`, wiring, keep step C state in sync |
| `tests/packimages.test.mts` | create | store and packimages behaviour |
| `tests/render.test.mts` | modify | per-file image render test |

Decision recorded for the PRD's open question on logo files: a per-file image on a logo-spec file
renders with the logo rule (`contain`), because the user chose that picture for that file.

---

### Task 1: Store per-file images

**Files:**
- Modify: `src/lib/store.ts` (the `Pack` interface near line 9, `readSources` near line 135)
- Test: `tests/packimages.test.mts` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests/packimages.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

async function tempHome(t: { after: (fn: () => unknown) => void }) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "im-images-"));
  process.env.ICONMASCHINE_HOME = home;
  t.after(async () => {
    delete process.env.ICONMASCHINE_HOME;
    await fs.rm(home, { recursive: true, force: true });
  });
  return home;
}

const png = (r: number, g: number, b: number, w = 64, h = 64) =>
  sharp({ create: { width: w, height: h, channels: 4, background: { r, g, b, alpha: 1 } } })
    .png()
    .toBuffer();

async function makePack(id: string, name = "Test Pack") {
  const { savePack } = await import("../src/lib/store.ts");
  const now = new Date().toISOString();
  return savePack(
    {
      id, name, kitType: "sample_kit", vendor: "", product: name, nks2: true,
      background: null, padding: 0.08, fileType: "", categories: [], shortName: null,
      bgColor: "000000", author: "", share: false, tags: [], nestImage: false,
      overlay: null, crops: { "MST_artwork.png": { x: 0, y: 0, w: 0.5, h: 0.5 }, "VB_artwork.png": { x: 0, y: 0, w: 0.5, h: 0.5 } },
      installedAs: null, hasLogo: false, createdAt: now, updatedAt: now,
    },
    { artwork: await png(255, 0, 0) },
  );
}

test("saveImage stores an image once per content and readSources returns per-file images", async (t) => {
  const home = await tempHome(t);
  const { saveImage, readSources } = await import("../src/lib/store.ts");
  await makePack("p1");
  const blue = await png(0, 0, 255);

  const a = await saveImage("p1", blue);
  const b = await saveImage("p1", blue);
  assert.equal(a, b, "same bytes, same id");
  assert.match(a, /^[0-9a-f]{64}$/);
  const stored = (await fs.readdir(path.join(home, "packs", "p1"))).filter((f) => f.startsWith("source-") && f !== "source-artwork.png");
  assert.deepEqual(stored, [`source-${a}.png`]);

  const sources = await readSources("p1", { "NKS2_hardware_banner.webp": a });
  assert.ok(sources.files["NKS2_hardware_banner.webp"].equals(blue));
  assert.ok(sources.artwork);
});

test("readSourceImage accepts artwork, logo and image ids only", async (t) => {
  await tempHome(t);
  const { readSourceImage } = await import("../src/lib/store.ts");
  await makePack("p1");
  assert.ok(await readSourceImage("p1", "artwork"));
  assert.equal(await readSourceImage("p1", "logo"), null, "no logo yet");
  assert.equal(await readSourceImage("p1", "../pack.json"), null);
  assert.equal(await readSourceImage("p1", "pack"), null);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: the two new tests fail (`saveImage` / `readSourceImage` do not exist).

- [ ] **Step 3: Implement in `src/lib/store.ts`**

Add to the `Pack` interface, after `crops`:

```ts
  /**
   * Output files that use their own image instead of the artwork or logo, as
   * output file name -> image id. The id is the image's sha256, stored in the
   * pack folder as `source-<id>.png`. Absent on packs made before this existed.
   */
  fileSources?: Record<string, string>;
```

Add after `LOGO_FILE`:

```ts
/** A per-file image id: the sha256 of its PNG bytes. */
export const IMAGE_ID = /^[0-9a-f]{64}$/;
const imageFile = (imageId: string) => `source-${imageId}.png`;
```

Replace `readSources` with:

```ts
export async function readSources(
  id: string,
  fileSources: Record<string, string> = {},
): Promise<{ artwork: Buffer | null; logo: Buffer | null; files: Record<string, Buffer> }> {
  const dir = packDir(id);
  const read = async (file: string) => {
    try {
      return await fs.readFile(path.join(dir, file));
    } catch {
      return null;
    }
  };
  const files: Record<string, Buffer> = {};
  for (const [file, imageId] of Object.entries(fileSources)) {
    if (!IMAGE_ID.test(imageId)) continue;
    const buffer = await read(imageFile(imageId));
    if (buffer) files[file] = buffer;
  }
  return { artwork: await read(ARTWORK_FILE), logo: await read(LOGO_FILE), files };
}

/** One stored source: "artwork", "logo" or a per-file image id. null for anything else. */
export async function readSourceImage(id: string, which: string): Promise<Buffer | null> {
  const name =
    which === "artwork" ? ARTWORK_FILE
    : which === "logo" ? LOGO_FILE
    : IMAGE_ID.test(which) ? imageFile(which)
    : null;
  if (!name) return null;
  try {
    return await fs.readFile(path.join(packDir(id), name));
  } catch {
    return null;
  }
}

/** Stores a per-file image in the pack folder and returns its id. Saving the same bytes twice stores one file. */
export async function saveImage(id: string, png: Buffer): Promise<string> {
  const imageId = crypto.createHash("sha256").update(png).digest("hex");
  const target = path.join(packDir(id), imageFile(imageId));
  await fs.writeFile(target, png, { flag: "wx" }).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "EEXIST") throw err;
  });
  return imageId;
}

/** Deletes per-file images the pack no longer points at. */
export async function pruneImages(pack: Pack): Promise<void> {
  const keep = new Set(Object.values(pack.fileSources ?? {}));
  const dir = packDir(pack.id);
  for (const name of await fs.readdir(dir)) {
    const m = /^source-([0-9a-f]{64})\.png$/.exec(name);
    if (m && !keep.has(m[1])) await fs.rm(path.join(dir, name), { force: true });
  }
}
```

(`crypto` is already imported in `store.ts`.)

- [ ] **Step 4: Run the tests**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"` and `npx tsc --noEmit`
Expected: all pass and a clean typecheck. The new `fileSources` argument is optional, so existing
callers keep working.

- [ ] **Step 5: Commit**

```bash
git add src/lib/store.ts tests/packimages.test.mts
git commit -m "Store per-file images in a pack, by content hash"
```

### Task 2: Render a file from its own image

**Files:**
- Modify: `src/lib/render.ts` (`renderPack`, near line 123)
- Modify: `src/lib/build.ts` (`buildPack`)
- Test: `tests/render.test.mts`

- [ ] **Step 1: Write the failing test** (append to `tests/render.test.mts`)

```ts
test("renderPack uses a file's own image for that file only", async () => {
  const artwork = await source(1200, 1200);
  const blue = await sharp({
    create: { width: 1600, height: 300, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
  }).png().toBuffer();

  const out = await renderPack(
    { artwork, logo: null, files: { "NKS2_hardware_banner.webp": blue } },
    specsFor({ nks2: true }),
    { padding: 0, background: null },
  );
  const blueness = async (buffer: Buffer) => {
    const { channels } = await sharp(buffer).stats();
    return channels[2].mean - channels[0].mean;
  };
  for (const f of out) {
    if (f.file === "NKS2_hardware_banner.webp") {
      assert.ok((await blueness(f.buffer)) > 0, "the banner comes from its own image");
    } else {
      assert.ok((await blueness(f.buffer)) < 0, `${f.file} still comes from the artwork`);
    }
  }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: FAIL on the new test (and a type error for `files` under `npx tsc --noEmit`).

- [ ] **Step 3: Implement**

In `src/lib/render.ts`, change `renderPack`:

```ts
export async function renderPack(
  sources: { artwork: Buffer; logo?: Buffer | null; files?: Record<string, Buffer> },
  specs: ImageSpec[],
  opts: RenderOptions = {},
  crops: CropMap = {},
): Promise<RenderedFile[]> {
  return Promise.all(
    specs.map(async (spec) => {
      const own = sources.files?.[spec.file] ?? null;
      const useLogo = !own && spec.source === "logo" && Boolean(sources.logo);
      const source = own ?? (useLogo ? sources.logo! : sources.artwork);
      const buffer = await renderOne(source, spec, {
        ...opts,
        crop: crops[spec.file] ?? null,
        // A file's own image on a logo file was picked for that file, so it
        // keeps the logo rule (fit inside, never clipped).
        haveLogoSource: useLogo || (own !== null && spec.source === "logo"),
        overlay: overlayAppliesTo(opts.overlay ?? null, spec.file)
          ? opts.overlay
          : null,
      });
      return { file: spec.file, buffer, width: spec.width, height: spec.height };
    }),
  );
}
```

In `src/lib/build.ts`, change the two lines in `buildPack`:

```ts
  const sources = await readSources(id, pack.fileSources ?? {});
```

```ts
  const files = await renderPack(
    { artwork: sources.artwork, logo: sources.logo, files: sources.files },
```

- [ ] **Step 4: Run the tests**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"` and `npx tsc --noEmit`
Expected: all pass, including the existing render tests (old packs render the same).

- [ ] **Step 5: Commit**

```bash
git add src/lib/render.ts src/lib/build.ts tests/render.test.mts
git commit -m "Render a file from its own image when it has one"
```

### Task 3: Replace and revert by scope

**Files:**
- Create: `src/lib/packimages.ts`
- Test: `tests/packimages.test.mts`

- [ ] **Step 1: Write the failing tests** (append to `tests/packimages.test.mts`)

```ts
test("replacing one file stores its own image and clears only its crop", async (t) => {
  await tempHome(t);
  const { replacePackImage } = await import("../src/lib/packimages.ts");
  await makePack("p1");

  const { pack } = await replacePackImage("p1", { kind: "file", file: "MST_artwork.png" }, await png(0, 0, 255));
  assert.match(pack.fileSources!["MST_artwork.png"], /^[0-9a-f]{64}$/);
  assert.equal(pack.crops["MST_artwork.png"], undefined);
  assert.ok(pack.crops["VB_artwork.png"], "other crops stay");
});

test("an unknown output file is refused", async (t) => {
  await tempHome(t);
  const { replacePackImage } = await import("../src/lib/packimages.ts");
  await makePack("p1");
  await assert.rejects(
    replacePackImage("p1", { kind: "file", file: "../pack.json" }, await png(0, 0, 255)),
    /Unknown output file/,
  );
});

test("replacing the artwork skips files with their own image and clears the others' crops", async (t) => {
  await tempHome(t);
  const { replacePackImage } = await import("../src/lib/packimages.ts");
  const { readSourceImage } = await import("../src/lib/store.ts");
  await makePack("p1");
  await replacePackImage("p1", { kind: "file", file: "MST_artwork.png" }, await png(0, 0, 255));
  const green = await png(0, 255, 0);

  const { pack, skipped } = await replacePackImage("p1", { kind: "artwork" }, green);
  assert.deepEqual(skipped, ["MST_artwork.png"]);
  assert.equal(pack.crops["VB_artwork.png"], undefined);
  assert.ok((await readSourceImage("p1", "artwork"))!.equals(green));
});

test("replacing the logo group creates the logo and marks the pack as having one", async (t) => {
  await tempHome(t);
  const { replacePackImage } = await import("../src/lib/packimages.ts");
  const { readSourceImage } = await import("../src/lib/store.ts");
  await makePack("p1");

  const { pack } = await replacePackImage("p1", { kind: "logo" }, await png(0, 255, 0));
  assert.equal(pack.hasLogo, true);
  assert.ok(await readSourceImage("p1", "logo"));
});

test("reverting a file removes its mapping, its crop and the unused image", async (t) => {
  const home = await tempHome(t);
  const { replacePackImage, clearFileImage } = await import("../src/lib/packimages.ts");
  await makePack("p1");
  await replacePackImage("p1", { kind: "file", file: "MST_artwork.png" }, await png(0, 0, 255));

  const pack = await clearFileImage("p1", "MST_artwork.png");
  assert.deepEqual(pack.fileSources, {});
  const left = (await fs.readdir(path.join(home, "packs", "p1"))).filter((f) => /^source-[0-9a-f]{64}\.png$/.test(f));
  assert.deepEqual(left, []);
});

test("the library lists each saved image once, across packs", async (t) => {
  await tempHome(t);
  const { listLibrary, replacePackImage } = await import("../src/lib/packimages.ts");
  await makePack("p1", "One");
  await makePack("p2", "Two");
  await replacePackImage("p2", { kind: "file", file: "MST_artwork.png" }, await png(0, 0, 255));

  const images = await listLibrary();
  assert.equal(images.length, 2, "red artwork shared by both packs counts once, plus the blue image");
  for (const img of images) {
    assert.match(img.imageId, /^[0-9a-f]{64}$/);
    assert.ok(img.url.startsWith(`/api/packs/${img.packId}/source?which=`));
  }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: the six new tests fail (`packimages.ts` does not exist).

- [ ] **Step 3: Create `src/lib/packimages.ts`**

```ts
import crypto from "node:crypto";
import { PackNotFound } from "./build";
import { BadRequest } from "./form";
import { IMAGE_SPECS } from "./spec";
import {
  listPacks,
  pruneImages,
  readPack,
  readSourceImage,
  saveImage,
  savePack,
  type Pack,
} from "./store";

/**
 * Replacing a pack's images after it is built. A file can have its own image,
 * or the artwork or logo can be replaced for every file that uses it.
 */

export type ReplaceScope =
  | { kind: "file"; file: string }
  | { kind: "artwork" }
  | { kind: "logo" };

export interface LibraryImage {
  imageId: string;
  packId: string;
  packName: string;
  /** "artwork", "logo" or a per-file image id: the `which` the source route takes. */
  which: string;
  url: string;
}

const KNOWN_FILES = new Set(IMAGE_SPECS.map((s) => s.file));

/** The files that currently render from the artwork, or from the logo. */
function groupFiles(pack: Pack, kind: "artwork" | "logo"): string[] {
  return IMAGE_SPECS.filter((s) =>
    kind === "logo"
      ? s.source === "logo"
      : s.source === "artwork" || !pack.hasLogo,
  ).map((s) => s.file);
}

export async function replacePackImage(
  packId: string,
  scope: ReplaceScope,
  png: Buffer,
): Promise<{ pack: Pack; skipped: string[] }> {
  const pack = await readPack(packId);
  if (!pack) throw new PackNotFound();
  const own = { ...(pack.fileSources ?? {}) };
  const crops = { ...(pack.crops ?? {}) };

  if (scope.kind === "file") {
    if (!KNOWN_FILES.has(scope.file)) throw new BadRequest(`Unknown output file: ${scope.file}`);
    own[scope.file] = await saveImage(packId, png);
    delete crops[scope.file];
    const saved = await savePack({ ...pack, fileSources: own, crops });
    await pruneImages(saved);
    return { pack: saved, skipped: [] };
  }

  const group = groupFiles(pack, scope.kind);
  const skipped = group.filter((f) => f in own);
  for (const f of group) if (!(f in own)) delete crops[f];
  const saved = await savePack(
    { ...pack, crops, ...(scope.kind === "logo" ? { hasLogo: true } : {}) },
    scope.kind === "artwork" ? { artwork: png } : { logo: png },
  );
  return { pack: saved, skipped };
}

/** Puts a file back on the pack's artwork or logo. */
export async function clearFileImage(packId: string, file: string): Promise<Pack> {
  const pack = await readPack(packId);
  if (!pack) throw new PackNotFound();
  const own = { ...(pack.fileSources ?? {}) };
  const crops = { ...(pack.crops ?? {}) };
  delete own[file];
  delete crops[file];
  const saved = await savePack({ ...pack, fileSources: own, crops });
  await pruneImages(saved);
  return saved;
}

/** Every source image saved in the app, each content once, newest pack first. */
export async function listLibrary(): Promise<LibraryImage[]> {
  const seen = new Map<string, LibraryImage>();
  for (const pack of await listPacks()) {
    const whiches = ["artwork", "logo", ...new Set(Object.values(pack.fileSources ?? {}))];
    for (const which of whiches) {
      const buffer = await readSourceImage(pack.id, which);
      if (!buffer) continue;
      const imageId = crypto.createHash("sha256").update(buffer).digest("hex");
      if (seen.has(imageId)) continue;
      seen.set(imageId, {
        imageId,
        packId: pack.id,
        packName: pack.name,
        which,
        url: `/api/packs/${pack.id}/source?which=${which}`,
      });
    }
  }
  return [...seen.values()];
}
```

Check that `PackNotFound` importing from `./build` does not create an import cycle: `build.ts`
imports `store`, `render`, `spec`, `distdb` only, so it does not.

- [ ] **Step 4: Run the tests**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"` and `npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/packimages.ts tests/packimages.test.mts
git commit -m "Replace a pack's image per file or per group, and list the image library"
```

### Task 4: Routes

**Files:**
- Create: `src/app/api/packs/[id]/images/route.ts`
- Create: `src/app/api/library/route.ts`
- Modify: `src/app/api/packs/[id]/source/route.ts`

Before writing route code, read the route handler guide in `node_modules/next/dist/docs/` (AGENTS.md).

- [ ] **Step 1: Create `src/app/api/packs/[id]/images/route.ts`**

```ts
import { PackNotFound } from "@/lib/build";
import { BadRequest, jsonError, readImageField } from "@/lib/form";
import { clearFileImage, replacePackImage, type ReplaceScope } from "@/lib/packimages";
import { readSourceImage } from "@/lib/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

const text = (form: FormData, field: string) => {
  const v = form.get(field);
  return typeof v === "string" ? v : "";
};

/**
 * Multipart form: `scope` ("file", "artwork" or "logo"), `file` (the output
 * file, for scope "file"), and either an `image` upload or `fromPack` plus
 * `fromWhich` naming a library image.
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const form = await request.formData();
    const kind = text(form, "scope");
    const scope: ReplaceScope =
      kind === "file" ? { kind: "file", file: text(form, "file") }
      : kind === "artwork" || kind === "logo" ? { kind }
      : (() => { throw new BadRequest("Choose what the new image replaces."); })();

    const fromPack = text(form, "fromPack");
    const image =
      (await readImageField(form, "image")) ??
      (fromPack ? await readSourceImage(fromPack, text(form, "fromWhich")) : null);
    if (!image) throw new BadRequest("Choose an image first.");

    return Response.json(await replacePackImage(id, scope, image));
  } catch (err) {
    return jsonError(err, err instanceof PackNotFound ? 404 : 500);
  }
}

/** `?file=<output file>` puts that file back on the pack's artwork or logo. */
export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const file = new URL(request.url).searchParams.get("file") ?? "";
    return Response.json({ pack: await clearFileImage(id, file) });
  } catch (err) {
    return jsonError(err, err instanceof PackNotFound ? 404 : 500);
  }
}
```

- [ ] **Step 2: Create `src/app/api/library/route.ts`**

```ts
import { jsonError } from "@/lib/form";
import { listLibrary } from "@/lib/packimages";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json({ images: await listLibrary() });
  } catch (err) {
    return jsonError(err);
  }
}
```

- [ ] **Step 3: Replace `src/app/api/packs/[id]/source/route.ts`**

```ts
import { readSourceImage } from "@/lib/store";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** `?which=artwork`, `logo` or a per-file image id. */
export async function GET(request: Request, { params }: Ctx) {
  const { id } = await params;
  const which = new URL(request.url).searchParams.get("which") ?? "artwork";
  const buffer = await readSourceImage(id, which);
  if (!buffer) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(buffer), {
    headers: { "content-type": "image/png", "cache-control": "no-store" },
  });
}
```

- [ ] **Step 4: Check the routes against a running dev server**

Run `npx tsc --noEmit` (expected: clean). Then, with `npm run dev` on a free port and a pack id
`<id>` from `ls ~/.iconmaschine/packs` (use a copied pack, see Task 7):

```bash
curl -s http://localhost:<port>/api/library | python3 -c "import json,sys;print(len(json.load(sys.stdin)['images']))"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:<port>/api/packs/<id>/source?which=../pack.json"
```

Expected: a number above 0, then `404`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/packs/[id]/images/route.ts" src/app/api/library/route.ts "src/app/api/packs/[id]/source/route.ts"
git commit -m "Add routes to replace and revert pack images and to list the library"
```

### Task 5: Library picker and replace dialog

**Files:**
- Create: `src/components/LibraryPicker.tsx`
- Create: `src/components/ReplaceImageDialog.tsx`

- [ ] **Step 1: Create `src/components/LibraryPicker.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { getJson } from "@/lib/client";
import type { LibraryImage } from "@/lib/packimages";

export function LibraryPicker({
  selected,
  onPick,
}: {
  selected: string | null;
  onPick: (image: LibraryImage) => void;
}) {
  const [images, setImages] = useState<LibraryImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<{ images: LibraryImage[] }>("/api/library")
      .then((r) => setImages(r.images))
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <div className="note bad">{error}</div>;
  if (!images) return <div className="hint">Loading your saved images…</div>;
  if (images.length === 0) return <div className="hint">No saved images yet.</div>;

  return (
    <div className="ov-targets">
      {images.map((img) => (
        <button
          key={img.imageId}
          type="button"
          className={selected === img.imageId ? "ov-target on" : "ov-target"}
          aria-pressed={selected === img.imageId}
          onClick={() => onPick(img)}
          title={`From ${img.packName}`}
        >
          <span className="ov-shot" style={{ aspectRatio: "1 / 1" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt="" />
          </span>
          <span className="ov-name">{img.packName}</span>
          <span className="ov-where">{img.which === "artwork" || img.which === "logo" ? img.which : "own image"}</span>
        </button>
      ))}
    </div>
  );
}
```

`import type` from `@/lib/packimages` keeps server code out of the client bundle.

- [ ] **Step 2: Create `src/components/ReplaceImageDialog.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { ArtworkPicker, type ArtworkSource } from "@/components/ArtworkPicker";
import { LibraryPicker } from "@/components/LibraryPicker";
import { IMAGE_SPECS } from "@/lib/spec";
import type { LibraryImage } from "@/lib/packimages";
import type { Pack } from "@/lib/store";
import type { PreviewFile } from "@/lib/types";

type Scope = "file" | "artwork" | "logo";

export function ReplaceImageDialog({
  packId,
  file,
  fileSources,
  hasLogo,
  hasOpenAiKey,
  hasSerpKey,
  searchSeed,
  onDone,
  onClose,
}: {
  packId: string;
  file: PreviewFile;
  fileSources: Record<string, string>;
  /** Without a logo, the logo files render from the artwork too. Same rule as the server. */
  hasLogo: boolean;
  hasOpenAiKey: boolean;
  hasSerpKey: boolean;
  searchSeed?: string;
  onDone: (pack: Pack, skipped: string[]) => void;
  onClose: () => void;
}) {
  const spec = IMAGE_SPECS.find((s) => s.file === file.file)!;
  const [scope, setScope] = useState<Scope>(spec.source);
  const [from, setFrom] = useState<"picker" | "library">("picker");
  const [picked, setPicked] = useState<ArtworkSource | null>(null);
  const [libraryPick, setLibraryPick] = useState<LibraryImage | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewUrl = from === "library" ? libraryPick?.url ?? null : picked?.preview ?? null;
  useEffect(() => {
    setWidth(null);
    if (!previewUrl) return;
    const img = new Image();
    img.onload = () => setWidth(img.naturalWidth);
    img.src = previewUrl;
  }, [previewUrl]);

  const groupFiles = useMemo(
    () =>
      scope === "file"
        ? [file.file]
        : IMAGE_SPECS.filter((s) =>
            scope === "logo" ? s.source === "logo" : s.source === "artwork" || !hasLogo,
          ).map((s) => s.file),
    [scope, file.file, hasLogo],
  );
  const skipCount = scope === "file" ? 0 : groupFiles.filter((f) => f in fileSources).length;
  const neededWidth = Math.max(
    ...IMAGE_SPECS.filter((s) => groupFiles.includes(s.file)).map((s) => s.width),
  );

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("scope", scope);
      form.set("file", file.file);
      if (from === "library" && libraryPick) {
        form.set("fromPack", libraryPick.packId);
        form.set("fromWhich", libraryPick.which);
      } else if (picked) {
        form.set("image", picked.blob, "image.png");
      }
      const res = await fetch(`/api/packs/${packId}/images`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "The image could not be replaced.");
      onDone(json.pack as Pack, json.skipped as string[]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ready = from === "library" ? libraryPick !== null : picked !== null;

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <h3>Replace the image for {file.file}</h3>

        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={from === "picker"} onClick={() => setFrom("picker")}>
            Upload, AI or search
          </button>
          <button role="tab" aria-selected={from === "library"} onClick={() => setFrom("library")}>
            Library
          </button>
        </div>

        {from === "picker" ? (
          <ArtworkPicker
            label="New image"
            hint="Use an image at least as wide as the file it replaces."
            value={picked}
            onChange={setPicked}
            allowAi
            hasOpenAiKey={hasOpenAiKey}
            hasSerpKey={hasSerpKey}
            searchSeed={searchSeed}
          />
        ) : (
          <LibraryPicker selected={libraryPick?.imageId ?? null} onPick={setLibraryPick} />
        )}

        <div className="field" style={{ marginTop: 14 }}>
          <label>Replace it for</label>
          {(["file", "artwork", "logo"] as const).map((s) => (
            <label key={s} className="inline-check">
              <input type="radio" name="scope" checked={scope === s} onChange={() => setScope(s)} />
              {s === "file" ? "This file only" : s === "artwork" ? "All artwork files" : "All logo files"}
            </label>
          ))}
        </div>

        {skipCount > 0 && (
          <div className="note">
            {skipCount} file{skipCount === 1 ? " has" : "s have"} its own image and will not change.
          </div>
        )}
        {width !== null && width < neededWidth && (
          <div className="note">
            This image is {width} px wide, and the widest file it feeds is {neededWidth} px, so it
            will look soft.
          </div>
        )}
        {error && <div className="note bad">{error}</div>}

        <div className="actions">
          <button className="btn" onClick={submit} disabled={!ready || busy}>
            {busy ? <><span className="spinner" /> Replacing…</> : "Replace"}
          </button>
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
```

The `lightbox` / `lightbox-inner` classes are the ones `CropEditor` uses, so the dialog looks the same.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/LibraryPicker.tsx src/components/ReplaceImageDialog.tsx
git commit -m "Add the image library picker and the replace image dialog"
```

### Task 6: Wire the lightbox, the grid and the page

**Files:**
- Modify: `src/components/CropEditor.tsx` (props and the actions row near line 197)
- Modify: `src/components/PreviewGrid.tsx`
- Modify: `src/app/page.tsx` (state near line 61, `openPack`, the `PreviewGrid` and `CropEditor` blocks near lines 874 and 911)

- [ ] **Step 1: `CropEditor` gets two actions**

Add to the props type and destructuring:

```ts
  /** True when this file uses its own image. */
  ownImage: boolean;
  onReplace: () => void;
  onUseGroupImage: () => void;
```

Add to the actions row, before "Save crop":

```tsx
          <button className="btn secondary" onClick={onReplace}>
            Replace image…
          </button>
          {ownImage && (
            <button className="btn ghost" onClick={onUseGroupImage} title="Go back to the pack's artwork or logo for this file">
              Use the pack&apos;s image
            </button>
          )}
```

- [ ] **Step 2: `PreviewGrid` shows the badge**

Add the prop `ownImageFiles: Set<string>` and, next to the "hand-cropped" badge:

```tsx
          {ownImageFiles.has(f.file) && (
            <span className="badge-cropped">own image</span>
          )}
```

- [ ] **Step 3: `page.tsx` state and helpers**

Add next to the other state:

```ts
  const [fileSources, setFileSources] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState<PreviewFile | null>(null);
  /** Bumped after a replace so image URLs that did not change their path still reload. */
  const [sourceVersion, setSourceVersion] = useState(0);
```

In `openPack`, add `setFileSources(pack.fileSources ?? {});`. In `resetOutputs` and `clearForm`,
add `setFileSources({});`.

Add this function next to `saveCrop`:

```ts
  /** Brings step C and the preview in line with the pack the server just saved. */
  async function applySavedPack(pack: Pack) {
    setCrops(pack.crops ?? {});
    setFileSources(pack.fileSources ?? {});
    setSourceVersion((v) => v + 1);
    const v = Date.now();
    setArtwork({ preview: `/api/packs/${pack.id}/source?which=artwork&v=${v}`, blob: new Blob(), origin: "upload" });
    // A logo-group replace creates the logo. The next build must keep it, so
    // step C's logo box and image follow the pack.
    setUseSeparateLogo(pack.hasLogo);
    setLogo(pack.hasLogo ? { preview: `/api/packs/${pack.id}/source?which=logo&v=${v}`, blob: new Blob(), origin: "upload" } : null);
    const { files } = await getJson<{ files: PreviewFile[] }>(`/api/packs/${pack.id}/preview`);
    setPreview(files);
    void refreshPacks();
  }
```

`Pack` and `getJson` are already imported in `page.tsx`. If either is not, add it to the existing
import lines.

- [ ] **Step 4: `page.tsx` wiring**

Pass `ownImageFiles={new Set(Object.keys(fileSources))}` to `PreviewGrid`.

Change the `CropEditor` block to:

```tsx
      {editing && packId && !replacing && (
        <CropEditor
          file={editing.file}
          targetW={editing.width}
          targetH={editing.height}
          sourceUrl={`/api/packs/${packId}/source?which=${
            fileSources[editing.file] ??
            (preview && SPEC_LOGO_FILES.has(editing.file) && useSeparateLogo ? "logo" : "artwork")
          }&v=${sourceVersion}`}
          initial={crops[editing.file] ?? null}
          onSave={(c) => saveCrop(editing.file, c)}
          onClose={() => setEditing(null)}
          ownImage={editing.file in fileSources}
          onReplace={() => setReplacing(editing)}
          onUseGroupImage={async () => {
            const res = await fetch(`/api/packs/${packId}/images?file=${encodeURIComponent(editing.file)}`, { method: "DELETE" });
            const json = await res.json();
            if (!res.ok) { setError(json.error ?? "Could not go back to the pack's image."); return; }
            await applySavedPack(json.pack as Pack);
          }}
        />
      )}
      {replacing && packId && (
        <ReplaceImageDialog
          packId={packId}
          file={replacing}
          fileSources={fileSources}
          hasLogo={useSeparateLogo}
          hasOpenAiKey={status?.hasOpenAiKey ?? false}
          hasSerpKey={status?.hasSerpKey ?? false}
          searchSeed={[vendor, product].filter(Boolean).join(" ")}
          onDone={async (pack) => {
            setReplacing(null);
            await applySavedPack(pack);
          }}
          onClose={() => setReplacing(null)}
        />
      )}
```

Import `ReplaceImageDialog` at the top. Keep `editing` set during a replace, so the lightbox opens
again on the new image with the default crop (PRD R4).

- [ ] **Step 5: Typecheck and test**

Run: `npx tsc --noEmit` and `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: clean, all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/CropEditor.tsx src/components/PreviewGrid.tsx src/app/page.tsx
git commit -m "Replace an image from the preview lightbox"
```

### Task 7: Check in the running app

Use a copy of a real pack so no saved pack changes:

```bash
SRC=$(ls -d ~/.iconmaschine/packs/9e4eeff0-*) && NEW=~/.iconmaschine/packs/$(uuidgen | tr A-Z a-z)
cp -R "$SRC" "$NEW" && python3 - "$NEW/pack.json" <<'EOF'
import json,sys,os; p=sys.argv[1]; d=json.load(open(p)); d["id"]=os.path.basename(os.path.dirname(p)); d["name"]="REPLACE TEST"; d["installedAs"]=None; json.dump(d,open(p,"w"),indent=2)
EOF
```

- [ ] **Step 1:** Start the app (`.claude/launch.json` config `iconmaschine`), open "REPLACE TEST",
  build the images, click `NKS2_hardware_banner.webp`, choose Replace image…, upload a wide image,
  keep "This file only", Replace. Expected: the lightbox reopens on the new image, the tile shows
  "own image", the other 7 tiles are unchanged.
- [ ] **Step 2:** Replace with "All artwork files" from the Library tab. Expected: the note says
  1 file will not change; after Replace, the artwork tiles change and the banner does not.
- [ ] **Step 3:** On the banner, click "Use the pack's image". Expected: the badge goes away and the
  banner shows the artwork again.
- [ ] **Step 4:** Replace "All logo files" on `MST_logo.png`. Expected: step C shows "Use a different
  image for the logo files" ticked, and a second build keeps the logo.
- [ ] **Step 5:** Pick an image narrower than 1280 px for the banner. Expected: the "will look soft"
  note.
- [ ] **Step 6:** Click "Check what will be written". Expected: the plan lists the rebuilt files.
  Do not install. Delete "REPLACE TEST" in the app afterwards.

### Task 8: Check against the PRD

- [ ] R1 to R8 each have a passing test or a Task 7 check. List any gap in the final report.
- [ ] All 17 earlier packs still build: run the preview route for each id and expect HTTP 200.

```bash
for d in ~/.iconmaschine/packs/*/; do id=$(basename "$d"); printf '%s ' "$id"; curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:<port>/api/packs/$id/preview"; done
```
