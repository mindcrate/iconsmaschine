import path from "node:path";
import type { SampleTarget } from "./kits";
import type { SampleFields } from "./wavtag";
import { suggestFromName } from "./samplesuggest";

export type SampleKind = "oneshot" | "loop" | "keep";

/** Each field left out takes the value of the nearest parent folder's rule. */
export interface SampleRule {
  kind?: SampleKind;
  /** Up to 3 TYPES paths, e.g. [["Drums", "Kick"]]. */
  types?: string[][];
  /** CHARACTERS. Written to the WAV under the key `modes`. */
  modes?: string[];
}

export interface SampleTags {
  /** Keyed by folder path relative to the library root, "/"-separated. "" is the whole pack. */
  rules: Record<string, SampleRule>;
  replaceExisting: boolean;
  /** Guess a file's TYPE and kind from its name where no rule sets them. */
  matchFileNames: boolean;
}

/** Name matching starts off, so a pack nobody set rules for installs exactly as before (R9). */
export const EMPTY_SAMPLE_TAGS: SampleTags = { rules: {}, replaceExisting: false, matchFileNames: false };
const MAX_TYPES = 3;
const KINDS: SampleKind[] = ["oneshot", "loop", "keep"];

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];

function parseRule(v: unknown): SampleRule | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const rule: SampleRule = {};
  if (KINDS.includes(r.kind as SampleKind)) rule.kind = r.kind as SampleKind;
  if (Array.isArray(r.types)) {
    rule.types = r.types
      .map(strings)
      .filter((p) => p.length >= 1 && p.length <= 3)
      .slice(0, MAX_TYPES);
  }
  if (Array.isArray(r.modes)) rule.modes = [...new Set(strings(r.modes))];
  return rule;
}

/** Saved or posted rules, cleaned. Anything not valid is dropped, never thrown. */
export function parseSampleTags(v: unknown): SampleTags {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const rules: Record<string, SampleRule> = {};
  if (o.rules && typeof o.rules === "object") {
    for (const [folder, raw] of Object.entries(o.rules as Record<string, unknown>)) {
      if (folder.split("/").some((s) => s === ".." || s === ".")) continue;
      const rule = parseRule(raw);
      if (rule) rules[folder] = rule;
    }
  }
  return {
    rules,
    replaceExisting: o.replaceExisting === true,
    matchFileNames: o.matchFileNames === true,
  };
}

export function folderOf(target: SampleTarget): string {
  const rel = path.relative(target.root, path.dirname(target.path));
  if (!target.root || rel.startsWith("..") || path.isAbsolute(rel)) return "";
  return rel.split(path.sep).join("/");
}

/** "", "Kicks", "Kicks/Hard" for "Kicks/Hard". */
function lineage(folder: string): string[] {
  const parts = folder ? folder.split("/") : [];
  return ["", ...parts.map((_, i) => parts.slice(0, i + 1).join("/"))];
}

/** The fields to write into one file, or null when nothing applies to it. */
export function resolveFields(target: SampleTarget, tags: SampleTags): SampleFields | null {
  const merged: SampleRule = {};
  for (const f of lineage(folderOf(target))) {
    const rule = tags.rules[f];
    if (!rule) continue;
    if (rule.kind !== undefined) merged.kind = rule.kind;
    if (rule.types !== undefined) merged.types = rule.types;
    if (rule.modes !== undefined) merged.modes = rule.modes;
  }
  if (tags.matchFileNames) {
    const guess = suggestFromName(path.basename(target.path, path.extname(target.path)));
    if (!merged.types?.length && guess.types) merged.types = guess.types;
    if (merged.kind === undefined && guess.kind) merged.kind = guess.kind;
  }

  const fields: SampleFields = { replace: tags.replaceExisting };
  if (merged.types?.length) fields.types = merged.types;
  if (merged.modes?.length) fields.modes = merged.modes;
  if (merged.kind === "loop") fields.deviceType = "LOOP";
  if (merged.kind === "oneshot") fields.deviceType = "ONESHOT";
  return Object.keys(fields).length > 1 ? fields : null;
}
