# Architecture

## Current alpha

The current alpha is intentionally a small Zotero bootstrap plugin. The importer has already been exercised against real Zotero 10 behavior, so the first open-source milestone keeps that runtime implementation while cleaning its public API, menus, packaging, documentation, and error handling.

Main pieces:

- `addon/bootstrap.js` - plugin lifecycle and locale registration
- `src/folder-drop-importer.js` - UI registration, filesystem scan, collection creation, duplicate check, and attachment import
- `addon/locale/` - Fluent menu labels
- `addon/icons/` - theme-compatible SVG menu icons
- `scripts/build.py` - dependency-free XPI packaging

## Why not refactor everything at once?

A full TypeScript/scaffold migration at the same time as changing import semantics makes regressions harder to isolate. The project first stabilizes behavior and test cases, then moves the same modules behind typed interfaces.

## Planned modular TypeScript shape

```text
src/
├── index.ts
├── hooks.ts
├── ui/
│   ├── menus.ts
│   ├── progress.ts
│   └── preferences.ts
├── importer/
│   ├── importer.ts
│   ├── collections.ts
│   └── duplicates.ts
├── filesystem/
│   ├── scanner.ts
│   └── paths.ts
└── types/
    └── import.ts
```

The planned build tooling is the maintained Zotero plugin scaffold, but runtime behavior should remain independently testable.
