# Contributing

Bug reports should include GNOME Shell version, Wayland/X11 session type, display
layout/scaling, input device, shortcut and reproducible steps. Describe whether
the issue occurs during zoom or after the zoom factor has settled.

Run `./scripts/check.sh` before submitting a change. Changes to runtime behavior
should include a meaningful regression test. Run `bash tests/integration.sh` on
GNOME 46 when modifying magnifier interaction; this creates a separate headless
Wayland session and never sends input to the current desktop.

Keep patches focused. Preserve attribution and existing license notices. Use
ordinary descriptive commits; list actual test results and limitations in PRs.
Review and understand submitted code, regardless of which development tools
were used. Do not label source-only or mock tests as compositor integration tests.
