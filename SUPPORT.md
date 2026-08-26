# Support

## Before opening an issue

1. Confirm the problem still occurs with the latest release.
2. Test with a small folder containing copies of 2-3 PDFs.
3. Enable **Help → Debug Output Logging → View Output**, run the import again, and capture the lines containing `Zotero Folder Drop Importer`. Every skipped file and unreadable folder is logged there with its path. The Error Console (**Tools → Developer → Error Console**) is useful for outright crashes.
4. If the problem is folder-specific, check whether the folder is local, OneDrive, Dropbox, a network drive, a junction/symlink, or contains cloud-only placeholders.

## Include this information

- Zotero version
- Folder Drop Importer version
- Operating system and version
- Source folder type: local / OneDrive / Dropbox / network / other
- Import method: right-click / File menu / drag-and-drop
- The full import summary text shown by the plugin
- Expected result
- Actual result
- Minimal folder tree that reproduces the issue
- Debug output lines containing `Zotero Folder Drop Importer`

Do not upload copyrighted papers or private documents just to demonstrate a bug. A synthetic folder tree and empty/sample files are usually enough.

## Files look missing after an import

Check this first. Files inside subfolders are imported into *subcollections*, and
Zotero's item list does not show subcollection items when the parent collection
is selected. Select **My Library**, or turn on **View → Show Items from
Subcollections**, and count again.

If the total is still short, the import summary will say why - it reports ignored
file types, unreadable entries, folders it could not read completely, and hidden
folders. If it reports none of those and the count is still wrong, that is a bug
worth reporting with the debug output.
