import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, encode } from "../src/lib/msgpack.ts";
import {
  editPreset,
  NotAnNksfError,
  parseNksf,
  readSummary,
  serialiseNksf,
  writeSummary,
} from "../src/lib/nksf.ts";

/* ---- MessagePack ---- */

test("messagepack round-trips every form we emit", () => {
  const cases = [
    null, true, false, 0, 1, 127, 128, 255, 256, 65535, 65536, 4294967295,
    -1, -32, -33, -128, -129, -32768, -32769, -2147483648,
    1.5, -0.25,
    "", "a", "a".repeat(31), "a".repeat(32), "a".repeat(255), "a".repeat(256),
    "unicode: éèê — 🎹",
    [], [1, 2, 3], new Array(16).fill(0), new Array(70000).fill(1),
    {}, { a: 1 }, { nested: { deep: ["x", null, true] } },
  ];
  for (const c of cases) {
    const { value } = decode(encode(c as never));
    assert.deepEqual(value, c, `round trip failed for ${JSON.stringify(c)?.slice(0, 60)}`);
  }
});

test("messagepack uses the shortest encoding, as NI's files do", () => {
  assert.equal(encode("author")[0], 0xa6, "6-char string -> fixstr");
  assert.equal(encode("")[0], 0xa0, "empty string -> fixstr 0");
  assert.equal(encode("a".repeat(36))[0], 0xd9, "36-char string -> str8");
  assert.equal(encode([])[0], 0x90, "empty array -> fixarray");
  assert.equal(encode(["Serum", "", ""])[0], 0x93, "3 items -> fixarray 3");
  assert.equal(encode({ a: 1, b: 2 })[0], 0x82, "2 keys -> fixmap 2");
});

test("decoder rejects a truncated payload rather than inventing data", () => {
  const full = encode({ name: "hello world" });
  assert.throws(() => decode(full.subarray(0, full.length - 3)), /ended early/);
});

/* ---- the real file ---- */

/**
 * Byte-for-byte reconstruction of the NISI chunk from a real Serum preset,
 * transcribed from an octal dump of the user's own file.
 */
function realNisiPayload(): Buffer {
  const parts: Buffer[] = [];
  const fixstr = (s: string) => {
    const b = Buffer.from(s, "utf8");
    return Buffer.concat([Buffer.from([0xa0 | b.length]), b]);
  };
  parts.push(Buffer.from([0x01, 0x00, 0x00, 0x00])); // version
  parts.push(Buffer.from([0x89])); // fixmap, 9 keys
  parts.push(fixstr("author"), fixstr(""));
  parts.push(fixstr("bankchain"), Buffer.from([0x93]), fixstr("Serum"), fixstr(""), fixstr(""));
  parts.push(fixstr("characters"), Buffer.from([0x90]));
  parts.push(fixstr("comment"), fixstr(""));
  parts.push(fixstr("deviceType"), fixstr("INST"));
  parts.push(fixstr("name"), fixstr("Serum Future Bass Brass"));
  parts.push(fixstr("types"), Buffer.from([0x90]));
  const uuid = "a6db6796-2a7c-46f1-8839-8472d94fb662";
  parts.push(fixstr("uuid"), Buffer.from([0xd9, uuid.length]), Buffer.from(uuid, "utf8"));
  parts.push(fixstr("vendor"), fixstr("Xfer"));
  return Buffer.concat(parts);
}

function realPreset(): Buffer {
  const chunk = (id: string, data: Buffer) => {
    const h = Buffer.alloc(8);
    h.write(id, 0, 4, "ascii");
    h.writeUInt32LE(data.length, 4);
    const pad = data.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0);
    return Buffer.concat([h, data, pad]);
  };
  const body = Buffer.concat([
    Buffer.from("NIKS", "ascii"),
    chunk("NISI", realNisiPayload()),
    chunk("NICA", Buffer.from([0x01, 0x00, 0x00, 0x00, 0x80])),
    chunk("PLID", Buffer.from("XfeR", "ascii")),
    // Odd length, to exercise RIFF word padding.
    chunk("PCHK", Buffer.from("opaque plugin state!", "ascii")),
  ]);
  const h = Buffer.alloc(8);
  h.write("RIFF", 0, 4, "ascii");
  h.writeUInt32LE(body.length, 4);
  return Buffer.concat([h, body]);
}

test("parses the real preset's chunks and summary", () => {
  const file = parseNksf(realPreset());
  assert.deepEqual(file.chunks.map((c) => c.id), ["NISI", "NICA", "PLID", "PCHK"]);

  const { version, summary } = readSummary(file);
  assert.equal(version, 1);
  assert.equal(summary.name, "Serum Future Bass Brass");
  assert.equal(summary.vendor, "Xfer");
  assert.deepEqual(summary.bankchain, ["Serum", "", ""]);
  assert.deepEqual(summary.types, []);
  assert.deepEqual(summary.characters, []);
  assert.equal(summary.deviceType, "INST");
  assert.equal(summary.uuid, "a6db6796-2a7c-46f1-8839-8472d94fb662");
});

test("THE SAFETY TEST: a no-op edit reproduces the file byte for byte", () => {
  const original = realPreset();
  const rewritten = editPreset(original, (s) => s);
  assert.equal(
    rewritten.equals(original),
    true,
    "a no-op edit must not change a single byte of the user's preset",
  );
});

test("editing changes only the NISI chunk; the sound data is untouched", () => {
  const original = realPreset();
  const edited = editPreset(original, (s) => ({
    ...s,
    vendor: "Xfer Records",
    types: [["Brass", "Synth Brass"]],
    characters: ["Additive", "Bright"],
  }));

  const before = parseNksf(original);
  const after = parseNksf(edited);

  for (const id of ["NICA", "PLID", "PCHK"]) {
    const a = before.chunks.find((c) => c.id === id)!.data;
    const b = after.chunks.find((c) => c.id === id)!.data;
    assert.equal(b.equals(a), true, `${id} must be preserved exactly`);
  }

  const summary = readSummary(after).summary;
  assert.equal(summary.vendor, "Xfer Records");
  assert.deepEqual(summary.types, [["Brass", "Synth Brass"]]);
  assert.deepEqual(summary.characters, ["Additive", "Bright"]);
  // Untouched fields survive.
  assert.equal(summary.name, "Serum Future Bass Brass");
  assert.equal(summary.uuid, "a6db6796-2a7c-46f1-8839-8472d94fb662");
});

test("the RIFF size header is corrected when the summary grows", () => {
  const edited = editPreset(realPreset(), (s) => ({
    ...s,
    comment: "a much longer comment than the original empty string",
  }));
  assert.equal(edited.readUInt32LE(4), edited.length - 8, "RIFF size must match");
  // And it still parses.
  assert.equal(readSummary(parseNksf(edited)).summary.comment.length > 20, true);
});

test("unknown keys NI may add are preserved through an edit", () => {
  const file = parseNksf(realPreset());
  const chunk = readSummary(file);
  chunk.summary.extra.futureField = ["something", 42];
  const withExtra = serialiseNksf(writeSummary(file, chunk));

  const back = readSummary(parseNksf(withExtra)).summary;
  assert.deepEqual(back.extra.futureField, ["something", 42]);
  assert.equal(back.vendor, "Xfer");
});

test("odd-length chunks keep their RIFF pad byte", () => {
  const original = realPreset();
  // "opaque plugin state!" is 20 bytes (even); force an odd one.
  const file = parseNksf(original);
  file.chunks.push({ id: "ODDC", data: Buffer.from("odd", "ascii") });
  const out = serialiseNksf(file);
  const reparsed = parseNksf(out);
  assert.equal(
    reparsed.chunks.find((c) => c.id === "ODDC")!.data.toString(),
    "odd",
  );
  assert.deepEqual(
    reparsed.chunks.map((c) => c.id),
    ["NISI", "NICA", "PLID", "PCHK", "ODDC"],
  );
});

test("non-NKS files are refused clearly, not mangled", () => {
  assert.throws(() => parseNksf(Buffer.from("hello")), NotAnNksfError);
  assert.throws(
    () => parseNksf(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")])),
    /expected NIKS/,
  );
  // A RIFF/NIKS file with no NISI chunk.
  const h = Buffer.alloc(8);
  h.write("RIFF", 0, 4, "ascii");
  const body = Buffer.concat([Buffer.from("NIKS", "ascii"), Buffer.from("JUNK"), Buffer.alloc(4)]);
  h.writeUInt32LE(body.length, 4);
  assert.throws(() => readSummary(parseNksf(Buffer.concat([h, body]))), /no NISI/);
});

test("a chunk claiming more bytes than exist is rejected", () => {
  const h = Buffer.alloc(8);
  h.write("RIFF", 0, 4, "ascii");
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.write("NISI", 0, 4, "ascii");
  chunkHeader.writeUInt32LE(999999, 4);
  const body = Buffer.concat([Buffer.from("NIKS", "ascii"), chunkHeader]);
  h.writeUInt32LE(body.length, 4);
  assert.throws(() => parseNksf(Buffer.concat([h, body])), /past the end/);
});

/**
 * A second real preset, with a two-entry bankchain and existing tags - the
 * shape Serum does not exercise. Transcribed from the same machine.
 */
function microtonicNisi(): Buffer {
  const parts: Buffer[] = [];
  const fixstr = (s: string) => {
    const b = Buffer.from(s, "utf8");
    return Buffer.concat([Buffer.from([0xa0 | b.length]), b]);
  };
  parts.push(Buffer.from([0x01, 0x00, 0x00, 0x00]));
  parts.push(Buffer.from([0x89]));
  parts.push(fixstr("author"), fixstr(""));
  parts.push(
    fixstr("bankchain"),
    Buffer.from([0x93]),
    fixstr("Sonic Charge"),
    fixstr("Microtonic"),
    fixstr(""),
  );
  parts.push(fixstr("characters"), Buffer.from([0x91]), fixstr("Analog"));
  parts.push(fixstr("comment"), fixstr(""));
  parts.push(fixstr("deviceType"), fixstr("INST"));
  parts.push(fixstr("name"), fixstr("Wild shit"));
  parts.push(
    fixstr("types"),
    Buffer.from([0x91]),
    Buffer.from([0x91]),
    fixstr("Beatbox"),
  );
  const uuid = "82e78171-7494-4761-99d8-d32b99121100";
  parts.push(fixstr("uuid"), Buffer.from([0xd9, uuid.length]), Buffer.from(uuid, "utf8"));
  parts.push(fixstr("vendor"), fixstr("Sonic Charge"));
  return Buffer.concat(parts);
}

function microtonicPreset(): Buffer {
  const chunk = (id: string, data: Buffer) => {
    const h = Buffer.alloc(8);
    h.write(id, 0, 4, "ascii");
    h.writeUInt32LE(data.length, 4);
    const pad = data.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0);
    return Buffer.concat([h, data, pad]);
  };
  const body = Buffer.concat([
    Buffer.from("NIKS", "ascii"),
    chunk("NISI", microtonicNisi()),
    chunk("NICA", Buffer.from([0x02, 0x00, 0x00, 0x00])),
    chunk("PCHK", Buffer.from("microtonic pattern data", "ascii")),
  ]);
  const h = Buffer.alloc(8);
  h.write("RIFF", 0, 4, "ascii");
  h.writeUInt32LE(body.length, 4);
  return Buffer.concat([h, body]);
}

test("a two-entry bankchain with existing tags parses correctly", () => {
  const { summary } = readSummary(parseNksf(microtonicPreset()));
  assert.deepEqual(summary.bankchain, ["Sonic Charge", "Microtonic", ""]);
  assert.deepEqual(summary.characters, ["Analog"]);
  assert.deepEqual(summary.types, [["Beatbox"]]);
  assert.equal(summary.vendor, "Sonic Charge");
  assert.equal(summary.name, "Wild shit");
});

test("the byte-exact safety test holds for the second real preset too", () => {
  const original = microtonicPreset();
  assert.equal(
    editPreset(original, (s) => s).equals(original),
    true,
    "a no-op edit must not change a single byte",
  );
});

test("existing tags are replaced, not appended to", () => {
  const edited = editPreset(microtonicPreset(), (s) => ({
    ...s,
    characters: ["Digital", "Bright"],
    types: [["Drums", "Kick"]],
  }));
  const summary = readSummary(parseNksf(edited)).summary;
  assert.deepEqual(summary.characters, ["Digital", "Bright"]);
  assert.deepEqual(summary.types, [["Drums", "Kick"]]);
  assert.deepEqual(summary.bankchain, ["Sonic Charge", "Microtonic", ""]);
});
