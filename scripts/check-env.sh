#!/usr/bin/env bash
# Shows what the app will actually see in .env.local, without printing secrets.
set -uo pipefail
exec node --experimental-strip-types - "$@" <<'NODE'
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const names = [".env.local", ".env", ".env.development.local", ".env.production.local"];

console.log("Looking in:", root);
console.log("(this must be the folder containing package.json)");
console.log("  package.json present:", fs.existsSync(path.join(root, "package.json")));

let any = false;
for (const name of names) {
  const p = path.join(root, name);
  if (!fs.existsSync(p)) continue;
  any = true;
  console.log(`\n=== ${name} ===`);
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  const seen = new Map();
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      console.log(`  line ${i + 1}: NO '=' SIGN -> ignored:  ${trimmed.slice(0, 40)}`);
      return;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    const quoted = /^".*"$|^'.*'$/.test(value);
    if (quoted) value = value.slice(1, -1);

    const prev = seen.get(key);
    seen.set(key, { line: i + 1, value, quoted });
    const note = [];
    if (value === "") note.push("EMPTY");
    if (quoted) note.push("quoted (fine, quotes are stripped)");
    if (/\s/.test(value)) note.push("CONTAINS A SPACE");
    if (prev) note.push(`overrides the value on line ${prev.line}`);
    console.log(
      `  line ${i + 1}: ${key} = ${value ? `${value.length} chars, starts "${value.slice(0, 4)}…"` : "(empty)"}` +
        (note.length ? `   <-- ${note.join("; ")}` : ""),
    );
  });

  console.log("\n  What the app will use:");
  for (const key of ["OPENAI_API_KEY", "SERPAPI_API_KEY"]) {
    const entry = seen.get(key);
    if (!entry) console.log(`    ${key}: NOT SET`);
    else if (!entry.value) console.log(`    ${key}: SET BUT EMPTY  (line ${entry.line}) <-- this is why it looks missing`);
    else console.log(`    ${key}: OK (${entry.value.length} chars, from line ${entry.line})`);
  }
}

if (!any) {
  console.log("\nNo .env file found in this folder.");
  console.log("Create one with:   cp .env.example .env.local");
}
console.log("\nAfter any change, fully stop the server (Ctrl+C) and run npm run dev again.");
NODE
