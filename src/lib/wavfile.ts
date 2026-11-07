import fs from "node:fs/promises";
import type { MsgValue } from "./msgpack";
import { readSoundInfo } from "./wavtag";
import { serialiseRiff } from "./riff";

/**
 * The NI sound info of a WAV on disk, reading only its chunk headers and its
 * ID3 chunk. A plan over thousands of files must not read their audio.
 */
export async function readSoundInfoAt(file: string): Promise<Record<string, MsgValue> | null> {
  const fh = await fs.open(file, "r");
  try {
    const head = Buffer.alloc(12);
    await fh.read(head, 0, 12, 0);
    if (head.toString("latin1", 0, 4) !== "RIFF" || head.toString("latin1", 8, 12) !== "WAVE") return null;
    const end = 8 + head.readUInt32LE(4);
    const h = Buffer.alloc(8);
    for (let at = 12; at + 8 <= end; ) {
      const { bytesRead } = await fh.read(h, 0, 8, at);
      if (bytesRead < 8) return null;
      const id = h.toString("latin1", 0, 4);
      const size = h.readUInt32LE(4);
      if (id.toLowerCase() === "id3 ") {
        const data = Buffer.alloc(size);
        await fh.read(data, 0, size, at + 8);
        return readSoundInfo(serialiseRiff({ form: "WAVE", chunks: [{ id, data }] }));
      }
      at += 8 + size + (size & 1);
    }
    return null;
  } finally {
    await fh.close();
  }
}
