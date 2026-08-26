// Test harness: runs src/folder-drop-importer.js against real directories under a
// stubbed Zotero/Gecko environment. Faults (enumeration failures, unreadable
// entries, junction loops, transient import errors) are injected via `opts`.
// Drives src/folder-drop-importer.js under a stubbed Zotero/Gecko environment
// against real directories on disk.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeFile(p, opts = {}) {
  const hidden = new Set(opts.hidden || []);
  const failEnum = opts.failEnum || new Map(); // canonical dir -> {afterN, times}
  const links = opts.links || new Map();       // canonical dir -> real target
  const raise = new Set(opts.raise || []);     // paths whose stat() throws

  function wrap(fp) {
    const norm = path.resolve(fp);
    return {
      get path() { return norm; },
      get leafName() { return path.basename(norm); },
      get fileSize() { return fs.statSync(norm).size; },
      exists() {
        if (raise.has(norm)) throw new Error('simulated cloud placeholder');
        return fs.existsSync(norm);
      },
      isFile() { return fs.statSync(norm).isFile(); },
      isDirectory() { return fs.statSync(norm).isDirectory(); },
      isHidden() { return hidden.has(norm); },
      get directoryEntries() {
        const target = links.get(norm) || norm;
        const names = fs.readdirSync(target);
        let i = 0;
        let closed = false;
        const key = norm;
        const fail = failEnum.get(key);
        return {
          hasMoreElements() {
            if (fail && fail.times > 0 && i === fail.afterN) {
              fail.times--;
              throw new Error('simulated enumeration failure');
            }
            return i < names.length;
          },
          getNext() {
            const child = wrap(path.join(target, names[i++]));
            return { QueryInterface: () => child };
          },
          close() { closed = true; }
        };
      }
    };
  }
  return wrap(p);
}

function run(rootDir, opts = {}) {
  const imported = [];
  const collections = new Map();
  let nextId = 100;

  function makeCollection(name, parentID, libraryID) {
    const id = nextId++;
    const c = {
      id, name, parentID, libraryID,
      _children: [], _items: [],
      getChildCollections() { return this._children; },
      getChildItems() { return this._items; },
      async saveTx() {
        collections.set(id, this);
        if (parentID != null && collections.has(parentID)) {
          collections.get(parentID)._children.push(this);
        }
      }
    };
    return c;
  }

  const rootCollection = makeCollection('Target', null, 1);
  collections.set(rootCollection.id, rootCollection);

  const sandbox = {
    console, Date, Math, JSON, Map, Set, WeakMap, WeakSet, Array, Object, String, Number, Error,
    Components: {
      classes: {
        '@mozilla.org/file/local;1': {
          createInstance: () => ({
            _p: null,
            initWithPath(p) { this._p = p; },
            get path() { return this._p; },
            exists() { return fs.existsSync(this._p); },
            get fileSize() { return fs.statSync(this._p).size; }
          })
        }
      },
      interfaces: { nsIFile: 'nsIFile', amIAddonManagerStartup: {} }
    },
    Services: { appinfo: { OS: process.platform === 'win32' ? 'WINNT' : 'Linux' } },
    Zotero: {
      _log: [],
      debug(m) { this._log.push(m); },
      logError() {},
      getMainWindow() { return null; },
      getMainWindows() { return []; },
      Collection: function () {
        const c = makeCollection(null, null, null);
        return new Proxy(c, {
          set(t, k, v) {
            t[k] = v;
            if (k === 'parentID') t.parentID = v;
            return true;
          }
        });
      },
      Attachments: {
        async importFromFile({ file, collections: cols, libraryID, title }) {
          if (opts.failOnce && opts.failOnce.has(path.basename(file))) {
            opts.failOnce.delete(path.basename(file));
            throw new Error('simulated transient import failure');
          }
          imported.push(file);
          const item = {
            id: nextId++,
            _cols: [...cols],
            isAttachment: () => true,
            attachmentFilename: path.basename(file),
            async getFilePathAsync() { return file; },
            getCollections() { return this._cols; },
            addToCollection(id) { this._cols.push(id); },
            async saveTx() {}
          };
          for (const cid of cols) collections.get(cid)?._items.push(item);
          return item;
        }
      }
    }
  };
  sandbox.globalThis = sandbox;

  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'folder-drop-importer.js'), 'utf8');
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const plugin = sandbox.ZoteroFolderDropImporter;
  plugin.rootURI = '';
  const captured = [];
  plugin.showStatus = (win, msg) => captured.push(String(msg));

  const rootFile = makeFile(rootDir, opts);
  return plugin.importRoots(null, [rootFile], rootCollection).then(() => ({
    imported,
    summary: captured[captured.length - 1],
    log: sandbox.Zotero._log,
    collections: [...collections.values()].map(c => c.name)
  }));
}

module.exports = { run, makeFile };
