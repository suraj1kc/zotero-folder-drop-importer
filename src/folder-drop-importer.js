/*
 * Zotero Folder Drop Importer
 * Lightweight, explicit folder-hierarchy importer for Zotero 8-10.
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
  cancelRequested: false,
  manuallyHiddenStatus: new WeakSet(),

  // Deliberately opinionated defaults for the first public release.
  defaults: Object.freeze({
    extensions: ['pdf'],
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

  async importRoots(win, roots, parentCollection) {
    this.importing = true;
    this.cancelRequested = false;
    this.manuallyHiddenStatus.delete(win);
    this.collectionCache = new Map();
    this.jobPathSet = new Set();

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    let found = 0;

    try {
      const canonicalRoots = this.filterTopLevelRoots(roots);
      const jobs = [];
      this.showStatus(win, 'Folder Drop Importer\nScanning folder…', 0, { cancellable: true, forceShow: true });

      for (const root of canonicalRoots) {
        if (this.cancelRequested) break;
        await this.collect(root, parentCollection, jobs, true);
      }

      found = jobs.length;

      if (this.cancelRequested) {
        this.showStatus(
          win,
          `Folder Drop Importer stopped\nFound before stop: ${found}\nImported: 0\nPartial collections may remain.`,
          8000,
          { forceShow: true }
        );
        return;
      }

      if (!found) {
        this.showStatus(win, 'Folder Drop Importer complete\nNo PDF files found.', 6000, { forceShow: true });
        return;
      }

      for (let i = 0; i < jobs.length; i++) {
        if (this.cancelRequested) break;

        const job = jobs[i];
        this.showStatus(
          win,
          `Folder Drop Importer\nImporting ${i + 1} of ${jobs.length}\n${job.file.leafName}`,
          0,
          { cancellable: true }
        );

        try {
          if (await this.isDuplicate(job.file, job.collection)) {
            skipped++;
            continue;
          }

          // Zotero's attachment import is atomic from the plugin's point of
          // view, so Stop takes effect between files rather than interrupting
          // a single file halfway through.
          await Zotero.Attachments.importFromFile({
            file: job.file.path,
            libraryID: job.collection.libraryID,
            collections: [job.collection.id],
            title: job.file.leafName.replace(/\.[^.]+$/, '')
          });
          imported++;
        } catch (e) {
          failed++;
          this.log(`Failed to import ${job.file.path}: ${e}`);
          Zotero.logError(e);
        }
      }

      if (this.cancelRequested) {
        this.showStatus(
          win,
          `Folder Drop Importer stopped\nFound: ${found}\nImported: ${imported}\nSkipped duplicates: ${skipped}\nFailed: ${failed}\nPartial results were kept.`,
          9000,
          { forceShow: true }
        );
      } else {
        this.showStatus(
          win,
          `Folder Drop Importer complete\nFound: ${found}\nImported: ${imported}\nSkipped duplicates: ${skipped}\nFailed: ${failed}`,
          8000,
          { forceShow: true }
        );
      }
    } finally {
      this.importing = false;
      this.cancelRequested = false;
      this.collectionCache.clear();
      this.jobPathSet.clear();
    }
  },

  allowed(file) {
    const m = file.leafName.match(/\.([^.]+)$/);
    return !!m && this.defaults.extensions.includes(m[1].toLowerCase());
  },

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
      let path = '<unknown path>';
      try { path = file?.path || file?.leafName || path; } catch (_) {}
      this.log(`Skipping filesystem entry during ${operation}: ${path}: ${e}`);
      return fallback;
    }
  },

  addJob(file, collection, jobs) {
    let path = '';
    try { path = file.path; } catch (_) { return; }
    const key = this.canonicalPath(path);
    if (!key || this.jobPathSet.has(key)) return;
    this.jobPathSet.add(key);
    jobs.push({ file, collection });
  },

  async collect(file, parentCollection, jobs, isRoot) {
    if (this.cancelRequested) return;

    // Broken junctions, cloud placeholders, or files disappearing during the
    // scan must never abort the rest of the import.
    if (!this.safeFileCall(file, 'exists')) return;

    if (this.safeFileCall(file, 'isFile')) {
      if (this.allowed(file)) this.addJob(file, parentCollection, jobs);
      return;
    }

    if (!this.safeFileCall(file, 'isDirectory')) return;
    if (this.defaults.skipHidden && this.safeFileCall(file, 'isHidden', false)) return;

    let collection = parentCollection;
    if (!isRoot || this.defaults.createRootCollection) {
      collection = await this.getOrCreateChildCollection(parentCollection, file.leafName);
    }

    let entries;
    try {
      entries = file.directoryEntries;
    } catch (e) {
      let path = '<unknown path>';
      try { path = file.path || file.leafName || path; } catch (_) {}
      this.log(`Could not enumerate directory; skipping it: ${path}: ${e}`);
      return;
    }

    while (true) {
      if (this.cancelRequested) break;
      let hasMore = false;
      try {
        hasMore = entries.hasMoreElements();
      } catch (e) {
        this.log(`Directory enumeration stopped: ${e}`);
        break;
      }
      if (!hasMore) break;

      let child;
      try {
        child = entries.getNext().QueryInterface(Ci.nsIFile);
      } catch (e) {
        this.log(`Could not read a directory entry; skipping it: ${e}`);
        continue;
      }

      try {
        await this.collect(child, collection, jobs, false);
      } catch (e) {
        let path = '<unknown path>';
        try { path = child?.path || child?.leafName || path; } catch (_) {}
        this.log(`Could not scan child entry; skipping it: ${path}: ${e}`);
        Zotero.logError(e);
      }
    }
  },

  collectionCacheKey(parent, name) {
    return `${parent.libraryID}:${parent.id}:${String(name || '').trim().toLocaleLowerCase()}`;
  },

  async getOrCreateChildCollection(parent, name) {
    const key = this.collectionCacheKey(parent, name);
    const cached = this.collectionCache.get(key);
    if (cached) return cached;

    let existing = null;
    try {
      existing = (parent.getChildCollections?.() || []).find(
        collection => String(collection.name || '').trim().toLocaleLowerCase()
          === String(name || '').trim().toLocaleLowerCase()
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
    collection.name = name;
    collection.parentID = parent.id;
    await collection.saveTx();
    this.collectionCache.set(key, collection);
    return collection;
  },

  async isDuplicate(file, collection) {
    if (this.defaults.duplicateMode === 'off') return false;

    try {
      const targetName = file.leafName.toLowerCase();
      const targetSize = file.fileSize;

      for (const item of collection.getChildItems?.() || []) {
        if (!item.isAttachment?.()) continue;
        const filename = (item.attachmentFilename || '').toLowerCase();
        if (filename !== targetName) continue;

        if (this.defaults.duplicateMode === 'name') return true;

        const existingPath = await item.getFilePathAsync?.();
        if (!existingPath) return true;
        const existing = this.fileFromPath(existingPath);
        if (existing?.exists() && existing.fileSize === targetSize) return true;
      }
    } catch (e) {
      this.log(`Duplicate check warning: ${e}`);
    }

    return false;
  }
};
