# Releasing

The first candidate is `v0.1.0-rc.1`. It is a preview, not a claim of complete
hardware coverage. Standard metadata supports GNOME 46 only.

1. Run `./scripts/check.sh` and the GNOME 46 integration suite.
2. Verify the release diff, license notices, README images and known limitations.
3. Confirm the ZIP contents with `node tests/package.cjs`.
4. Push the reviewed commit and tag to the project repository.
5. Create a GitHub **prerelease** and attach the standard `.shell-extension.zip`.
6. Attach the experimental 51 build separately, with `experimental-51` in its
   downloadable filename. Both ZIPs intentionally share a UUID: they are
   alternative versions, not extensions that should run simultaneously.
7. Include SHA256 checksums and release notes. Link the demo as illustrative
   footage from an isolated software-rendered GNOME 46 session.

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
