#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail
SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
SANDBOX="$(mktemp -d)"
trap 'rm -rf -- "$SANDBOX"' EXIT
DATA="$SANDBOX/data"
DEST="$DATA/gnome-shell/extensions/smooth-push-zoom@jinkim0823.github.io"
XDG_DATA_HOME="$DATA" bash "$SOURCE/install.sh" >/dev/null
cmp "$SOURCE/extension.js" "$DEST/extension.js"
# Simulate the old self-install failure: execute from the installed directory.
cp "$SOURCE/install.sh" "$DEST/install.sh"
(cd "$DEST" && XDG_DATA_HOME="$DATA" bash ./install.sh >/dev/null)
cmp "$SOURCE/extension.js" "$DEST/extension.js"
# Invalid new schema must leave the old installation intact.
cp -a "$SOURCE" "$SANDBOX/broken"
printf '<broken>\n' > "$SANDBOX/broken/schemas/org.gnome.shell.extensions.smooth-push-zoom.gschema.xml"
if XDG_DATA_HOME="$DATA" bash "$SANDBOX/broken/install.sh" >/dev/null 2>&1; then
    printf 'Invalid schema unexpectedly installed\n' >&2
    exit 1
fi
cmp "$SOURCE/extension.js" "$DEST/extension.js"
# A symlink must not redirect installation into another location.
mv "$DEST" "$SANDBOX/original"
ln -s "$SANDBOX/original" "$DEST"
if XDG_DATA_HOME="$DATA" bash "$SOURCE/install.sh" >/dev/null 2>&1; then
    printf 'Symbolic-link destination unexpectedly replaced\n' >&2
    exit 1
fi
cmp "$SOURCE/extension.js" "$SANDBOX/original/extension.js"
printf 'PASS: fresh install, self-install, validation failure, symlink protection\n'
