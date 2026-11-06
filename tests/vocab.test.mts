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
      CREATE TABLE k_bank_chain (id INTEGER, bcvendor TEXT, entry1 TEXT);
      CREATE TABLE k_sound_info (id INTEGER, bank_chain_id INTEGER, device_type_flags INTEGER, file_ext TEXT, vendor TEXT);
      INSERT INTO k_bank_chain VALUES
        (1,'Chain Only Co','Chain Only Pack'),(2,'Other','Other Pack'),(3,'',NULL),
        (4,'','Valhalla DSP, LLC'),(5,'Other','iZotope, Inc.'),
        (6,'','Loose Sample Pack'),(7,'','Vendored Plugin Bank'),
        (8,'','Reaktor'),(9,'','Reaktor');
      -- flags: 1 instrument, 2 effect, 4 one-shot
      INSERT INTO k_sound_info VALUES
        (1,1,4,'wav','Native Instruments'),(2,1,4,'wav','Native Instruments'),(3,1,4,'wav','Native instruments'),
        (4,1,4,'wav','tim moose'),(5,1,4,'wav','other'),(6,1,4,'wav',NULL),
        (7,1,4,'wav','arturia'),(8,1,4,'wav','Arturia'),(9,1,4,'wav','Arturia'),
        (10,4,2,'',NULL),(11,4,2,'',NULL),
        (12,5,1,'','Other'),
        (13,6,4,'wav',NULL),
        (14,7,1,'nksf','Arturia'),
        (15,8,1,'ens',NULL),(16,9,1,'ens','Native Instruments');
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

test("a plugin with no vendor adds its maker's bank name; a sample pack does not", async (t) => {
  await setup(t, { db: true });
  const { readVocabulary } = await import("../src/lib/vocab.ts");
  const { vendors } = await readVocabulary();
  assert.ok(vendors.includes("Valhalla DSP, LLC"));
  assert.ok(vendors.includes("iZotope, Inc."));
  assert.ok(!vendors.includes("Loose Sample Pack"));
  assert.ok(!vendors.includes("Vendored Plugin Bank"));
  assert.ok(!vendors.includes("Chain Only Pack"));
  // A product heading with one vendor-less chain among vendored ones.
  assert.ok(!vendors.includes("Reaktor"));
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
