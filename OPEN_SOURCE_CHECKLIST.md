# Open-source launch checklist

## Before making the repository public

- [ ] Choose/confirm GitHub owner name
- [ ] Replace every `OWNER` placeholder in `addon/manifest.json`, `updates.json`, and README links if added
- [ ] Confirm MIT license choice
- [ ] Test `1.1.0-alpha.1` on Zotero 10
- [ ] Confirm right-click import
- [ ] Confirm Tools-menu import
- [ ] Confirm icons in light/dark themes
- [ ] Run manual test matrix in `docs/TESTING.md`
- [ ] Create public GitHub repository `zotero-folder-drop-importer`
- [ ] Push source
- [ ] Verify GitHub Actions build succeeds
- [ ] Tag first public alpha
- [ ] Verify release contains XPI
- [ ] Update manifest/update URLs to real repository
- [ ] Rebuild and release corrected alpha if necessary

## After public alpha

- [ ] Enable GitHub Discussions or decide to use Issues only
- [ ] Enable private vulnerability reporting if available
- [ ] Create `good first issue` labels
- [ ] Announce on Zotero Forums after basic cross-platform testing
