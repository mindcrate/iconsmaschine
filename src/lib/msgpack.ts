/**
 * Minimal MessagePack codec.
 *
 * NKS presets store their metadata as MessagePack inside a RIFF chunk. We only
 * need the subset NI actually emits, but the decoder accepts the full range of
 * types so an unexpected preset does not silently lose data.
 *
 * The encoder emits *canonical minimal* forms (shortest encoding for each
 * value), which is what the observed NI files use. That matters: it lets a
 * decode/encode round trip reproduce the original bytes exactly, which the
 * tests assert before anything is written to a user's file.
 */

export type MsgValue =
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | MsgValue[]
  | { [key: string]: MsgValue };

class Reader {
  offset = 0;
  // An explicit field, not a constructor parameter property: Node's
  // type-stripping mode (used by the test runner) does not support those.
  readonly buf: Buffer;

  constructor(buf: Buffer) {
    this.buf = buf;
  }

  private need(n: number) {
    if (this.offset + n > this.buf.length) {
      throw new Error(
        `MessagePack ended early: wanted ${n} bytes at ${this.offset}, have ${this.buf.length}`,
      );
    }
  }

  u8() {
    this.need(1);
    return this.buf.readUInt8(this.offset++);
  }
  u16() {
    this.need(2);
    const v = this.buf.readUInt16BE(this.offset);
    this.offset += 2;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.buf.readUInt32BE(this.offset);
    this.offset += 4;
    return v;
  }
  bytes(n: number) {
    this.need(n);
    const v = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }
  str(n: number) {
    return this.bytes(n).toString("utf8");
  }
}

export function decode(buf: Buffer): { value: MsgValue; bytesRead: number } {
  const r = new Reader(buf);
  const value = readValue(r);
  return { value, bytesRead: r.offset };
}

function readValue(r: Reader): MsgValue {
  const b = r.u8();

  if (b <= 0x7f) return b; // positive fixint
  if (b >= 0xe0) return b - 0x100; // negative fixint
  if (b >= 0x80 && b <= 0x8f) return readMap(r, b & 0x0f);
  if (b >= 0x90 && b <= 0x9f) return readArray(r, b & 0x0f);
  if (b >= 0xa0 && b <= 0xbf) return r.str(b & 0x1f);

  switch (b) {
    case 0xc0:
      return null;
    case 0xc2:
      return false;
    case 0xc3:
      return true;
    case 0xc4:
      return new Uint8Array(r.bytes(r.u8()));
    case 0xc5:
      return new Uint8Array(r.bytes(r.u16()));
    case 0xc6:
      return new Uint8Array(r.bytes(r.u32()));
    case 0xca: {
      const v = r.buf.readFloatBE(r.offset);
      r.offset += 4;
      return v;
    }
    case 0xcb: {
      const v = r.buf.readDoubleBE(r.offset);
      r.offset += 8;
      return v;
    }
    case 0xcc:
      return r.u8();
    case 0xcd:
      return r.u16();
    case 0xce:
      return r.u32();
    case 0xcf: {
      const hi = r.u32();
      const lo = r.u32();
      return hi * 2 ** 32 + lo;
    }
    case 0xd0: {
      const v = r.u8();
      return v > 0x7f ? v - 0x100 : v;
    }
    case 0xd1: {
      const v = r.u16();
      return v > 0x7fff ? v - 0x10000 : v;
    }
    case 0xd2: {
      const v = r.u32();
      return v > 0x7fffffff ? v - 0x100000000 : v;
    }
    case 0xd3: {
      const hi = r.u32();
      const lo = r.u32();
      const signed = hi > 0x7fffffff ? hi - 0x100000000 : hi;
      return signed * 2 ** 32 + lo;
    }
    case 0xd9:
      return r.str(r.u8());
    case 0xda:
      return r.str(r.u16());
    case 0xdb:
      return r.str(r.u32());
    case 0xdc:
      return readArray(r, r.u16());
    case 0xdd:
      return readArray(r, r.u32());
    case 0xde:
      return readMap(r, r.u16());
    case 0xdf:
      return readMap(r, r.u32());
    default:
      throw new Error(`Unsupported MessagePack byte 0x${b.toString(16)}`);
  }
}

function readArray(r: Reader, n: number): MsgValue[] {
  const out: MsgValue[] = [];
  for (let i = 0; i < n; i++) out.push(readValue(r));
  return out;
}

function readMap(r: Reader, n: number): { [key: string]: MsgValue } {
  const out: { [key: string]: MsgValue } = {};
  for (let i = 0; i < n; i++) {
    const key = readValue(r);
    if (typeof key !== "string") {
      throw new Error(`Non-string map key: ${String(key)}`);
    }
    out[key] = readValue(r);
  }
  return out;
}

export function encode(value: MsgValue): Buffer {
  const parts: Buffer[] = [];
  writeValue(parts, value);
  return Buffer.concat(parts);
}

function writeValue(out: Buffer[], v: MsgValue): void {
  if (v === null || v === undefined) {
    out.push(Buffer.from([0xc0]));
    return;
  }
  if (typeof v === "boolean") {
    out.push(Buffer.from([v ? 0xc3 : 0xc2]));
    return;
  }
  if (typeof v === "number") {
    writeNumber(out, v);
    return;
  }
  if (typeof v === "string") {
    writeString(out, v);
    return;
  }
  if (v instanceof Uint8Array) {
    writeBin(out, v);
    return;
  }
  if (Array.isArray(v)) {
    writeLengthPrefix(out, v.length, 0x90, 0xdc, 0xdd);
    for (const item of v) writeValue(out, item);
    return;
  }
  const keys = Object.keys(v);
  writeLengthPrefix(out, keys.length, 0x80, 0xde, 0xdf);
  for (const k of keys) {
    writeString(out, k);
    writeValue(out, v[k]);
  }
}

/** fix-form when it fits, then the 16- and 32-bit forms. */
function writeLengthPrefix(
  out: Buffer[],
  n: number,
  fixBase: number,
  wide16: number,
  wide32: number,
): void {
  if (n < 16) {
    out.push(Buffer.from([fixBase | n]));
  } else if (n < 0x10000) {
    const b = Buffer.alloc(3);
    b.writeUInt8(wide16, 0);
    b.writeUInt16BE(n, 1);
    out.push(b);
  } else {
    const b = Buffer.alloc(5);
    b.writeUInt8(wide32, 0);
    b.writeUInt32BE(n, 1);
    out.push(b);
  }
}

function writeString(out: Buffer[], s: string): void {
  const bytes = Buffer.from(s, "utf8");
  const n = bytes.length;
  if (n < 32) {
    out.push(Buffer.from([0xa0 | n]));
  } else if (n < 0x100) {
    out.push(Buffer.from([0xd9, n]));
  } else if (n < 0x10000) {
    const b = Buffer.alloc(3);
    b.writeUInt8(0xda, 0);
    b.writeUInt16BE(n, 1);
    out.push(b);
  } else {
    const b = Buffer.alloc(5);
    b.writeUInt8(0xdb, 0);
    b.writeUInt32BE(n, 1);
    out.push(b);
  }
  out.push(bytes);
}

function writeBin(out: Buffer[], v: Uint8Array): void {
  const n = v.length;
  if (n < 0x100) {
    out.push(Buffer.from([0xc4, n]));
  } else if (n < 0x10000) {
    const b = Buffer.alloc(3);
    b.writeUInt8(0xc5, 0);
    b.writeUInt16BE(n, 1);
    out.push(b);
  } else {
    const b = Buffer.alloc(5);
    b.writeUInt8(0xc6, 0);
    b.writeUInt32BE(n, 1);
    out.push(b);
  }
  out.push(Buffer.from(v));
}

function writeNumber(out: Buffer[], n: number): void {
  if (Number.isInteger(n)) {
    if (n >= 0) {
      if (n < 0x80) return void out.push(Buffer.from([n]));
      if (n < 0x100) return void out.push(Buffer.from([0xcc, n]));
      if (n < 0x10000) {
        const b = Buffer.alloc(3);
        b.writeUInt8(0xcd, 0);
        b.writeUInt16BE(n, 1);
        return void out.push(b);
      }
      if (n < 0x100000000) {
        const b = Buffer.alloc(5);
        b.writeUInt8(0xce, 0);
        b.writeUInt32BE(n, 1);
        return void out.push(b);
      }
    } else {
      if (n >= -32) return void out.push(Buffer.from([n + 0x100]));
      if (n >= -0x80) {
        const b = Buffer.alloc(2);
        b.writeUInt8(0xd0, 0);
        b.writeInt8(n, 1);
        return void out.push(b);
      }
      if (n >= -0x8000) {
        const b = Buffer.alloc(3);
        b.writeUInt8(0xd1, 0);
        b.writeInt16BE(n, 1);
        return void out.push(b);
      }
      if (n >= -0x80000000) {
        const b = Buffer.alloc(5);
        b.writeUInt8(0xd2, 0);
        b.writeInt32BE(n, 1);
        return void out.push(b);
      }
    }
  }
  const b = Buffer.alloc(9);
  b.writeUInt8(0xcb, 0);
  b.writeDoubleBE(n, 1);
  out.push(b);
}
