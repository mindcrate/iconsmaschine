#!/usr/bin/env bash
# Read-only diagnostic for NI Resources (image + dist_database).
#
# Maschine needs TWO folders per plugin, not one:
#   NI Resources/image/<...>/          artwork + <Name>.meta
#   NI Resources/dist_database/<...>/  categories.json, color.json,
#                                      shortname.json + <Name>.meta
#
# This dumps real factory examples of both so the exact formats can be matched
# instead of guessed. It only reads - it writes, changes and deletes nothing.

set -uo pipefail

IMAGE_DIR="${NI_RESOURCES_IMAGE_DIR:-/Users/Shared/NI Resources/image}"
NI_ROOT="$(dirname "$IMAGE_DIR")"
DIST_DIR="$NI_ROOT/dist_database"

rule() { printf '\n========== %s ==========\n' "$1"; }
sub()  { printf '\n--- %s ---\n' "$1"; }

dump_text() {   # path, max lines
  local f="$1" n="${2:-40}"
  echo "    bytes: $(wc -c < "$f" | tr -d ' ')   type: $(file -b "$f")"
  echo "    ---- contents ----"
  head -c 4000 "$f" | head -"$n" | sed 's/^/    /'
  echo
  echo "    ---- first bytes (octal dump) ----"
  od -c "$f" 2>/dev/null | head -10 | sed 's/^/    /'
}

rule "NI Resources root"
echo "$NI_ROOT"
ls -la "$NI_ROOT" 2>/dev/null | sed 's/^/  /'

rule "Does dist_database exist?"
if [ -d "$DIST_DIR" ]; then
  echo "YES: $DIST_DIR"
  echo "top-level entries: $(find "$DIST_DIR" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')"
  find "$DIST_DIR" -mindepth 1 -maxdepth 1 2>/dev/null | head -15 | sed 's/^/  /'
else
  echo "NO - $DIST_DIR does not exist."
  echo "That alone would explain why plugin artwork never resolves."
fi

rule "A real dist_database entry (every file, verbatim)"
FOUND=""
while IFS= read -r -d '' CAT; do
  FOUND="$(dirname "$CAT")"
  break
done < <(find "$DIST_DIR" -name 'categories.json' -print0 2>/dev/null)

if [ -z "$FOUND" ]; then
  echo "No categories.json found under $DIST_DIR"
  echo "Searching the whole NI Resources tree for one:"
  find "$NI_ROOT" -name 'categories.json' 2>/dev/null | head -5 | sed 's/^/  /'
else
  echo "folder: $FOUND"
  ls -la "$FOUND" | sed 's/^/  /'
  for NAME in categories.json color.json shortname.json; do
    if [ -f "$FOUND/$NAME" ]; then
      sub "$NAME"
      dump_text "$FOUND/$NAME" 60
    else
      sub "$NAME - not present"
    fi
  done
  while IFS= read -r -d '' M; do
    sub "dist_database .meta -> $(basename "$M")"
    dump_text "$M" 40
    break
  done < <(find "$FOUND" -maxdepth 1 -name '*.meta' -print0 2>/dev/null)
fi

rule "Any other json filenames used in dist_database"
find "$DIST_DIR" -name '*.json' 2>/dev/null | sed 's|.*/||' | sort | uniq -c | sort -rn | head -10 | sed 's/^/  /'

rule "A real image .meta, for comparison"
while IFS= read -r -d '' M; do
  sub "image .meta -> $(basename "$M")"
  echo "    folder: $(dirname "$M")"
  dump_text "$M" 40
  break
done < <(find "$IMAGE_DIR" -maxdepth 3 -name '*.meta' -size +0c -print0 2>/dev/null)

rule "Image folder shape: is it nested per vendor, or flat?"
echo "top-level entries: $(find "$IMAGE_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
echo "folders that themselves contain subfolders (vendor/plugin nesting):"
while IFS= read -r -d '' D; do
  if [ -n "$(find "$D" -mindepth 1 -maxdepth 1 -type d -print -quit 2>/dev/null)" ]; then
    echo "  $(basename "$D")/"
    find "$D" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -3 | sed 's|.*/|      |'
  fi
done < <(find "$IMAGE_DIR" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null | head -z -n 40)

rule "User Content (where presets live)"
UC="$HOME/Documents/Native Instruments/User Content"
if [ -d "$UC" ]; then
  echo "$UC"
  find "$UC" -mindepth 1 -maxdepth 2 2>/dev/null | head -15 | sed 's/^/  /'
else
  echo "not found: $UC"
fi

rule "Browser database location (do NOT edit these)"
find "$HOME/Library/Application Support/Native Instruments" -maxdepth 2 -name '*.db3' 2>/dev/null | head -5 | sed 's/^/  /'

rule "Done - nothing was modified"
