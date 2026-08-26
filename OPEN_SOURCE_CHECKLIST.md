# Open-source launch checklist

> **Status: complete.** Kept as a record of the launch. The repository is public
> and `1.1.0` is released. Nothing here needs action.

## Before making the repository public

- [x] Choose/confirm GitHub owner name
- [x] Replace every `OWNER` placeholder in `addon/manifest.json`, `updates.json`, and README links if added
- [x] Confirm MIT license choice
- [x] Test on Zotero 10
- [x] Confirm right-click import
- [x] Confirm File-menu import
- [x] Confirm icons in light/dark themes
- [x] Run manual test matrix in `docs/TESTING.md`
- [x] Create public GitHub repository `zotero-folder-drop-importer`
- [x] Push source
- [x] Verify GitHub Actions build succeeds
- [x] Tag first public alpha
- [x] Verify release contains XPI
- [x] Update manifest/update URLs to real repository

## After public alpha

- [x] Automated test suite in CI
- [x] Stable `1.1.0` release with a working update channel
- [ ] Enable GitHub Discussions or decide to use Issues only
- [ ] Enable private vulnerability reporting if available
- [ ] Create `good first issue` labels
- [ ] Announce on Zotero Forums after cross-platform testing
