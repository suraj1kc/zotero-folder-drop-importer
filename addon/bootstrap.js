var ZoteroFolderDropImporter;
var chromeHandle;

function install() {}

async function startup({ id, version, rootURI }) {
  const aomStartup = Components.classes['@mozilla.org/addons/addon-manager-startup;1']
    .getService(Components.interfaces.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(`${rootURI}manifest.json`);

  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ['content', 'zotero-folder-drop-importer', 'content/'],
    ['locale', 'zotero-folder-drop-importer', 'en-US', 'locale/en-US/']
  ]);

  Services.scriptloader.loadSubScript(rootURI + 'src/folder-drop-importer.js');
  ZoteroFolderDropImporter.init({ id, version, rootURI });
  // Use the same per-window path for an already-open window (plugin install/enable).
  // On normal app startup, onMainWindowLoad will recreate all UI.
  ZoteroFolderDropImporter.addToAllWindows();
}

function onMainWindowLoad({ window }) {
  try { window.MozXULElement?.insertFTLIfNeeded?.('zotero-folder-drop-importer.ftl'); } catch (_) {}
  ZoteroFolderDropImporter?.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  ZoteroFolderDropImporter?.removeFromWindow(window);
}

function shutdown() {
  ZoteroFolderDropImporter?.removeFromAllWindows();
  ZoteroFolderDropImporter = undefined;
  if (chromeHandle) {
    try { chromeHandle.destruct(); } catch (_) {}
    chromeHandle = undefined;
  }
}

function uninstall() {}
