/**
 * NKS preset files (.nksf / .nksn).
 *
 * Layout, read from a real Serum preset:
 *
 *   "RIFF" <u32 size> "NIKS"
 *     "NISI" <u32 size> <u32 version=1> <MessagePack map>   summary info
 *     "NICA" <u32 size> ...                                 controller assignments
 *     "PLID" <u32 size> ...                                 plugin id
 *     "PCHK" <u32 size> ...                                 the plugin's own state
 *
 * Only NISI is ever touched. Every other chunk is carried through byte for
 * byte, in its original order, because they hold the actual sound.
 */

import { decode, encode, type MsgValue } from "./msgpack";
import { parseRiff, RiffError, serialiseRiff, type Chunk } from "./riff";

const FORM = "NIKS";
const SUMMARY = "NISI";

export type { Chunk };

export interface NksfFile {
  form: string;
  chunks: Chunk[];
}

export class NotAnNksfError extends Error {
  constructor(detail: string) {
    super(`Not a readable NKS preset: ${detail}`);
    this.name = "NotAnNksfError";
  }
}

export function parseNksf(buf: Buffer): NksfFile {
  try {
    return parseRiff(buf, FORM);
  } catch (err) {
    if (err instanceof RiffError) throw new NotAnNksfError(err.message);
    throw err;
  }
}

export function serialiseNksf(file: NksfFile): Buffer {
  return serialiseRiff(file);
}

/** The fields Maschine shows on GENERAL, TYPES and CHARACTERS. */
export interface Summary {
  author: string;
  /** The lines shown under GENERAL. Usually [product] or [vendor, product]. */
  bankchain: string[];
  /** CHARACTERS tab, e.g. ["Acoustic", "Additive"]. */
  characters: string[];
  comment: string;
  /** "INST" or "FX". */
  deviceType: string;
  name: string;
  /** TYPES tab. Each entry is a path, e.g. ["Brass", "Synth Brass"]. */
  types: string[][];
  uuid: string;
  vendor: string;
  /** Anything NI added that this app does not model, preserved on write. */
  extra: Record<string, MsgValue>;
}

const KNOWN_KEYS = new Set([
  "author",
  "bankchain",
  "characters",
  "comment",
  "deviceType",
  "name",
  "types",
  "uuid",
  "vendor",
]);

function asStringArray(v: MsgValue): string[] {
  return Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : "")) : [];
}

function asTypes(v: MsgValue): string[][] {
  if (!Array.isArray(v)) return [];
  return v.map((entry) =>
    Array.isArray(entry)
      ? entry.map((x) => (typeof x === "string" ? x : ""))
      : [typeof entry === "string" ? entry : ""],
  );
}

export interface SummaryChunk {
  version: number;
  summary: Summary;
  /** Key order as found, so a rewrite reproduces the original byte layout. */
  keyOrder: string[];
}

export function readSummary(file: NksfFile): SummaryChunk {
  const chunk = file.chunks.find((c) => c.id === SUMMARY);
  if (!chunk) throw new NotAnNksfError(`no ${SUMMARY} chunk`);
  if (chunk.data.length < 4) throw new NotAnNksfError(`${SUMMARY} chunk is too short`);

  const version = chunk.data.readUInt32LE(0);
  const { value } = decode(chunk.data.subarray(4));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NotAnNksfError(`${SUMMARY} payload is not a map`);
  }

  const map = value as Record<string, MsgValue>;
  const extra: Record<string, MsgValue> = {};
  for (const [k, v] of Object.entries(map)) {
    if (!KNOWN_KEYS.has(k)) extra[k] = v;
  }

  const str = (k: string) => (typeof map[k] === "string" ? (map[k] as string) : "");

  return {
    version,
    keyOrder: Object.keys(map),
    summary: {
      author: str("author"),
      bankchain: asStringArray(map.bankchain),
      characters: asStringArray(map.characters),
      comment: str("comment"),
      deviceType: str("deviceType"),
      name: str("name"),
      types: asTypes(map.types),
      uuid: str("uuid"),
      vendor: str("vendor"),
      extra,
    },
  };
}

function toMap(s: Summary, keyOrder: string[]): Record<string, MsgValue> {
  const values: Record<string, MsgValue> = {
    author: s.author,
    bankchain: s.bankchain,
    characters: s.characters,
    comment: s.comment,
    deviceType: s.deviceType,
    name: s.name,
    types: s.types,
    uuid: s.uuid,
    vendor: s.vendor,
    ...s.extra,
  };

  // Preserve the original key order, then append anything new.
  const out: Record<string, MsgValue> = {};
  for (const k of keyOrder) {
    if (k in values) out[k] = values[k];
  }
  for (const k of Object.keys(values)) {
    if (!(k in out)) out[k] = values[k];
  }
  return out;
}

export function writeSummary(
  file: NksfFile,
  chunk: SummaryChunk,
): NksfFile {
  const version = Buffer.alloc(4);
  version.writeUInt32LE(chunk.version, 0);
  const payload = Buffer.concat([
    version,
    encode(toMap(chunk.summary, chunk.keyOrder)),
  ]);

  return {
    form: file.form,
    chunks: file.chunks.map((c) =>
      c.id === SUMMARY ? { id: c.id, data: payload } : c,
    ),
  };
}

/** Convenience: read a buffer, apply an edit, return new bytes. */
export function editPreset(
  buf: Buffer,
  edit: (s: Summary) => Summary,
): Buffer {
  const file = parseNksf(buf);
  const chunk = readSummary(file);
  const next = { ...chunk, summary: edit(chunk.summary) };
  return serialiseNksf(writeSummary(file, next));
}
