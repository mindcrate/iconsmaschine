#!/usr/bin/env bash
# Read-only diagnostic for the NI Resources / Maschine browser metadata.
#
# Answers three questions the public docs do not:
#   1. Does a .meta file carry the library name INSIDE it, not just as its name?
#   2. Does categories.json exist, and what is in it?
#   3. Where does Maschine actually keep its browser database?
#
# It only reads. It writes nothing, changes nothing, and deletes nothing.

set -uo pipefail

IMAGE_DIR="${NI_RESOURCES_IMAGE_DIR:-/Users/Shared/NI Resources/image}"
NI_ROOT="$(dirname "$IMAGE_DIR")"

rule() { printf '\n== %s ==\n' "$1"; }

rule "Image dir"
if [ ! -d "$IMAGE_DIR" ]; then
  echo "NOT FOUND: $IMAGE_DIR"
  exit 1
fi
echo "$IMAGE_DIR"
echo "libraries: $(find "$IMAGE_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"

rule "A real NI library folder (first one with a .meta)"
SAMPLE_META="$(find "$IMAGE_DIR" -maxdepth 2 -name '*.meta' -size +0c 2>/dev/null | head -1)"
if [ -z "$SAMPLE_META" ]; then
  echo "No non-empty .meta found."
else
  SAMPLE_DIR="$(dirname "$SAMPLE_META")"
  echo "folder: $SAMPLE_DIR"
  ls -la "$SAMPLE_DIR" | sed 's/^/  /'
fi

rule "Does the .meta contain its own library name?"
# This is the question that decides whether copying a .meta verbatim is safe.
# NUL-delimited: NI library names are full of spaces.
while IFS= read -r -d '' META; do
  BASE="$(basename "$META" .meta)"
  echo "--- $BASE.meta ($(wc -c < "$META" | tr -d ' ') bytes, type: $(file -b "$META"))"
  if grep -qa -- "$BASE" "$META"; then
    echo "  >>> YES: the name \"$BASE\" appears INSIDE the file <<<"
  else
    echo "  no: the name does not appear inside the file"
  fi
  echo "  printable strings:"
  strings -n 3 "$META" 2>/dev/null | head -20 | sed 's/^/    /'
  echo "  first 256 bytes:"
  od -c "$META" 2>/dev/null | head -16 | sed 's/^/    /'
done < <(find "$IMAGE_DIR" -maxdepth 2 -name '*.meta' -size +0c -print0 2>/dev/null | head -z -n 3)

rule "categories.json anywhere under NI Resources"
find "$NI_ROOT" -name 'categories.json' 2>/dev/null | head -5 | sed 's/^/  /'
CAT="$(find "$NI_ROOT" -name 'categories.json' -print 2>/dev/null | head -1)"
if [ -n "$CAT" ]; then
  echo "  --- contents of $CAT (first 60 lines) ---"
  head -60 "$CAT" | sed 's/^/    /'
else
  echo "  none found under $NI_ROOT"
fi

rule "Everything else directly under NI Resources"
ls -la "$NI_ROOT" 2>/dev/null | sed 's/^/  /'

rule "Other json/xml/plist in the image tree"
find "$IMAGE_DIR" -maxdepth 3 \( -name '*.json' -o -name '*.xml' -o -name '*.plist' \) 2>/dev/null | head -10 | sed 's/^/  /'
echo "  (distinct file extensions present in the image tree:)"
find "$IMAGE_DIR" -maxdepth 3 -type f 2>/dev/null | sed 's|.*\.||' | sort | uniq -c | sort -rn | head -10 | sed 's/^/    /'

rule "Maschine browser database"
for DB in \
  "$HOME/Library/Application Support/Native Instruments/Maschine 2/komplete.db3" \
  "$HOME/Library/Application Support/Native Instruments/Maschine 2" \
  "$HOME/Library/Application Support/Native Instruments/Komplete Kontrol"
do
  [ -e "$DB" ] && echo "  EXISTS: $DB"
done
find "$HOME/Library/Application Support/Native Instruments" -maxdepth 2 -name '*.db3' 2>/dev/null | head -5 | sed 's/^/  /'

rule "Done"
echo "Nothing was modified."
