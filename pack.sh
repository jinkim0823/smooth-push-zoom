#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
CHANNEL=standard
case "${1:-}" in
    '') ;;
    --experimental-51) CHANNEL=experimental-51 ;;
    *) printf 'Usage: %s [--experimental-51]\n' "$0" >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || exit 2
STAGING="$(mktemp -d)"
trap 'rm -rf -- "$STAGING"' EXIT
for file in extension.js prefs.js metadata.json README.md LICENSE NOTICE.md CHANGELOG.md; do
    cp -- "$ROOT/$file" "$STAGING/"
done
mkdir "$STAGING/schemas"
cp -- "$ROOT/schemas/"*.gschema.xml "$STAGING/schemas/"
glib-compile-schemas --strict --dry-run "$STAGING/schemas"
if [[ "$CHANNEL" == experimental-51 ]]; then
    node - "$STAGING/metadata.json" <<'JS'
const fs = require('node:fs');
const path = process.argv[2];
const metadata = JSON.parse(fs.readFileSync(path, 'utf8'));
metadata['shell-version'] = ['51'];
metadata.description += ' Experimental GNOME 51 preview: runtime validation pending.';
fs.writeFileSync(path, JSON.stringify(metadata, null, 2) + '\n');
JS
fi
OUT="$ROOT/dist/$CHANNEL"
mkdir -p "$OUT"
gnome-extensions pack --force --out-dir="$OUT" --extra-source=README.md \
    --extra-source=LICENSE --extra-source=NOTICE.md --extra-source=CHANGELOG.md "$STAGING"
printf 'Package created in %s\n' "$OUT"
