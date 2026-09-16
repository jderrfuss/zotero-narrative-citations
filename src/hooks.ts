import { initLocale } from "./utils/locale";
import { createZToolkit } from "./utils/ztoolkit";
import {
  installCitationToJSONPatch,
  uninstallCitationToJSONPatch,
} from "./modules/patches/citationToJSON";
import * as narrative from "./modules/narrative";
import {
  registerCitationDialogHook,
  unregisterCitationDialogHook,
} from "./modules/dialog";
import {
  installStyleEnginePatches,
  uninstallStyleEnginePatches,
  rebuildExistingIntegrationEngines,
  getLastSynthesis,
  getLastCapability,
} from "./modules/patches/styleEngine";

async function onStartup() {
  // Patches first, before anything else and without awaiting anything.
  //
  // Zotero accepts Word commands before it starts plugins: the HTTP server
  // starts in _initFull (zotero.js:719), plugins only after initComplete
  // (zotero.js:443), one at a time, each startup awaited (plugins.js:80). A
  // Refresh that runs before these patches exist writes every field code
  // without the narrative flag. Observed: a Refresh arrived 4 s before the
  // patch, behind another plugin's startup.
  //
  // Nothing here needs the UI. Zotero only calls plugin startup after
  // initialization, and `integration` and `style` are eagerly loaded xpcom
  // modules. Waiting for uiReadyPromise, as this used to, only lengthened the
  // window -- and held up every plugin loaded after this one.
  try {
    installCitationToJSONPatch();
    addon.data.patched = true;
    ztoolkit.log("narrative citations: toJSON patch installed");
  } catch (e) {
    addon.data.patched = false;
    Zotero.logError(e as Error);
  }

  try {
    installStyleEnginePatches();
    addon.data.intextPatched = true;
    ztoolkit.log("narrative citations: <intext> synthesis patches installed");
  } catch (e) {
    addon.data.intextPatched = false;
    Zotero.logError(e as Error);
  }

  initLocale();

  try {
    registerCitationDialogHook();
    ztoolkit.log("narrative citations: citation dialog hook registered");
  } catch (e) {
    Zotero.logError(e as Error);
  }

  addon.data.initialized = true;

  // Engines built before the patches existed stay unpatched until rebuilt.
  // Not awaited: it may wait for a running Word command, and Zotero awaits
  // this startup before starting the next plugin.
  if (addon.data.intextPatched) {
    rebuildExistingIntegrationEngines().catch((e) =>
      Zotero.logError(e as Error),
    );
  }
}

async function onMainWindowLoad(_win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  try {
    unregisterCitationDialogHook();
  } catch (e) {
    Zotero.logError(e as Error);
  }
  try {
    uninstallStyleEnginePatches();
  } catch (e) {
    Zotero.logError(e as Error);
  }
  try {
    uninstallCitationToJSONPatch();
  } catch (e) {
    Zotero.logError(e as Error);
  }
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  narrative,
  getLastSynthesis,
  getLastCapability,
};
