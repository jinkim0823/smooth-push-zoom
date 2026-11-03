# Verification

## November 3, 2026: frame hook only while zoomed

Checked with GNOME Shell 46.0 and GJS 1.80.2.

| Check | Result |
| --- | --- |
| `scripts/check.sh` | Passed, including 55 mock runtime checks |
| `tests/integration.sh` | Passed: 38 checks with one monitor, 14 in each two-monitor session |

New checks: no `before-update` handler is connected while zoom is off. It
connects when zoom turns on and is removed when zoom turns off, when the
responsive-pointer option is switched off, after a runtime error and on
disable. Disabling during a monitor-mode zoom animation restores whole-desktop
zoom.

## Working tree: balanced Push and camera preferences

Local checks were performed on September 16, 2026 with GNOME Shell 46.0 and GJS
1.80.2. The standard metadata permits only GNOME 46. A separate experimental
package permits GNOME 51; it has not been run in a GNOME 51 desktop.

| Check | Result / scope |
| --- | --- |
| JavaScript and shell syntax | Passed |
| GSettings schema validation | Passed, strict mode |
| Runtime regression suite | 44 checks passed with mocked GNOME objects |
| Installer | Fresh install, self-install, invalid schema and symlink protection passed |
| Package validation | Both channels have expected files, metadata and matching source |
| GNOME 46 integration | 35 checks passed using real Shell, magnifier and virtual input |
| Preferences | Loaded actual preferences code; zoom controls, tracking enums, bounds and margin sensitivity bindings passed |
| GNOME 51 source contract | 16 checks passed using pinned upstream methods and stub rendering |
| GitHub Actions | See repository Actions for commit-specific hosted status |

## Reproduce

```sh
./scripts/check.sh
bash tests/integration.sh
```

The integration script starts a separate headless GNOME 46 Wayland session,
using a software-rendered 1280×960 virtual display, isolated XDG directories,
an isolated session bus, and a keyfile settings backend. It does not restart or
send virtual input to the current desktop. It terminates after the checks, with
a 55-second timeout. This test harness uses GNOME 46-specific APIs and library
paths; run it in that environment.

The suite covers external zoom ON/OFF and factor changes, limit changes,
zero smoothing, native virtual wheel routing, paired-event deduplication,
virtual pointer tracking, Push preservation, cursor anchoring, equal four-edge
thresholds at 2× and 8×, native fallback and method restoration. The virtual
pointer also exercises the corrected right-edge path.
Preferences are constructed using the real GTK/libadwaita widgets and GNOME
preferences classes. The test registers them in an isolated preferences manager.

For a preferences image, set `SPZ_ARTIFACT_DIR` to an existing directory before
running the integration script. To render the synthetic demo scene, set
`SPZ_DEMO_DIR` to a frame output directory. The optional demo is illustrative
software-rendered output, not a latency or hardware performance benchmark.
The demo uses 600 fixed 1/60-second simulation steps, renders each through the
actual magnifier, then encodes an 10-second 60 fps MP4 (20 fps GIF preview).
PNG capture wall time is independent of playback time. Encode with
`./scripts/encode-demo.sh /path/to/frames`. Demo generation has a 100-second
watchdog; normal integration tests retain the 55-second timeout.

## GNOME 51 source verification

Download `magnifier.js` from the official GNOME Shell 51.0 source, then run:

```sh
gjs tests/source-api.js /path/to/magnifier.js
```

Source: https://raw.githubusercontent.com/GNOME/gnome-shell/51.0/js/ui/magnifier.js

Expected SHA-256:
`d5c99e0f4f97c9a19ca3777a96d33d450b97f10c2e29d1d672ee71f0d53f99d2`

Selected actual upstream methods run against stub scene objects. This verifies
ROI anchoring, bounds, equal Push thresholds and native tracking/easing contracts. It does not
load the complete GNOME 51 compositor or establish hardware compatibility.

## Monitor mode

`tests/integration.sh` runs two more isolated sessions with two virtual monitors,
1920×1080 and 2560×1440. The first session puts the larger monitor first. The
second puts the smaller monitor at x = 0 and makes the larger one primary. That
order exposed an offset bug: GNOME sizes the magnifier's clipping group from the
first monitor, so the image was offset on the larger monitor until the group was
pinned to the viewport. That session checks the following:
- only the monitor under the pointer is magnified;
- the real desktop stays visible on the other monitor;
- the zoom follows the virtual pointer across monitors;
- panning cannot reach the other monitor or the empty stage area;
- the option switch works in both directions;
- disable restores full screen and the native method.

Mock tests cover anchoring, clamping, proportional mapping, and every case where
the mode must stay off. Software rendering cannot reproduce GPU-specific tearing,
so the GNOME rendering bugs themselves are verified only on real hardware.

## Outstanding manual coverage

- Physical mouse wheel and touchpad feel on a normal dconf-backed desktop.
- Physical multiple monitors, mixed scaling and high refresh-rate displays.
- Lock/unlock, focus/caret tracking and display-layout changes during zoom.
- X11 on GNOME 46; all actual GNOME 51 activation, preferences and input behavior.

Desktop-edge clamps can legitimately move the anchor to prevent blank space.
Non-fullscreen lenses retain GNOME's own zoom policy.

The illustration uses one continuous 2.5-second zoom-in gesture and one
continuous 2.5-second zoom-out gesture. Final factor persistence happens only
once after each gesture; fine-grained intermediate factors are not rounded.
