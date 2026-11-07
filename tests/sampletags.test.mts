import { test } from "node:test";
import assert from "node:assert/strict";
import { folderOf, parseSampleTags, resolveFields, EMPTY_SAMPLE_TAGS } from "../src/lib/sampletags.ts";

const root = "/Lib/Voodoo";
const t = (rel: string) => ({ path: `${root}/${rel}`, root, bankchain: ["Voodoo"] });

test("folderOf is the folder relative to the library root", () => {
  assert.equal(folderOf(t("Kicks/Hard/K1.wav")), "Kicks/Hard");
  assert.equal(folderOf(t("K1.wav")), "");
  assert.equal(folderOf({ path: "/Else/K1.wav", root, bankchain: [] }), "");
});

test("a folder takes each field from its nearest rule that sets it", () => {
  const tags = parseSampleTags({
    rules: { "": { modes: ["Analog"] }, Kicks: { types: [["Drums", "Kick"]] }, "Kicks/Loops": { kind: "loop" } },
    replaceExisting: false,
    matchFileNames: false,
  });
  assert.deepEqual(resolveFields(t("Kicks/Hard/K1.wav"), tags), {
    types: [["Drums", "Kick"]], modes: ["Analog"], replace: false,
  });
  assert.deepEqual(resolveFields(t("Kicks/Loops/L1.wav"), tags), {
    types: [["Drums", "Kick"]], modes: ["Analog"], deviceType: "LOOP", replace: false,
  });
});

test("keep writes no deviceType, and one-shot writes ONESHOT", () => {
  const tags = parseSampleTags({ rules: { "": { kind: "oneshot" }, Raw: { kind: "keep" } }, replaceExisting: true, matchFileNames: false });
  assert.equal(resolveFields(t("A.wav"), tags)?.deviceType, "ONESHOT");
  assert.equal(resolveFields(t("Raw/A.wav"), tags)?.deviceType, undefined);
});

test("no rules and no name match gives no fields at all", () => {
  assert.equal(resolveFields(t("Kicks/K1.wav"), EMPTY_SAMPLE_TAGS), null);
});

test("file names fill a folder with no types when matching is on", () => {
  const tags = parseSampleTags({ rules: {}, replaceExisting: false, matchFileNames: true });
  assert.deepEqual(resolveFields(t("Drums/Snare 02.wav"), tags), { types: [["Drums", "Snare"]], replace: false });
  assert.equal(resolveFields(t("Drums/Groove [94].wav"), tags)?.deviceType, "LOOP");
});

test("parseSampleTags drops what is not valid", () => {
  const tags = parseSampleTags({
    rules: {
      ok: { kind: "loop", types: [["Drums", "Kick"], ["A", "B", "C", "D"], [], "x"], modes: ["Vinyl", 3] },
      bad: "nope",
      "../up": { kind: "loop" },
      weird: { kind: "sideways" },
    },
    replaceExisting: "yes",
  });
  assert.deepEqual(tags, {
    rules: { ok: { kind: "loop", types: [["Drums", "Kick"]], modes: ["Vinyl"] }, weird: {} },
    replaceExisting: false,
    matchFileNames: false,
  });
});

test("a pack with no saved rules writes nothing new, even for a name that would match", () => {
  assert.equal(resolveFields(t("Kicks/Kick 01.wav"), EMPTY_SAMPLE_TAGS), null);
});
