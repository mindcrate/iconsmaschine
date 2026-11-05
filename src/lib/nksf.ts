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

const RIFF = "RIFF";
const FORM = "NIKS";
const SUMMARY = "NISI";
/** RIFF chunks are word-aligned: an odd-length chunk is followed by a pad byte. */
const ALIGN = 2;

export interface Chunk {
  id: string;
  data: Buffer;
}

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
  if (buf.length < 12) throw new NotAnNksfError("file is too short");
  const riff = buf.toString("ascii", 0, 4);
  if (riff !== RIFF) throw new NotAnNksfError(`expected RIFF, found ${JSON.stringify(riff)}`);

  const declared = buf.readUInt32LE(4);
  const form = buf.toString("ascii", 8, 12);
  if (form !== FORM) throw new NotAnNksfError(`expected ${FORM} form, found ${JSON.stringify(form)}`);

  // RIFF's size covers everything after the 8-byte header.
  const end = Math.min(buf.length, 8 + declared);
  const chunks: Chunk[] = [];
  let offset = 12;

  while (offset + 8 <= end) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > buf.length) {
      throw new NotAnNksfError(
        `chunk ${id} claims ${size} bytes at ${start}, past the end of the file`,
      );
    }
    chunks.push({ id, data: buf.subarray(start, start + size) });
    offset = start + size + (size % ALIGN);
  }

  if (chunks.length === 0) throw new NotAnNksfError("no chunks found");
  return { form, chunks };
}

export function serialiseNksf(file: NksfFile): Buffer {
  const body: Buffer[] = [Buffer.from(file.form, "ascii")];

  for (const chunk of file.chunks) {
    const header = Buffer.alloc(8);
    header.write(chunk.id, 0, 4, "ascii");
    header.writeUInt32LE(chunk.data.length, 4);
    body.push(header, chunk.data);
    if (chunk.data.length % ALIGN !== 0) body.push(Buffer.alloc(1));
  }

  const payload = Buffer.concat(body);
  const header = Buffer.alloc(8);
  header.write(RIFF, 0, 4, "ascii");
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload]);
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
