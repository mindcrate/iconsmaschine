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
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "im-home-"));
  process.env.NI_USER_CONTENT_DIR = root;
  process.env.ICONMASCHINE_HOME = home;
  t.after(async () => {
    delete process.env.NI_USER_CONTENT_DIR;
    delete process.env.ICONMASCHINE_HOME;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });
  return { root, home };
}

async function addPreset(
  root: string,
  rel: string,
  opts: Parameters<typeof makePreset>[0],
): Promise<string> {
  const full = path.join(root, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, makePreset(opts));
  return full;
}

const serum = (name: string) => ({
  name,
  vendor: "Old",
  bankchain: ["Serum", "", ""],
  characters: ["Analog"],
  types: [["Bass"]],
});

test("only the picked fields change", async (t) => {
  const { root } = await tempContent(t);
  const file = await addPreset(root, "Xfer/Serum/Lead.nksf", serum("Lead"));
  const { runBatch } = await import("../src/lib/presetbatch.ts");
  const { readPreset } = await import("../src/lib/presets.ts");

  const report = await runBatch("Xfer", { vendor: "Xfer" }, { dryRun: false });
  assert.deepEqual(report.counts, { changed: 1, unchanged: 0, failed: 0 });

  const { summary } = await readPreset("Xfer/Serum/Lead.nksf");
  assert.equal(summary.vendor, "Xfer");
  assert.equal(summary.name, "Lead");
  assert.deepEqual(summary.bankchain, ["Serum", "", ""]);
  assert.deepEqual(summary.characters, ["Analog"]);
  assert.deepEqual(summary.types, [["Bass"]]);
  assert.ok((await fs.readFile(file)).includes("THE IRREPLACEABLE SOUND DATA"));
});

test("a second run reports unchanged and does not rewrite the files", async (t) => {
  const { root } = await tempContent(t);
  const file = await addPreset(root, "a/One.nksf", serum("One"));
  await addPreset(root, "a/Two.nksf", serum("Two"));
  const { runBatch } = await import("../src/lib/presetbatch.ts");
  const fields = { vendor: "New", characters: ["Warm"] };

  await runBatch("a", fields, { dryRun: false });
  const mtime = (await fs.stat(file)).mtimeMs;
  await new Promise((r) => setTimeout(r, 20));
  const again = await runBatch("a", fields, { dryRun: false });

  assert.deepEqual(again.counts, { changed: 0, unchanged: 2, failed: 0 });
  assert.equal((await fs.stat(file)).mtimeMs, mtime);
});

test("the .bak keeps the first original through a second, different apply", async (t) => {
  const { root } = await tempContent(t);
  const file = await addPreset(root, "a/One.nksf", serum("One"));
  const original = await fs.readFile(file);
  const { runBatch } = await import("../src/lib/presetbatch.ts");

  await runBatch("a", { vendor: "First" }, { dryRun: false });
  await runBatch("a", { vendor: "Second" }, { dryRun: false });

  assert.ok(original.equals(await fs.readFile(`${file}.bak`)));
});

test("a folder outside User Content, or a symlinked one, is refused", async (t) => {
  const { root } = await tempContent(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "im-out-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await addPreset(outside, "Evil.nksf", serum("Evil"));
  await fs.symlink(outside, path.join(root, "link"));
  const { runBatch } = await import("../src/lib/presetbatch.ts");
  const { OutsideUserContentError } = await import("../src/lib/presets.ts");

  await assert.rejects(runBatch("../", { vendor: "X" }, { dryRun: false }), OutsideUserContentError);
  await assert.rejects(runBatch("/etc", { vendor: "X" }, { dryRun: false }), OutsideUserContentError);
  await assert.rejects(runBatch("link", { vendor: "X" }, { dryRun: false }));
  assert.equal((await fs.readdir(outside)).length, 1);
});

test("a symlinked preset inside the folder is not followed", async (t) => {
  const { root } = await tempContent(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "im-out-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  const target = await addPreset(outside, "Evil.nksf", serum("Evil"));
  const before = await fs.readFile(target);
  await fs.mkdir(path.join(root, "a"));
  await fs.symlink(target, path.join(root, "a", "Evil.nksf"));
  const { runBatch } = await import("../src/lib/presetbatch.ts");

  const report = await runBatch("a", { vendor: "X" }, { dryRun: false });
  assert.equal(report.files.length, 0);
  assert.ok(before.equals(await fs.readFile(target)));
});

test("a broken file is reported as failed and the rest still apply", async (t) => {
  const { root } = await tempContent(t);
  await addPreset(root, "a/Good.nksf", serum("Good"));
  await fs.writeFile(path.join(root, "a", "Bad.nksf"), Buffer.from("not a riff file"));
  const { runBatch } = await import("../src/lib/presetbatch.ts");

  const report = await runBatch("a", { author: "Tim" }, { dryRun: false });
  assert.deepEqual(report.counts, { changed: 1, unchanged: 0, failed: 1 });
  const bad = report.files.find((f) => f.relPath.endsWith("Bad.nksf"));
  assert.equal(bad?.status, "failed");
  assert.deepEqual(report.files.map((f) => f.relPath), ["a/Bad.nksf", "a/Good.nksf"]);
});

test("a dry run writes nothing but reports before and after", async (t) => {
  const { root } = await tempContent(t);
  const file = await addPreset(root, "a/One.nksf", serum("One"));
  const original = await fs.readFile(file);
  const { runBatch } = await import("../src/lib/presetbatch.ts");

  const report = await runBatch(
    "a",
    { vendor: "New", types: [["Lead", "Synth Lead"]] },
    { dryRun: true },
  );

  assert.ok(original.equals(await fs.readFile(file)));
  await assert.rejects(fs.access(`${file}.bak`));
  const file0 = report.files[0];
  assert.equal(file0.status, "changed");
  if (file0.status !== "changed") return;
  assert.equal(file0.backupPath, null);
  assert.deepEqual(file0.changes, [
    { field: "vendor", before: "Old", after: "New" },
    { field: "types", before: [["Bass"]], after: [["Lead", "Synth Lead"]] },
  ]);
});

test("rules save, list, overwrite, reapply and delete", async (t) => {
  const { root } = await tempContent(t);
  const file = await addPreset(root, "Xfer/One.nksf", serum("One"));
  const { saveRule, listRules, reapplyRule, deleteRule } = await import(
    "../src/lib/presetbatch.ts"
  );
  const { readPreset } = await import("../src/lib/presets.ts");

  assert.deepEqual(await listRules(), []);
  await saveRule("Xfer/", { vendor: "First" });
  await saveRule("Xfer", { vendor: "Xfer", comment: "tagged" });
  const rules = await listRules();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].folder, "Xfer");
  assert.deepEqual(rules[0].fields, { vendor: "Xfer", comment: "tagged" });

  const report = await reapplyRule("Xfer");
  assert.equal(report.counts.changed, 1);
  assert.equal((await readPreset("Xfer/One.nksf")).summary.comment, "tagged");

  await fs.writeFile(file, makePreset(serum("One")));
  assert.equal((await reapplyRule("Xfer")).counts.changed, 1);

  await deleteRule("Xfer");
  assert.deepEqual(await listRules(), []);
  await assert.rejects(reapplyRule("Xfer"), /No saved rule/);
});

test("a bad rule in the rules file is skipped", async (t) => {
  const { home } = await tempContent(t);
  await fs.writeFile(
    path.join(home, "preset-tag-rules.json"),
    JSON.stringify({
      rules: [
        { folder: "a", fields: { nope: 1 }, updatedAt: "x" },
        { folder: "b", fields: { vendor: "V" }, updatedAt: "2026-01-01T00:00:00.000Z" },
      ],
    }),
  );
  const { listRules } = await import("../src/lib/presetbatch.ts");
  assert.deepEqual((await listRules()).map((r) => r.folder), ["b"]);
});

test("parseTagFields rejects unknown keys, wrong types and an empty pick", async () => {
  const { parseTagFields, InvalidTagFieldsError } = await import("../src/lib/presetbatch.ts");

  assert.throws(() => parseTagFields({ vendor: "X", colour: "red" }), InvalidTagFieldsError);
  assert.throws(() => parseTagFields({ vendor: 5 }), InvalidTagFieldsError);
  assert.throws(() => parseTagFields({ types: ["Bass"] }), InvalidTagFieldsError);
  assert.throws(() => parseTagFields({ characters: [1] }), InvalidTagFieldsError);
  assert.throws(() => parseTagFields({}), /Pick at least one field/);
  assert.throws(() => parseTagFields({ vendor: undefined }), /Pick at least one field/);
  assert.throws(() => parseTagFields(null), InvalidTagFieldsError);
  assert.deepEqual(parseTagFields({ vendor: "X", comment: undefined }), { vendor: "X" });
});
