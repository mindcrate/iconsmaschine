import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Fixture mirroring the real schema and the real situation found on disk. */
/** Create an image folder that actually holds artwork, as a real one does. */
async function artFolder(image: string, name: string) {
  await fs.mkdir(path.join(image, name), { recursive: true });
  await fs.writeFile(path.join(image, name, "MST_artwork.png"), "png");
}

async function setup(t: { after: (fn: () => unknown) => void }) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "im-kits-"));
  const image = path.join(base, "image");
  // Expansions that DO have artwork.
  for (const f of ["arcane attic", "astral flutter", "amplified funk", "xfer records"]) {
    await artFolder(image, f);
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
      (7,'','Empty Chain',NULL,NULL),
      (8,'MOOSE LIFE','ALL HIHATS PERCUSSION',NULL,NULL);
    -- flags: 0+mxgrp Group, 4 one-shot, 8 loop, 1 instrument
    INSERT INTO k_sound_info VALUES
      (1,1,0,'mxgrp'),(2,1,0,'mxgrp'),
      (3,2,0,'mxgrp'),(4,2,4,'wav'),(5,2,8,'wav'),
      (6,3,4,'wav'),
      (7,4,1,'nksf'),
      (8,5,4,'wav'),(9,5,8,'wav'),
      (10,6,4,'wav'),
      (11,8,4,'wav'),(12,8,4,'wav');
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

test("a kit with a vendor installs to the vendor folder, not the bank name", async (t) => {
  // Measured on a real system: where the two differ, vendor matched an image
  // folder 1,031 times against the bank chain's 105. image/moose life/ exists;
  // image/all hihats percussion/ does not.
  await setup(t);
  const { scanKits } = await import("../src/lib/kits.ts");
  const { kits } = await scanKits();

  const hihats = kits.find((k) => k.name === "ALL HIHATS PERCUSSION")!;
  assert.equal(hihats.folder, "moose life", "vendor wins when one is set");
  assert.equal(hihats.altFolder, "all hihats percussion", "the name is kept as the alternative");
});

test("a kit with no vendor still uses its bank chain name", async (t) => {
  await setup(t);
  const { scanKits } = await import("../src/lib/kits.ts");
  const { kits } = await scanKits();

  const flava = kits.find((k) => k.name === "Bumpin Flava")!;
  assert.equal(flava.folder, "bumpin flava");
  assert.equal(flava.altFolder, null, "no vendor means no second candidate");
});

test("artwork found under the alternative folder is still reported", async (t) => {
  const { image } = await setup(t);
  // A folder named after the bank chain rather than the vendor - the 105 case.
  await artFolder(image, "all hihats percussion");

  const { scanKits } = await import("../src/lib/kits.ts");
  const { kits } = await scanKits();
  const hihats = kits.find((k) => k.name === "ALL HIHATS PERCUSSION")!;
  assert.equal(hihats.hasArtwork, true);
  assert.equal(hihats.matchedBy, "name", "it matched the alternative, not the vendor");
});

test("matchedBy says which key the folder was found under", async (t) => {
  const { image } = await setup(t);
  await artFolder(image, "moose life");

  const { scanKits } = await import("../src/lib/kits.ts");
  const { kits } = await scanKits();
  assert.equal(kits.find((k) => k.name === "ALL HIHATS PERCUSSION")!.matchedBy, "vendor");
  assert.equal(kits.find((k) => k.name === "Arcane Attic")!.matchedBy, "name");
});

test("a kit sharing a vendor's artwork is distinguishable from one with its own", async (t) => {
  const { image } = await setup(t);
  await artFolder(image, "moose life");

  const { scanKits } = await import("../src/lib/kits.ts");
  const { kits } = await scanKits();

  // ALL HIHATS PERCUSSION has vendor MOOSE LIFE: it resolves to that vendor's
  // folder, so it shows MOOSE LIFE's art rather than its own. The UI needs to
  // tell those apart, which is what hid Voodoo behind MOOSE LIFE.
  const hihats = kits.find((k) => k.name === "ALL HIHATS PERCUSSION")!;
  assert.equal(hihats.hasArtwork, true);
  assert.equal(hihats.matchedBy, "vendor");
  assert.notEqual(
    hihats.vendor.toLowerCase(),
    hihats.name.toLowerCase(),
    "vendor and name differ, so the artwork is shared not its own",
  );

  // Arcane Attic has no vendor and its own folder - genuinely done.
  const arcane = kits.find((k) => k.name === "Arcane Attic")!;
  assert.equal(arcane.matchedBy, "name");
  assert.equal(arcane.vendor, "");
});

test("an empty image folder is not artwork", async (t) => {
  const { image } = await setup(t);
  // A bare folder, as my app leaves behind on a rename, or as the user creates
  // by hand. Maschine has nothing to draw from it, so neither should we claim
  // the kit is done - this is what made Voodoo look finished.
  await fs.mkdir(path.join(image, "moose life"), { recursive: true });

  const { scanKits } = await import("../src/lib/kits.ts");
  const { kits } = await scanKits();

  const hihats = kits.find((k) => k.name === "ALL HIHATS PERCUSSION")!;
  assert.equal(hihats.hasArtwork, false);
  assert.equal(hihats.matchedBy, null);
});

test("artwork nested a level down still counts, as a plugin's is", async (t) => {
  const { image } = await setup(t);
  // A plugin's images live in image/<vendor>/<product>/, so the vendor folder
  // holds no files of its own.
  await fs.rm(path.join(image, "xfer records"), { recursive: true, force: true });
  await artFolder(image, path.join("xfer records", "serum"));

  const { scanKits } = await import("../src/lib/kits.ts");
  const { kits } = await scanKits();

  const serum = kits.find((k) => k.name === "Serum")!;
  assert.equal(serum.hasArtwork, true);
  assert.equal(serum.matchedBy, "vendor");
});
