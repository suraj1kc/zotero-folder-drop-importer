# Contributing

Contributions are welcome.

## Principles

- Keep imports user-initiated; no background watcher by default.
- Never delete or move source files without a separate, explicit design review.
- No telemetry or analytics.
- A single bad filesystem entry must not abort an otherwise valid import.
- Prefer official Zotero APIs over DOM injection or legacy Mozilla APIs when available.
- Keep error messages actionable.

## Development workflow

1. Fork and clone the repository.
2. Create a feature branch.
3. Run `node --check src/folder-drop-importer.js`.
4. Run `python scripts/build.py`.
5. Install the generated XPI into a test Zotero profile.
6. Test both right-click and Tools-menu imports.
7. Include reproduction steps and test results in the pull request.

## Pull requests

Keep pull requests focused. For filesystem behavior changes, include tests or at minimum a reproducible folder-tree example covering the new case.
