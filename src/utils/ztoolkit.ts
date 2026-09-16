import { BasicTool, UITool, unregister } from "zotero-plugin-toolkit";
import { config } from "../../package.json";

export { createZToolkit };

/**
 * A trimmed toolkit. The template's full `ZoteroToolkit` pulls in every helper;
 * this plugin needs logging, DOM construction (for the citation dialog control,
 * later) and nothing else. `PatchHelper` is used directly in
 * `src/modules/patches/`, not through here, because it is not a ManagerTool and
 * so is not covered by `unregister()`.
 */
class NarrativeToolkit extends BasicTool {
  UI: UITool;

  constructor() {
    super();
    this.UI = new UITool(this);
  }

  unregisterAll() {
    unregister(this);
  }
}

function createZToolkit() {
  const _ztoolkit = new NarrativeToolkit();
  const env = __env__;
  _ztoolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  _ztoolkit.basicOptions.log.disableConsole = env === "production";
  _ztoolkit.basicOptions.api.pluginID = config.addonID;
  return _ztoolkit;
}
