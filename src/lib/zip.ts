import { crc32 } from "node:zlib";
import path from "node:path";
import { metaBuffer } from "./nimeta";
import { buildDistDbFiles, folderName, type DistDbInput } from "./distdb";
import type { RenderedFile } from "./render";

export interface ZipInput {
  product: string;
  files: RenderedFile[];
  distDb: DistDbInput | null;
  /** Nest image/ under this vendor without a dist_database entry. */
  imageVendor?: string | null;
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
    local.writeUInt16LE(20, 4);
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
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(METHOD_STORE, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
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
 * Zips both trees with the folder shape they install to, so the archive can be
 * unzipped straight over NI Resources on another machine.
 */
export function zipPack(input: ZipInput): Buffer {
  const productFolder = folderName(input.product);
  // Plugins nest in image/ the same way they do in dist_database, and a user
  // sample pack nests under its vendor with no entry at all. The zip has to
  // carry the same shape, or unzipping it over NI Resources puts the artwork
  // where nothing looks for it.
  const nestVendor = input.distDb?.vendor ?? input.imageVendor ?? null;
  const imageRel = nestVendor
    ? path.join("image", folderName(nestVendor), productFolder)
    : path.join("image", productFolder);
  const entries: Entry[] = [];

  for (const f of input.files) {
    entries.push({ name: path.join(imageRel, f.file), data: f.buffer });
  }
  // Same .meta shape the installer writes: a nested user sample pack carries
  // <vendor>, lowercase and matching its folder.
  const nestedUserPack = !input.distDb && Boolean(input.imageVendor);
  entries.push({
    name: path.join(imageRel, `${productFolder}.meta`),
    data: metaBuffer(
      nestedUserPack
        ? { name: productFolder, type: "image", vendor: folderName(input.imageVendor!) }
        : { name: input.product, type: "image" },
    ),
  });

  if (input.distDb) {
    const rel = path.join(
      "dist_database",
      folderName(input.distDb.vendor),
      productFolder,
    );
    for (const f of buildDistDbFiles(input.distDb)) {
      entries.push({ name: path.join(rel, f.file), data: f.buffer });
    }
  }

  return buildZip(entries);
}
