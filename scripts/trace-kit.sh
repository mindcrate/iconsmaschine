#!/usr/bin/env bash
# Everything that decides where ONE library's artwork is looked up.
#
#   ./scripts/trace-kit.sh "808 COLLECTION"
#
# Prints its bank chains, the vendor recorded on the chain and on the sounds
# themselves (these can disagree, and the browser groups by one of them), what
# content types the sounds carry, where the audio lives, and every candidate
# image folder with whether it actually holds artwork files.
#
# Use it when a library shows no artwork: the answer is almost always one of
# "the vendor never saved", "the content type was never set", or "the artwork
# is in a folder nothing looks at".
#
# Reads only, from a copy of the database. Changes nothing.

set -uo pipefail
exec node --experimental-strip-types - "$@" <<'NODE'
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const needle = (process.argv[2] ?? "").trim().toLowerCase();
if (!needle) {
  console.log('Usage: ./scripts/trace-kit.sh "808 COLLECTION"');
  process.exit(1);
}

const root = process.env.NI_RESOURCES_DIR ?? "/Users/Shared/NI Resources";
const imageDir = process.env.NI_RESOURCES_IMAGE_DIR ?? path.join(root, "image");
const dbPath =
  process.env.MASCHINE_DB_PATH ??
  path.join(os.homedir(), "Library/Application Support/Native Instruments/Maschine 2/komplete.db3");
if (!fs.existsSync(dbPath)) { console.log("No komplete.db3 at " + dbPath); process.exit(1); }

const ART = new Set(
  ["MST_artwork.png","MST_logo.png","MST_plugin.png","VB_artwork.png","VB_logo.png",
   "OSO_logo.png","NKS2_hardware_banner.webp","NKS2_hardware_banner_1280x152.webp"]
    .map((f) => f.toLowerCase()),
);
/** The art files and any .meta directly in this folder. */
function contents(dir: string) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  return {
    art: entries.filter((e) => e.isFile() && ART.has(e.name.toLowerCase())).map((e) => e.name),
    metas: entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".meta")).map((e) => e.name),
    subdirs: entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name),
  };
}
const folderName = (s: string) => s.trim().toLowerCase();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "im-trace-"));
const copy = path.join(tmp, "s.db3");
fs.copyFileSync(dbPath, copy);

try {
  const d = new DatabaseSync(copy);

  const chains = d
    .prepare("SELECT id, bcvendor, entry1, entry2 FROM k_bank_chain")
    .all()
    .filter((r) => String(r.entry1 ?? "").trim().toLowerCase().includes(needle));

  if (chains.length === 0) {
    console.log(`No bank chain whose name contains "${needle}".`);
    console.log("The library may not be imported yet: Preferences > Library > User > Add, then Rescan.");
    process.exit(0);
  }

  const typeName = (f: number, ext: string) => {
    if (f === 0) return ext === "mxgrp" ? "Group" : ext === "mxsnd" ? "Sound" : "NOT SET";
    const bits = [];
    if (f & 1) bits.push("Instrument");
    if (f & 2) bits.push("Effect");
    if (f & 4) bits.push("One-shot");
    if (f & 8) bits.push("Loop");
    return bits.join("+") || `flags ${f}`;
  };

  for (const c of chains) {
    const id = Number(c.id);
    const name = String(c.entry1 ?? "").trim();
    const bcvendor = String(c.bcvendor ?? "").trim();
    console.log("=".repeat(74));
    console.log(`Bank chain ${id}: "${name}"${c.entry2 ? ` / "${String(c.entry2).trim()}"` : ""}`);
    console.log("=".repeat(74));
    console.log(`  Browser groups it under: ${bcvendor || "(none)"}`);

    // Column names vary a little between Maschine versions, so ask first
    // rather than assume and fall over.
    const cols = new Set(
      d.prepare("PRAGMA table_info(k_sound_info)").all().map((r) => String(r.name)),
    );
    const vCol = cols.has("vendor") ? "s.vendor" : "NULL";
    const pJoin = cols.has("content_path_id")
      ? "LEFT JOIN k_content_path p ON p.id = s.content_path_id"
      : "LEFT JOIN (SELECT NULL AS path) p";
    const rows = d
      .prepare(
        `SELECT s.device_type_flags AS f, s.file_ext AS ext, ${vCol} AS v, p.path AS path,
                COUNT(*) AS n
         FROM k_sound_info s ${pJoin}
         WHERE s.bank_chain_id = ?
         GROUP BY s.device_type_flags, s.file_ext, v, p.path`,
      )
      .all(id);

    const vendors = new Map<string, number>();
    const types = new Map<string, number>();
    const paths = new Map<string, number>();
    let total = 0;
    for (const r of rows) {
      const n = Number(r.n ?? 0);
      total += n;
      const v = String(r.v ?? "").trim() || "(none)";
      vendors.set(v, (vendors.get(v) ?? 0) + n);
      const t = typeName(Number(r.f ?? 0), String(r.ext ?? "").toLowerCase());
      types.set(t, (types.get(t) ?? 0) + n);
      const p = String(r.path ?? "") || "(none)";
      paths.set(p, (paths.get(p) ?? 0) + n);
    }
    console.log(`  Sounds: ${total}`);
    console.log("  Vendor on the sounds themselves:");
    for (const [v, n] of [...vendors].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(6)}  ${v}${v === "(none)" ? "   <- never set" : ""}`);
    }
    console.log("  Content type:");
    for (const [t, n] of [...types].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(6)}  ${t}${t === "NOT SET" ? "   <- set it in Edit > General" : ""}`);
    }
    console.log("  Audio lives in:");
    for (const [p, n] of [...paths].sort((a, b) => b[1] - a[1])) {
      const here = p !== "(none)" && fs.existsSync(p);
      const installed = ["/Users/Shared/", "/Library/", "/Applications/"].some((r) => p.startsWith(r));
      console.log(
        `    ${String(n).padStart(6)}  ${p}  ${here ? "" : "[MISSING] "}${installed ? "(installed library -> flat layout)" : "(your own folder -> nests under vendor)"}`,
      );
    }

    // Candidate folders, in the order anything would look.
    const soundVendor = [...vendors].filter(([v]) => v !== "(none)").sort((a, b) => b[1] - a[1])[0]?.[0];
    const cands: string[] = [];
    for (const v of [soundVendor, bcvendor]) {
      if (v && v.toLowerCase() !== "other") cands.push(`${folderName(v)}/${folderName(name)}`);
    }
    cands.push(folderName(name));
    console.log("  Image folders:");
    for (const rel of [...new Set(cands)]) {
      const c = contents(path.join(imageDir, rel));
      if (!c) {
        console.log(`    image/${rel}/  does not exist`);
      } else if (c.art.length === 0) {
        console.log(
          `    image/${rel}/  EXISTS but holds no artwork${c.subdirs.length ? ` (${c.subdirs.length} subfolder(s))` : ""}`,
        );
      } else {
        console.log(`    image/${rel}/  ${c.art.length} artwork file(s), meta: ${c.metas.join(", ") || "NONE"}`);
        if (c.metas.length > 1) console.log("      ^ more than one .meta - remove the stale one");
        for (const m of c.metas) {
          const text = fs.readFileSync(path.join(imageDir, rel, m), "utf8").replace(/\s+/g, " ").trim();
          console.log(`      ${m}: ${text}`);
        }
      }
    }
    console.log();
  }
  d.close();
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
NODE
