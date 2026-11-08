import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveSettings, setting, settingsStatus } from "../src/lib/settings.ts";

const NAMES = ["OPENAI_API_KEY", "SERPAPI_API_KEY", "OPENAI_IMAGE_MODEL"] as const;
let home: string;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "im-settings-"));
  saved.ICONMASCHINE_HOME = process.env.ICONMASCHINE_HOME;
  process.env.ICONMASCHINE_HOME = home;
  for (const n of NAMES) {
    saved[n] = process.env[n];
    delete process.env[n];
  }
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(home, { recursive: true, force: true });
});

test("a saved key is read back, and only the owner can read the file", async () => {
  await saveSettings({ OPENAI_API_KEY: "sk-test-1234" });
  assert.equal(setting("OPENAI_API_KEY"), "sk-test-1234");
  const mode = fs.statSync(path.join(home, "settings.json")).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("an environment variable wins over the saved value", async () => {
  await saveSettings({ SERPAPI_API_KEY: "from-file" });
  process.env.SERPAPI_API_KEY = "from-env";
  assert.equal(setting("SERPAPI_API_KEY"), "from-env");
  assert.equal(settingsStatus().SERPAPI_API_KEY.source, "env");
});

test("no file and no env gives undefined, not an error", () => {
  assert.equal(setting("OPENAI_API_KEY"), undefined);
  assert.deepEqual(settingsStatus().OPENAI_API_KEY, { set: false, source: null, hint: null });
});

test("an empty string clears a saved key and leaves the others", async () => {
  await saveSettings({ OPENAI_API_KEY: "sk-a", SERPAPI_API_KEY: "serp-b" });
  await saveSettings({ OPENAI_API_KEY: "" });
  assert.equal(setting("OPENAI_API_KEY"), undefined);
  assert.equal(setting("SERPAPI_API_KEY"), "serp-b");
});

test("the status shows only the last four characters", async () => {
  await saveSettings({ OPENAI_API_KEY: "sk-secret-abcd" });
  assert.equal(settingsStatus().OPENAI_API_KEY.hint, "abcd");
  assert.ok(!JSON.stringify(settingsStatus()).includes("secret"));
});

test("a value is trimmed, and unknown names are ignored", async () => {
  await saveSettings({ OPENAI_API_KEY: "  sk-x  ", EVIL: "x" } as never);
  assert.equal(setting("OPENAI_API_KEY"), "sk-x");
  const file = JSON.parse(fs.readFileSync(path.join(home, "settings.json"), "utf8"));
  assert.deepEqual(Object.keys(file), ["OPENAI_API_KEY"]);
});
