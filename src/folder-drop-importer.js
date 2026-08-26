/*
 * Zotero Folder Drop Importer
 * Lightweight, explicit folder-hierarchy importer for Zotero 8-10.
 *
 * 1.1.1:
 * - Indexes existing attachment filenames once per collection instead of
 *   calling getChildItems() for every file (duplicate detection was quadratic).
 * - Learns which nsIDirectoryEnumerator accessor works once per session instead
 *   of re-probing getNext() on every directory entry.
 *
 * 1.1.0:
 * - Fixes silently dropped files: directory enumeration no longer holds an
 *   nsIDirectoryEnumerator open across `await`, and a partial read is retried
 *   and merged instead of abandoning the rest of the folder.
 * - Counts only verified Zotero items as imported, and re-files an item if it
 *   did not land in the requested collection.
 * - Reports every skipped file: unsupported type, hidden folder, unreadable
 *   entry, partial folder read, link loop, depth limit.
 * - Retries failed imports once before giving up.
 * - Walks the tree iteratively with a visited-path guard, so a directory
 *   junction pointing at an ancestor can no longer recurse until the stack
 *   overflows.
 * - Stops treating an unresolvable existing attachment as a duplicate match.
 * - Prefers exact-case collection names so sibling folders differing only in
 *   case are no longer merged.
 * - Imports common e-book and document formats alongside PDF.
 * - Tells the user about View -> Show Items from Subcollections, the usual
 *   reason imported files look missing.
 *
 * 1.1.0-alpha.3:
 * - Moves the picker command to File -> Import Folder… (no File-menu icon).
 * - Removes Settings and uses safe opinionated defaults.
 * - Keeps one icon only on the collection/subcollection right-click action.
 * - Uses a chrome:// resource URI for the context-menu icon.
 * - Hardens multi-folder drag/drop against duplicate and nested roots.
 * - Adds one-drop/one-import locking and per-import path/collection caches.
 * - Reuses existing same-named Zotero collections instead of creating twins.
 * - Re-registers all window UI from onMainWindowLoad so commands survive Zotero restarts.
 * - Adds visible Stop and Close controls to import progress.
 */

const Cc = Components.classes;
const Ci = Components.interfaces;

ZoteroFolderDropImporter = {
  id: null,
  version: null,
  rootURI: null,
  windows: new Set(),
  importing: false,
  handlingDrop: false,
  lastDropSignature: '',
  lastDropAt: 0,
  statusTimers: new WeakMap(),
  contextMenuID: null,
  fileMenuID: null,
  collectionCache: new Map(),
  jobPathSet: new Set(),
  duplicateIndex: new Map(),
  enumeratorAccessor: null,
  cancelRequested: false,
  manuallyHiddenStatus: new WeakSet(),

  // Deliberately opinionated defaults. Anything not in `extensions` is counted
  // and reported as ignored rather than passed over in silence.
  defaults: Object.freeze({
    extensions: [
      'pdf',
      'epub', 'djvu', 'mobi', 'azw3',
      'doc', 'docx', 'odt', 'rtf'
    ],
    createRootCollection: true,
    skipHidden: true,
    duplicateMode: 'name-size'
  }),

  init({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    // Window UI (menus, drag/drop listeners, progress panel) is registered
    // from addToWindow/onMainWindowLoad. Zotero explicitly recommends doing
    // window-related work there so it is recreated after application/window
    // restarts.
  },

  log(message) {
    Zotero.debug(`[Zotero Folder Drop Importer] ${message}`);
  },

  showStatus(win, message, timeout = 5000, options = {}) {
    try {
      win = win || Zotero.getMainWindow?.();
      if (!win?.document) {
        this.log(message);
        return;
      }

      const el = win.document.getElementById('zfdi-status');
      const text = win.document.getElementById('zfdi-status-text');
      const stop = win.document.getElementById('zfdi-stop');
      const close = win.document.getElementById('zfdi-close');
      if (!el || !text) {
        this.log(message);
        return;
      }

      const oldTimer = this.statusTimers.get(win);
      if (oldTimer) {
        try { win.clearTimeout(oldTimer); } catch (_) {}
        this.statusTimers.delete(win);
      }

      text.textContent = String(message);
      if (stop) {
        stop.style.display = options.cancellable ? 'inline-flex' : 'none';
        stop.disabled = !!this.cancelRequested;
        stop.textContent = this.cancelRequested ? 'Stopping…' : 'Stop';
      }
      if (close) close.style.display = 'inline-flex';

      // A user may hide the progress panel while an import continues. Do not
      // immediately reopen it on every file update. Completion/error messages
      // may set forceShow=true so the final state is still visible.
      if (options.forceShow) this.manuallyHiddenStatus.delete(win);
      if (!this.manuallyHiddenStatus.has(win)) el.style.display = 'flex';

      if (timeout > 0) {
        const timer = win.setTimeout(() => {
          try { el.style.display = 'none'; } catch (_) {}
          this.statusTimers.delete(win);
        }, timeout);
        this.statusTimers.set(win, timer);
      }
    } catch (e) {
      Zotero.logError(e);
    }
  },

  requestCancel(win) {
    if (!this.importing) return;
    this.cancelRequested = true;
    this.manuallyHiddenStatus.delete(win);
    this.showStatus(
      win,
      'Folder Drop Importer\nStopping safely after the current file…',
      0,
      { cancellable: true, forceShow: true }
    );
  },

  hideStatus(win) {
    try {
      const el = win?.document?.getElementById('zfdi-status');
      if (el) el.style.display = 'none';
      this.manuallyHiddenStatus.add(win);
    } catch (e) {
      Zotero.logError(e);
    }
  },

  async runCommand(win, fn) {
    try {
      await fn();
    } catch (e) {
      Zotero.logError(e);
      this.log(e?.stack || e);
      this.showStatus(win, `Folder Drop Importer error\n${e?.message || e}`, 8000);
    }
  },

  addToAllWindows() {
    for (const win of Zotero.getMainWindows()) {
      if (win.ZoteroPane) this.addToWindow(win);
    }
  },

  addToWindow(win) {
    // Menus are main-window UI. Register/re-register them here rather than
    // relying on startup timing. This also fixes commands disappearing after
    // closing and reopening Zotero.
    this.registerMenus();

    if (this.windows.has(win)) return;
    this.windows.add(win);

    const doc = win.document;
    const root = doc.documentElement;

    try {
      win.MozXULElement?.insertFTLIfNeeded?.('zotero-folder-drop-importer.ftl');
    } catch (e) {
      this.log(`Could not register localization in window: ${e}`);
    }

    const style = doc.createElement('style');
    style.id = 'zfdi-style';
    style.textContent = `
      #zfdi-status {
        position: fixed; right: 18px; bottom: 18px; z-index: 999999;
        width: min(520px, calc(100vw - 36px)); min-width: 300px;
        gap: 10px; align-items: flex-start; padding: 10px 10px 10px 14px;
        border-radius: 8px; background: rgba(32,32,32,.96); color: white;
        font: 13px sans-serif; box-shadow: 0 4px 18px rgba(0,0,0,.35);
        display: none; box-sizing: border-box;
      }
      #zfdi-status-text {
        flex: 1; min-width: 0; white-space: pre-line; overflow-wrap: anywhere;
        line-height: 1.35; padding-top: 3px;
      }
      #zfdi-status-actions {
        display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
      }
      #zfdi-stop, #zfdi-close {
        border: 0; border-radius: 5px; color: white; cursor: pointer;
        font: 12px sans-serif; min-height: 26px; align-items: center;
        justify-content: center;
      }
      #zfdi-stop {
        padding: 4px 10px; background: rgba(190,55,55,.95); display: none;
      }
      #zfdi-stop:hover:not(:disabled) { background: rgba(220,65,65,.98); }
      #zfdi-stop:disabled { opacity: .65; cursor: default; }
      #zfdi-close {
        width: 28px; padding: 0; background: transparent; font-size: 18px;
        line-height: 1; display: inline-flex;
      }
      #zfdi-close:hover { background: rgba(255,255,255,.14); }
      #zfdi-highlight {
        position: fixed; pointer-events: none; inset: 0; z-index: 999998;
        border: 3px solid #4a90e2; box-sizing: border-box; display: none;
      }
    `;
    root.appendChild(style);

    const status = doc.createElement('div');
    status.id = 'zfdi-status';

    const statusText = doc.createElement('div');
    statusText.id = 'zfdi-status-text';
    status.appendChild(statusText);

    const statusActions = doc.createElement('div');
    statusActions.id = 'zfdi-status-actions';

    const stopButton = doc.createElement('button');
    stopButton.id = 'zfdi-stop';
    stopButton.type = 'button';
    stopButton.textContent = 'Stop';
    stopButton.title = 'Stop importing after the current file';
    stopButton.addEventListener('click', () => this.requestCancel(win));
    statusActions.appendChild(stopButton);

    const closeButton = doc.createElement('button');
    closeButton.id = 'zfdi-close';
    closeButton.type = 'button';
    closeButton.textContent = '×';
    closeButton.title = 'Hide progress (import continues)';
    closeButton.setAttribute('aria-label', 'Close progress');
    closeButton.addEventListener('click', () => this.hideStatus(win));
    statusActions.appendChild(closeButton);

    status.appendChild(statusActions);
    root.appendChild(status);

    const highlight = doc.createElement('div');
    highlight.id = 'zfdi-highlight';
    root.appendChild(highlight);

    win.addEventListener('dragover', this.onDragOver, true);
    win.addEventListener('drop', this.onDrop, true);
    win.addEventListener('dragleave', this.onDragLeave, true);
    win.addEventListener('dragend', this.onDragEnd, true);
  },

  registerMenus() {
    this.registerFileMenu();
    this.registerCollectionContextMenu();
  },

  registerFileMenu() {
    if (this.fileMenuID || !Zotero.MenuManager?.registerMenu) return;

    try {
      this.fileMenuID = Zotero.MenuManager.registerMenu({
        menuID: 'zfdi-file-menu',
        pluginID: this.id || 'zotero-folder-drop-importer@open-source',
        target: 'main/menubar/file',
        menus: [
          {
            menuType: 'menuitem',
            l10nID: 'zfdi-import-folder',
            // Intentionally no icon in the File menu.
            onCommand: (event) => {
              const win = event?.target?.ownerGlobal
                || event?.currentTarget?.ownerGlobal
                || Zotero.getMainWindow?.();
              this.runCommand(win, () => this.pickAndImportFolder(win));
            }
          }
        ]
      });
    } catch (e) {
      Zotero.logError(e);
      this.log(`Could not register File menu: ${e}`);
      this.fileMenuID = null;
    }
  },

  unregisterFileMenu() {
    if (!this.fileMenuID || !Zotero.MenuManager?.unregisterMenu) return;
    try { Zotero.MenuManager.unregisterMenu(this.fileMenuID); } catch (e) { Zotero.logError(e); }
    this.fileMenuID = null;
  },

  getCollectionsFromMenuContext(context) {
    const out = [];
    const seen = new Set();

    const add = (collection) => {
      if (!collection || typeof collection.id !== 'number') return;
      if (seen.has(collection.id)) return;
      seen.add(collection.id);
      out.push(collection);
    };

    // Zotero 10: use collectionTreeRows. Reading collectionTreeRow can throw.
    try {
      for (const row of context?.collectionTreeRows || []) {
        try {
          if (row?.isCollection?.() && row.ref) add(row.ref);
        } catch (_) {}
      }
    } catch (_) {}

    // Some menu contexts expose the collection objects directly.
    try {
      for (const collection of context?.collections || []) add(collection);
    } catch (_) {}

    return out;
  },

  registerCollectionContextMenu() {
    if (this.contextMenuID || !Zotero.MenuManager?.registerMenu) return;

    try {
      this.contextMenuID = Zotero.MenuManager.registerMenu({
        menuID: 'zfdi-collection-context-menu',
        pluginID: this.id || 'zotero-folder-drop-importer@open-source',
        target: 'main/library/collection',
        menus: [
          {
            menuType: 'menuitem',
            l10nID: 'zfdi-import-folder-here',
            // chrome:// mirrors the pattern used by mature Zotero plugins and
            // avoids relying on an extension root URI in a menu image attribute.
            icon: 'chrome://zotero-folder-drop-importer/content/icons/import-folder.svg',
            onShowing: (_event, context) => {
              const collections = this.getCollectionsFromMenuContext(context);
              context.setVisible(collections.length === 1);
            },
            onCommand: (event, context) => {
              const collections = this.getCollectionsFromMenuContext(context);
              const win = event?.target?.ownerGlobal
                || event?.currentTarget?.ownerGlobal
                || Zotero.getMainWindow?.();

              if (collections.length !== 1) {
                this.showStatus(win, 'Right-click exactly one Zotero collection.');
                return;
              }

              this.runCommand(win, () => this.pickAndImportFolder(win, collections[0]));
            }
          }
        ]
      });
    } catch (e) {
      Zotero.logError(e);
      this.log(`Could not register collection context menu: ${e}`);
      this.contextMenuID = null;
    }
  },

  unregisterCollectionContextMenu() {
    if (!this.contextMenuID || !Zotero.MenuManager?.unregisterMenu) return;
    try { Zotero.MenuManager.unregisterMenu(this.contextMenuID); } catch (e) { Zotero.logError(e); }
    this.contextMenuID = null;
  },

  removeFromWindow(win) {
    if (!this.windows.has(win)) return;
    win.removeEventListener('dragover', this.onDragOver, true);
    win.removeEventListener('drop', this.onDrop, true);
    win.removeEventListener('dragleave', this.onDragLeave, true);
    win.removeEventListener('dragend', this.onDragEnd, true);
    this.windows.delete(win);
    this.manuallyHiddenStatus.delete(win);

    const timer = this.statusTimers.get(win);
    if (timer) {
      try { win.clearTimeout(timer); } catch (_) {}
      this.statusTimers.delete(win);
    }

    for (const id of ['zfdi-style', 'zfdi-status', 'zfdi-highlight']) {
      win.document.getElementById(id)?.remove();
    }
  },

  removeFromAllWindows() {
    for (const win of [...this.windows]) this.removeFromWindow(win);
    this.unregisterCollectionContextMenu();
    this.unregisterFileMenu();
  },

  isExternalFileDrag(event) {
    const dt = event.dataTransfer;
    if (!dt) return false;

    try {
      const types = Array.from(dt.types || []);
      if (types.includes('Files') || types.includes('application/x-moz-file')) return true;
    } catch (_) {}

    try {
      return Array.from(dt.items || []).some(item => item.kind === 'file');
    } catch (_) {}

    return false;
  },

  onDragOver(event) {
    const self = ZoteroFolderDropImporter;
    if (!self.isExternalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    const win = event.view || event.currentTarget;
    const el = win?.document?.getElementById('zfdi-highlight');
    if (el) el.style.display = 'block';
  },

  onDragLeave(event) {
    const win = event.view || event.currentTarget;
    const el = win?.document?.getElementById('zfdi-highlight');
    if (el) el.style.display = 'none';
  },

  onDragEnd(event) {
    const win = event.view || event.currentTarget;
    const el = win?.document?.getElementById('zfdi-highlight');
    if (el) el.style.display = 'none';
  },

  fileFromPath(path) {
    if (!path) return null;
    try {
      const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
      file.initWithPath(path);
      return file;
    } catch (e) {
      this.log(`Could not create nsIFile for ${path}: ${e}`);
      return null;
    }
  },

  canonicalPath(path) {
    if (!path) return '';
    let value = String(path);
    const isWindows = Services.appinfo?.OS === 'WINNT';
    if (isWindows) {
      value = value.replace(/\//g, '\\').replace(/\\+$/g, '').toLowerCase();
    } else {
      value = value.replace(/\/+$/g, '') || '/';
    }
    return value;
  },

  pathIsInside(childPath, parentPath) {
    const child = this.canonicalPath(childPath);
    const parent = this.canonicalPath(parentPath);
    if (!child || !parent || child === parent) return false;
    const sep = Services.appinfo?.OS === 'WINNT' ? '\\' : '/';
    return child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
  },

  addUniqueRoot(roots, seen, candidate) {
    if (!candidate) return;

    let file = null;
    try {
      if (typeof candidate === 'string') {
        file = this.fileFromPath(candidate);
      } else if (candidate.path) {
        file = this.fileFromPath(candidate.path);
      } else if (candidate.mozFullPath) {
        file = this.fileFromPath(candidate.mozFullPath);
      }
    } catch (_) {}

    if (!file) return;
    try {
      if (!file.exists()) return;
      const key = this.canonicalPath(file.path);
      if (!key || seen.has(key)) return;
      seen.add(key);
      roots.push(file);
    } catch (_) {}
  },

  filterTopLevelRoots(roots) {
    const unique = [];
    const seen = new Set();

    for (const file of roots || []) {
      let path = '';
      try { path = file?.path || ''; } catch (_) {}
      const key = this.canonicalPath(path);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(file);
    }

    // If the OS exposes both a dropped directory and descendants from inside it,
    // keep only the explicit/top-level directory. This is the main guard against
    // a five-folder drop turning into ten parallel collection trees.
    return unique.filter((candidate, index) => {
      let candidatePath = '';
      try { candidatePath = candidate.path; } catch (_) { return false; }
      return !unique.some((other, otherIndex) => {
        if (index === otherIndex) return false;
        let otherPath = '';
        try { otherPath = other.path; } catch (_) { return false; }
        return this.pathIsInside(candidatePath, otherPath);
      });
    });
  },

  getDroppedRoots(event) {
    const roots = [];
    const seen = new Set();
    const dt = event.dataTransfer;
    if (!dt) return roots;

    // In privileged Zotero/Gecko code, mozGetDataAt usually represents the
    // exact top-level objects selected in the OS file manager. Prefer it for
    // folder drops so descendants are not accidentally treated as extra roots.
    if (typeof dt.mozGetDataAt === 'function') {
      try {
        const count = Number(dt.mozItemCount || 0);
        for (let i = 0; i < count; i++) {
          let candidate = null;
          try { candidate = dt.mozGetDataAt('application/x-moz-file', i); } catch (_) {}
          this.addUniqueRoot(roots, seen, candidate);
        }
      } catch (e) {
        this.log(`Privileged drag root reading warning: ${e}`);
      }
    }

    // Modern DOM File fallback.
    if (!roots.length) {
      try {
        for (const domFile of Array.from(dt.files || [])) {
          let path = '';
          try { path = domFile.mozFullPath || ''; } catch (_) {}
          if (path) this.addUniqueRoot(roots, seen, path);
        }
      } catch (e) {
        this.log(`DataTransfer.files warning: ${e}`);
      }
    }

    if (!roots.length) {
      try {
        for (const item of Array.from(dt.items || [])) {
          if (item.kind !== 'file') continue;
          const domFile = item.getAsFile?.();
          let path = '';
          try { path = domFile?.mozFullPath || ''; } catch (_) {}
          if (path) this.addUniqueRoot(roots, seen, path);
        }
      } catch (e) {
        this.log(`DataTransfer.items warning: ${e}`);
      }
    }

    if (!roots.length) {
      try {
        const raw = dt.getData?.('application/x-moz-file');
        if (raw) {
          for (const line of String(raw).split(/\r?\n/).map(x => x.trim()).filter(Boolean)) {
            this.addUniqueRoot(roots, seen, line);
          }
        }
      } catch (e) {
        this.log(`DataTransfer.getData warning: ${e}`);
      }
    }

    return this.filterTopLevelRoots(roots);
  },

  dropSignature(roots) {
    return (roots || [])
      .map(file => {
        try { return this.canonicalPath(file.path); } catch (_) { return ''; }
      })
      .filter(Boolean)
      .sort()
      .join('|');
  },

  async onDrop(event) {
    const self = ZoteroFolderDropImporter;
    if (!self.isExternalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();

    const win = event.view || event.currentTarget || Zotero.getMainWindow?.();
    const highlight = win?.document?.getElementById('zfdi-highlight');
    if (highlight) highlight.style.display = 'none';

    if (self.handlingDrop || self.importing) {
      self.showStatus(win, 'An import is already running. Please wait.');
      return;
    }

    self.handlingDrop = true;
    try {
      const roots = self.getDroppedRoots(event);
      if (!roots.length) {
        self.showStatus(
          win,
          'The dropped folder path could not be read on this Zotero build.\nUse File → Import Folder… instead.',
          8000
        );
        return;
      }

      const signature = self.dropSignature(roots);
      const now = Date.now();
      if (signature && signature === self.lastDropSignature && now - self.lastDropAt < 3000) {
        self.log(`Ignored repeated drop event for: ${signature}`);
        return;
      }
      self.lastDropSignature = signature;
      self.lastDropAt = now;

      const collection = self.getSelectedCollection(win);
      if (!collection) {
        const count = self.getSelectedCollections(win).length;
        self.showStatus(
          win,
          count > 1
            ? 'Select exactly one Zotero collection, then drop the folder onto Zotero.'
            : 'Select a Zotero collection first, then drop the folder onto Zotero.'
        );
        return;
      }

      await self.importRoots(win, roots, collection);
    } catch (e) {
      Zotero.logError(e);
      self.log(e?.stack || e);
      self.showStatus(win, `Folder Drop Importer error\n${e?.message || e}`, 8000);
    } finally {
      self.handlingDrop = false;
    }
  },

  getSelectedCollections(win) {
    try {
      const pane = win?.ZoteroPane || Zotero.getActiveZoteroPane?.();
      if (!pane) return [];

      // Zotero 10 uses plural selection getters.
      if (typeof pane.getSelectedCollections === 'function') {
        const collections = pane.getSelectedCollections();
        return Array.isArray(collections) ? collections.filter(Boolean) : [];
      }

      // Zotero 8-9 compatibility.
      if (typeof pane.getSelectedCollection === 'function') {
        const collection = pane.getSelectedCollection();
        if (collection) return [collection];
      }

      const id = pane.getSelectedCollectionID?.();
      const collection = id ? Zotero.Collections.get(id) : null;
      return collection ? [collection] : [];
    } catch (e) {
      Zotero.logError(e);
      this.log(`Could not read selected collection(s): ${e}`);
      return [];
    }
  },

  getSelectedCollection(win) {
    const collections = this.getSelectedCollections(win);
    return collections.length === 1 ? collections[0] : null;
  },

  async pickAndImportFolder(win, targetCollection = null) {
    // Capture the destination before the native folder picker takes focus.
    const collection = targetCollection || this.getSelectedCollection(win);
    if (!collection) {
      const count = this.getSelectedCollections(win).length;
      this.showStatus(
        win,
        count > 1
          ? 'Select exactly one Zotero collection first.'
          : 'Select a Zotero collection first.'
      );
      return;
    }

    if (this.importing) {
      this.showStatus(win, 'An import is already running. Please wait.');
      return;
    }

    const { FilePicker } = ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
    const picker = new FilePicker();
    picker.init(win, 'Select a folder to import', picker.modeGetFolder);

    const result = await picker.show();
    if (result !== picker.returnOK || !picker.file) return;

    const folder = this.fileFromPath(picker.file);
    if (!folder?.exists() || !folder.isDirectory()) {
      this.showStatus(win, 'The selected folder could not be opened.', 8000);
      return;
    }

    await this.importRoots(win, [folder], collection);
  },

  // Guards against directory junction/symlink loops and pathological trees.
  limits: Object.freeze({
    maxDepth: 64,
    statusThrottleMs: 120
  }),

  newStats() {
    return {
      // Scan-time accounting. Every file the scanner touches lands in exactly
      // one bucket, so "found" can be trusted against the folder on disk.
      files: 0,
      ignored: 0,
      ignoredExtensions: new Map(),
      unreadableEntries: 0,
      unreadableDirs: 0,
      partialDirs: 0,
      hiddenSkipped: 0,
      loopGuards: 0,
      depthLimited: 0,
      collectionsCreated: 0,
      // Which collections files actually landed in, so the summary can warn
      // about subcollection visibility even on a re-import that creates none.
      targetCollectionID: null,
      collectionsUsed: new Set(),
      // Import-time accounting.
      imported: 0,
      skipped: 0,
      failed: 0,
      retried: 0,
      collectionRepairs: 0,
      problemPaths: []
    };
  },

  noteProblem(stats, message) {
    this.log(message);
    if (stats.problemPaths.length < 500) stats.problemPaths.push(message);
  },

  async importRoots(win, roots, parentCollection) {
    this.importing = true;
    this.cancelRequested = false;
    this.manuallyHiddenStatus.delete(win);
    this.collectionCache = new Map();
    this.jobPathSet = new Set();
    this.duplicateIndex = new Map();

    const stats = this.newStats();
    stats.targetCollectionID = parentCollection?.id ?? null;
    let found = 0;

    try {
      const canonicalRoots = this.filterTopLevelRoots(roots);
      const jobs = [];
      this.showStatus(win, 'Folder Drop Importer\nScanning folder…', 0, { cancellable: true, forceShow: true });

      await this.collectAll(canonicalRoots, parentCollection, jobs, stats, win);
      found = jobs.length;

      if (this.cancelRequested) {
        this.showStatus(
          win,
          `Folder Drop Importer stopped\nFound before stop: ${found}\nImported: 0\nPartial collections may remain.`,
          9000,
          { forceShow: true }
        );
        return;
      }

      if (!found) {
        this.showStatus(
          win,
          `Folder Drop Importer complete\nNo importable files found.${this.scanNotes(stats)}`,
          9000,
          { forceShow: true }
        );
        this.logReport(stats, found);
        return;
      }

      const retryQueue = [];
      let lastTick = 0;

      for (let i = 0; i < jobs.length; i++) {
        if (this.cancelRequested) break;

        const job = jobs[i];
        const now = Date.now();
        if (now - lastTick >= this.limits.statusThrottleMs || i === 0 || i === jobs.length - 1) {
          lastTick = now;
          this.showStatus(
            win,
            `Folder Drop Importer\nImporting ${i + 1} of ${jobs.length}\n${job.file.leafName}`,
            0,
            { cancellable: true }
          );
        }

        const outcome = await this.importJob(job, stats);
        if (outcome === 'retry') retryQueue.push(job);
      }

      // A single transient failure (a locked file, a cloud file still
      // hydrating) should not silently cost the user an item.
      if (retryQueue.length && !this.cancelRequested) {
        this.showStatus(
          win,
          `Folder Drop Importer\nRetrying ${retryQueue.length} file(s) that failed…`,
          0,
          { cancellable: true, forceShow: true }
        );

        for (const job of retryQueue) {
          if (this.cancelRequested) break;
          stats.retried++;
          const outcome = await this.importJob(job, stats);
          if (outcome === 'retry') {
            stats.failed++;
            this.noteProblem(stats, `Failed after retry: ${this.safePath(job.file)}`);
          }
        }
      }

      const settled = stats.imported + stats.skipped + stats.failed;
      const unaccounted = this.cancelRequested ? 0 : Math.max(0, found - settled);

      this.showStatus(
        win,
        this.buildSummary(stats, found, unaccounted),
        this.cancelRequested ? 12000 : 14000,
        { forceShow: true }
      );
      this.logReport(stats, found);
    } finally {
      this.importing = false;
      this.cancelRequested = false;
      this.collectionCache.clear();
      this.jobPathSet.clear();
      this.duplicateIndex.clear();
    }
  },

  // Returns 'ok' | 'skipped' | 'retry'. Only a verified Zotero item counts as
  // imported, so the reported number reflects what is actually in the library.
  async importJob(job, stats) {
    try {
      if (await this.isDuplicate(job.file, job.collection)) {
        stats.skipped++;
        return 'skipped';
      }

      // Zotero's attachment import is atomic from the plugin's point of view,
      // so Stop takes effect between files rather than interrupting a single
      // file halfway through.
      const item = await Zotero.Attachments.importFromFile({
        file: job.file.path,
        libraryID: job.collection.libraryID,
        collections: [job.collection.id],
        title: job.file.leafName.replace(/\.[^.]+$/, '')
      });

      if (!item?.id) {
        this.noteProblem(stats, `Import returned no item: ${this.safePath(job.file)}`);
        return 'retry';
      }

      // Defensive: if the item did not end up in the requested collection it
      // would look "missing" to the user even though the import succeeded.
      try {
        const inTarget = (item.getCollections?.() || []).includes(job.collection.id);
        if (!inTarget) {
          item.addToCollection(job.collection.id);
          await item.saveTx();
          stats.collectionRepairs++;
          this.noteProblem(stats, `Re-filed into target collection: ${this.safePath(job.file)}`);
        }
      } catch (e) {
        this.noteProblem(stats, `Could not verify collection membership for ${this.safePath(job.file)}: ${e}`);
      }

      this.rememberImported(job.collection, item, job.file);
      stats.imported++;
      return 'ok';
    } catch (e) {
      this.noteProblem(stats, `Import error for ${this.safePath(job.file)}: ${e}`);
      Zotero.logError(e);
      return 'retry';
    }
  },

  buildSummary(stats, found, unaccounted) {
    const lines = [];
    lines.push(this.cancelRequested ? 'Folder Drop Importer stopped' : 'Folder Drop Importer complete');
    lines.push(`Found: ${found} · Imported: ${stats.imported} · Duplicates: ${stats.skipped} · Failed: ${stats.failed}`);

    if (stats.collectionsCreated) lines.push(`Collections created: ${stats.collectionsCreated}`);

    // The most common "my files are missing" report is really this: items live in
    // subcollections and Zotero's item list hides them by default. Warn whenever
    // anything landed outside the collection the user was pointing at, even if
    // this run reused existing collections and created none.
    const usedNested = [...stats.collectionsUsed].some(id => id !== stats.targetCollectionID);
    if (usedNested) {
      lines.push('Files in subfolders go to subcollections - enable View -> Show Items from Subcollections to see them all.');
    }

    const notes = this.scanNotes(stats);
    if (notes) lines.push(notes.trim());
    if (unaccounted) lines.push(`Unaccounted: ${unaccounted} (please report this)`);
    if (this.cancelRequested) lines.push('Partial results were kept.');

    return lines.join('\n');
  },

  scanNotes(stats) {
    const parts = [];

    if (stats.ignored) {
      const kinds = [...stats.ignoredExtensions.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([ext, count]) => `${count}x .${ext || '(no extension)'}`)
        .join(', ');
      parts.push(`Ignored ${stats.ignored} unsupported file(s): ${kinds}`);
    }
    if (stats.hiddenSkipped) parts.push(`Skipped ${stats.hiddenSkipped} hidden folder(s)`);
    if (stats.partialDirs) parts.push(`${stats.partialDirs} folder(s) could only be read partially`);
    if (stats.unreadableDirs) parts.push(`${stats.unreadableDirs} folder(s) could not be opened`);
    if (stats.unreadableEntries) parts.push(`${stats.unreadableEntries} unreadable entry/entries (cloud placeholder or permissions)`);
    if (stats.loopGuards) parts.push(`${stats.loopGuards} folder link loop(s) skipped`);
    if (stats.depthLimited) parts.push(`${stats.depthLimited} folder(s) deeper than ${this.limits.maxDepth} levels skipped`);

    if (!parts.length) return '';
    return `\n${parts.join('\n')}\nDetails: Help -> Debug Output Logging -> View Output`;
  },

  logReport(stats, found) {
    this.log(
      `Report - found:${found} imported:${stats.imported} duplicates:${stats.skipped} ` +
      `failed:${stats.failed} retried:${stats.retried} ignored:${stats.ignored} ` +
      `collectionsCreated:${stats.collectionsCreated} collectionsUsed:${stats.collectionsUsed.size} ` +
      `collectionRepairs:${stats.collectionRepairs} ` +
      `partialDirs:${stats.partialDirs} unreadableDirs:${stats.unreadableDirs} ` +
      `unreadableEntries:${stats.unreadableEntries} hiddenSkipped:${stats.hiddenSkipped} ` +
      `loopGuards:${stats.loopGuards} depthLimited:${stats.depthLimited}`
    );
    for (const problem of stats.problemPaths) this.log(`  - ${problem}`);
  },

  allowed(file) {
    const ext = this.extensionOf(file);
    return !!ext && this.defaults.extensions.includes(ext);
  },

  extensionOf(file) {
    let name = '';
    try { name = file.leafName || ''; } catch (_) { return ''; }
    const m = name.match(/\.([^.\\/]+)$/);
    return m ? m[1].toLowerCase() : '';
  },

  safePath(file) {
    try { return file?.path || file?.leafName || '<unknown path>'; } catch (_) { return '<unknown path>'; }
  },

  // Returns true/false normally, or null when the filesystem raised - callers
  // must distinguish "definitely not a file" from "could not be inspected",
  // otherwise unreadable entries vanish from the import without a trace.
  safeFileCall(file, operation, fallback = false) {
    try {
      if (!file) return fallback;
      switch (operation) {
        case 'exists': return !!file.exists();
        case 'isFile': return !!file.isFile();
        case 'isDirectory': return !!file.isDirectory();
        case 'isHidden': return !!file.isHidden();
        default: return fallback;
      }
    } catch (e) {
      this.log(`Filesystem entry raised during ${operation}: ${this.safePath(file)}: ${e}`);
      return null;
    }
  },

  addJob(file, collection, jobs, stats) {
    let path = '';
    try { path = file.path; } catch (_) {
      stats.unreadableEntries++;
      return;
    }
    const key = this.canonicalPath(path);
    if (!key || this.jobPathSet.has(key)) return;
    this.jobPathSet.add(key);
    jobs.push({ file, collection });
    stats.files++;
    if (collection?.id != null) stats.collectionsUsed.add(collection.id);
  },

  // Reads one directory into a plain array. Critically, the nsIDirectoryEnumerator
  // is opened, drained and closed synchronously. Holding one open across an
  // `await` - and creating a collection does hit the database - is what used to
  // make enumeration abort mid-folder and silently drop the remaining files.
  readDirectoryOnce(dir) {
    const children = [];
    let entries = null;

    try {
      entries = dir.directoryEntries;
    } catch (e) {
      return { children, opened: false, partial: false, unreadableEntries: 0, error: e };
    }

    let partial = false;
    let unreadableEntries = 0;
    let error = null;

    try {
      while (true) {
        let hasMore = false;
        try {
          hasMore = entries.hasMoreElements();
        } catch (e) {
          partial = true;
          error = e;
          break;
        }
        if (!hasMore) break;

        let child = null;
        let thrown = null;

        // Some Gecko builds expose only the newer nsIDirectoryEnumerator
        // getter. Learn which accessor works once rather than throwing on
        // every single entry of every directory.
        if (this.enumeratorAccessor !== 'nextFile') {
          try {
            child = entries.getNext().QueryInterface(Ci.nsIFile);
            this.enumeratorAccessor = 'getNext';
          } catch (e) {
            thrown = e;
          }
        }

        if (!child) {
          try {
            child = entries.nextFile;
            if (child && this.enumeratorAccessor !== 'getNext') {
              this.enumeratorAccessor = 'nextFile';
            }
          } catch (_) {}
        }

        if (!child) {
          unreadableEntries++;
          error = thrown || error;
          // The enumerator can no longer be advanced reliably. Stop instead of
          // spinning forever on the same broken entry.
          partial = true;
          break;
        }

        children.push(child);
      }
    } finally {
      try { entries.close?.(); } catch (_) {}
    }

    return { children, opened: true, partial, unreadableEntries, error };
  },

  // A partial read is retried once from scratch and the results merged by
  // canonical path, so a transient failure does not quietly shrink the import.
  readDirectorySnapshot(dir, stats) {
    const first = this.readDirectoryOnce(dir);
    if (!first.opened) {
      stats.unreadableDirs++;
      this.noteProblem(stats, `Could not open folder: ${this.safePath(dir)}: ${first.error}`);
      return null;
    }

    if (!first.partial && !first.unreadableEntries) return first.children;

    const second = this.readDirectoryOnce(dir);
    const merged = new Map();
    for (const child of [...first.children, ...second.children]) {
      const key = this.canonicalPath(this.safePath(child));
      if (key && !merged.has(key)) merged.set(key, child);
    }

    if (first.partial && second.partial) {
      stats.partialDirs++;
      this.noteProblem(
        stats,
        `Folder read incompletely after retry (${merged.size} entries recovered): ` +
        `${this.safePath(dir)}: ${second.error || first.error}`
      );
    } else {
      this.log(`Recovered a partial folder read on retry: ${this.safePath(dir)}`);
    }

    stats.unreadableEntries += Math.min(first.unreadableEntries, second.unreadableEntries);
    return [...merged.values()];
  },

  // Iterative walk. The previous recursive version was bounded only by the tree
  // itself, so a directory junction pointing at an ancestor could recurse until
  // the stack blew up and took the whole import down with it.
  async collectAll(roots, parentCollection, jobs, stats, win) {
    const stack = [];
    for (let i = roots.length - 1; i >= 0; i--) {
      stack.push({ file: roots[i], collection: parentCollection, isRoot: true, depth: 0 });
    }

    const visitedDirs = new Set();
    let lastTick = 0;

    while (stack.length) {
      if (this.cancelRequested) return;

      const task = stack.pop();
      const file = task.file;

      const exists = this.safeFileCall(file, 'exists');
      if (exists === null) {
        stats.unreadableEntries++;
        this.noteProblem(stats, `Unreadable entry (skipped): ${this.safePath(file)}`);
        continue;
      }
      if (!exists) continue;

      const isFile = this.safeFileCall(file, 'isFile');
      if (isFile === null) {
        stats.unreadableEntries++;
        this.noteProblem(stats, `Could not classify entry (skipped): ${this.safePath(file)}`);
        continue;
      }

      if (isFile) {
        if (this.allowed(file)) {
          this.addJob(file, task.collection, jobs, stats);
        } else {
          const ext = this.extensionOf(file);
          stats.ignored++;
          stats.ignoredExtensions.set(ext, (stats.ignoredExtensions.get(ext) || 0) + 1);
        }
        continue;
      }

      if (this.safeFileCall(file, 'isDirectory') !== true) continue;

      if (this.defaults.skipHidden && this.safeFileCall(file, 'isHidden', false) === true) {
        stats.hiddenSkipped++;
        this.log(`Skipped hidden folder: ${this.safePath(file)}`);
        continue;
      }

      if (task.depth > this.limits.maxDepth) {
        stats.depthLimited++;
        this.noteProblem(stats, `Folder deeper than ${this.limits.maxDepth} levels (skipped): ${this.safePath(file)}`);
        continue;
      }

      const dirKey = this.canonicalPath(this.safePath(file));
      if (dirKey) {
        if (visitedDirs.has(dirKey)) {
          stats.loopGuards++;
          this.log(`Already visited, not re-scanning: ${dirKey}`);
          continue;
        }
        visitedDirs.add(dirKey);
      }

      // Snapshot before any await, then create the collection.
      const children = this.readDirectorySnapshot(file, stats);
      if (children === null) continue;

      let collection = task.collection;
      if (!task.isRoot || this.defaults.createRootCollection) {
        try {
          collection = await this.getOrCreateChildCollection(task.collection, file.leafName, stats);
        } catch (e) {
          this.noteProblem(stats, `Could not create collection for ${this.safePath(file)}: ${e}`);
          Zotero.logError(e);
          continue;
        }
      }

      const now = Date.now();
      if (now - lastTick >= this.limits.statusThrottleMs) {
        lastTick = now;
        this.showStatus(
          win,
          `Folder Drop Importer\nScanning... ${jobs.length} file(s) found\n${file.leafName}`,
          0,
          { cancellable: true }
        );
      }

      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ file: children[i], collection, isRoot: false, depth: task.depth + 1 });
      }
    }
  },

  collectionCacheKey(parent, name) {
    return `${parent.libraryID}:${parent.id}:${String(name || '')}`;
  },

  async getOrCreateChildCollection(parent, name, stats) {
    const wanted = String(name || '').trim();
    const key = this.collectionCacheKey(parent, wanted);
    const cached = this.collectionCache.get(key);
    if (cached) return cached;

    let existing = null;
    try {
      const siblings = parent.getChildCollections?.() || [];
      // Exact match first. Matching case-insensitively outright merged sibling
      // folders that differ only in case on case-sensitive filesystems.
      existing = siblings.find(collection => String(collection.name || '').trim() === wanted)
        || siblings.find(
          collection => String(collection.name || '').trim().toLocaleLowerCase()
            === wanted.toLocaleLowerCase()
        );
    } catch (e) {
      this.log(`Could not inspect child collections under ${parent.id}: ${e}`);
    }

    if (existing) {
      this.collectionCache.set(key, existing);
      return existing;
    }

    const collection = new Zotero.Collection();
    collection.libraryID = parent.libraryID;
    collection.name = wanted;
    collection.parentID = parent.id;
    await collection.saveTx();
    this.collectionCache.set(key, collection);
    if (stats) stats.collectionsCreated++;
    return collection;
  },

  // Attachment filenames already in a collection, indexed once per collection
  // per import. Calling getChildItems() for every single file made a large
  // import quadratic in (files x existing items).
  duplicateIndexFor(collection) {
    const id = collection?.id;
    if (id == null) return new Map();

    const cached = this.duplicateIndex.get(id);
    if (cached) return cached;

    const index = new Map();
    try {
      for (const item of collection.getChildItems?.() || []) {
        if (!item.isAttachment?.()) continue;
        const name = (item.attachmentFilename || '').toLowerCase();
        if (!name) continue;
        const bucket = index.get(name);
        if (bucket) bucket.push(item);
        else index.set(name, [item]);
      }
    } catch (e) {
      this.log(`Could not index existing attachments in collection ${id}: ${e}`);
    }

    this.duplicateIndex.set(id, index);
    return index;
  },

  rememberImported(collection, item, file) {
    const index = this.duplicateIndex.get(collection?.id);
    if (!index) return;

    let name = '';
    try { name = (item.attachmentFilename || '').toLowerCase(); } catch (_) {}
    if (!name) {
      try { name = (file.leafName || '').toLowerCase(); } catch (_) {}
    }
    if (!name) return;

    const bucket = index.get(name);
    if (bucket) bucket.push(item);
    else index.set(name, [item]);
  },

  async isDuplicate(file, collection) {
    if (this.defaults.duplicateMode === 'off') return false;

    try {
      const targetName = file.leafName.toLowerCase();
      let targetSize = -1;
      try { targetSize = file.fileSize; } catch (_) {}

      for (const item of this.duplicateIndexFor(collection).get(targetName) || []) {
        if (this.defaults.duplicateMode === 'name') return true;

        const existingPath = await item.getFilePathAsync?.();
        if (!existingPath) {
          // name-size mode cannot confirm a match without the stored file
          // (linked attachment, or a synced file not downloaded yet). Importing
          // a possible twin is recoverable; silently dropping a new file is not.
          this.log(`Duplicate check inconclusive, importing anyway: ${this.safePath(file)}`);
          continue;
        }

        const existing = this.fileFromPath(existingPath);
        if (this.safeFileCall(existing, 'exists') !== true) continue;
        let existingSize = -2;
        try { existingSize = existing.fileSize; } catch (_) {}
        if (existingSize >= 0 && targetSize >= 0 && existingSize === targetSize) return true;
      }
    } catch (e) {
      this.log(`Duplicate check warning: ${e}`);
    }

    return false;
  }
};
