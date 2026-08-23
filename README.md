# 📂 Zotero Folder Drop Importer

[![Latest Release](https://img.shields.io/github/v/release/suraj1kc/zotero-folder-drop-importer?include_prereleases&label=Release)](https://github.com/suraj1kc/zotero-folder-drop-importer/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/suraj1kc/zotero-folder-drop-importer/total?label=Downloads)](https://github.com/suraj1kc/zotero-folder-drop-importer/releases)
[![Zotero](https://img.shields.io/badge/Zotero-8%20-%2010-red?logo=zotero)](https://www.zotero.org/)
[![License](https://img.shields.io/github/license/suraj1kc/zotero-folder-drop-importer)](LICENSE)

Import entire folder hierarchies into Zotero collections - preserving your directory structure as nested collections and importing PDFs in one step.

> **Status:** `1.1.0-alpha.3` - test with copies of your files before using on a large library.
>
> 📖 **Blog Post:** [Building Zotero Folder Drop Importer](https://surajkatwal.com.np/blog/building-zotero-folder-drop-importer/) - Read about the motivation, design decisions, and how it was built.

---

## 📥 Download & Install

### Step 1 - Download the plugin file

> **[⬇️ Click here to download Zotero-Folder-Drop-Importer-1.1.0-alpha.3.xpi](https://github.com/suraj1kc/zotero-folder-drop-importer/releases/download/v1.1.0-alpha.3/Zotero-Folder-Drop-Importer-1.1.0-alpha.3.xpi)**

This downloads a small `.xpi` file (≈10 KB). Save it somewhere you can find it (e.g. your Downloads folder).

> **⚠️ Important - Firefox users:** Firefox will try to install the `.xpi` as a browser extension. **Right-click** the link above and choose **"Save Link As…"** instead.
>
> **Chrome / Edge users:** Your browser may warn that `.xpi` files "can harm your computer." Click **"Keep"** - it's a standard Zotero plugin file, not an executable.

### Step 2 - Install in Zotero

1. Open **Zotero** on your computer.
2. Go to **Tools → Plugins** (called "Add-ons" in some Zotero versions).
3. Click the **gear icon ⚙️** in the top-right corner.
4. Choose **Install Add-on From File…**
5. Navigate to the `.xpi` file you just downloaded and select it.
6. Restart Zotero if prompted.

**That's it!** The plugin is now installed. No configuration needed.

---

## ✨ What It Does

A folder tree like this:

```text
Research/
├── Transformers/
│   ├── paper-a.pdf
│   └── paper-b.pdf
└── RNN/
    └── paper-c.pdf
```

becomes this in Zotero:

```text
My Library
└── Research
    ├── Transformers
    │   ├── paper-a
    │   └── paper-b
    └── RNN
        └── paper-c
```

Your folder structure is preserved as nested Zotero collections, and every PDF is imported as an attachment item.

---

## 🚀 How to Use

### File Menu

Select a Zotero collection, then use:

**File → Import Folder…**

### Right-Click Context Menu

Right-click any collection or subcollection and choose:

**Import Folder Here…**

### Drag and Drop

Select a Zotero collection, then drag one or more folders from your file manager onto Zotero. The plugin handles deduplication, nested roots, and prevents double-imports automatically.

### Stop an Import

While an import is running, the progress panel shows **Stop** and **×** controls. **Stop** safely halts before the next file. **×** hides the panel while the import continues. Partial results are kept when stopped.

---

## ⚙️ Opinionated Defaults

There is intentionally **no Settings dialog** in this alpha. The plugin does one job with safe defaults:

| Setting | Default |
| :--- | :--- |
| File types | PDFs only |
| Hierarchy | Preserve folder structure as nested collections |
| Hidden files | Skipped |
| Inaccessible entries | Skipped (import continues) |
| Duplicate detection | Filename + file size |
| Existing collections | Reuse same-named child collections |
| Source files | Never moved or deleted (copy only) |
| Background watcher | None |
| Telemetry | None |
| Auto-metadata retrieval | None (use Zotero's built-in retrieval after import) |

---

## 🛡️ Multi-Folder Drop Protection

`1.1.0-alpha.3` includes safeguards to prevent duplicate collection trees when dropping multiple folders:

- Prefers privileged Gecko top-level drag objects when available
- Canonicalizes paths before processing
- Removes nested roots when a parent root is already present
- Deduplicates PDF jobs by full source path
- One-drop / one-import locking
- Caches collections created/reused during each import

---

## 🔒 Privacy & Safety

Folder Drop Importer is **100% offline** and performs explicit local imports only.

- ✅ No folder watcher
- ✅ No file uploads
- ✅ No telemetry or analytics
- ✅ No network requests
- ✅ Never moves or deletes source files

Zotero plugins have broad access to Zotero and the local computer - install releases only from a repository or developer you trust.

---

## ⚠️ Known Alpha Limitations

- Drag-and-drop uses the currently selected collection; dropping directly onto a specific collection row is planned.
- Duplicate detection uses filename + size, not content-hash (SHA-256 planned for beta).
- JavaScript codebase - a modular TypeScript refactor is planned before stable release.

---

## 🛠️ Development

```bash
# Syntax check
npm run check

# Build .xpi
npm run build
```

Or manually:

```bash
node --check src/folder-drop-importer.js
node --check addon/bootstrap.js
python scripts/build.py
```

---

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

- 🐛 [Report a Bug](https://github.com/suraj1kc/zotero-folder-drop-importer/issues/new?template=bug_report.yml)
- 💡 [Request a Feature](https://github.com/suraj1kc/zotero-folder-drop-importer/issues/new?template=feature_request.yml)

---

## 📄 License

MIT. See [LICENSE](LICENSE).
