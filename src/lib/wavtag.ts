/**
 * Vendor and bank tags inside a WAV file.
 *
 * Maschine 3 takes a user sample's heading from a tag inside the file itself.
 * A file whose tag has `vendor` and a non-empty `bankchain` is listed under
 * that vendor and shows its artwork; one without `bankchain` goes under
 * "Other".
 *
 * Native Instruments writes the tag as an `ID3 ` RIFF chunk holding an
 * ID3v2.4 tag. Its frames are GEOB (general object) frames:
 *
 *   com.native-instruments.nks.soundinfo     a MessagePack map. The only frame edited.
 *   com.native-instruments.nisound.soundinfo older binary form. Never touched.
 *
 * The tag is followed by zero padding, so a changed map usually fits without
 * moving anything. Every other RIFF chunk, the audio above all, is carried
 * through byte for byte and checked before a result is returned.
 */

import { decode, encode, type MsgValue } from "./msgpack";
import { parseRiff, serialiseRiff, type Chunk } from "./riff";

const FORM = "WAVE";
const NKS_SOUNDINFO = "com.native-instruments.nks.soundinfo";
const TAG_HEADER = 10;
const FRAME_HEADER = 10;
/** Room left after a tag that had to grow, so the next edit can stay in place. */
const GROWTH_PADDING = 1024;

export interface Id3Frame {
  id: string;
  flags: Buffer;
  body: Buffer;
}

export interface Id3Tag {
  frames: Id3Frame[];
  /** Bytes after the 10-byte header: the frames plus their padding. */
  size: number;
}

export interface SampleTag {
  vendor: string;
  bankchain: string[];
  name: string;
}

export type TagOutcome =
  | { kind: "tagged"; buffer: Buffer }
  | { kind: "unchanged" }
  | { kind: "refused"; reason: string };

class WavTagError extends Error {}

const isId3 = (id: string) => id.toLowerCase() === "id3 ";

function readSyncsafe(buf: Buffer, at: number): number {
  let n = 0;
  for (let i = 0; i < 4; i++) {
    const b = buf[at + i];
    if (b & 0x80) throw new WavTagError("the tag has a size that is not valid");
    n = (n << 7) | b;
  }
  return n;
}

function writeSyncsafe(n: number): Buffer {
  if (n >= 1 << 28) throw new WavTagError("the tag is too large");
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

function parseId3(data: Buffer): Id3Tag {
  if (data.length < TAG_HEADER || data.toString("latin1", 0, 3) !== "ID3") {
    throw new WavTagError("the ID3 chunk does not hold an ID3 tag");
  }
  if (data[3] !== 4) {
    throw new WavTagError(`the tag is ID3v2.${data[3]}, and only ID3v2.4 is handled`);
  }
  if (data[5] !== 0) {
    throw new WavTagError("the tag uses flags (unsynchronisation, extended header or footer)");
  }
  const size = readSyncsafe(data, 6);
  if (TAG_HEADER + size !== data.length) {
    throw new WavTagError("the tag size does not match its chunk");
  }

  const frames: Id3Frame[] = [];
  let at = TAG_HEADER;
  const end = data.length;
  while (at + FRAME_HEADER <= end && data[at] !== 0) {
    const id = data.toString("latin1", at, at + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) throw new WavTagError("a frame in the tag cannot be read");
    const bodySize = readSyncsafe(data, at + 4);
    const bodyStart = at + FRAME_HEADER;
    if (bodyStart + bodySize > end) throw new WavTagError("a frame runs past the end of the tag");
    frames.push({
      id,
      flags: data.subarray(at + 8, at + 10),
      body: data.subarray(bodyStart, bodyStart + bodySize),
    });
    at = bodyStart + bodySize;
  }
  if (data.subarray(at).some((b) => b !== 0)) {
    throw new WavTagError("a frame in the tag cannot be read");
  }
  return { frames, size };
}

/** Frames, then zero padding up to `size`; grows by GROWTH_PADDING when they do not fit. */
function serialiseId3(tag: Id3Tag): Buffer {
  const parts: Buffer[] = [];
  for (const f of tag.frames) {
    parts.push(Buffer.from(f.id, "latin1"), writeSyncsafe(f.body.length), f.flags, f.body);
  }
  const frames = Buffer.concat(parts);
  const size = frames.length <= tag.size ? tag.size : frames.length + GROWTH_PADDING;
  const head = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0]), writeSyncsafe(size)]);
  return Buffer.concat([head, frames, Buffer.alloc(size - frames.length)]);
}

interface Geob {
  description: string;
  /** Bytes up to and including the description's terminator. */
  prefixLength: number;
}

/** Only single-byte encodings (Latin-1, UTF-8): that is all NI writes. */
function parseGeob(body: Buffer): Geob | null {
  if (body.length < 4 || (body[0] !== 0 && body[0] !== 3)) return null;
  let at = 1;
  let description = "";
  for (let field = 0; field < 3; field++) {
    const stop = body.indexOf(0, at);
    if (stop < 0) return null;
    if (field === 2) description = body.toString(body[0] === 3 ? "utf8" : "latin1", at, stop);
    at = stop + 1;
  }
  return { description, prefixLength: at };
}

function isNksFrame(f: Id3Frame): boolean {
  return f.id === "GEOB" && parseGeob(f.body)?.description === NKS_SOUNDINFO;
}

function decodeMap(frame: Id3Frame): Record<string, MsgValue> {
  const geob = parseGeob(frame.body)!;
  const object = frame.body.subarray(geob.prefixLength);
  const { value, bytesRead } = decode(object);
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Uint8Array) {
    throw new WavTagError("the sound info is not a map");
  }
  if (bytesRead !== object.length) throw new WavTagError("the sound info has extra bytes after it");
  return value as Record<string, MsgValue>;
}

function encodeSorted(map: Record<string, MsgValue>): Buffer {
  const sorted: Record<string, MsgValue> = {};
  for (const k of Object.keys(map).sort()) sorted[k] = map[k];
  return encode(sorted);
}

function newMap(tag: SampleTag): Record<string, MsgValue> {
  return {
    __ni_internal: { source: "other" },
    author: "",
    bankchain: tag.bankchain,
    comment: "",
    name: tag.name,
    tempo: 0,
    vendor: tag.vendor,
  };
}

function newNksFrame(map: Record<string, MsgValue>): Id3Frame {
  const prefix = Buffer.concat([
    Buffer.from([0, 0, 0]),
    Buffer.from(NKS_SOUNDINFO, "latin1"),
    Buffer.from([0]),
  ]);
  return { id: "GEOB", flags: Buffer.alloc(2), body: Buffer.concat([prefix, encodeSorted(map)]) };
}

function sameBank(a: MsgValue | undefined, b: string[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
}

/** The nks.soundinfo map of a WAV, or null when it has none or cannot be read. */
export function readSoundInfo(wav: Buffer): Record<string, MsgValue> | null {
  try {
    const riff = parseRiff(wav, FORM);
    const chunk = riff.chunks.find((c) => isId3(c.id));
    if (!chunk) return null;
    const frame = parseId3(chunk.data).frames.find(isNksFrame);
    return frame ? decodeMap(frame) : null;
  } catch {
    return null;
  }
}

function sameChunks(a: Chunk[], b: Chunk[]): boolean {
  const x = a.filter((c) => !isId3(c.id));
  const y = b.filter((c) => !isId3(c.id));
  return x.length === y.length && x.every((c, i) => c.id === y[i].id && c.data.equals(y[i].data));
}

/**
 * Writes `vendor` and `bankchain` into a WAV's NI sound info. Pure: the caller
 * does the file I/O.
 */
export function tagSample(wav: Buffer, tag: SampleTag): TagOutcome {
  try {
    return tagOrThrow(wav, tag);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { kind: "refused", reason };
  }
}

function tagOrThrow(wav: Buffer, tag: SampleTag): TagOutcome {
  const riff = parseRiff(wav, FORM);
  const declared = 8 + wav.readUInt32LE(4);
  if (declared > wav.length) throw new WavTagError("the file is cut short");
  // Anything past the RIFF's own end is not ours to drop.
  const trailing = wav.subarray(declared);

  const at = riff.chunks.findIndex((c) => isId3(c.id));
  const existing = at >= 0 ? parseId3(riff.chunks[at].data) : null;

  let frames: Id3Frame[];
  if (existing) {
    const i = existing.frames.findIndex(isNksFrame);
    if (i >= 0) {
      const frame = existing.frames[i];
      if (frame.flags.some((b) => b !== 0)) {
        throw new WavTagError("the sound info frame uses flags");
      }
      const map = decodeMap(frame);
      if (map.vendor === tag.vendor && sameBank(map.bankchain, tag.bankchain)) {
        return { kind: "unchanged" };
      }
      const geob = parseGeob(frame.body)!;
      const body = Buffer.concat([
        frame.body.subarray(0, geob.prefixLength),
        encodeSorted({ ...map, vendor: tag.vendor, bankchain: tag.bankchain }),
      ]);
      frames = existing.frames.map((f, j) => (j === i ? { ...f, body } : f));
    } else {
      frames = [newNksFrame(newMap(tag)), ...existing.frames];
    }
  } else {
    frames = [newNksFrame(newMap(tag))];
  }

  const data = serialiseId3({ frames, size: existing ? existing.size : 0 });
  const chunks = riff.chunks.slice();
  if (at >= 0) chunks[at] = { id: riff.chunks[at].id, data };
  else chunks.push({ id: "ID3 ", data });

  const buffer = Buffer.concat([serialiseRiff({ form: FORM, chunks }), trailing]);

  const check = parseRiff(buffer, FORM);
  if (!sameChunks(riff.chunks, check.chunks)) {
    throw new WavTagError("the audio would have changed, so the file was left alone");
  }
  const written = readSoundInfo(buffer);
  if (!written || written.vendor !== tag.vendor || !sameBank(written.bankchain, tag.bankchain)) {
    throw new WavTagError("the new tag did not read back correctly");
  }
  return { kind: "tagged", buffer };
}
