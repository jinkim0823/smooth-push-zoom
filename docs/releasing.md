# Releasing

1. Update `CHANGELOG.md`, `docs/release-notes.md` and `version-name` in
   `metadata.json`.
2. Run `./scripts/check.sh` and `bash tests/integration.sh`.
3. Run `./pack.sh`, then
   `uvx --from shexli --with tree-sitter==0.25.2 shexli dist/standard/*.zip`.
4. Commit, tag `vX.Y.Z` and push. Never move a published tag.
5. Create the GitHub release with the ZIP and its SHA-256.
6. Upload the same ZIP at https://extensions.gnome.org/upload/. Uploading
   replaces the page description with the one in `metadata.json`. Paste
   `docs/ego-description.txt` back in afterwards.

Add a Shell version only after checking the private magnifier API listed in
`docs/architecture.md` against that version and running the integration tests on it.
