import keywords from "../data/sample-keywords.json" with { type: "json" };
import type { SampleKind, SampleRule } from "./sampletags";

const TEMPO = /\[(\d{2,3})\]|(?:^|[^\d])(\d{2,3})\s?bpm|_(\d{2,3})_/i;
const MIN_BPM = 60;
const MAX_BPM = 200;
/** Share of a folder's files with a tempo in the name before the folder counts as loops. */
const LOOP_SHARE = 0.8;

export function tokens(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

function hasWord(words: string[], entry: string): boolean {
  const parts = entry.split("+");
  return parts.every((p) => words.includes(p) || words.includes(p.replace(/s$/, "")));
}

function hasTempo(name: string): boolean {
  const m = TEMPO.exec(name);
  const bpm = m ? Number(m[1] ?? m[2] ?? m[3]) : 0;
  return bpm >= MIN_BPM && bpm <= MAX_BPM;
}

function knownOrParent(type: string[], known?: Set<string>): string[] | null {
  if (!known) return type;
  for (let n = type.length; n > 0; n--) {
    const p = type.slice(0, n);
    if (known.has(p.join(" > "))) return p;
  }
  return null;
}

/**
 * A guess from one name. `known` holds the TYPES paths Maschine has, joined
 * with " > "; a guess outside it falls back to its parent, or is dropped.
 */
export function suggestFromName(name: string, known?: Set<string>): { types?: string[][]; kind?: SampleKind } {
  const words = tokens(name);
  const out: { types?: string[][]; kind?: SampleKind } = {};
  for (const e of keywords.types) {
    if (e.words.some((w) => hasWord(words, w))) {
      const t = knownOrParent(e.type, known);
      if (t) out.types = [t];
      break;
    }
  }
  if (keywords.loop.some((w) => hasWord(words, w)) || hasTempo(name)) out.kind = "loop";
  else if (keywords.oneshot.some((w) => hasWord(words, w))) out.kind = "oneshot";
  return out;
}

/** Suggested rules for folders, from the folder's name, its parents' loop words and its files' tempos. */
export function suggestFolders(
  folders: { folder: string; files: string[] }[],
  known?: Set<string>,
): Record<string, SampleRule> {
  const out: Record<string, SampleRule> = {};
  for (const { folder, files } of folders) {
    if (!folder) continue;
    const segments = folder.split("/");
    const rule: SampleRule = {};
    const own = suggestFromName(segments[segments.length - 1], known);
    if (segments.some((s) => suggestFromName(s).kind === "loop")) rule.kind = "loop";
    else if (own.kind) rule.kind = own.kind;
    else if (files.length > 0 && files.filter(hasTempo).length / files.length >= LOOP_SHARE) rule.kind = "loop";
    if (own.types) rule.types = own.types;
    if (Object.keys(rule).length > 0) out[folder] = rule;
  }
  return out;
}
