#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
OUT="$ROOT/dist/standard"
mkdir -p "$OUT"
glib-compile-schemas --strict --dry-run "$ROOT/schemas"
gnome-extensions pack --force --out-dir="$OUT" --extra-source=geometry.js \
    --extra-source=README.md --extra-source=LICENSE --extra-source=NOTICE.md \
    --extra-source=CHANGELOG.md "$ROOT"
printf 'Package created in %s\n' "$OUT"
