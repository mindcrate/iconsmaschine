import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const lower = (list: string[]) => list.map((v) => v.toLowerCase());

async function setup(
  t: { after: (fn: () => unknown) => void },
  opts: { db?: boolean; distVendor?: string } = {},
) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "im-vocab-"));
  if (opts.db) {
    const dbFile = path.join(base, "komplete.db3");
    const db = new DatabaseSync(dbFile);
    db.exec(`
      CREATE TABLE k_bank_chain (id INTEGER, bcvendor TEXT);
      CREATE TABLE k_sound_info (id INTEGER, vendor TEXT);
      INSERT INTO k_bank_chain VALUES (1,'Chain Only Co'),(2,'Other'),(3,'');
      INSERT INTO k_sound_info VALUES
        (1,'Native Instruments'),(2,'Native Instruments'),(3,'Native instruments'),
        (4,'tim moose'),(5,'other'),(6,NULL),(7,'arturia'),(8,'Arturia'),(9,'Arturia');
    `);
    db.close();
    process.env.MASCHINE_DB_PATH = dbFile;
  } else {
    process.env.MASCHINE_DB_PATH = path.join(base, "missing.db3");
  }
  const dist = path.join(base, "dist_database");
  await fs.mkdir(dist, { recursive: true });
  if (opts.distVendor) {
    const dir = path.join(dist, "one");
    await fs.mkdir(dir);
    await fs.writeFile(
      path.join(dir, "categories.json"),
      JSON.stringify({ Vendor: opts.distVendor, CategoryDB: [] }),
    );
  }
  process.env.NI_RESOURCES_DIST_DB_DIR = dist;
  t.after(async () => {
    delete process.env.MASCHINE_DB_PATH;
    delete process.env.NI_RESOURCES_DIST_DB_DIR;
    await fs.rm(base, { recursive: true, force: true });
  });
}

test("vendors from both Maschine tables appear, and Other never does", async (t) => {
  await setup(t, { db: true });
  const { readVocabulary } = await import("../src/lib/vocab.ts");
  const { vendors } = await readVocabulary();
  assert.ok(vendors.includes("tim moose"));
  assert.ok(vendors.includes("Chain Only Co"));
  assert.ok(!lower(vendors).includes("other"));
  assert.deepEqual(
    vendors,
    [...vendors].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
  );
});

test("inside the database the commonest spelling wins a case clash", async (t) => {
  await setup(t, { db: true });
  const { readVocabulary } = await import("../src/lib/vocab.ts");
  const { vendors } = await readVocabulary();
  assert.ok(vendors.includes("Native Instruments"));
  assert.ok(!vendors.includes("Native instruments"));
  assert.ok(vendors.includes("Arturia"));
  assert.ok(!vendors.includes("arturia"));
});

test("a dist_database spelling beats the database spelling", async (t) => {
  await setup(t, { db: true, distVendor: "NATIVE INSTRUMENTS" });
  const { readVocabulary } = await import("../src/lib/vocab.ts");
  const { vendors } = await readVocabulary();
  assert.ok(vendors.includes("NATIVE INSTRUMENTS"));
  assert.ok(!vendors.includes("Native Instruments"));
});

test("a suggestion matching a Maschine vendor is dropped, the Maschine spelling stays", async (t) => {
  await setup(t, { db: true });
  const { readVocabulary } = await import("../src/lib/vocab.ts");
  const { vendors, suggestedVendors } = await readVocabulary();
  assert.ok(vendors.includes("Arturia"));
  assert.ok(!lower(suggestedVendors).includes("arturia"));
  for (const v of vendors) {
    assert.ok(!lower(suggestedVendors).includes(v.toLowerCase()));
  }
});

test("with no database and no dist_database there are only suggestions", async (t) => {
  await setup(t);
  const { readVocabulary } = await import("../src/lib/vocab.ts");
  const vocab = await readVocabulary();
  assert.deepEqual(vocab.vendors, []);
  assert.ok(vocab.suggestedVendors.length > 0);
  assert.equal(vocab.fromDisk, false);
});

test("mergeVendors keeps the first spelling and drops names the field would reject", async () => {
  const { mergeVendors } = await import("../src/lib/vocab.ts");
  const r = mergeVendors(
    ["Zed  Audio", "zed audio", "Alpha"],
    ["ALPHA", "AC/DC Sounds", "Beta", "beta", "  Gamma  "],
  );
  assert.deepEqual(r.vendors, ["Alpha", "Zed Audio"]);
  assert.deepEqual(r.suggestedVendors, ["Beta", "Gamma"]);
});

test("the checked-in suggestion file is well formed", async () => {
  const file = JSON.parse(
    await fs.readFile(
      path.join(import.meta.dirname, "..", "src", "data", "vendor-suggestions.json"),
      "utf8",
    ),
  );
  assert.ok(Array.isArray(file.source) && file.source.length > 0);
  for (const url of file.source) assert.match(url, /^https?:\/\//);
  assert.match(file.fetchedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Array.isArray(file.vendors) && file.vendors.length > 0);
  for (const v of file.vendors) {
    assert.equal(typeof v, "string");
    assert.ok(v.length > 0 && v === v.trim());
  }
});
