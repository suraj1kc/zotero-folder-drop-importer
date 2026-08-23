# Changelog

All notable changes to this project will be documented here.

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
