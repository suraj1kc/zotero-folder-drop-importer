# Architecture

## Current shape

Intentionally a small Zotero bootstrap plugin with no build step for the runtime
code. The importer is exercised against real Zotero 10 behavior, so the project
stabilizes semantics and test coverage before moving the same modules behind
typed interfaces.

Main pieces:

- `addon/bootstrap.js` - plugin lifecycle and locale registration
- `src/folder-drop-importer.js` - UI registration, filesystem scan, collection creation, duplicate check, and attachment import
- `addon/locale/` - Fluent menu labels
- `addon/content/icons/` - theme-compatible SVG menu icons
- `scripts/build.py` - dependency-free XPI packaging
- `test/harness.js` - stubbed Zotero/Gecko environment with injectable filesystem faults
- `test/import.test.js` - import engine scenarios, run by `npm test`

## Import pipeline

```text
roots (drop or picker)
  -> filterTopLevelRoots     drop descendants of an already-present root
  -> collectAll              iterative walk, visited-path guard, depth cap
       -> readDirectorySnapshot   synchronous drain + close, retry-and-merge
       -> getOrCreateChildCollection   only AFTER the snapshot
       -> addJob                  dedupe by canonical path
  -> importJob per file      duplicate check, importFromFile, verify item
  -> retry pass              one retry for each failed job
  -> buildSummary            every bucket surfaced to the user
```

### Two invariants worth preserving

**Never hold an `nsIDirectoryEnumerator` open across an `await`.** The enumerator
wraps an open OS directory handle. The pre-1.1.0 scanner recursed - and created
collections, which hits the database - while iterating, and when enumeration
failed mid-folder the loop simply broke. Every remaining file in that folder was
discarded to the debug log, and because `found` was computed from the scan, the
summary reported the shortened total as a success. `readDirectoryOnce` opens,
drains and closes the enumerator in one synchronous pass for this reason.

**Every file lands in exactly one counted bucket.** Imported, duplicate, failed,
ignored-type, unreadable, hidden, loop-guarded, or depth-limited. A skip that is
only written to the debug log is indistinguishable from a file that was never
there. `buildSummary` also reports an `Unaccounted` figure if the buckets ever
fail to add up, so an accounting bug becomes visible instead of silent.

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
