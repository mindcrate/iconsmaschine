#!/usr/bin/env bash
# Read-only inspection of a .nksf preset file.
#
# Vendor, Product, Types and Characters - everything on the GENERAL, TYPES and
# CHARACTERS tabs - live inside the preset, not in dist_database. Before this
# app writes to presets, the container format has to be read from real ones.
#
# It only reads. It writes, changes and deletes nothing.

set -uo pipefail

UC="${1:-$HOME/Documents/Native Instruments/User Content}"

rule() { printf '\n========== %s ==========\n' "$1"; }

rule "Preset files under User Content"
find "$UC" -name '*.nksf' -o -name '*.nksn' 2>/dev/null | head -20 | sed 's/^/  /'
echo "  total: $(find "$UC" \( -name '*.nksf' -o -name '*.nksn' \) 2>/dev/null | wc -l | tr -d ' ')"

TARGET="${NKSF:-}"
if [ -z "$TARGET" ]; then
  TARGET="$(find "$UC" -name '*.nksf' 2>/dev/null | head -1)"
fi

if [ -z "$TARGET" ] || [ ! -f "$TARGET" ]; then
  echo "No .nksf found. Pass one explicitly:  NKSF=/path/to/file.nksf $0"
  exit 0
fi

rule "Target"
echo "$TARGET"
echo "  size: $(wc -c < "$TARGET" | tr -d ' ') bytes"
echo "  type: $(file -b "$TARGET")"

rule "Container chunks (first 64 bytes, and any 4-char tags)"
od -c "$TARGET" | head -8 | sed 's/^/  /'
echo "  -- uppercase 4-letter tags found near the start --"
strings -n 4 "$TARGET" 2>/dev/null | head -40 | sed 's/^/    /'

rule "Embedded JSON blocks"
# NKS stores its metadata as JSON inside the chunked container. Pull out every
# balanced-looking {...} run and pretty-print the ones that parse.
python3 - "$TARGET" <<'PYEOF'
import json, re, sys
raw = open(sys.argv[1], "rb").read()
text = raw.decode("utf-8", errors="replace")
found = 0
for m in re.finditer(r"\{", text):
    start = m.start()
    depth, i, instr, esc = 0, start, False, False
    while i < len(text) and i - start < 200000:
        ch = text[i]
        if instr:
            if esc: esc = False
            elif ch == "\\": esc = True
            elif ch == '"': instr = False
        else:
            if ch == '"': instr = True
            elif ch == "{": depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    blob = text[start:i+1]
                    try:
                        parsed = json.loads(blob)
                    except Exception:
                        break
                    if isinstance(parsed, dict) and len(blob) > 20:
                        found += 1
                        print(f"\n  --- JSON block {found} at byte {start}, {len(blob)} bytes ---")
                        print("\n".join("    " + l for l in json.dumps(parsed, indent=2).splitlines()[:60]))
                    break
        i += 1
    if found >= 6:
        break
if found == 0:
    print("  No parseable JSON found - the metadata may be binary or compressed.")
PYEOF

rule "Keys of interest"
for KEY in vendor Vendor bankchain BankChain types Types characters Characters name Name modes Modes author Author; do
  COUNT=$(strings -n 3 "$TARGET" 2>/dev/null | grep -c "\"$KEY\"" || true)
  [ "$COUNT" != "0" ] && echo "  \"$KEY\" appears $COUNT time(s)"
done

rule "Done - nothing was modified"
