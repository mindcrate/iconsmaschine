import { crc32 } from "node:zlib";
import path from "node:path";
import { metaFileName } from "./meta";
import type { RenderedFile } from "./render";

export interface ZipInput {
  vendor: string;
  subfolder: string | null;
  files: RenderedFile[];
  meta: Buffer | null;
}

interface Entry {
  name: string;
  data: Buffer;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** Store only - PNG and WebP payloads are already compressed. */
const METHOD_STORE = 0;

/**
 * Minimal ZIP writer. The pack is a handful of small already-compressed files,
 * so storing them uncompressed keeps this dependency-free and deterministic.
 */
function buildZip(entries: Entry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  // Fixed DOS timestamp (1980-01-01) keeps output byte-identical across runs.
  const dosTime = 0;
  const dosDate = 0x0021;

  for (const entry of entries) {
    const name = Buffer.from(entry.name.split(path.sep).join("/"), "utf8");
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    local.writeUInt16LE(METHOD_STORE, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    locals.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(METHOD_STORE, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);

    centrals.push(central, name);
    offset += local.length + name.length + size;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/**
 * Zips the pack with the same folder shape it installs to, so the archive can
 * be unzipped straight into NI Resources/image on another machine.
 */
export function zipPack(input: ZipInput): Buffer {
  const inner = input.subfolder?.trim()
    ? path.join(input.vendor, input.subfolder.trim())
    : input.vendor;

  const entries: Entry[] = input.files.map((f) => ({
    name: path.join(inner, f.file),
    data: f.buffer,
  }));

  if (input.meta) {
    entries.push({
      name: path.join(input.vendor, metaFileName(input.vendor)),
      data: input.meta,
    });
  }

  return buildZip(entries);
}
