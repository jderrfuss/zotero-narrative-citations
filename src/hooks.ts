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
  getLastSynthesis,
  getLastCapability,
} from "./modules/patches/styleEngine";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  // `integration` is in the eagerly-loaded xpcom module list in zotero.mjs, so
  // Zotero.Integration.Citation exists by the time initializationPromise
  // resolves. No lazy-load dance needed.
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

  try {
    registerCitationDialogHook();
    ztoolkit.log("narrative citations: citation dialog hook registered");
  } catch (e) {
    Zotero.logError(e as Error);
  }

  addon.data.initialized = true;
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
