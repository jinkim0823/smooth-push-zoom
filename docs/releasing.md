# Releasing

`v0.1.0-rc.1` is the earlier candidate and `v0.1.0` is the first public release,
which adds balanced Push borders and Camera preferences. Never move or reuse
published tags; tag each new release on its reviewed commit and update
`CHANGELOG.md` and `docs/release-notes.md` in the same commit.
Standard metadata supports GNOME 46 only.

1. Run `./scripts/check.sh` and the GNOME 46 integration suite.
2. Verify the release diff, license notices, README images and known limitations.
3. Confirm the ZIP contents with `node tests/package.cjs`.
4. Push the reviewed commit and tag to the project repository.
5. For public distribution, make the repository public, then create a GitHub
   release and attach the standard `.shell-extension.zip`. The **prerelease**
   checkbox is optional: use it if seeking preview testers. State the tested
   GNOME 46 scope and outstanding checks either way.
6. Keep the experimental GNOME 51 build out of the initial standard release.
   If distributing it later, label it explicitly and use `experimental-51` in its
   downloadable filename. Both ZIPs share a UUID and cannot run side by side.
7. Include SHA256 checksums and release notes. Link the demo as illustrative
   footage from an isolated software-rendered GNOME 46 session.

For GNOME Extensions distribution, sign in at https://extensions.gnome.org/,
open https://extensions.gnome.org/upload/, and upload the standard package.
Respond to reviewer feedback and submit corrected versions as needed.
Use the public repository URL for source and issue reports.

GNOME Extensions submissions should use the standard package. The ZIP excludes
development/test scripts and generated schema binaries. Retain readable source,
schema XML, license and attribution. Store review is a separate process; neither
GitHub publication nor automated test success implies store approval.

The public UUID replaces the earlier local UUID. Migration preserves the settings
schema; disable the local build before enabling the public one. Do not silently
remove or reconfigure other extensions.

Before promoting to a stable release, exercise the outstanding manual coverage
in TESTING.md and collect actual user feedback. Add new Shell versions only when
the source contracts and runtime behavior have been checked.
