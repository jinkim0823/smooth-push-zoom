# Smooth Push Zoom 0.1.0

Smooth, cursor-anchored desktop zoom for **GNOME Shell 46**. Hold **Super + Alt** and scroll to zoom; return to **1.00×** to turn Desktop Zoom off.

## Features

- Smooth scroll zoom with configurable shortcut, speed, smoothing and maximum magnification.
- Equal Push borders on all four sides, with a configurable 0–200 logical-pixel margin (default 24 px) that stays the same apparent size as zoom changes.
- A Camera preferences page for GNOME mouse, keyboard focus and text cursor tracking: Push, Proportional, Centered or No tracking.
- A native desktop-edge scrolling option and a switch to restore GNOME's original Push behavior.
- External zoom changes take precedence; optional responsive pointer tracking on older GNOME.

Tracking and desktop-limit controls edit shared GNOME Accessibility settings. These choices persist after disabling the extension. Disabling the extension keeps the current magnification.

## Install

Download **smooth-push-zoom@jinkim0823.github.io.shell-extension.zip** below, rather than GitHub's automatically generated source archive.

```sh
gnome-extensions install --force smooth-push-zoom@jinkim0823.github.io.shell-extension.zip
```

Log out and back in to load the extension, then enable it:

```sh
gnome-extensions enable smooth-push-zoom@jinkim0823.github.io
```

If migrating from the earlier local build, disable `smooth-push-zoom@local` before enabling this release. Existing extension preferences are retained. Run only one build at a time.

## Validation and scope

- 44 runtime regression checks with mocked GNOME objects.
- 35 integration checks in an isolated GNOME 46 Wayland compositor, including real preferences widgets and virtual input.
- Installer and package checks passed; GitHub Actions passed for the release commit.

The attached package supports **GNOME 46 only**. X11, multi-monitor and mixed-scaling configurations, lock/unlock, and broader physical-device behavior need further testing. GNOME 51 remains experimental and is not included in this release.

The README demo is an offline illustration rendered through GNOME, not a real-time hardware performance recording. This GitHub release does not imply approval or availability on extensions.gnome.org.

Report issues with GNOME version, session type, display configuration and reproduction steps. SHA-256 checksums for the installable ZIP are attached.

