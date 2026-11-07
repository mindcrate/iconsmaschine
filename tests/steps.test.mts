import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blockers, fallbackStep, nextStep, prevStep, stepViews, toolsFor, type PackFacts,
} from "../src/lib/steps.ts";

const fresh: PackFacts = {
  kitType: "sample_kit", kitChosen: false, nameValid: false, browserValid: false,
  hasArtwork: false, built: false, nestedSampleKit: false, installed: false,
};
const ids = (f: PackFacts) => stepViews(f).map((v) => v.id);
const state = (f: PackFacts, id: string) => stepViews(f).find((v) => v.id === id)?.state;

test("a new pack opens only the kit type step", () => {
  const views = stepViews(fresh);
  assert.equal(views[0].state, "open");
  assert.ok(views.slice(1).every((v) => v.state === "locked"));
});

test("each kit type lists only its own steps", () => {
  assert.deepEqual(ids({ ...fresh, kitType: "plugin" }),
    ["kit", "name", "browser", "artwork", "text", "details", "review", "install"]);
  assert.deepEqual(ids({ ...fresh, kitType: "sample_kit" }),
    ["kit", "name", "artwork", "text", "details", "review", "install"]);
  assert.deepEqual(ids({ ...fresh, kitType: "sample_kit", nestedSampleKit: true }),
    ["kit", "name", "artwork", "text", "details", "review", "sampletags", "install"]);
  assert.deepEqual(ids({ ...fresh, kitType: "kontakt" }),
    ["kit", "name", "artwork", "text", "details", "review", "install"]);
});

test("steps unlock in order as the pack fills in", () => {
  const named = { ...fresh, kitChosen: true, nameValid: true };
  assert.equal(state(named, "name"), "done");
  assert.equal(state(named, "artwork"), "open");
  assert.equal(state(named, "review"), "locked");
  const withArt = { ...named, hasArtwork: true };
  assert.equal(state(withArt, "text"), "open");
  assert.equal(state(withArt, "details"), "open");
  assert.equal(state(withArt, "review"), "open");
  assert.equal(state(withArt, "install"), "locked");
  assert.equal(state({ ...withArt, built: true }, "install"), "open");
  assert.equal(state({ ...withArt, built: true, installed: true }, "install"), "done");
});

test("a plugin's artwork waits for its browser entry", () => {
  const named = { ...fresh, kitType: "plugin" as const, kitChosen: true, nameValid: true };
  assert.equal(state(named, "artwork"), "locked");
  assert.equal(state({ ...named, browserValid: true }, "artwork"), "open");
});

test("a locked step names the first steps still to do", () => {
  const chosen = { ...fresh, kitChosen: true };
  assert.deepEqual(blockers(stepViews(chosen), "install"), ["name"]);
  const plugin = { ...chosen, kitType: "plugin" as const, nameValid: true };
  assert.deepEqual(blockers(stepViews(plugin), "review"), ["browser"]);
});

test("Next skips locked steps and stops at an unfinished required step", () => {
  const withArt = { ...fresh, kitChosen: true, nameValid: true, hasArtwork: true };
  const views = stepViews(withArt);
  assert.equal(nextStep(views, "artwork"), "text");
  assert.equal(nextStep(views, "details"), "review");
  assert.equal(nextStep(views, "review"), null, "review is not built yet");
  assert.equal(prevStep(views, "text"), "artwork");
  assert.equal(prevStep(views, "kit"), null);
});

test("a step the kit type hides falls back to the nearest open step before it", () => {
  const nested = { ...fresh, kitChosen: true, nameValid: true, hasArtwork: true, built: true, nestedSampleKit: true };
  assert.equal(fallbackStep(stepViews(nested), "sampletags"), "sampletags");
  assert.equal(fallbackStep(stepViews({ ...nested, nestedSampleKit: false }), "sampletags"), "review");
  assert.equal(fallbackStep(stepViews({ ...nested, built: false }), "install"), "review");
});

test("preset tools show only for plugins and Kontakt", () => {
  assert.deepEqual(toolsFor("plugin").map((t) => t.id), ["presets", "batch"]);
  assert.deepEqual(toolsFor("kontakt").map((t) => t.id), ["presets", "batch"]);
  assert.deepEqual(toolsFor("sample_kit"), []);
  assert.deepEqual(toolsFor("group"), []);
});
