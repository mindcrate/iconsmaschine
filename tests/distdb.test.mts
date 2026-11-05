import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMeta } from "../src/lib/nimeta.ts";
import {
  buildCategoriesJson,
  buildColorJson,
  buildShortNameJson,
  buildDistDbFiles,
  folderName,
  normaliseHex,
} from "../src/lib/distdb.ts";

/* Byte-for-byte targets transcribed from a real installed system. */

const REAL_IMAGE_META = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<resource version="2.654.0.0">

  <name>Amplified Funk</name>

  <type>image</type>

</resource>
`;

const REAL_DISTDB_META = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<resource version="1.0.0.0">

  <vendor>FutureAudioWorkshop</vendor>

  <name>SubLab</name>

  <type>dist_database</type>

</resource>
`;

test("image .meta reproduces a real NI file exactly", () => {
  const out = buildMeta({
    name: "Amplified Funk",
    type: "image",
    version: "2.654.0.0",
  });
  assert.equal(out, REAL_IMAGE_META);
});

test("dist_database .meta reproduces a real third-party file exactly", () => {
  const out = buildMeta({
    name: "SubLab",
    vendor: "FutureAudioWorkshop",
    type: "dist_database",
  });
  assert.equal(out, REAL_DISTDB_META);
});

test("image .meta carries no vendor, dist_database .meta requires one", () => {
  const img = buildMeta({ name: "X", type: "image", vendor: "Ignored" });
  assert.equal(img.includes("<vendor>"), false);
  assert.ok(img.includes("<type>image</type>"));

  assert.throws(
    () => buildMeta({ name: "X", type: "dist_database" }),
    /requires a vendor/,
  );
});

test("XML special characters in names are escaped", () => {
  const out = buildMeta({
    name: 'Tom & "Jerry" <v2>',
    vendor: "A & B",
    type: "dist_database",
  });
  assert.ok(out.includes("<name>Tom &amp; &quot;Jerry&quot; &lt;v2&gt;</name>"));
  assert.ok(out.includes("<vendor>A &amp; B</vendor>"));
  assert.equal(out.includes("<v2>"), false);
});

const INPUT = {
  vendor: "FutureAudioWorkshop",
  product: "SubLab",
  fileType: "Instruments",
  categories: ["Synthesizers"],
  bgColor: "f4b021",
  shortName: null,
};

test("categories.json carries the keys NI actually uses", () => {
  const parsed = JSON.parse(buildCategoriesJson(INPUT));
  assert.deepEqual(parsed, {
    Vendor: "FutureAudioWorkshop",
    Product: "SubLab",
    CategoryDB: [{ FileType: "Instruments", Categories: ["Synthesizers"] }],
  });
});

test("color.json stores bare hex, stripping any leading hash", () => {
  assert.deepEqual(JSON.parse(buildColorJson(INPUT)), { VB_bgcolor: "f4b021" });
  assert.deepEqual(
    JSON.parse(buildColorJson({ ...INPUT, bgColor: "#F4B021" })),
    { VB_bgcolor: "f4b021" },
  );
  assert.equal(normaliseHex("nonsense"), "000000");
});

test("shortname.json defines all four hardware generations", () => {
  const parsed = JSON.parse(buildShortNameJson(INPUT));
  assert.deepEqual(Object.keys(parsed).sort(), [
    "MIKRO_shortname",
    "MKII_shortname",
    "MST_shortname",
    "VB_shortname",
  ]);
  assert.equal(parsed.VB_shortname, "SubLab");

  const custom = JSON.parse(
    buildShortNameJson({ ...INPUT, shortName: "Sub" }),
  );
  assert.equal(custom.MST_shortname, "Sub");
});

test("a dist_database entry is the three JSON files plus a lowercase .meta", () => {
  const files = buildDistDbFiles(INPUT);
  assert.deepEqual(
    files.map((f) => f.file).sort(),
    ["categories.json", "color.json", "shortname.json", "sublab.meta"],
  );
  const meta = files.find((f) => f.file === "sublab.meta")!;
  assert.equal(meta.buffer.toString("utf8"), REAL_DISTDB_META);
});

test("folder names are lowercased the way NI stores them", () => {
  assert.equal(folderName("SubLab"), "sublab");
  assert.equal(folderName("Amplified Funk"), "amplified funk");
  assert.equal(folderName("  Sugar Bytes "), "sugar bytes");
});
