import { config } from "../package.json";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import * as narrative from "./modules/narrative";
import type { DialogProbe } from "./modules/dialog";
import {
  getLastSynthesis,
  getLastCapability,
} from "./modules/patches/styleEngine";
import { synthesizeIntext, assessStyle } from "./modules/intext";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    env: "development" | "production";
    initialized?: boolean;
    /** Whether the Citation.toJSON patch is currently installed. */
    patched?: boolean;
    /** Whether the <intext> synthesis patches are currently installed. */
    intextPatched?: boolean;
    ztoolkit: ZToolkit;
    locale?: { current: any };
    /** Diagnostics recorded the last time a citation dialog was opened. */
    dialogProbe?: DialogProbe;
    /** The last few dialog sessions, most recent first. */
    dialogProbes?: DialogProbe[];
  };

  public hooks: typeof hooks;

  /**
   * Exposed as Zotero.NarrativeCitations.api for Run JavaScript testing until
   * the citation dialog UI exists.
   */
  public api: {
    isNarrative: typeof narrative.isNarrative;
    canBeNarrative: typeof narrative.canBeNarrative;
    setNarrative: typeof narrative.setNarrative;
    NARRATIVE_MODE: typeof narrative.NARRATIVE_MODE;
    /** Diagnostics from the last citation dialog opened. See modules/dialog.ts. */
    getDialogProbe: () => DialogProbe | undefined;
    /** The last few dialog sessions, most recent first. */
    getDialogProbes: () => DialogProbe[];
    /** Diagnostics from the most recent <intext> synthesis attempt. */
    getLastSynthesis: typeof getLastSynthesis;
    /** Exposed so the transform can be tested offline, without Word. */
    synthesizeIntext: typeof synthesizeIntext;
    /** Can a given style XML support narrative citations, and if not why not. */
    assessStyle: typeof assessStyle;
    /** Capability of the style the integration session is currently using. */
    getLastCapability: typeof getLastCapability;
  };

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      patched: false,
      ztoolkit: createZToolkit(),
    };
    this.hooks = hooks;
    this.api = {
      isNarrative: narrative.isNarrative,
      canBeNarrative: narrative.canBeNarrative,
      setNarrative: narrative.setNarrative,
      NARRATIVE_MODE: narrative.NARRATIVE_MODE,
      getDialogProbe: () => this.data.dialogProbe,
      getDialogProbes: () => this.data.dialogProbes ?? [],
      getLastSynthesis,
      synthesizeIntext,
      assessStyle,
      getLastCapability,
    };
  }
}

export default Addon;
