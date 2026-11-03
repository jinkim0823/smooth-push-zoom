# Smooth Push Zoom 0.2.0

Smooth, cursor-anchored desktop zoom for **GNOME Shell 46**. Hold **Super + Alt** and scroll to zoom; return to **1.00×** to turn Desktop Zoom off.

## What's new

- **Zoom only the monitor under the pointer.** With several monitors, GNOME's full-screen zoom magnifies all of them as one image. The zoom then spills across monitors, and mismatched monitor sizes expose glitchy empty areas ([GNOME#5751](https://gitlab.gnome.org/GNOME/gnome-shell/-/work_items/5751), [GNOME#8101](https://gitlab.gnome.org/GNOME/gnome-shell/-/work_items/8101)). The new option is on by default. The view stays inside the current monitor and follows the pointer to the next one. Switch it off on the Camera page.
- **No log flooding.** The responsive-pointer hook now runs only while zoom is on. Before, an idle per-frame callback could log one critical message per frame while GNOME Shell blocked JavaScript callbacks during garbage collection.
- **Frame-driven animation.** Zoom interpolation follows the stage frame cycle instead of using a `Clutter.Timeline`, so disabling the extension leaves no objects behind.
- Disabling during a zoom animation in monitor mode restores whole-desktop zoom correctly.

## Install

Download **smooth-push-zoom@jinkim0823.github.io.shell-extension.zip** below, rather than GitHub's automatically generated source archive.

```sh
gnome-extensions install --force smooth-push-zoom@jinkim0823.github.io.shell-extension.zip
```

Then enable it in the Extensions app or with `gnome-extensions enable smooth-push-zoom@jinkim0823.github.io`. A running GNOME Shell on Wayland loads new extension code at the next login.

## Validation and scope

- 56 runtime regression checks with mocked GNOME objects.
- 66 integration checks in isolated GNOME 46 Wayland compositors: one monitor, and two mismatched virtual monitors in both orders.
- Shexli 0.2.1 static review: no findings.

The package supports **GNOME 46 only**. Physical multi-monitor setups have been tried by the author on one 1920×1080 + 2560×1440 desk. X11, mixed scaling, lock/unlock and broader hardware need more testing. The software-rendered tests cannot reproduce GPU-specific tearing.

SHA-256 checksums for the installable ZIP are attached.
