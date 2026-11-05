# Testing

```sh
./scripts/check.sh
bash tests/integration.sh
```

`check.sh` runs syntax checks, schema validation, `tests/runtime.js`
(GNOME objects replaced by small fakes), the installer test and the package
test.

`tests/integration.sh` starts headless GNOME 46 Wayland sessions with their own
XDG directories, session bus and keyfile settings. It does not touch the
running desktop. There are three sessions:

- one 1280×960 monitor: real preferences window, wheel input through virtual
  devices, cursor anchoring, equal Push margins at 2× and 8×, external setting
  changes, and restoring GNOME's methods on disable;
- two monitors (2560×1440 first, 1920×1080 second);
- the same two monitors with the smaller one first and the larger one primary.

The two-monitor sessions check that only the monitor under the pointer is
zoomed, that the zoom follows the pointer, that panning stays on that monitor,
and that switching the option off or disabling the extension restores
full-screen zoom.

Set `SPZ_ARTIFACT_DIR` to save preference screenshots, or `SPZ_DEMO_DIR` to
render the demo frames (encode with `scripts/encode-demo.sh`).

## Last run

2026-11-06, GNOME Shell 46.0, GJS 1.80.2: 52 runtime checks and 66 integration
checks (38 + 14 + 14) passed.

## Not covered

- X11, fractional scaling, high refresh rates.
- Physical input devices, apart from the author's own mouse and two monitors.
- Lock/unlock and monitor hotplug while zoomed.
- GPU-specific rendering. The test sessions use software rendering.
