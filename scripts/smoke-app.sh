#!/bin/sh
# Runs the packaged app from a temp folder, outside the project, so Node
# cannot find a missing module in the project's own node_modules.
set -e
app="dist/mac-arm64/iconmaschine.app"
dir=$(mktemp -d "${TMPDIR:-/tmp}/iconmaschine-smoke.XXXXXX")
ditto "$app" "$dir/iconmaschine.app"
status=0
ICONMASCHINE_SMOKE=1 "$dir/iconmaschine.app/Contents/MacOS/iconmaschine" || status=$?
rm -r "$dir"
exit $status
