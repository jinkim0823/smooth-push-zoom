# How it works

The extension drives GNOME's own magnifier (`Main.magnifier`). It does not
render anything itself. Pure calculations are in `geometry.js`. `extension.js`
connects them to GNOME.

## Input and animation

A `captured-event` handler on the stage takes vertical scroll events with the
configured modifiers. Each event multiplies the target factor by
`exp(delta * speed)`. Mutter 46 delivers a wheel tick twice, as a smooth event
and as a discrete event with the same device and time. Only the smooth one is
counted.

While the current factor differs from the target, a `before-update` handler
moves it towards the target with `1 - exp(-3 dt / smoothing)` and calls
`stage.schedule_update()` for the next frame. The handler is disconnected when
the target is reached. GSettings (`mag-factor`, `screen-magnifier-enabled`) is
written only then, rounded to two decimals as GNOME stores it.

## Zooming about the cursor

`ZoomRegion.setMagFactor()` adds its own 100 ms easing, so the extension calls
the private `_changeROI()` with `animate: false`. The new ROI centre keeps the
point under the cursor fixed:

    centre' = pointer + (centre - pointer) * oldFactor / newFactor

## Balanced Push

In GNOME 46 `_centerFromPointPush()` subtracts the cursor sprite size only at
the right and bottom edges. That margin grows with the zoom factor and depends
on the cursor theme (GNOME#9451). The extension overrides
`_centerFromMousePosition()` for full-screen mouse Push. The override uses the
pointer hotspot and the same margin on all edges: `margin / factor` in desktop
coordinates, at most 45% of the ROI. Focus and caret tracking still use GNOME's
method.

## Monitor mode

With two or more monitors, full-screen position and no lens, the zoom region's
viewport is set to the monitor under the pointer with `setViewPort()`. The rest
of the desktop is drawn normally. Three overrides support this:

- `_changeROI()` clamps the ROI to that monitor, for mouse, focus and caret tracking.
- `_updateMagViewGeometry()` removes the border GNOME draws around partial
  regions. It also pins the clip group to the viewport size. GNOME sizes that
  group from the first monitor, which offset the image on a larger monitor.
- Proportional tracking maps the current monitor instead of the whole stage.

When the pointer moves to another monitor, the viewport moves with it. Leaving
monitor mode or disabling the extension calls `setScreenPosition()` with
GNOME's configured position.

## Cleanup

Signals are kept in one list and disconnected in `disable()`. Method overrides
use `InjectionManager` and are restored on disable. An unexpected error is
logged once and the extension stops handling input until it is re-enabled.

Private API used: `_changeROI`, `_centerFromMousePosition`,
`_updateMagViewGeometry`, `_isFullScreen`, `_followingCursor`, `_mouseTrackingMode`,
`_magView` and the `_viewPort*` fields of `ZoomRegion` in
[magnifier.js](https://github.com/GNOME/gnome-shell/blob/46.0/js/ui/magnifier.js).
Check these before adding a Shell version.
