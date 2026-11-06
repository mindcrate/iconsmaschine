import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Maschine's komplete.db3 runs in WAL mode: writes land in a -wal sidecar and
 * are only folded into the .db3 at a checkpoint, which happens when Maschine
 * quits. Copying the .db3 on its own therefore reads the last checkpoint - on
 * one machine that was two days stale, and every reading taken from it was
 * silently out of date.
 */
test("a copied database carries its write-ahead log, not just the .db3", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "im-wal-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, "komplete.db3");

  const writer = new DatabaseSync(dbPath);
  writer.exec("PRAGMA journal_mode = WAL");
  writer.exec("CREATE TABLE k_bank_chain (id INTEGER, bcvendor TEXT, entry1 TEXT)");
  writer.exec("INSERT INTO k_bank_chain VALUES (1,'MOOSE LIFE','Voodoo')");
  writer.exec("PRAGMA wal_checkpoint(FULL)");
  // Added after the checkpoint, so it lives only in the -wal - exactly like a
  // library added while Maschine is still running.
  writer.exec("INSERT INTO k_bank_chain VALUES (2,'tim moose','808 COLLECTION')");

  const wal = await fs.stat(dbPath + "-wal").catch(() => null);
  assert.notEqual(wal, null, "the sidecar should exist, or this proves nothing");

  // Copying the .db3 alone: the new row is invisible.
  const alone = path.join(dir, "alone.db3");
  await fs.copyFile(dbPath, alone);
  const stale = new DatabaseSync(alone);
  assert.deepEqual(
    stale.prepare("SELECT entry1 FROM k_bank_chain ORDER BY id").all().map((r) => r.entry1),
    ["Voodoo"],
  );
  stale.close();

  // The snapshot the copy fallback takes brings the sidecars, so the row is
  // there. Tested directly rather than through openMaschineDb, which prefers
  // opening in place and would not exercise this.
  const { snapshotDatabase, openMaschineDb } = await import("../src/lib/maschinedb.ts");
  const snap = await snapshotDatabase(dbPath);
  const fresh = new DatabaseSync(snap.copy);
  try {
    assert.deepEqual(
      fresh.prepare("SELECT entry1 FROM k_bank_chain ORDER BY id").all().map((r) => r.entry1),
      ["Voodoo", "808 COLLECTION"],
    );
  } finally {
    fresh.close();
    await fs.rm(snap.dir, { recursive: true, force: true });
  }

  // And whichever way openMaschineDb gets there, it sees the same.
  const opened = await openMaschineDb(dbPath);
  try {
    assert.deepEqual(
      opened.db.prepare("SELECT entry1 FROM k_bank_chain ORDER BY id").all().map((r) => r.entry1),
      ["Voodoo", "808 COLLECTION"],
    );
  } finally {
    opened.db.close();
    await opened.cleanup();
    writer.close();
  }
});
