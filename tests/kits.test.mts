import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Fixture mirroring the real schema and the real situation found on disk. */
async function setup(t: { after: (fn: () => unknown) => void }) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "im-kits-"));
  const image = path.join(base, "image");
  // Expansions that DO have artwork.
  for (const f of ["arcane attic", "astral flutter", "amplified funk", "xfer records"]) {
    await fs.mkdir(path.join(image, f), { recursive: true });
  }
  const dbFile = path.join(base, "komplete.db3");
  const db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE k_bank_chain (id INTEGER, bcvendor TEXT, entry1 TEXT, entry2 TEXT, entry3 TEXT);
    CREATE TABLE k_sound_info (id INTEGER, bank_chain_id INTEGER, device_type_flags INTEGER, file_ext TEXT);
    INSERT INTO k_bank_chain VALUES
      (1,'','Arcane Attic','Kits',NULL),
      (2,'','Bumpin Flava',NULL,NULL),
      (3,'','Bumpin Flava','Kits',NULL),
      (4,'Xfer Records','Serum',NULL,NULL),
      (5,'Other','MASCHINE KITS',NULL,NULL),
      (6,'','/Volumes/External/thing.mxgrp',NULL,NULL),
      (7,'','Empty Chain',NULL,NULL);
    -- flags: 0+mxgrp Group, 4 one-shot, 8 loop, 1 instrument
    INSERT INTO k_sound_info VALUES
      (1,1,0,'mxgrp'),(2,1,0,'mxgrp'),
      (3,2,0,'mxgrp'),(4,2,4,'wav'),(5,2,8,'wav'),
      (6,3,4,'wav'),
      (7,4,1,'nksf'),
      (8,5,4,'wav'),(9,5,8,'wav'),
      (10,6,4,'wav');
  `);
  db.close();

  process.env.NI_RESOURCES_IMAGE_DIR = image;
  process.env.MASCHINE_DB_PATH = dbFile;
  t.after(async () => {
    delete process.env.NI_RESOURCES_IMAGE_DIR;
    delete process.env.MASCHINE_DB_PATH;
    await fs.rm(base, { recursive: true, force: true });
  });
  return { image, dbFile };
}

test("kits with no image folder are flagged, and listed first", async (t) => {
  await setup(t);
  const { scanKits } = await import("../src/lib/kits.ts");
  const { kits } = await scanKits();

  const byName = Object.fromEntries(kits.map((k) => [k.name, k]));
  assert.equal(byName["Arcane Attic"].hasArtwork, true);
  assert.equal(byName["Bumpin Flava"].hasArtwork, false);
  // Missing artwork sorts to the top, so it is what you see first.
  assert.equal(kits[0].hasArtwork, false);
});

test("chain rows sharing a name are collapsed and their sounds summed", async (t) => {
  await setup(t);
  const { scanKits } = await import("../src/lib/kits.ts");
  const { kits } = await scanKits();

  const flava = kits.filter((k) => k.name === "Bumpin Flava");
  assert.equal(flava.length, 1, "two chain rows, one kit");
  assert.equal(flava[0].sounds, 4, "3 + 1 sounds added up");
  assert.equal(flava[0].folder, "bumpin flava");
});

test("a kit covered by its vendor's folder counts as having artwork", async (t) => {
  await setup(t);
  const { scanKits } = await import("../src/lib/kits.ts");
  const { kits } = await scanKits();
  // No image/serum folder, but image/xfer records exists.
  assert.equal(kits.find((k) => k.name === "Serum")!.hasArtwork, true);
});

test('"Other" is treated as no vendor, since it is Maschine\'s catch-all', async (t) => {
  await setup(t);
  const { scanKits } = await import("../src/lib/kits.ts");
  const { kits } = await scanKits();
  const mk = kits.find((k) => k.name === "MASCHINE KITS")!;
  assert.equal(mk.vendor, "", '"Other" must not be used as a vendor');
  assert.equal(mk.hasArtwork, false);
});

test("path-like chain entries and empty chains are skipped", async (t) => {
  await setup(t);
  const { scanKits } = await import("../src/lib/kits.ts");
  const { kits } = await scanKits();
  assert.equal(kits.some((k) => k.name.startsWith("/")), false, "paths are not kits");
  assert.equal(kits.some((k) => k.name === "Empty Chain"), false, "no sounds, not listed");
});

test("the database is never modified", async (t) => {
  const { dbFile } = await setup(t);
  const before = await fs.readFile(dbFile);
  const { scanKits } = await import("../src/lib/kits.ts");
  await scanKits();
  await scanKits();
  assert.equal((await fs.readFile(dbFile)).equals(before), true);
});

test("a missing database reports rather than throwing", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "im-kits2-"));
  process.env.NI_RESOURCES_IMAGE_DIR = path.join(base, "image");
  process.env.MASCHINE_DB_PATH = "/nope/komplete.db3";
  t.after(async () => {
    delete process.env.NI_RESOURCES_IMAGE_DIR;
    delete process.env.MASCHINE_DB_PATH;
    await fs.rm(base, { recursive: true, force: true });
  });
  const { scanKits } = await import("../src/lib/kits.ts");
  const res = await scanKits();
  assert.deepEqual(res.kits, []);
  assert.ok(res.note);
});

test("a kit is broken down by content type, not given one label", async (t) => {
  await setup(t);
  const { scanKits } = await import("../src/lib/kits.ts");
  const { kits } = await scanKits();

  // Bumpin Flava's two chain rows hold a Group, a one-shot and a loop.
  const flava = kits.find((k) => k.name === "Bumpin Flava")!;
  assert.equal(flava.counts.group, 1);
  assert.equal(flava.counts.oneshot, 2, "one from each chain row");
  assert.equal(flava.counts.loop, 1);
  assert.equal(flava.sounds, 4);

  // Groups and Samples are separate groupings, both present here.
  assert.ok(flava.groups.includes("groups"));
  assert.ok(flava.groups.includes("samples"));
});

test("Groups, Samples, Instruments and Effects are classified apart", async (t) => {
  await setup(t);
  const { scanKits } = await import("../src/lib/kits.ts");
  const { kits } = await scanKits();

  const arcane = kits.find((k) => k.name === "Arcane Attic")!;
  assert.deepEqual(arcane.groups, ["groups"], "only .mxgrp content");
  assert.equal(arcane.counts.group, 2);

  const serum = kits.find((k) => k.name === "Serum")!;
  assert.deepEqual(serum.groups, ["instruments"], "an .nksf preset is an instrument");

  const mk = kits.find((k) => k.name === "MASCHINE KITS")!;
  assert.deepEqual(mk.groups, ["samples"], "wav content is samples");
});
