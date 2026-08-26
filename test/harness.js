// Test harness: runs src/folder-drop-importer.js against real directories under a
// stubbed Zotero/Gecko environment. Faults (enumeration failures, unreadable
// entries, junction loops, transient import errors) are injected via `opts`.
//
// `createSession()` keeps one stubbed library alive across several imports, so
// duplicate detection and collection reuse can be tested the way a user hits
// them - by importing the same folder twice.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = path.join(__dirname, '..', 'src', 'folder-drop-importer.js');

function makeFile(p, opts = {}) {
  const hidden = new Set(opts.hidden || []);
  const failEnum = opts.failEnum || new Map(); // canonical dir -> {afterN, times}
  const links = opts.links || new Map();       // canonical dir -> real target
  const raise = new Set(opts.raise || []);     // paths whose exists() throws
  const nextFileOnly = !!opts.nextFileOnly;    // Gecko build without getNext()
  const counters = opts.counters || {};

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
        counters.enumeratorsOpened = (counters.enumeratorsOpened || 0) + 1;
        const target = links.get(norm) || norm;
        const names = fs.readdirSync(target);
        let i = 0;
        const fail = failEnum.get(norm);
        return {
          hasMoreElements() {
            if (fail && fail.times > 0 && i === fail.afterN) {
              fail.times--;
              throw new Error('simulated enumeration failure');
            }
            return i < names.length;
          },
          getNext() {
            if (nextFileOnly) throw new Error('getNext is not available on this build');
            const child = wrap(path.join(target, names[i++]));
            return { QueryInterface: () => child };
          },
          get nextFile() {
            if (i >= names.length) return null;
            return wrap(path.join(target, names[i++]));
          },
          close() { counters.enumeratorsClosed = (counters.enumeratorsClosed || 0) + 1; }
        };
      }
    };
  }
  return wrap(p);
}

function createSession() {
  const imported = [];
  const collections = new Map();
  const counters = { getChildItems: 0, enumeratorsOpened: 0, enumeratorsClosed: 0 };
  let nextId = 100;

  function makeCollection(name, parentID, libraryID) {
    const id = nextId++;
    return {
      id, name, parentID, libraryID,
      _children: [], _items: [],
      getChildCollections() { return this._children; },
      getChildItems() {
        counters.getChildItems++;
        return this._items;
      },
      async saveTx() {
        collections.set(this.id, this);
        const parent = collections.get(this.parentID);
        if (parent && !parent._children.includes(this)) parent._children.push(this);
      }
    };
  }

  const target = makeCollection('Target', null, 1);
  collections.set(target.id, target);

  const sandbox = {
    console, Date, Math, JSON, Map, Set, WeakMap, WeakSet,
    Array, Object, String, Number, Error, Promise,
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
      debug(m) { this._log.push(String(m)); },
      logError() {},
      getMainWindow() { return null; },
      getMainWindows() { return []; },
      Collection: function () { return makeCollection(null, null, null); },
      Attachments: {
        async importFromFile({ file, collections: cols }) {
          const base = path.basename(file);
          if (sandbox.__failOnce && sandbox.__failOnce.has(base)) {
            sandbox.__failOnce.delete(base);
            throw new Error('simulated transient import failure');
          }
          imported.push(file);
          const item = {
            id: nextId++,
            _cols: [...cols],
            isAttachment: () => true,
            attachmentFilename: base,
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

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SOURCE, 'utf8'), sandbox);

  const plugin = sandbox.ZoteroFolderDropImporter;
  plugin.rootURI = '';
  const messages = [];
  plugin.showStatus = (win, msg) => messages.push(String(msg));

  async function importFolder(dir, opts = {}) {
    const before = imported.length;
    sandbox.__failOnce = opts.failOnce || null;
    counters.getChildItems = 0;
    messages.length = 0;

    const root = makeFile(dir, { ...opts, counters });
    await plugin.importRoots(null, [root], target);

    return {
      imported: imported.slice(before),
      importedTotal: imported.length,
      summary: messages[messages.length - 1],
      log: sandbox.Zotero._log,
      counters: { ...counters },
      collectionNames: [...collections.values()].map(c => c.name)
    };
  }

  return { importFolder, plugin, collections, target };
}

// Single-import convenience wrapper.
function run(dir, opts = {}) {
  return createSession().importFolder(dir, opts);
}

module.exports = { run, createSession, makeFile };
