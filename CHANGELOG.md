# Changelog

## 0.2.1 — 2026-11-11

- Move the geometry into `geometry.js` and simplify `extension.js`.
- Drop the GNOME 51 code path and the experimental 51 package.
- Shorter preference texts.
- New README demo with uneven wheel ticks and a natural mouse path.

## 0.2.0 — 2026-11-03

- Zoom only the monitor under the pointer when there are several monitors (on by default).
- Proportional tracking follows the current monitor in that mode.
- Animate from the stage frame clock instead of a `Clutter.Timeline`.
- Connect the per-frame pointer hook only while zoomed. An idle hook could flood
  the journal while GNOME Shell was blocking JavaScript callbacks.
- Disabling during a zoom animation restores whole-desktop zoom.

## 0.1.0 — 2026-10-01

- Equal Push margins on all four edges (0–200 px), independent of zoom.
- Camera page for GNOME's mouse, focus, caret and desktop-edge settings.

## 0.1.0-rc.1 — 2026-09-16

- Smooth modifier-scroll zoom anchored at the cursor.
- Keep GNOME's mouse tracking; zoom out to 1.00× turns Desktop Zoom off.
- Follow zoom changes made in GNOME settings.
- Count a wheel tick once when Mutter sends it twice.
- Optional per-frame pointer refresh.
