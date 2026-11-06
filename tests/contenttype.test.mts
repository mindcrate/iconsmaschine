import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classify,
  describeCounts,
  emptyCounts,
  groupCounts,
  groupOf,
  groupsPresent,
} from "../src/lib/contenttype.ts";

/* The mapping below was decoded by pairing each device_type_flags value with
   the file extensions behind it on a real 270,443-row database. */

test("flags decode to the content types seen on a real system", () => {
  assert.equal(classify(1, "nksf"), "instrument");
  assert.equal(classify(1, "nki"), "instrument");
  assert.equal(classify(1, "nmsv"), "instrument");
  assert.equal(classify(2, "ngrr"), "effect");
  assert.equal(classify(2, "mxfx"), "effect");
  assert.equal(classify(4, "wav"), "oneshot");
  assert.equal(classify(4, "aif"), "oneshot");
  assert.equal(classify(8, "wav"), "loop");
  assert.equal(classify(8, "aif"), "loop");
});

test("flag 0 is resolved by file extension, not by the flag", () => {
  // Maschine's own formats all carry flag 0; only the extension separates them.
  assert.equal(classify(0, "mxgrp"), "group");
  assert.equal(classify(0, "mxsnd"), "sound");
  assert.equal(classify(0, "mxprj"), "project");
  assert.equal(classify(0, "ens"), "other");
  assert.equal(classify(0, ""), "other");
});

test("extension case and padding do not change the answer", () => {
  assert.equal(classify(0, "  MXGRP  "), "group");
  assert.equal(classify(0, "MxSnd"), "sound");
});

test("one-shot wins over loop when both bits are set", () => {
  // Not seen in the wild, but the bitmask allows it; the result must be stable.
  assert.equal(classify(4 | 8, "wav"), "oneshot");
});

test("an unknown flag falls through to other rather than guessing", () => {
  assert.equal(classify(64, "xyz"), "other");
});

test("Groups and Samples are distinct UI groupings", () => {
  assert.equal(groupOf("group"), "groups");
  assert.equal(groupOf("sound"), "groups");
  assert.equal(groupOf("oneshot"), "samples");
  assert.equal(groupOf("loop"), "samples");
  assert.equal(groupOf("instrument"), "instruments");
  assert.equal(groupOf("effect"), "effects");
  assert.equal(groupOf("project"), "other");
});

test("a kit holding several types reports all of them, largest first", () => {
  // INSTRUMENT SAMPLE LIBRARIES really does hold both, in this proportion.
  const counts = { ...emptyCounts(), oneshot: 8244, loop: 5949, group: 3 };
  assert.deepEqual(groupCounts(counts).samples, 14193);
  assert.deepEqual(groupsPresent(counts), ["samples", "groups"]);
});

test("empty counts report no groups at all", () => {
  assert.deepEqual(groupsPresent(emptyCounts()), []);
});

test("the description names the biggest types, pluralised", () => {
  assert.equal(
    describeCounts({ ...emptyCounts(), oneshot: 2304, loop: 1950 }),
    "2,304 one-shots, 1,950 loops",
  );
  assert.equal(describeCounts({ ...emptyCounts(), group: 1 }), "1 group");
});
