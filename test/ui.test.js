const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSession } = require('./harness');

// Minimal window model with persistent Fluent resources and rendered menus,
// both of which outlive unregisterMenu in Zotero.
function makeWindow() {
  const elements = new Set();
  const listeners = new Map();
  const resources = new Set(['zotero.ftl', 'other-plugin.ftl']);
  function element(tag) {
    const el = {
      tag, style: {}, attributes: {}, children: [],
      appendChild(child) { this.children.push(child); elements.add(child); },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener() {},
      remove() { elements.delete(this); }
    };
    return el;
  }
  const doc = {
    createElement: element,
    documentElement: element('window'),
    getElementById(id) { return [...elements].find(el => el.id === id); },
    querySelectorAll(selector) {
      return [...elements].filter(el => selector.startsWith('[data-l10n-id')
        ? el.attributes['data-l10n-id']?.startsWith('zfdi-')
        : el.tag === 'link' && el.attributes.rel === 'localization'
          && el.attributes.href === 'zotero-folder-drop-importer.ftl');
    },
    l10n: { removeResourceIds(ids) { ids.forEach(id => resources.delete(id)); } }
  };
  return {
    document: doc, listeners, resources, elements,
    MozXULElement: {
      insertFTLIfNeeded(id) {
        if (resources.has(id)) return;
        resources.add(id);
        const link = element('link');
        link.setAttribute('rel', 'localization');
        link.setAttribute('href', id);
        doc.documentElement.appendChild(link);
      }
    },
    addEventListener(type, fn, capture) { listeners.set(type, { fn, capture }); },
    removeEventListener(type, fn, capture) {
      const entry = listeners.get(type);
      assert.equal(entry?.fn, fn);
      assert.equal(entry?.capture, capture);
      listeners.delete(type);
    },
    clearTimeout() {}
  };
}

function drag(win, paths, overrides = {}) {
  return {
    view: win, prevented: false, stopped: false,
    dataTransfer: {
      types: ['Files', 'application/x-moz-file'], dropEffect: 'move',
      mozItemCount: paths.length,
      mozGetDataAt(_type, index) { return { path: paths[index] }; },
      ...overrides
    },
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; }
  };
}

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'zfdi-ui-'));
  try {
    const pdf = path.join(base, 'orphan.pdf');
    fs.writeFileSync(pdf, 'pdf');
    const { plugin, target } = createSession();
    const win = makeWindow();
    plugin.addToWindow(win);
    const calls = [];
    plugin.getSelectedCollection = () => target;
    plugin.importRoots = async (...args) => calls.push(args);

    for (const [name, overrides, paths] of [
      ['internal attachment with file flavors', { types: ['Files', 'application/x-moz-file', 'zotero/item'] }, [pdf]],
      ['internal collection with folder payload', { types: ['Files', 'zotero/collection'] }, [base]],
      ['internal source node', { mozSourceNode: {} }, [base]],
      ['external individual PDF', {}, [pdf]],
      ['unreadable file payload', {}, [path.join(base, 'missing')]],
      ['URL', { types: ['text/uri-list'] }, []]
    ]) {
      const event = drag(win, paths, overrides);
      // Native handlers need to receive the event even during a folder import.
      plugin.importing = true;
      plugin.onDragOver(event);
      await plugin.onDrop(event);
      assert.equal(event.prevented, false, name);
      assert.equal(event.stopped, false, name);
      assert.equal(event.dataTransfer.dropEffect, 'move', name);
      assert.equal(win.document.getElementById('zfdi-highlight').style.display, 'none', name);
      assert.equal(calls.length, 0, name);
      console.log(`  PASS  ${name} reaches Zotero unchanged`);
    }

    plugin.importing = false;
    const folder = drag(win, [base, pdf]);
    folder.shiftKey = true;
    plugin.onDragOver(folder);
    assert.equal(folder.prevented, true);
    assert.equal(folder.dataTransfer.dropEffect, 'copy');
    assert.equal(win.document.getElementById('zfdi-highlight').style.display, 'block');
    await plugin.onDrop(folder);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][1].length, 1, 'nested payload is deduplicated');
    assert.equal(calls[0][1][0].path, base);
    assert.equal(calls[0][3].linked, true);
    assert.equal(plugin.handlingDrop, false);
    await plugin.onDrop(drag(win, [base]));
    assert.equal(calls.length, 1, 'repeated drop is suppressed');
    console.log('  PASS  folder drops still import once and preserve linked mode');

    // Simulate menus already rendered by MenuManager before disabling.
    const other = win.document.createElement('menuitem');
    other.setAttribute('data-l10n-id', 'other-plugin-command');
    win.document.documentElement.appendChild(other);
    for (const id of ['zfdi-import-folder', 'zfdi-import-folder-here']) {
      const menu = win.document.createElement('menuitem');
      menu.setAttribute('data-l10n-id', id);
      win.document.documentElement.appendChild(menu);
    }
    const secondWindow = makeWindow();
    plugin.addToWindow(secondWindow);
    plugin.removeFromAllWindows();
    for (const window of [win, secondWindow]) {
      assert.equal(window.listeners.size, 0);
      assert.equal(window.resources.has('zotero-folder-drop-importer.ftl'), false);
      assert.equal(window.resources.has('zotero.ftl'), true);
      assert.equal(window.resources.has('other-plugin.ftl'), true);
      assert.equal(window.document.querySelectorAll('[data-l10n-id^="zfdi-"]').length, 0);
      assert.equal(window.document.querySelectorAll('link').length, 0);
      assert.equal(window.document.getElementById('zfdi-status'), undefined);
    }
    assert.equal(win.elements.has(other), true, 'other plugin menus are preserved');
    assert.equal(plugin.windows.size, 0);
    plugin.removeFromAllWindows();
    plugin.addToWindow(win);
    plugin.addToWindow(win);
    assert.equal(win.listeners.size, 4);
    assert.equal(win.resources.has('zotero-folder-drop-importer.ftl'), true);
    plugin.removeFromAllWindows();
    console.log('  PASS  disable/re-enable cleans menus, listeners and Fluent in every window');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
