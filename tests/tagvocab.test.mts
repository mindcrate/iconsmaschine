import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Builds a fixture using the schema confirmed from a real komplete.db3. */
async function makeDb(t: { after: (fn: () => unknown) => void }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "im-vocab-"));
  const file = path.join(dir, "komplete.db3");
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE k_category (id INTEGER, category TEXT, subcategory TEXT, subsubcategory TEXT);
    CREATE TABLE k_mode (id INTEGER, name TEXT);
    CREATE TABLE k_bank_chain (id INTEGER, bcvendor TEXT, entry1 TEXT, entry2 TEXT, entry3 TEXT);
    -- join tables, deliberately present: these are NOT the vocabulary
    CREATE TABLE k_sound_info_category (sound_info_id INTEGER, category_id INTEGER);
    CREATE TABLE k_sound_info_mode (sound_info_id INTEGER, mode_id INTEGER);
    INSERT INTO k_category VALUES
      (1,'Brass','Ensemble',NULL),(2,'Brass','Synth',NULL),
      (3,'Synth Lead',NULL,NULL),(4,'Drums','Kick','Acoustic'),
      (5,'Brass','Ensemble',NULL);
    INSERT INTO k_mode VALUES (1,'Processed'),(2,'Dirty'),(3,'Dirty'),(4,'Analog');
    INSERT INTO k_bank_chain VALUES
      (1,'','ANALOG BRASS AND WINDS','Factory',NULL),
      (2,'Arturia','ARP 2600 V3',NULL,NULL),
      (3,'Xfer','Serum',NULL,NULL);
    INSERT INTO k_sound_info_category VALUES (1,1),(1,2),(2,1);
  `);
  db.close();

  const home = await fs.mkdtemp(path.join(os.tmpdir(), "im-vhome-"));
  process.env.MASCHINE_DB_PATH = file;
  process.env.ICONMASCHINE_HOME = home;
  t.after(async () => {
    delete process.env.MASCHINE_DB_PATH;
    delete process.env.ICONMASCHINE_HOME;
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });
  return file;
}

const hash = async (p: string) =>
  createHash("sha256").update(await fs.readFile(p)).digest("hex");

test("reads Types, Characters and bank chains from the real schema", async (t) => {
  await makeDb(t);
  const { readTagVocabulary } = await import("../src/lib/tagvocab.ts");
  const v = await readTagVocabulary({ refresh: true });

  assert.ok(v.source === "database" || v.source === "database-copy", v.source);
  // Duplicates collapsed, NULLs dropped, deepest path preserved.
  assert.deepEqual(v.types, [
    ["Brass", "Ensemble"],
    ["Brass", "Synth"],
    ["Drums", "Kick", "Acoustic"],
    ["Synth Lead"],
  ]);
  assert.deepEqual(v.characters, ["Analog", "Dirty", "Processed"]);
  assert.deepEqual(v.vendors, ["Arturia", "Xfer"]);
  assert.equal(v.bankChains.length, 3);
});

test("the Maschine database is never modified", async (t) => {
  const file = await makeDb(t);
  const before = await hash(file);
  const { readTagVocabulary } = await import("../src/lib/tagvocab.ts");
  await readTagVocabulary({ refresh: true });
  await readTagVocabulary({ refresh: true });
  assert.equal(await hash(file), before, "komplete.db3 must be byte-identical");
});

test("results are cached, and the cache is invalidated when the db changes", async (t) => {
  const file = await makeDb(t);
  const { readTagVocabulary } = await import("../src/lib/tagvocab.ts");

  await readTagVocabulary({ refresh: true });
  const cached = await readTagVocabulary();
  assert.equal(cached.source, "cache");
  assert.deepEqual(cached.characters, ["Analog", "Dirty", "Processed"]);

  // Change the database: the cache key (size + mtime) must no longer match.
  const db = new DatabaseSync(file);
  db.exec("INSERT INTO k_mode VALUES (9,'Bright')");
  db.close();
  await fs.utimes(file, new Date(Date.now() + 2000), new Date(Date.now() + 2000));

  const fresh = await readTagVocabulary();
  assert.notEqual(fresh.source, "cache", "a changed database must be re-read");
  assert.ok(fresh.characters.includes("Bright"));
});

test("a missing database falls back without throwing", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "im-vhome2-"));
  process.env.MASCHINE_DB_PATH = "/definitely/not/here/komplete.db3";
  process.env.ICONMASCHINE_HOME = home;
  t.after(async () => {
    delete process.env.MASCHINE_DB_PATH;
    delete process.env.ICONMASCHINE_HOME;
    await fs.rm(home, { recursive: true, force: true });
  });

  const { readTagVocabulary } = await import("../src/lib/tagvocab.ts");
  const v = await readTagVocabulary({ refresh: true });
  assert.equal(v.source, "fallback");
  assert.ok(v.types.length > 0 && v.characters.length > 0);
  assert.ok(v.note);
});

test("a database with an unexpected schema falls back rather than crashing", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "im-vbad-"));
  const file = path.join(dir, "komplete.db3");
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE something_else (a TEXT)");
  db.close();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "im-vhome3-"));
  process.env.MASCHINE_DB_PATH = file;
  process.env.ICONMASCHINE_HOME = home;
  t.after(async () => {
    delete process.env.MASCHINE_DB_PATH;
    delete process.env.ICONMASCHINE_HOME;
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  const { readTagVocabulary } = await import("../src/lib/tagvocab.ts");
  const v = await readTagVocabulary({ refresh: true });
  assert.equal(v.source, "fallback");
  assert.ok(v.note?.includes("Could not read"));
});
