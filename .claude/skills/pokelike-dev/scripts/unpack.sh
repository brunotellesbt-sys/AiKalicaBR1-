#!/usr/bin/env bash
# Unpack the shipped zip into an editable working tree.
#
# The repo tracks only pokelike-site-for-actions.zip, so every edit starts here
# and ends with repack.sh. Running this twice is safe: it refuses to clobber a
# working tree that has changes you have not packed yet, because that tree is
# the only copy of your work.
set -euo pipefail

REPO="${REPO:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
ZIP="$REPO/pokelike-site-for-actions.zip"
SRC="$REPO/.pokelike-src"

[ -f "$ZIP" ] || { echo "error: $ZIP not found" >&2; exit 1; }

if [ -d "$SRC" ] && [ "${FORCE:-0}" != "1" ]; then
  # Exclude only the stamp file itself. Excluding by a '*/.*' glob would match
  # the whole tree, since the working dir is itself dot-prefixed.
  if [ -f "$SRC/.packed-at" ] && [ -z "$(find "$SRC" -newer "$SRC/.packed-at" -type f -not -name '.packed-at' -print -quit)" ]; then
    echo "working tree is already in sync with the zip — nothing to do"
    echo "$SRC"
    exit 0
  fi
  echo "error: $SRC has unpacked changes that are not in the zip." >&2
  echo "       run repack.sh to save them, or FORCE=1 unpack.sh to discard them." >&2
  exit 1
fi

rm -rf "$SRC"
mkdir -p "$SRC"
unzip -q -o "$ZIP" -d "$SRC"
touch "$SRC/.packed-at"

# Keep the working tree out of git: the zip is the tracked artifact, and
# committing 180 loose files alongside it would double the repo and confuse
# the Pages workflow about which copy is authoritative.
if ! grep -qs '^\.pokelike-src/' "$REPO/.gitignore" 2>/dev/null; then
  printf '.pokelike-src/\n' >> "$REPO/.gitignore"
  echo "added .pokelike-src/ to .gitignore"
fi

echo "unpacked $(find "$SRC" -type f | wc -l | tr -d ' ') files to $SRC"
