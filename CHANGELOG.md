# Changelog

All notable changes to this project will be documented here.

## [1.1.1] - 2026-08-26

Production hardening of the 1.1.0 import engine. No behavior change for a
successful import; both fixes matter on large libraries and unusual Zotero builds.

### Fixed
- **Duplicate detection was quadratic.** `isDuplicate` called
  `collection.getChildItems()` once per file, rebuilding the collection's item
  array for every single import. Attachment filenames are now indexed once per
  collection per import and kept current as items are added: a 2000-file import
  went from 2000 `getChildItems()` calls to 20 (one per collection).
- **Enumerator accessor was re-probed per entry.** On a Gecko build without
  `nsIDirectoryEnumerator.getNext()`, the scanner threw and fell back to
  `nextFile` for every entry of every directory. The working accessor is now
  learned once per session.

### Added
- Test coverage for re-import duplicate handling, the duplicate-index call
  budget, `nextFile`-only enumeration, and the invariant that every opened
  enumerator is closed. The suite now runs 11 scenarios.
- Dependabot for GitHub Actions.

## [1.1.0] - 2026-08-26

First stable release. The headline change is that imports no longer lose files
silently: previously a folder scan could abandon the remainder of a directory
and still report "complete" with a total that looked correct.

### Fixed
- **Silently dropped files.** The directory scanner held a Gecko
  `nsIDirectoryEnumerator` open across `await` boundaries (including the
  database transaction that creates a collection). When enumeration failed
  mid-folder, the loop broke and every remaining file in that folder was
  discarded - the summary then honestly reported the shortened total, so a
  40-file folder could import 34 and still say "complete". Each directory is
  now read into an array in one synchronous pass, the enumerator is closed
  immediately, and a partial read is retried once and merged by path.
- **Unverified import counts.** `imported` was incremented whenever the import
  call resolved. It now requires a real Zotero item, and if the item did not
  land in the requested collection it is re-filed there.
- **Invisible skips.** Unreadable entries (cloud placeholder files, permission
  errors), unopenable folders, hidden folders and unsupported file types were
  only written to the debug log. All of them are now counted and shown in the
  final summary.
- **Directory junction loops.** The scanner recursed with no visited-path
  guard, so a junction or symlink pointing at an ancestor recursed until the
  stack overflowed and took the whole import with it. The walk is now iterative
  with a visited-path guard and a 64-level depth limit.
- **Over-eager duplicate skip.** When an existing attachment's file could not
  be resolved (a linked file, or a synced file not yet downloaded), the
  filename match alone was treated as a duplicate and the new file was skipped.
  Filename+size mode now imports when it cannot confirm the match.
- **Merged sibling collections.** Collection names were matched
  case-insensitively, so sibling folders differing only in case collapsed into
  one collection. Exact-case matches are now preferred.

### Added
- Failed imports are retried once before being reported as failures.
- E-book and document formats alongside PDF: `epub`, `djvu`, `mobi`, `azw3`,
  `doc`, `docx`, `odt`, `rtf`.
- The summary names the most common cause of "my files are missing": items in
  subfolders go to subcollections, which Zotero's item list hides until
  **View → Show Items from Subcollections** is enabled.
- A machine-readable report line and a per-path problem list in the debug log.
- Progress updates are throttled, so large imports are no longer slowed by UI
  repainting on every file.

## 1.1.0-alpha.3

- Fixed File/context menu commands disappearing after Zotero is closed and reopened by registering window UI from the main-window lifecycle hook.
- Added a visible **Stop** button while scanning/importing. Cancellation is cooperative and takes effect safely between files.
- Added a **×** close control to hide progress without cancelling the import.
- Final status distinguishes completed and stopped imports and keeps partial imported results.

## [1.1.0-alpha.2] - 2026-08-23

### Changed
- Moved the interactive import command from Tools to **File → Import Folder…**.
- Removed icons from the File menu.
- Removed the Settings command and all yes/no configuration prompts.
- Uses fixed safe defaults: PDF-only, preserve hierarchy, skip hidden/inaccessible entries, skip filename+size duplicates.
- The collection/subcollection right-click command remains **Import Folder Here…** and is the only in-app command with a custom icon.
- Registered the context-menu SVG through a `chrome://` content resource so Zotero can resolve it reliably.

### Fixed
- Hardened multi-folder drag/drop to avoid duplicate top-level roots and nested-root reprocessing.
- Added a one-drop/one-import lock so one OS drop cannot start the importer twice.
- Deduplicates queued PDFs by canonical source path.
- Reuses existing same-named child collections and caches collection resolution during each import.

## [1.1.0-alpha.1] - 2026-08-23

### Added
- Single **Folder Drop Importer** submenu under Zotero Tools.
- Icons for Tools submenu, import actions, settings, and collection context action.
- GitHub-ready project documentation, issue templates, build workflow, and release workflow.

### Changed
- Collection context command is now simply **Import Folder Here…**.
- Tools import captures the selected collection before opening the folder picker.
- Minimum supported Zotero version for this alpha is Zotero 8 because the official `Zotero.MenuManager` API is used for menus.

### Retained from 1.0.4 prototype
- Zotero 10 collection selection compatibility.
- Current Zotero `FilePicker` wrapper.
- Recursive hierarchy import.
- Resilient handling of missing/inaccessible filesystem entries.
- Duplicate detection by name or name + size.
