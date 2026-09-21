# Test Matrix - 1.2.0

## Automated

```bash
npm run check   # syntax
npm test        # import engine against real directories with injected faults
```

`test/import.test.js` drives `src/folder-drop-importer.js` under a stubbed
Zotero/Gecko environment (`test/harness.js`) and injects the faults that used to
cause silent file loss: enumeration failing mid-folder, permanently unreadable
folders, unreadable entries, directory junction loops, and transient import
errors. Every case asserts that either all files arrive, or the shortfall is
reported in the summary. The later scenarios cover the linked-file mode: that a
linked run writes no copies, that re-linking the same folder is recognised as
duplicates rather than doubled, and that a linked import into a group library is
refused before anything is written.

## Manual

Use copies of files. Keep a backup of your Zotero library before a large import.

## Installation / menus

- [ ] Alpha.1 / older test build is disabled or removed
- [ ] Plugin installs without manifest errors
- [ ] **File → Import Folder…** appears
- [ ] No Folder Drop Importer entry is added under Tools
- [ ] File-menu Import Folder command has no custom icon
- [ ] **File → Import Folder as Linked Files…** appears
- [ ] Right-click a collection → **Import Folder Here…** appears
- [ ] Right-click a collection → **Import Folder Here as Linked Files…** appears
- [ ] Right-click a subcollection → both Import Folder Here entries appear
- [ ] Right-click command shows the folder/import SVG icon in light theme
- [ ] Right-click command shows the icon in dark theme

## Picker import

- [ ] Select one collection → File → Import Folder… opens picker
- [ ] File import uses the collection selected before the picker opened
- [ ] Right-click Import Folder Here… imports into the right-clicked collection
- [ ] One PDF imports
- [ ] Nested folders become nested collections
- [ ] Existing same-named collection is reused, not duplicated
- [ ] Empty folder does not crash
- [ ] Folder names with spaces work
- [ ] Unicode folder/file names work

## Multi-folder drag/drop

- [ ] Drag 2 folders → exactly 2 root collections are created/reused
- [ ] Drag 5 folders → exactly 5 root collections are created/reused, not 10
- [ ] Nested subfolders are not also treated as top-level roots
- [ ] Same drop event does not start two imports
- [ ] Same source PDF is queued only once by full path
- [ ] Repeating the drop later skips duplicate PDFs instead of creating copies

## Default behavior

- [ ] PDF files import
- [ ] EPUB/DJVU/DOC/DOCX/ODT/RTF/MOBI/AZW3 files import
- [ ] TXT/MD/HTML/HTM files import
- [ ] CSV/ZIP/other unsupported files are ignored **and counted in the summary**
- [ ] Root folder is preserved as a collection
- [ ] Nested folders are preserved
- [ ] Hidden entries are skipped
- [ ] Duplicate filename+size attachments are skipped
- [ ] Original source files remain in place

## Linked-file mode

- [ ] File → Import Folder as Linked Files… creates linked attachments
- [ ] Right-click → Import Folder Here as Linked Files… does the same
- [ ] Shift while dropping a folder imports as linked files
- [ ] Alt while dropping a folder imports as linked files
- [ ] Dropping with no modifier still copies into storage
- [ ] Progress panel names the mode while a linked import runs
- [ ] Summary says the originals were not copied
- [ ] Zotero storage does **not** grow after a linked import
- [ ] Opening a linked attachment opens the file from its original folder
- [ ] Re-running the same linked import reports duplicates, not doubles
- [ ] Linked import into a **group library** is refused with an explanation,
      before the folder picker opens and before anything is written
- [ ] Copy-mode import into a group library still works
- [ ] Moving the original folder afterwards breaks the link (expected - Zotero
      behavior, worth confirming the error is Zotero's own)

## Filesystem resilience

- [ ] Missing/broken entry does not abort entire import
- [ ] OneDrive/cloud placeholder does not abort entire import
- [ ] Read-only source file imports
- [ ] Deeply nested folder does not crash

## Import accounting

- [ ] Summary total matches the file count on disk
- [ ] Ignored unsupported files are listed with their extensions
- [ ] Hidden folders are reported as skipped
- [ ] A folder that cannot be read is reported, not silently omitted
- [ ] Summary shows the "Show Items from Subcollections" tip when subcollections were created
- [ ] "Unaccounted" never appears on a healthy import

## Filesystem resilience (extra)

- [ ] Directory junction pointing at an ancestor does not hang or crash
- [ ] Import completes on a OneDrive folder with online-only files, and reports them

## Large import

- [ ] 100 files
- [ ] 500 files
- [ ] 5000 files - progress panel stays responsive
- [ ] Import summary counts are correct
