import fs from "node:fs/promises";
import path from "node:path";
import { iconmaschineHome } from "./paths";
import { parseNksf, readSummary, type Summary } from "./nksf";
import {
  OutsideUserContentError,
  presetFilesUnder,
  userContentDir,
  writePreset,
  type PresetEdit,
} from "./presets";

/**
 * Apply chosen tag fields to every preset in a folder, and remember the choice
 * as a rule so it can be applied again after a plugin re-save reverts it.
 */

export const TAG_FIELDS = [
  "vendor",
  "bankchain",
  "types",
  "characters",
  "author",
  "comment",
] as const;
export type TagField = (typeof TAG_FIELDS)[number];
/** Only the picked keys are present. */
export type TagFields = Pick<PresetEdit, TagField>;

export interface TagRule {
  /** Relative to User Content, normalised. "" is the User Content root. */
  folder: string;
  fields: TagFields;
  updatedAt: string;
}

export interface FieldChange {
  field: TagField;
  before: Summary[TagField];
  after: Summary[TagField];
}

export type FileOutcome =
  | { relPath: string; status: "changed"; changes: FieldChange[]; backupPath: string | null }
  | { relPath: string; status: "unchanged" }
  | { relPath: string; status: "failed"; error: string };

export interface BatchReport {
  folder: string;
  dryRun: boolean;
  files: FileOutcome[];
  counts: { changed: number; unchanged: number; failed: number };
}

export class InvalidTagFieldsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTagFieldsError";
  }
}

export class InvalidFolderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFolderError";
  }
}

const isString = (v: unknown): v is string => typeof v === "string";
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);

const FIELD_SHAPES: Record<TagField, { expects: string; valid: (v: unknown) => boolean }> = {
  vendor: { expects: "a string", valid: isString },
  bankchain: { expects: "a list of strings", valid: isStringArray },
  types: {
    expects: "a list of string lists",
    valid: (v) => Array.isArray(v) && v.every(isStringArray),
  },
  characters: { expects: "a list of strings", valid: isStringArray },
  author: { expects: "a string", valid: isString },
  comment: { expects: "a string", valid: isString },
};

/** Validates untrusted JSON. Keys set to undefined count as not picked. */
export function parseTagFields(input: unknown): TagFields {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new InvalidTagFieldsError("Fields must be an object.");
  }
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!(TAG_FIELDS as readonly string[]).includes(key)) {
      throw new InvalidTagFieldsError(`Unknown field: ${key}.`);
    }
    if (value === undefined) continue;
    const shape = FIELD_SHAPES[key as TagField];
    if (!shape.valid(value)) {
      throw new InvalidTagFieldsError(`${key} must be ${shape.expects}.`);
    }
    picked[key] = value;
  }
  if (Object.keys(picked).length === 0) {
    throw new InvalidTagFieldsError("Pick at least one field.");
  }
  return picked as TagFields;
}

const pickedFields = (fields: TagFields) => TAG_FIELDS.filter((f) => fields[f] !== undefined);

/** Normalises a folder and checks it sits inside User Content. The folder need not exist. */
function lexicalFolder(rel: string): { abs: string; rel: string } {
  const root = path.resolve(userContentDir());
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new OutsideUserContentError();
  }
  return { abs, rel: path.relative(root, abs) };
}

/** As lexicalFolder, and also requires a real directory with no symlink on the way. */
export async function resolvePresetFolder(rel: string): Promise<{ abs: string; rel: string }> {
  const folder = lexicalFolder(rel);
  try {
    const stat = await fs.lstat(folder.abs);
    if (!stat.isDirectory()) throw new Error("not a directory");
    const realRoot = await fs.realpath(path.resolve(userContentDir()));
    const real = await fs.realpath(folder.abs);
    if (real !== path.join(realRoot, folder.rel)) throw new Error("symlink");
  } catch {
    throw new InvalidFolderError(`"${rel}" is not a plain folder inside User Content.`);
  }
  return folder;
}

export async function runBatch(
  folder: string,
  fields: TagFields,
  { dryRun }: { dryRun: boolean },
): Promise<BatchReport> {
  const target = await resolvePresetFolder(folder);
  const root = path.resolve(userContentDir());
  const names = pickedFields(fields);
  const files: FileOutcome[] = [];

  const absFiles = await presetFilesUnder(target.abs);
  const relPaths = absFiles.map((abs) => path.relative(root, abs)).sort((a, b) => a.localeCompare(b));

  for (const relPath of relPaths) {
    try {
      const { summary } = readSummary(parseNksf(await fs.readFile(path.join(root, relPath))));
      const changes: FieldChange[] = names
        .filter((f) => JSON.stringify(summary[f]) !== JSON.stringify(fields[f]))
        .map((f) => ({ field: f, before: summary[f], after: fields[f] as Summary[typeof f] }));
      if (changes.length === 0) {
        files.push({ relPath, status: "unchanged" });
        continue;
      }
      if (dryRun) {
        files.push({ relPath, status: "changed", changes, backupPath: null });
        continue;
      }
      const written = await writePreset(relPath, fields);
      files.push(
        written.unchanged
          ? { relPath, status: "unchanged" }
          : { relPath, status: "changed", changes, backupPath: written.backupPath },
      );
    } catch (err) {
      files.push({ relPath, status: "failed", error: (err as Error).message });
    }
  }

  const count = (status: FileOutcome["status"]) => files.filter((f) => f.status === status).length;
  return {
    folder: target.rel,
    dryRun,
    files,
    counts: { changed: count("changed"), unchanged: count("unchanged"), failed: count("failed") },
  };
}

const rulesFile = () => path.join(iconmaschineHome(), "preset-tag-rules.json");

export async function listRules(): Promise<TagRule[]> {
  let raw: string;
  try {
    raw = await fs.readFile(rulesFile(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const stored = (JSON.parse(raw) as { rules?: unknown }).rules;
  const rules: TagRule[] = [];
  for (const item of Array.isArray(stored) ? stored : []) {
    try {
      const { folder, fields, updatedAt } = item as Record<string, unknown>;
      if (!isString(folder) || !isString(updatedAt)) continue;
      rules.push({ folder, fields: parseTagFields(fields), updatedAt });
    } catch {
      // A hand-edited or stale rule is skipped, not fatal.
    }
  }
  return rules;
}

async function writeRules(rules: TagRule[]): Promise<void> {
  const file = rulesFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ rules }, null, 2));
  await fs.rename(tmp, file);
}

export async function saveRule(folder: string, fields: unknown): Promise<TagRule> {
  const { rel } = await resolvePresetFolder(folder);
  const rule: TagRule = {
    folder: rel,
    fields: parseTagFields(fields),
    updatedAt: new Date().toISOString(),
  };
  const others = (await listRules()).filter((r) => r.folder !== rel);
  await writeRules([...others, rule].sort((a, b) => a.folder.localeCompare(b.folder)));
  return rule;
}

export async function deleteRule(folder: string): Promise<void> {
  const { rel } = lexicalFolder(folder);
  const rules = await listRules();
  await writeRules(rules.filter((r) => r.folder !== rel));
}

export async function reapplyRule(folder: string): Promise<BatchReport> {
  const { rel } = lexicalFolder(folder);
  const rule = (await listRules()).find((r) => r.folder === rel);
  if (!rule) throw new InvalidFolderError(`No saved rule for "${rel || "User Content"}".`);
  return runBatch(rel, rule.fields, { dryRun: false });
}
