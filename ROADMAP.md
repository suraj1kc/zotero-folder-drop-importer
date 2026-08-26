# Roadmap

The project aims to remain a focused, explicit, one-shot folder importer rather than a background synchronization service.

## Shipped in 1.1.0

- [x] Recursive folder import
- [x] Preserve hierarchy as nested collections
- [x] Right-click **Import Folder Here…**
- [x] **File → Import Folder…**
- [x] Multi-folder drag and drop with nested-root protection
- [x] Zotero 10 selected-collection handling
- [x] Missing/inaccessible entry resilience
- [x] Basic duplicate handling (filename + size)
- [x] Progress panel with Stop and hide controls
- [x] Cooperative cancellation between files
- [x] Import report with failed paths and reasons
- [x] Trustworthy totals - every file accounted for, every skip reported
- [x] Directory junction/symlink loop protection
- [x] Automated test suite against real directories with injected filesystem faults

## Next

- [ ] Directly detect the collection row used as a drag/drop target
- [ ] SHA-256 content-hash duplicate detection
- [ ] Duplicate policy: skip / import / ask
- [ ] Stored vs linked attachment mode
- [ ] Proper Zotero preferences pane (file types, hierarchy, duplicate policy)
- [ ] Skip-empty-folders option
- [ ] Copyable import report, and an option to write it to a file
- [ ] Unicode and Windows long-path (>260 char) test coverage
- [ ] Large import stress tests (5k+ files)
- [ ] Modular TypeScript refactor using maintained Zotero plugin tooling

## Platform and compatibility

- [ ] Windows test matrix
- [ ] macOS test matrix
- [ ] Linux test matrix
- [ ] Zotero 8/9/10 compatibility matrix or a narrower documented support range
- [ ] Forum announcement and public support process

## Explicit non-goals

- Continuous background folder watching
- Two-way filesystem synchronization
- Automatic deletion of source files
- Telemetry or analytics
- Plugin-operated cloud storage
