# Changelog

## 0.2.0 — 2026-11-03

Supports GNOME Shell 46 only.

- Drive zoom interpolation from the stage frame cycle (`before-update` plus `schedule_update()`) instead of a `Clutter.Timeline`. Nothing is left to destroy on disable, which resolves the EGO-L-002 review warning.
- With several monitors, zoom only the monitor under the pointer (new option, on by default). The view stays inside that monitor and follows the pointer to another monitor. This avoids GNOME's whole-desktop zoom spilling across monitors and the empty-area glitches with mismatched monitor sizes.
- Proportional mouse tracking maps the current monitor in monitor mode.
- Monitor views are borderless and fill the monitor, including when a smaller monitor comes first in the layout.
- Responsive pointer tracking connects its per-frame hook only while zoom is on. It is removed when zoom turns off, when the option is switched off, after a runtime error and on disable. Before, an idle hook ran on every stage update; while GNOME Shell blocked JavaScript callbacks during garbage collection, it logged one critical message per stage update (tens of thousands per second).
- Disabling the extension during a zoom animation in monitor mode restores whole-desktop zoom instead of leaving the zoom confined to one monitor.

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
