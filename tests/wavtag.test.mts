import { test } from "node:test";
import assert from "node:assert/strict";
import { encode } from "../src/lib/msgpack.ts";
import { parseRiff, serialiseRiff, type Chunk } from "../src/lib/riff.ts";
import { readSoundInfo, tagSample } from "../src/lib/wavtag.ts";

const TAG = { vendor: "tim moose", bankchain: ["808 COLLECTION"], name: "Kick" };
const NKS = "com.native-instruments.nks.soundinfo";
const NISOUND = "com.native-instruments.nisound.soundinfo";

function syncsafe(n: number): Buffer {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

function geob(description: string, object: Buffer): Buffer {
  const body = Buffer.concat([
    Buffer.from([0, 0, 0]),
    Buffer.from(description, "latin1"),
    Buffer.from([0]),
    object,
  ]);
  return Buffer.concat([
    Buffer.from("GEOB", "latin1"),
    syncsafe(body.length),
    Buffer.alloc(2),
    body,
  ]);
}

function id3(frames: Buffer[], padding: number, version = 4): Buffer {
  const body = Buffer.concat([...frames, Buffer.alloc(padding)]);
  return Buffer.concat([Buffer.from([0x49, 0x44, 0x33, version, 0, 0]), syncsafe(body.length), body]);
}

const NISOUND_BYTES = Buffer.from([0x00, 0x01, 0xff, 0x7f, 0x80, 0x00, 0x42]);
const AUDIO = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 37) & 0xff));
const FMT = Buffer.from([1, 0, 1, 0, 0x44, 0xac, 0, 0, 0x88, 0x58, 1, 0, 2, 0, 16, 0]);

function nksMap(extra: Record<string, unknown> = {}) {
  return encode({
    __ni_internal: { source: "other" },
    author: "",
    comment: "",
    name: "Cymatics - 808 Alert (C)",
    tempo: 0,
    vendor: "tim moose",
    ...extra,
  } as never);
}

function wav(chunks: Chunk[]): Buffer {
  return serialiseRiff({ form: "WAVE", chunks });
}

function realWav(opts: { padding?: number; map?: Buffer } = {}): Buffer {
  const tag = id3(
    [geob(NKS, opts.map ?? nksMap()), geob(NISOUND, NISOUND_BYTES)],
    opts.padding ?? 300,
  );
  return wav([
    { id: "fmt ", data: FMT },
    { id: "data", data: AUDIO },
    { id: "ID3 ", data: tag },
  ]);
}

function chunkData(buf: Buffer, id: string): Buffer | undefined {
  return parseRiff(buf, "WAVE").chunks.find((c) => c.id === id)?.data;
}

function tagged(buf: Buffer) {
  const out = tagSample(buf, TAG);
  assert.equal(out.kind, "tagged", out.kind === "refused" ? out.reason : "");
  return (out as { kind: "tagged"; buffer: Buffer }).buffer;
}

test("a vendor-only tag gains the bankchain and keeps its other keys", () => {
  const input = realWav();
  const out = tagged(input);
  const info = readSoundInfo(out)!;
  assert.deepEqual(info.bankchain, ["808 COLLECTION"]);
  assert.equal(info.vendor, "tim moose");
  assert.equal(info.name, "Cymatics - 808 Alert (C)");
  assert.deepEqual(info.__ni_internal, { source: "other" });
  assert.equal(info.tempo, 0);
});

test("the vendor is replaced when the file named another one", () => {
  const out = tagged(realWav({ map: nksMap({ vendor: "someone else" }) }));
  assert.equal(readSoundInfo(out)!.vendor, "tim moose");
});

test("audio, format and the older sound info frame come through unchanged", () => {
  const input = realWav();
  const out = tagged(input);
  assert.ok(chunkData(out, "data")!.equals(AUDIO));
  assert.ok(chunkData(out, "fmt ")!.equals(FMT));
  assert.ok(chunkData(out, "ID3 ")!.includes(geob(NISOUND, NISOUND_BYTES)));
});

test("the file keeps its size while the padding can absorb the change", () => {
  const input = realWav({ padding: 300 });
  assert.equal(tagged(input).length, input.length);
});

test("tagging twice reports unchanged", () => {
  const out = tagged(realWav());
  assert.deepEqual(tagSample(out, TAG), { kind: "unchanged" });
});

test("a file with no ID3 chunk gets one that reads back", () => {
  const input = wav([
    { id: "fmt ", data: FMT },
    { id: "data", data: AUDIO },
  ]);
  const out = tagged(input);
  const info = readSoundInfo(out)!;
  assert.equal(info.name, "Kick");
  assert.equal(info.vendor, "tim moose");
  assert.deepEqual(info.bankchain, ["808 COLLECTION"]);
  assert.ok(chunkData(out, "data")!.equals(AUDIO));
  assert.equal(parseRiff(out, "WAVE").chunks.at(-1)!.id, "ID3 ");
});

test("an ID3 chunk without the NI frame gets it, and its other frames stay", () => {
  const other = Buffer.concat([
    Buffer.from("TIT2", "latin1"),
    syncsafe(6),
    Buffer.alloc(2),
    Buffer.from([0, 0x68, 0x65, 0x6c, 0x6c, 0x6f]),
  ]);
  const input = wav([
    { id: "fmt ", data: FMT },
    { id: "data", data: AUDIO },
    { id: "id3 ", data: id3([other], 400) },
  ]);
  const out = tagged(input);
  assert.equal(readSoundInfo(out)!.vendor, "tim moose");
  assert.ok(chunkData(out, "id3 ")!.includes(other));
});

test("ID3 v2.3 is refused and the reason says so", () => {
  const input = wav([
    { id: "fmt ", data: FMT },
    { id: "data", data: AUDIO },
    { id: "ID3 ", data: id3([geob(NKS, nksMap())], 100, 3) },
  ]);
  const out = tagSample(input, TAG);
  assert.equal(out.kind, "refused");
  assert.match((out as { reason: string }).reason, /v2\.3/);
});

test("a tag with flags is refused", () => {
  const tag = id3([geob(NKS, nksMap())], 100);
  tag[5] = 0x80;
  const out = tagSample(wav([{ id: "fmt ", data: FMT }, { id: "ID3 ", data: tag }]), TAG);
  assert.equal(out.kind, "refused");
});

test("something that is not a WAV is refused", () => {
  assert.equal(tagSample(Buffer.from("not audio at all"), TAG).kind, "refused");
  const aiff = serialiseRiff({ form: "AIFF", chunks: [{ id: "COMM", data: FMT }] });
  assert.equal(tagSample(aiff, TAG).kind, "refused");
});

test("an odd-length chunk before the tag keeps the chunks aligned", () => {
  const odd = Buffer.from([1, 2, 3, 4, 5]);
  const input = wav([
    { id: "fmt ", data: FMT },
    { id: "junk", data: odd },
    { id: "data", data: AUDIO },
    { id: "ID3 ", data: id3([geob(NKS, nksMap())], 200) },
  ]);
  const out = tagged(input);
  const chunks = parseRiff(out, "WAVE").chunks;
  assert.deepEqual(chunks.map((c) => c.id), ["fmt ", "junk", "data", "ID3 "]);
  assert.ok(chunks[1].data.equals(odd));
  assert.ok(chunks[2].data.equals(AUDIO));
  assert.equal(out.length, input.length);
});

test("a map too big for the padding grows the tag and still parses", () => {
  const input = realWav({ padding: 4 });
  const long = { vendor: "v".repeat(40), bankchain: ["B".repeat(200), "C".repeat(200)], name: "Kick" };
  const out = tagSample(input, long);
  assert.equal(out.kind, "tagged");
  const buffer = (out as { buffer: Buffer }).buffer;
  assert.ok(buffer.length > input.length);
  assert.deepEqual(readSoundInfo(buffer)!.bankchain, long.bankchain);
  assert.ok(chunkData(buffer, "data")!.equals(AUDIO));
  assert.ok(chunkData(buffer, "ID3 ")!.includes(NISOUND_BYTES));
});

test("bytes after the RIFF are kept", () => {
  const input = Buffer.concat([realWav(), Buffer.from("tail")]);
  const out = tagged(input);
  assert.equal(out.subarray(out.length - 4).toString(), "tail");
});
