# Contributing

For bug reports, include the GNOME Shell version, Wayland or X11, the monitor
layout and scaling, the input device, and steps to reproduce.

Run `./scripts/check.sh` before sending a change, and `bash tests/integration.sh`
on GNOME 46 when the change touches the magnifier. Add a test for behaviour
changes. Keep the existing license and attribution notices.
