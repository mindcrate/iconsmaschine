import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** A minimal but valid NKS preset, matching the real container layout. */
function makePreset(opts: {
  name: string;
  vendor: string;
  bankchain: string[];
  characters?: string[];
  types?: string[][];
}): Buffer {
  const fixstr = (s: string) => {
    const b = Buffer.from(s, "utf8");
    return Buffer.concat([Buffer.from([0xa0 | b.length]), b]);
  };
  const arr = (n: number) => Buffer.from([0x90 | n]);
  const parts: Buffer[] = [
    Buffer.from([0x01, 0x00, 0x00, 0x00]),
    Buffer.from([0x89]),
    fixstr("author"), fixstr(""),
    fixstr("bankchain"), arr(opts.bankchain.length), ...opts.bankchain.map(fixstr),
    fixstr("characters"), arr((opts.characters ?? []).length), ...(opts.characters ?? []).map(fixstr),
    fixstr("comment"), fixstr(""),
    fixstr("deviceType"), fixstr("INST"),
    fixstr("name"), fixstr(opts.name),
    fixstr("types"), arr((opts.types ?? []).length),
    ...(opts.types ?? []).flatMap((t) => [arr(t.length), ...t.map(fixstr)]),
    fixstr("uuid"), fixstr("abc-123"),
    fixstr("vendor"), fixstr(opts.vendor),
  ];
  const nisi = Buffer.concat(parts);

  const chunk = (id: string, data: Buffer) => {
    const h = Buffer.alloc(8);
    h.write(id, 0, 4, "ascii");
    h.writeUInt32LE(data.length, 4);
    const pad = data.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0);
    return Buffer.concat([h, data, pad]);
  };
  const body = Buffer.concat([
    Buffer.from("NIKS", "ascii"),
    chunk("NISI", nisi),
    chunk("PCHK", Buffer.from("THE IRREPLACEABLE SOUND DATA", "ascii")),
  ]);
  const h = Buffer.alloc(8);
  h.write("RIFF", 0, 4, "ascii");
  h.writeUInt32LE(body.length, 4);
  return Buffer.concat([h, body]);
}

async function tempContent(t: { after: (fn: () => unknown) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "im-uc-"));
  process.env.NI_USER_CONTENT_DIR = root;
  t.after(async () => {
    delete process.env.NI_USER_CONTENT_DIR;
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, "Xfer", "Serum"), { recursive: true });
  await fs.writeFile(
    path.join(root, "Xfer", "Serum", "Future Bass.nksf"),
    makePreset({ name: "Future Bass", vendor: "Xfer", bankchain: ["Serum", "", ""] }),
  );
  await fs.mkdir(path.join(root, "Sonic Charge", "Microtonic"), { recursive: true });
  await fs.writeFile(
    path.join(root, "Sonic Charge", "Microtonic", "Wild shit.nksf"),
    makePreset({
      name: "Wild shit",
      vendor: "Sonic Charge",
      bankchain: ["Sonic Charge", "Microtonic", ""],
      characters: ["Analog"],
      types: [["Beatbox"]],
    }),
  );
  return root;
}

test("lists presets with their current metadata", async (t) => {
  await tempContent(t);
  const { listPresets } = await import("../src/lib/presets.ts");
  const { presets, rootExists } = await listPresets();

  assert.equal(rootExists, true);
  assert.equal(presets.length, 2);
  const micro = presets.find((p) => p.name === "Wild shit")!;
  assert.deepEqual(micro.bankchain, ["Sonic Charge", "Microtonic", ""]);
  assert.deepEqual(micro.characters, ["Analog"]);
  assert.deepEqual(micro.types, [["Beatbox"]]);
  assert.equal(micro.vendor, "Sonic Charge");
});

test("an unreadable preset is reported, not allowed to break the listing", async (t) => {
  const root = await tempContent(t);
  await fs.writeFile(path.join(root, "broken.nksf"), Buffer.from("not a riff file"));
  const { listPresets } = await import("../src/lib/presets.ts");
  const { presets } = await listPresets();

  assert.equal(presets.length, 3);
  const broken = presets.find((p) => p.relPath === "broken.nksf")!;
  assert.ok(broken.error, "the broken file should carry an error");
  assert.ok(presets.filter((p) => !p.error).length === 2, "the good ones still parse");
});

test("writing edits in place and keeps a .bak of the original", async (t) => {
  const root = await tempContent(t);
  const rel = path.join("Xfer", "Serum", "Future Bass.nksf");
  const full = path.join(root, rel);
  const original = await fs.readFile(full);

  const { writePreset, readPreset } = await import("../src/lib/presets.ts");
  const result = await writePreset(rel, {
    vendor: "Xfer Records",
    types: [["Bass", "Synth Bass"]],
    characters: ["Digital"],
  });

  assert.equal(result.unchanged, false);
  assert.ok(result.backupPath);
  assert.equal((await fs.readFile(result.backupPath!)).equals(original), true,
    "the .bak must be the untouched original");

  const after = (await readPreset(rel)).summary;
  assert.equal(after.vendor, "Xfer Records");
  assert.deepEqual(after.types, [["Bass", "Synth Bass"]]);
  assert.deepEqual(after.characters, ["Digital"]);
  assert.equal(after.name, "Future Bass", "untouched fields survive");
});

test("the sound data is preserved across an edit", async (t) => {
  const root = await tempContent(t);
  const rel = path.join("Xfer", "Serum", "Future Bass.nksf");
  const { writePreset } = await import("../src/lib/presets.ts");
  await writePreset(rel, { vendor: "Completely Different" });

  const edited = await fs.readFile(path.join(root, rel));
  assert.ok(
    edited.includes(Buffer.from("THE IRREPLACEABLE SOUND DATA")),
    "the PCHK payload must survive untouched",
  );
});

test("a no-op edit writes nothing and creates no backup", async (t) => {
  const root = await tempContent(t);
  const rel = path.join("Xfer", "Serum", "Future Bass.nksf");
  const before = await fs.stat(path.join(root, rel));

  const { writePreset } = await import("../src/lib/presets.ts");
  const result = await writePreset(rel, { vendor: "Xfer" }); // already "Xfer"

  assert.equal(result.unchanged, true);
  assert.equal(result.backupPath, null);
  const after = await fs.stat(path.join(root, rel));
  assert.equal(after.mtimeMs, before.mtimeMs, "the file must not be rewritten");
  await assert.rejects(() => fs.access(path.join(root, rel + ".bak")));
});

test("a second edit does not clobber the original .bak", async (t) => {
  const root = await tempContent(t);
  const rel = path.join("Xfer", "Serum", "Future Bass.nksf");
  const original = await fs.readFile(path.join(root, rel));

  const { writePreset } = await import("../src/lib/presets.ts");
  await writePreset(rel, { vendor: "First Change" });
  await writePreset(rel, { vendor: "Second Change" });

  const bak = await fs.readFile(path.join(root, rel + ".bak"));
  assert.equal(bak.equals(original), true,
    "the .bak must still hold the very first original, not the intermediate");
});

test("restore puts the original back", async (t) => {
  const root = await tempContent(t);
  const rel = path.join("Xfer", "Serum", "Future Bass.nksf");
  const original = await fs.readFile(path.join(root, rel));

  const { writePreset, restorePreset } = await import("../src/lib/presets.ts");
  await writePreset(rel, { vendor: "Oops" });
  await restorePreset(rel);

  assert.equal((await fs.readFile(path.join(root, rel))).equals(original), true);
});

test("paths outside User Content are refused", async (t) => {
  await tempContent(t);
  const { readPreset, writePreset, resolvePresetPath } = await import("../src/lib/presets.ts");

  for (const bad of [
    "../../../etc/passwd.nksf",
    "/etc/passwd.nksf",
    "../outside.nksf",
  ]) {
    assert.throws(() => resolvePresetPath(bad), /outside the User Content/, bad);
    await assert.rejects(() => readPreset(bad), /outside the User Content/);
    await assert.rejects(() => writePreset(bad, { vendor: "x" }), /outside the User Content/);
  }
});

test("non-preset file types are refused", async (t) => {
  await tempContent(t);
  const { resolvePresetPath } = await import("../src/lib/presets.ts");
  for (const bad of ["notes.txt", "song.wav", "Xfer/Serum/cover.png"]) {
    assert.throws(() => resolvePresetPath(bad), /Only \.nksf/, bad);
  }
});
