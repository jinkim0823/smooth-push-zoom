# Changelog

## 0.1.0 — 2026-10-01

First public release. Supports GNOME Shell 46 only.

- Correct asymmetric full-screen mouse Push borders with equal, zoom-independent margins.
- Add a 0–200 logical-pixel edge margin and a switch to restore native Push.
- Add a Camera page for shared GNOME mouse, focus, caret and desktop-boundary settings.
- Preserve native lens and focus/caret Push behavior and restore the mouse method on disable.

## 0.1.0-rc.1 — release candidate

First public release candidate, based on local development builds from
September 10–16, 2026.

- Smooth modifier-scroll zoom anchored at the cursor.
- Preserve GNOME mouse tracking and fully disable zoom at 1.00×.
- Synchronize external zoom changes and avoid double-counting paired scroll input.
- Optional responsive pointer tracking on GNOME 46.
- Preferences, staged installer, regression checks and isolated GNOME 46 tests.
- GNOME 51 code path available in a separate experimental package.

Only GNOME 46 is permitted by standard release metadata. Physical hardware,
multi-monitor and GNOME 51 runtime verification remain outstanding.
