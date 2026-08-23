# Roadmap

The project aims to remain a focused, explicit, one-shot folder importer rather than a background synchronization service.

## Alpha

- [x] Recursive folder import
- [x] Preserve hierarchy
- [x] Right-click **Import Folder Here…**
- [x] Tools submenu
- [x] Zotero 10 selected-collection handling
- [x] Missing/inaccessible entry resilience
- [x] Basic duplicate handling
- [ ] Directly detect the collection row used as a drag/drop target
- [ ] Better progress UI
- [ ] Cancellation
- [ ] Import report with failed paths/reasons

## Beta

- [ ] SHA-256 content-hash duplicate detection
- [ ] Duplicate policy: skip / import / ask
- [ ] Stored vs linked attachment mode
- [ ] Proper Zotero preferences pane
- [ ] Skip-empty-folders option
- [ ] Better OneDrive/Dropbox/network-drive diagnostics
- [ ] Unicode and long-path test suite
- [ ] Large import stress tests
- [ ] Modular TypeScript refactor using maintained Zotero plugin tooling

## 1.0

- [ ] Windows test matrix
- [ ] macOS test matrix
- [ ] Linux test matrix
- [ ] Zotero 8/9/10 compatibility matrix or narrower documented support range
- [ ] Stable update channel
- [ ] Signed/documented GitHub Releases process
- [ ] Forum announcement and public support process

## Explicit non-goals for 1.0

- Continuous background folder watching
- Two-way filesystem synchronization
- Automatic deletion of source files
- Telemetry or analytics
- Plugin-operated cloud storage
