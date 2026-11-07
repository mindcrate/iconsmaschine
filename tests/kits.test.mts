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
  // Content folders, so a kit can be seen to be live or gone.
  const live = path.join(base, "content", "live-pack");
  const dead = path.join(base, "content", "deleted-pack");
  await fs.mkdir(live, { recursive: true });
  await fs.mkdir(dead, { recursive: true });

  const dbFile = path.join(base, "komplete.db3");
  const db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE k_bank_chain (id INTEGER, bcvendor TEXT, entry1 TEXT, entry2 TEXT, entry3 TEXT);
    CREATE TABLE k_sound_info (id INTEGER, bank_chain_id INTEGER, device_type_flags INTEGER, file_ext TEXT, content_path_id INTEGER, vendor TEXT);
    CREATE TABLE k_content_path (id INTEGER, path TEXT);
    INSERT INTO k_bank_chain VALUES
      (1,'','Arcane Attic','Kits',NULL),
      (2,'','Bumpin Flava',NULL,NULL),
      (3,'','Bumpin Flava','Kits',NULL),
      (4,'Xfer Records','Serum',NULL,NULL),
      (5,'Other','MASCHINE KITS',NULL,NULL),
      (6,'','/Volumes/External/thing.mxgrp',NULL,NULL),
      (7,'','Empty Chain',NULL,NULL),
      (8,'MOOSE LIFE','ALL HIHATS PERCUSSION',NULL,NULL),
      (9,'','Deleted Pack',NULL,NULL),
      (11,'Other','808 COLLECTION',NULL,NULL);
    -- Path 1 is a folder that exists; path 2 is one we delete in a test, the
    -- shape Maschine leaves behind when a user library is removed.
    INSERT INTO k_content_path VALUES (1,'@LIVE@'),(2,'@DEAD@');
    -- flags: 0+mxgrp Group, 4 one-shot, 8 loop, 1 instrument
    INSERT INTO k_sound_info VALUES
      (1,1,0,'mxgrp',1,NULL),(2,1,0,'mxgrp',1,NULL),
      (3,2,0,'mxgrp',1,NULL),(4,2,4,'wav',1,NULL),(5,2,8,'wav',1,NULL),
      (6,3,4,'wav',1,NULL),
      (7,4,1,'nksf',1,NULL),
      (8,5,4,'wav',1,NULL),(9,5,8,'wav',1,NULL),
      (10,6,4,'wav',1,NULL),
      (11,8,4,'wav',1,NULL),(12,8,4,'wav',1,NULL),
      (13,9,4,'wav',2,NULL),
      (15,11,4,'wav',1,'tim moose'),(16,11,4,'wav',1,'tim moose');
  `.replaceAll("@LIVE@", live).replaceAll("@DEAD@", dead));
  db.close();

  process.env.NI_RESOURCES_IMAGE_DIR = image;
  process.env.MASCHINE_DB_PATH = dbFile;
  t.after(async () => {
    delete process.env.NI_RESOURCES_IMAGE_DIR;
    delete process.env.MASCHINE_DB_PATH;
    await fs.rm(base, { recursive: true, force: true });
  });
  return { image, dbFile, base, live, dead };
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

test("a user pack with a vendor nests under it, product folder and all", async (t) => {
  // The layout read off a real system: image/moose life/ holds no files of its
  // own, only ALL BREAKS/, VOCALS/, VOODOO/ and a dozen more siblings, each
  // with its own artwork and .meta. Earlier this returned "moose life" alone,
  // which is a folder of folders - nothing Maschine would draw.
  await setup(t);
  const { scanKits } = await import("../src/lib/kits.ts");
  const { kits } = await scanKits();

  const hihats = kits.find((k) => k.name === "ALL HIHATS PERCUSSION")!;
  assert.equal(hihats.folder, "moose life/all hihats percussion");
  assert.equal(hihats.nestUnder, "moose life");
  assert.equal(hihats.altFolder, "all hihats percussion", "flat stays a candidate");
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
  assert.equal(serum.matchedBy, "nested");
});

test("a kit whose audio folder is gone is flagged, not offered", async (t) => {
  const { image, base } = await setup(t);
  await artFolder(image, "moose life");

  const { scanKits } = await import("../src/lib/kits.ts");
  const { kits } = await scanKits();

  // setup() points content_path at a folder it does create, so a kit whose
  // path exists reads as live...
  const live = kits.find((k) => k.name === "Arcane Attic")!;
  assert.equal(live.contentMissing, false);

  // ...and one pointed at a folder that was deleted reads as missing. This is
  // the ~700-dead-chain case: Maschine keeps k_bank_chain after a user library
  // is removed, so the rows outlive the audio.
  await fs.rm(path.join(base, "content", "deleted-pack"), {
    recursive: true,
    force: true,
  });
  const after = await scanKits();
  const dead = after.kits.find((k) => k.name === "Deleted Pack")!;
  assert.equal(dead.contentMissing, true);
  assert.equal(
    after.kits.indexOf(dead) > after.kits.indexOf(after.kits.find((k) => k.name === "Arcane Attic")!),
    true,
    "dead kits sort last",
  );
});

test("an installed library stays flat, however its vendor reads", async (t) => {
  const { image, base } = await setup(t);
  // Bumpin Flava is the confirmed-working case: vendor "Native Instruments",
  // no image/native instruments/ anywhere on the machine, artwork at
  // image/bumpin flava/. Content under /Users/Shared is the signal.
  const db = new DatabaseSync(path.join(base, "komplete.db3"));
  db.exec(`
    INSERT INTO k_content_path VALUES (3,'/Users/Shared/NI Resources/content/x');
    INSERT INTO k_bank_chain VALUES (10,'Native Instruments','Shared Pack',NULL,NULL);
    INSERT INTO k_sound_info VALUES (14,10,4,'wav',3,NULL);
  `);
  db.close();
  await artFolder(image, "shared pack");

  const { scanKits } = await import("../src/lib/kits.ts");
  const { kits } = await scanKits();

  const pack = kits.find((k) => k.name === "Shared Pack")!;
  assert.equal(pack.nestUnder, null, "installed content does not nest");
  assert.equal(pack.folder, "shared pack");
  assert.equal(pack.matchedBy, "name");
});

test("the vendor on the sounds beats the bank chain's own field", async (t) => {
  const { image } = await setup(t);
  await artFolder(image, path.join("tim moose", "808 collection"));

  const { scanKits } = await import("../src/lib/kits.ts");
  const { kits } = await scanKits();

  // 808 COLLECTION's chain still reads bcvendor "Other" after its 30 sounds
  // were set to "tim moose" - that edit does not touch the chain's field. The
  // sounds are the authority, so reading bcvendor alone would send artwork to
  // the flat path while Maschine looked in the nested one.
  const kit = kits.find((k) => k.name === "808 COLLECTION")!;
  assert.equal(kit.vendor, "tim moose");
  assert.equal(kit.nestUnder, "tim moose");
  assert.equal(kit.folder, "tim moose/808 collection");
  assert.equal(kit.matchedBy, "nested");
});

test("userLibrarySamples lists a library's own WAV files with their bank chains", async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "im-samples-"));
  const dbFile = path.join(base, "komplete.db3");
  const db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE k_bank_chain (id INTEGER, bcvendor TEXT, entry1 TEXT, entry2 TEXT, entry3 TEXT);
    CREATE TABLE k_sound_info (id INTEGER, bank_chain_id INTEGER, file_name TEXT, file_ext TEXT, content_path_id INTEGER);
    CREATE TABLE k_content_path (id INTEGER, path TEXT);
    INSERT INTO k_bank_chain VALUES
      (1,'Other','808 COLLECTION',NULL,NULL),
      (2,'Other','Projects','808 Collection',''),
      (3,'Other','Other Library',NULL,NULL),
      (4,'Native Instruments','808 collection','Kits',NULL),
      (5,'Other','Mike''s Kit',NULL,NULL);
    INSERT INTO k_content_path VALUES (1,'/Volumes/Music/808'),(2,'/Users/Shared/Expansions/808');
    INSERT INTO k_sound_info VALUES
      (1,1,'/Volumes/Music/808/kick.wav','wav',1),
      (2,1,'/Volumes/Music/808/snare.WAV','WAV',1),
      (3,1,'/Volumes/Music/808/kick.wav','wav',1),
      (4,1,'/Volumes/Music/808/loop.aif','aif',1),
      (5,2,'/Volumes/Music/808/nested.wav','wav',1),
      (6,3,'/Volumes/Music/other/x.wav','wav',1),
      (7,4,'/Users/Shared/Expansions/808/installed.wav','wav',2),
      (8,1,'/Users/Shared/Loose/no-content-path.wav','wav',NULL),
      (9,5,'/Volumes/Music/mike/hat .wav','wav',1);
  `);
  db.close();
  process.env.MASCHINE_DB_PATH = dbFile;
  t.after(async () => {
    delete process.env.MASCHINE_DB_PATH;
    await fs.rm(base, { recursive: true, force: true });
  });

  const { userLibrarySamples } = await import("../src/lib/kits.ts");
  const { samples, nonWav } = await userLibrarySamples(" 808 collection ");
  const root = "/Volumes/Music/808";
  assert.deepEqual(samples, [
    { path: "/Volumes/Music/808/kick.wav", root, bankchain: ["808 COLLECTION"] },
    { path: "/Volumes/Music/808/snare.WAV", root, bankchain: ["808 COLLECTION"] },
  ]);
  assert.deepEqual(nonWav, [{ path: "/Volumes/Music/808/loop.aif", root, bankchain: ["808 COLLECTION"] }]);

  const nested = await userLibrarySamples("Projects");
  assert.deepEqual(nested.samples, [
    { path: "/Volumes/Music/808/nested.wav", root: "/Volumes/Music/808", bankchain: ["Projects", "808 Collection"] },
  ]);

  const quoted = await userLibrarySamples("Mike's Kit");
  assert.deepEqual(quoted.samples, [
    { path: "/Volumes/Music/mike/hat .wav", root: "/Volumes/Music/808", bankchain: ["Mike's Kit"] },
  ]);
});

test("userLibrarySamples without a database gives an empty list and a note", async (t) => {
  process.env.MASCHINE_DB_PATH = "/nonexistent/komplete.db3";
  t.after(() => {
    delete process.env.MASCHINE_DB_PATH;
  });
  const { userLibrarySamples } = await import("../src/lib/kits.ts");
  const out = await userLibrarySamples("anything");
  assert.deepEqual(out.samples, []);
  assert.ok(out.note);
});
