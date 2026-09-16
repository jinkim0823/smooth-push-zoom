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
