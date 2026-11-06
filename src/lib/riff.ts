/**
 * Generic RIFF container read and write.
 *
 * Chunks are kept as raw bytes so a caller can edit one and carry every other
 * chunk through byte for byte, in its original order.
 */

const RIFF = "RIFF";
/** RIFF chunks are word-aligned: an odd-length chunk is followed by a pad byte. */
const ALIGN = 2;

export interface Chunk {
  id: string;
  data: Buffer;
}

export interface RiffFile {
  form: string;
  chunks: Chunk[];
}

export class RiffError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "RiffError";
  }
}

/** Throws RiffError when the buffer is not a RIFF container of the given form. */
export function parseRiff(buf: Buffer, form: string): RiffFile {
  if (buf.length < 12) throw new RiffError("file is too short");
  const riff = buf.toString("ascii", 0, 4);
  if (riff !== RIFF) throw new RiffError(`expected RIFF, found ${JSON.stringify(riff)}`);

  const declared = buf.readUInt32LE(4);
  const found = buf.toString("ascii", 8, 12);
  if (found !== form) {
    throw new RiffError(`expected ${form} form, found ${JSON.stringify(found)}`);
  }

  // RIFF's size covers everything after the 8-byte header.
  const end = Math.min(buf.length, 8 + declared);
  const chunks: Chunk[] = [];
  let offset = 12;

  while (offset + 8 <= end) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > buf.length) {
      throw new RiffError(
        `chunk ${id} claims ${size} bytes at ${start}, past the end of the file`,
      );
    }
    chunks.push({ id, data: buf.subarray(start, start + size) });
    offset = start + size + (size % ALIGN);
  }

  if (chunks.length === 0) throw new RiffError("no chunks found");
  return { form, chunks };
}

export function serialiseRiff(file: RiffFile): Buffer {
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
