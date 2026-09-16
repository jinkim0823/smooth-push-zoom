#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail

UUID='smooth-push-zoom@jinkim0823.github.io'
SRC_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}"
PARENT="$DATA_DIR/gnome-shell/extensions"
DEST="$PARENT/$UUID"

command -v glib-compile-schemas >/dev/null
if [[ -L "$DEST" ]]; then
    printf 'Refusing to replace a symbolic-link installation: %s\n' "$DEST" >&2
    exit 1
fi
mkdir -p -- "$PARENT"
STAGING="$(mktemp -d "$PARENT/.smooth-push-zoom-stage.XXXXXX")"
BACKUP=''
cleanup() {
    local result=$?
    if [[ -n "$BACKUP" && -e "$BACKUP/original" && ! -e "$DEST" ]]; then
        mv -- "$BACKUP/original" "$DEST" || {
            printf 'Restore failed; original remains at %s\n' "$BACKUP/original" >&2
            return 1
        }
    fi
    [[ ! -d "$STAGING" ]] || rm -rf -- "$STAGING"
    [[ -z "$BACKUP" || ! -d "$BACKUP" ]] || rm -rf -- "$BACKUP"
    return "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Prepare and validate before touching the installed copy. Also works when this
# script is invoked from DEST itself: all source files have already been copied.
for file in metadata.json extension.js prefs.js README.md LICENSE NOTICE.md TESTING.md CHANGELOG.md; do
    cp -- "$SRC_DIR/$file" "$STAGING/"
done
mkdir -- "$STAGING/schemas"
cp -- "$SRC_DIR/schemas/"*.gschema.xml "$STAGING/schemas/"
glib-compile-schemas --strict "$STAGING/schemas"

if [[ -e "$DEST" || -L "$DEST" ]]; then
    BACKUP="$(mktemp -d "$PARENT/.smooth-push-zoom-backup.XXXXXX")"
    mv -- "$DEST" "$BACKUP/original"
fi
mv -- "$STAGING" "$DEST"
printf 'Installed to %s\nLog out/in on Wayland to load changed code, then run:\n' "$DEST"
printf '  gnome-extensions enable %s\n' "$UUID"
