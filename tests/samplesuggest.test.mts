import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestFolders, suggestFromName, tokens } from "../src/lib/samplesuggest.ts";

test("names split on case, digits and punctuation, with plurals folded", () => {
  assert.deepEqual(tokens("808Bass_Kicks-01"), ["808", "bass", "kick", "01"]);
  assert.deepEqual(tokens("OpenHat"), ["open", "hat"]);
});

test("drum words give Maschine's TYPES", () => {
  assert.deepEqual(suggestFromName("Kick 01").types, [["Drums", "Kick"]]);
  assert.deepEqual(suggestFromName("TR909 OH 3").types, [["Drums", "Hi-Hat Open"]]);
  assert.deepEqual(suggestFromName("Open Hat").types, [["Drums", "Hi-Hat Open"]]);
  assert.deepEqual(suggestFromName("HH_closed").types, [["Drums", "Hi-Hat Closed"]]);
  assert.deepEqual(suggestFromName("Hat 4").types, [["Drums", "Hi-Hat"]]);
  assert.deepEqual(suggestFromName("808 Kick").types, [["Drums", "Kick"]]);
  assert.equal(suggestFromName("Gm - P78_001").types, undefined);
});

test("loop words and tempos mark a loop", () => {
  assert.equal(suggestFromName("Synth[160] C Eclipse").kind, "loop");
  assert.equal(suggestFromName("Groove 94bpm").kind, "loop");
  assert.equal(suggestFromName("Drums_120_Am").kind, "loop");
  assert.equal(suggestFromName("Kick 01").kind, undefined);
  assert.equal(suggestFromName("Snare_1000_x").kind, undefined);
});

test("a type the vocabulary lacks falls back to its parent, or is dropped", () => {
  const known = new Set(["Drums", "Bass"]);
  assert.deepEqual(suggestFromName("Kick 01", known).types, [["Drums"]]);
  assert.equal(suggestFromName("Vox 1", known).types, undefined);
});

test("folders are suggested from their own name and their parents' loop words", () => {
  const s = suggestFolders([
    { folder: "Kicks", files: ["K1", "K2"] },
    { folder: "Loops/Drums", files: ["A", "B"] },
    { folder: "Misc", files: ["X [90]", "Y [92]", "Z [94]", "W [96]", "V"] },
    { folder: "Stuff", files: ["X", "Y"] },
  ]);
  assert.deepEqual(s.Kicks, { types: [["Drums", "Kick"]] });
  assert.deepEqual(s["Loops/Drums"], { kind: "loop", types: [["Drums"]] });
  assert.deepEqual(s.Misc, { kind: "loop" });
  assert.equal(s.Stuff, undefined);
});
