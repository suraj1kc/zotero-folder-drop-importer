# Contributing

Contributions are welcome.

## Principles

- Keep imports user-initiated; no background watcher by default.
- Never delete or move source files without a separate, explicit design review.
- No telemetry or analytics.
- A single bad filesystem entry must not abort an otherwise valid import.
- A file that is skipped must be counted and reported. Silently dropping a file
  is worse than failing loudly - a summary the user cannot trust is the bug.
- Never hold an `nsIDirectoryEnumerator` open across an `await`. Snapshot the
  directory synchronously first. See `readDirectoryOnce`.
- Prefer official Zotero APIs over DOM injection or legacy Mozilla APIs when available.
- Keep error messages actionable.

## Development workflow

1. Fork and clone the repository.
2. Create a feature branch.
3. Run `npm run check` (syntax).
4. Run `npm test` (import engine against real directories with injected filesystem faults).
5. Run `npm run build`.
6. Install the generated XPI into a test Zotero profile.
7. Test right-click, **File → Import Folder…**, and drag-and-drop imports.
8. Include reproduction steps and test results in the pull request.

## Pull requests

Keep pull requests focused. For filesystem behavior changes, add a case to
`test/import.test.js` - the harness in `test/harness.js` can inject enumeration
failures, unreadable entries, junction loops and transient import errors against
a real temporary directory, so most scan bugs can be covered without a running
Zotero.
