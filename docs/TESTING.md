# Manual Test Matrix - 1.1.0-alpha.2

Use copies of files. Do not use important originals while testing alpha builds.

## Installation / menus

- [ ] Alpha.1 / older test build is disabled or removed
- [ ] Plugin installs without manifest errors
- [ ] **File → Import Folder…** appears
- [ ] No Folder Drop Importer entry is added under Tools
- [ ] File-menu Import Folder command has no custom icon
- [ ] Right-click a collection → **Import Folder Here…** appears
- [ ] Right-click a subcollection → **Import Folder Here…** appears
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
- [ ] TXT/DOCX/other files are ignored
- [ ] Root folder is preserved as a collection
- [ ] Nested folders are preserved
- [ ] Hidden entries are skipped
- [ ] Duplicate filename+size attachments are skipped
- [ ] Original source files remain in place

## Filesystem resilience

- [ ] Missing/broken entry does not abort entire import
- [ ] OneDrive/cloud placeholder does not abort entire import
- [ ] Read-only source file imports
- [ ] Deeply nested folder does not crash

## Large import

- [ ] 100 PDFs
- [ ] 500 PDFs
- [ ] Import summary counts are correct
