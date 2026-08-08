#!/usr/bin/env bash
# Pack the working tree back into the zip the Pages workflow deploys.
#
# The workflow does `unzip -o pokelike-site-for-actions.zip -d dist` and then
# `test -f dist/index.html`. That single assertion is the whole contract: if
# index.html is not at the ROOT of the zip, the deploy fails. Packing from
# inside the source dir (rather than zipping the dir itself) is what guarantees
# that, so this script always cds in first.
set -euo pipefail

REPO="${REPO:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
ZIP="$REPO/pokelike-site-for-actions.zip"
SRC="$REPO/.pokelike-src"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ -d "$SRC" ] || { echo "error: $SRC not found — run unpack.sh first" >&2; exit 1; }
[ -f "$SRC/index.html" ] || { echo "error: $SRC/index.html missing" >&2; exit 1; }

if [ "${SKIP_CHECK:-0}" != "1" ]; then
  echo "running check.mjs…"
  node "$HERE/check.mjs" "$SRC" || {
    echo "error: check failed — fix it, or SKIP_CHECK=1 to pack anyway" >&2
    exit 1
  }
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# .mapcache holds the decomp tilesets render-maps.py downloads — tens of MB of
# build input that must never reach the deployed site.
( cd "$SRC" && zip -q -r -X "$TMP/out.zip" . \
    -x '.claude/*' '*.skill' '.packed-at' '.git/*' '.mapcache/*' \
       '__MACOSX/*' '.DS_Store' '*/.DS_Store' 'node_modules/*' )

# Verify the artifact the way the workflow will, before it reaches CI.
#
# The listing is captured first rather than piped into `grep -q`: under
# `set -o pipefail` the early exit of `grep -q` gives `unzip` a SIGPIPE, the
# pipeline reports 141, and a perfectly good zip looks broken. It races on zip
# size, so it passes on a small tree and fails on a big one.
LISTING="$(unzip -l "$TMP/out.zip")"
grep -qE ' index\.html$' <<<"$LISTING" || {
  echo "error: index.html is not at the zip root — the Pages deploy would fail" >&2
  exit 1
}

mv "$TMP/out.zip" "$ZIP"
touch "$SRC/.packed-at"

echo "packed $(unzip -l "$ZIP" | tail -1 | awk '{print $2}') files · $(du -h "$ZIP" | cut -f1) → $ZIP"
echo "commit the zip to deploy (push to main triggers Pages)."
