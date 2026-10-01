# Architecture

The Shell-stage captured-event handler recognizes exact modifier combinations
and vertical scroll. Smooth/discrete pairs from the same device and timestamp
are counted once. Horizontal-only and unmatched input propagates.

Zoom targets are multiplied by `exp(delta * sensitivity)`. One Clutter timeline
interpolates toward the target using monotonic elapsed time. Final zoom is rounded
to GNOME's two-decimal persistence precision; settings are not written each frame.

Full-screen zoom preserves `zoom * (pointer - center)` when changing the ROI
center. Desktop bounds can override that anchor. Normal pointer movement retains
GNOME's configured tracking policy. Non-fullscreen regions use native behavior.

The extension uses GNOME's magnifier, not a separate screen-capture renderer.
The isolated private API adapter calls `ZoomRegion._changeROI()` with
`animate: false`: `setMagFactor()` adds another 100 ms animation in the reviewed
46.0 and 51.0 sources. `_isFullScreen()` and `_followingCursor` are also private
dependencies. Review these contracts before adding Shell versions.

On older GNOME, motion requests a frame and before-update refreshes pointer
tracking. This keeps native polling as a fallback. On GNOME 51, paired native
`_queuePointerPositionUpdate()` / `_getPointerPosition()` methods are detected;
no supplemental frame hook is added, and native fractional coordinates are used.

All extension signals and timelines are removed on disable. External zoom changes
cancel interpolation. The extension does not send network requests, spawn
processes, change mouse acceleration, or force a mouse tracking mode.

## Balanced Push and native tracking preferences

In the audited GNOME 46.0 and 51.0 `_centerFromPointPush()`, the right/bottom
thresholds subtract the unzoomed cursor sprite width/height; left/top do not.
Consequently this directional inset grows visually with magnification and varies
with cursor theme. `_changeROI()` separately clamps to the desktop when
`scroll-at-edges` is false. These are distinct boundaries.
Reported upstream as
[GNOME/gnome-shell#9451](https://gitlab.gnome.org/GNOME/gnome-shell/-/work_items/9451).

During enable, `InjectionManager` wraps `_centerFromMousePosition()` on the
existing zoom-region prototypes. Only this magnifier’s full-screen mouse Push
uses the replacement; other modes and regions call the original function. New
regions of the same native class inherit the wrapper. Disable restores it.
No timer or extra per-motion settings write is introduced. The shared
`_centerFromPointPush()` function is untouched, preserving focus/caret behavior.

For ROI `[x, y, w, h]` and factors `zx, zy`, inset is
`min(margin / zx, 0.45 * w)` horizontally (likewise vertically). The center moves
only by the pointer’s excess beyond the inset rectangle. Tracking the hotspot
removes dependence on sprite dimensions and keeps equal visible logical-pixel
thresholds at each zoom level. Native `_changeROI()` still applies desktop bounds.

Preferences bind tracking enums and `scroll-at-edges` directly to the native
GSettings schema. No native settings are rewritten at enable/disable; opening
preferences only reads them. Changes are intentionally shared and persistent.

Sources: [GNOME 46 magnifier](https://github.com/GNOME/gnome-shell/blob/46.0/js/ui/magnifier.js),
[GNOME 51 magnifier](https://github.com/GNOME/gnome-shell/blob/51.0/js/ui/magnifier.js).
