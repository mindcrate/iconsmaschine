import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { iconmaschineHome } from "./paths";

export const SETTING_NAMES = ["OPENAI_API_KEY", "SERPAPI_API_KEY", "OPENAI_IMAGE_MODEL"] as const;
export type SettingName = (typeof SETTING_NAMES)[number];
export type Settings = Partial<Record<SettingName, string>>;

export interface SettingStatus {
  set: boolean;
  source: "env" | "file" | null;
  /** The last four characters, so two keys can be told apart. */
  hint: string | null;
}

const file = () => path.join(iconmaschineHome(), "settings.json");

/** Read on every call, so a saved key works at once, with no restart. */
function readFile(): Settings {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), "utf8")) as Record<string, unknown>;
    const out: Settings = {};
    for (const n of SETTING_NAMES) {
      const v = raw[n];
      if (typeof v === "string" && v.trim()) out[n] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

/** The environment wins, so `.env.local` keeps working in dev. */
export function setting(name: SettingName): string | undefined {
  return process.env[name]?.trim() || readFile()[name];
}

export function settingsStatus(): Record<SettingName, SettingStatus> {
  const stored = readFile();
  const out = {} as Record<SettingName, SettingStatus>;
  for (const n of SETTING_NAMES) {
    const env = process.env[n]?.trim();
    const value = env || stored[n];
    out[n] = {
      set: Boolean(value),
      source: env ? "env" : stored[n] ? "file" : null,
      hint: value ? value.slice(-4) : null,
    };
  }
  return out;
}

/** Merges into the saved file. An empty string clears that one setting. */
export async function saveSettings(changes: Settings): Promise<void> {
  const next = readFile();
  for (const n of SETTING_NAMES) {
    if (!(n in changes)) continue;
    const v = changes[n]?.trim();
    if (v) next[n] = v;
    else delete next[n];
  }
  await fsp.mkdir(iconmaschineHome(), { recursive: true });
  const tmp = `${file()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  await fsp.chmod(tmp, 0o600);
  await fsp.rename(tmp, file());
}
