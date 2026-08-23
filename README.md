# Zotero Folder Drop Importer

Import local folder hierarchies into Zotero collections by File menu, drag and drop, or collection right-click.

> **Status:** `1.1.0-alpha.3` — test with copies of your files before using it on a large library.

## What it does

A folder tree such as:

```text
Research/
├── Transformers/
│   ├── paper-a.pdf
│   └── paper-b.pdf
└── RNN/
    └── paper-c.pdf
```

becomes:

```text
Target Zotero Collection
└── Research
    ├── Transformers
    │   ├── paper-a
    │   └── paper-b
    └── RNN
        └── paper-c
```

## Current interaction

### File menu

Select exactly one Zotero collection, then use:

**File → Import Folder…**

The File-menu command intentionally has no custom icon.

### Collection/subcollection context menu

Right-click a Zotero collection or subcollection and choose:

**Import Folder Here…**

This is the only in-app command that uses the import-folder SVG icon.

### Drag and drop

Select exactly one Zotero collection, then drag one or more folders from the operating-system file manager onto Zotero.

The alpha normalizes the top-level drop list, removes duplicate/nested roots, and prevents the same drop event from starting two imports.

## Opinionated defaults

There is intentionally **no Settings dialog** in this alpha. The plugin does one job with safe defaults:

- Import PDFs only
- Preserve the dropped root folder as a Zotero collection
- Preserve nested folders as nested collections
- Skip hidden files/folders
- Skip inaccessible or vanished filesystem entries and continue
- Reuse an existing same-named child collection instead of creating another one
- Skip duplicate attachments using filename + file size
- Copy files into Zotero managed storage
- Never move or delete source files
- No background watcher
- No telemetry or analytics
- No automatic metadata retrieval initiated by this plugin

## Multi-folder protection

`1.1.0-alpha.3` adds several safeguards for multi-folder drops:

- Prefer the privileged Gecko top-level drag objects when available
- Canonicalize paths before processing
- Remove nested roots when a parent root is already present
- Deduplicate PDF jobs by full source path
- Use a one-drop/one-import lock
- Cache collections created/reused during the import

These safeguards are intended to prevent a drop of five folders from producing ten duplicate collection trees.

## Installation

1. Download the `.xpi` release.
2. Open Zotero → **Tools → Plugins**.
3. Choose **Install Add-on From File…** and select the XPI.
4. Restart Zotero if requested.

## Privacy and safety

Folder Drop Importer performs explicit local imports only. It does not run a folder watcher, upload files to a service, send telemetry, or delete/move source files.

Zotero plugins have broad access to Zotero and the local computer, so install releases only from a repository/developer you trust.

## Known alpha limitations

- Drag-and-drop still uses the currently selected collection; dropping directly onto a specific collection row is planned.
- Duplicate detection is filename + size, not content-hash based yet.
- Progress is a lightweight Zotero status overlay rather than a cancellable progress window.
- The current code remains JavaScript while behavior stabilizes; a modular TypeScript refactor is planned before a stable release.

## Development

Build locally:

```bash
python scripts/build.py
```

Syntax check:

```bash
node --check src/folder-drop-importer.js
node --check addon/bootstrap.js
```

## License

MIT. See [LICENSE](LICENSE).


### Stop an import

While an import is running, the progress panel shows **Stop** and **×** controls. **Stop** safely stops before the next file (the file currently being copied is allowed to finish). **×** hides the progress panel while the import continues. Partial results are kept when an import is stopped.
