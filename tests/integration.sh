#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
export SPZ_TEST_TIMEOUT=55
if [[ -n "${SPZ_DEMO_DIR:-}" ]]; then
    export SPZ_TEST_TIMEOUT=100
fi
export SPZ_PREFS_SCRIPT="$ROOT/tests/prefs-window.js"
TEST_ROOT="$(mktemp -d)"
cleanup() {
    # The isolated document portal may leave its FUSE mount while shutting down.
    # Unmount only this test's private runtime path before deleting its files.
    if mountpoint -q "$TEST_ROOT/run/doc"; then
        fusermount3 -u "$TEST_ROOT/run/doc"
    fi
    rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT
export XDG_DATA_HOME="$TEST_ROOT/data"
export XDG_CONFIG_HOME="$TEST_ROOT/config"
export XDG_CACHE_HOME="$TEST_ROOT/cache"
export XDG_RUNTIME_DIR="$TEST_ROOT/run"
export GSETTINGS_BACKEND=keyfile
export XDG_CURRENT_DESKTOP=GNOME
export LIBGL_ALWAYS_SOFTWARE=1
export GI_TYPELIB_PATH="/usr/lib/gnome-shell/girepository-1.0${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}"
export LD_LIBRARY_PATH="/usr/lib/gnome-shell${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export GSK_RENDERER=cairo
unset DISPLAY WAYLAND_DISPLAY SESSION_MANAGER
mkdir -p "$XDG_DATA_HOME/gnome-shell/extensions" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
bash "$ROOT/install.sh" >/dev/null
cp -a "$ROOT/tests/gnome-integration" "$XDG_DATA_HOME/gnome-shell/extensions/smooth-push-zoom-test@local"
if ! dbus-run-session -- bash -c '
    gsettings set org.gnome.shell enabled-extensions '\''["smooth-push-zoom-test@local"]'\''
    gsettings set org.gnome.shell disable-user-extensions false
    exec timeout "$SPZ_TEST_TIMEOUT" gnome-shell --wayland --headless --no-x11 --wayland-display=spz-test --virtual-monitor 1280x960 --mode=user
' > "$TEST_ROOT/session.log" 2>&1; then
    cat "$TEST_ROOT/session.log"
    exit 1
fi
RESULT="$XDG_CACHE_HOME/zoom-result.txt"
if [[ ! -f "$RESULT" ]] || [[ "$(head -n 1 "$RESULT")" != SUCCESS ]]; then
    cat "$TEST_ROOT/session.log"
    [[ ! -f "$RESULT" ]] || cat "$RESULT"
    exit 1
fi
cat "$RESULT"
