#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
for file in extension.js prefs.js tests/runtime.js tests/source-api.js tests/gnome-integration/extension.js tests/gnome-integration/demo.js tests/prefs-window.js; do
    node --input-type=module --check < "$file"
done
for file in install.sh pack.sh scripts/check.sh tests/install.sh tests/integration.sh; do
    bash -n "$file"
done
glib-compile-schemas --strict --dry-run schemas
gjs tests/runtime.js
bash tests/install.sh
./pack.sh
./pack.sh --experimental-51
node tests/package.cjs
