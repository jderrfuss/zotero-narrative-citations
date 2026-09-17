/**
 * Patches 2 and 3: getting the synthesized <intext> into the engine the
 * integration pipeline uses, and *only* that engine.
 *
 * THE PROBLEM
 *
 * The style XML is assembled inside `Zotero.Style.prototype.getCiteProc`
 * (style.js:769) and never escapes it:
 *
 *     var xml = this.getXML();              // or an XSLT upgrade for CSL 0.8
 *     xml = this._eventToEventTitle(xml);
 *     citeproc = new Zotero.CiteProc.CSL.Engine(sys, xml, locale, override);
 *
 * There is no seam that hands us the finished XML, so we have to intercept one
 * of those three calls.
 *
 * WHAT WAS REJECTED, AND WHY
 *
 *  - **`CSL.Engine`** — the obvious target, and wrong. Its constructor body
 *    does `new CSL.Engine.Opt()`, `new CSL.Engine.Tmp()`, `new
 *    CSL.Engine.InText()` and so on (citeproc.js:3794-3807), resolving those
 *    statics off `CSL.Engine` *at construction time*. Replacing `CSL.Engine`
 *    with anything lacking those statics breaks construction outright.
 *    Separately, `PatchHelper` must not be used on a constructor at all: its
 *    disabled path is `state.origin.apply(this, arguments)`, which for a
 *    constructor returns undefined and so yields an object carrying the
 *    wrapper's prototype instead of the engine's. Disabling this plugin would
 *    break every citation Zotero renders until restart.
 *  - **`_eventToEventTitle()`** — right stage, but underscore-private *and*
 *    self-documented as temporary ("Until
 *    https://github.com/citation-style-language/styles/issues/6151").
 *  - **`getXML()` patched on the prototype** — it also feeds the CSL editor
 *    (tools/csledit.js:125), so a standing patch would change the style source
 *    the user sees when editing a style.
 *
 * WHAT THIS DOES INSTEAD
 *
 * Patch `getCiteProc` — an ordinary method, which PatchHelper handles properly
 * — and inside it, override `getXML` **on the style instance** for the
 * duration of the original call. `getCiteProc` contains no `await`
 * (verified against 10.0.2), so the override is installed and removed within a
 * single synchronous turn and no other code can observe it. Nothing is left
 * behind on any prototype. (Zotero 10.0.2 does not destroy a plugin's sandbox
 * when the plugin is disabled, so functions left behind would keep working;
 * a later version might.)
 *
 * `_eventToEventTitle` still runs afterwards; it only rewrites elements
 * matching `[variable*="event"]`, so a synthesized <intext> passes through it
 * untouched.
 *
 * NARROWING IT TO THE INTEGRATION PIPELINE
 *
 * `getCiteProc` also serves bibliographies, quick copy and export. The
 * transform is gated on a flag raised around
 * `Zotero.Integration.Session.setData` (integration.js:1987), the only place
 * the integration session's engine is built, so this plugin does not change
 * what Zotero renders anywhere else.
 *
 * `setData` is async and awaits `Zotero.Styles.init()` before calling
 * `getCiteProc`, so the flag is briefly raised across a yield. If another task
 * built an engine inside that window it would get an <intext> it did not ask
 * for. That is accepted deliberately: an <intext> block is inert unless a
 * cluster sets `properties.mode`, and SPIKE-RESULTS confirmed parenthetical
 * output is unchanged by its presence -- so the flag buys narrowness without
 * correctness depending on it. In practice the window is only open while
 * styles are still loading; after that the await settles within the same turn.
 *
 * What that argument does not cover (neither has been observed):
 *  - A caller asking for a cached engine inside the window (Quick Copy, the
 *    item pane) would also get the fallback guard if its style is unsupported,
 *    and keep it in Zotero's engine cache.
 *  - The flag is a single boolean. Overlapping setData calls -- e.g. Zotero's
 *    resetSessionStyles after a style update, during a Word command -- could
 *    clear it while another call is still waiting, and that session would get
 *    an engine with no <intext> and no fallback guard.
 *
 * Note too that the integration's `getCiteProc` call passes no `cache` option,
 * so `cacheKey` is null and the engine never enters
 * `Zotero.Style._cachedEngines`. A transformed engine cannot leak into
 * Zotero's own style cache.
 */

import { PatchHelper } from "zotero-plugin-toolkit";
import { config } from "../../../package.json";
import {
  synthesizeIntext,
  assessStyle,
  type SynthesisResult,
  type StyleCapability,
} from "../intext";
import { installFallbackGuard } from "../fallbackGuard";

let setDataHelper: PatchHelper | undefined;
let getCiteProcHelper: PatchHelper | undefined;

/** Raised only while an integration session is building its engine. */
let buildingIntegrationEngine = false;

/** Diagnostics from the most recent synthesis attempt. */
let lastSynthesis: (SynthesisResult & { when: string }) | undefined;

/**
 * Whether each integration engine's style can support narrative citations, as
 * assessed when the engine was built -- the same value its fallback guard was
 * installed with.
 *
 * Per engine, not one module-level value: every open document has its own
 * session and engine, and any of them (or Zotero's resetSessionStyles after a
 * style update) can build an engine at any time. A single "last" value made
 * the checkbox in one document reflect whichever document's style was built
 * most recently.
 */
const capabilityByEngine = new WeakMap<object, StyleCapability>();

export function getLastSynthesis() {
  return lastSynthesis;
}

/**
 * Can the style of this integration session support narrative citations?
 *
 * Read by the citation dialog for the session whose command opened it. Returns
 * what the session's engine was built with, so the checkbox and the fallback
 * guard cannot disagree. For an engine built without these patches -- before
 * plugin startup, or not yet reached by rebuildExistingIntegrationEngines --
 * assesses the session's style directly instead.
 */
export function getSessionCapability(
  session: any,
): StyleCapability | undefined {
  const engine = session?.style;
  if (engine) {
    const known = capabilityByEngine.get(engine);
    if (known) return known;
  }

  const styleID = session?.data?.style?.styleID;
  if (!styleID) return undefined;
  try {
    const style = (Zotero as any).Styles.get(styleID);
    if (!style) {
      return {
        supported: false,
        code: "error",
        reason: `style ${styleID} is not installed`,
      };
    }
    return assessStyle(style.getXML());
  } catch (e) {
    return {
      supported: false,
      code: "error",
      reason: `could not read style: ${(e as Error).message}`,
    };
  }
}

/**
 * Run `fn` with the style instance's `getXML` temporarily returning XML that
 * carries a synthesized <intext>. Installed and removed within one synchronous
 * turn, so nothing else can observe it and nothing is left on any prototype.
 *
 * Also returns the capability assessed from that XML, or undefined if `fn`
 * never read it (e.g. a cached engine was returned).
 */
function withSynthesizedXML<T>(
  Style: any,
  style: any,
  fn: () => T,
): { value: T; capability: StyleCapability | undefined } {
  const hadOwn = Object.prototype.hasOwnProperty.call(style, "getXML");
  const previous = style.getXML;
  let capability: StyleCapability | undefined;

  style.getXML = function (this: any, ...xmlArgs: unknown[]) {
    const xml = (hadOwn ? previous : Style.prototype.getXML).apply(
      this,
      xmlArgs,
    );
    // Never throws; on failure it returns its input unchanged, so a style we
    // cannot handle falls back to the no-<intext> rendering rather than
    // breaking citations.
    capability = assessStyle(xml);
    const result = synthesizeIntext(xml);
    lastSynthesis = { ...result, when: new Date().toISOString() };
    return result.xml;
  };

  try {
    return { value: fn(), capability };
  } finally {
    if (hadOwn) {
      style.getXML = previous;
    } else {
      delete style.getXML;
    }
  }
}

export function installStyleEnginePatches(): void {
  if (setDataHelper || getCiteProcHelper) return;

  const Session = (Zotero as any)?.Integration?.Session;
  const Style = (Zotero as any)?.Style;
  if (typeof Session?.prototype?.setData !== "function") {
    throw new Error(
      "Zotero.Integration.Session.prototype.setData not found -- " +
        "Zotero internals have moved; refusing to patch.",
    );
  }
  if (
    typeof Style?.prototype?.getCiteProc !== "function" ||
    typeof Style?.prototype?.getXML !== "function"
  ) {
    throw new Error(
      "Zotero.Style.prototype.getCiteProc/getXML not found -- " +
        "refusing to patch.",
    );
  }

  setDataHelper = new PatchHelper();
  setDataHelper.setData({
    target: Session.prototype,
    funcSign: "setData",
    enabled: true,
    pluginID: config.addonID,
    patcher: (original: any) =>
      async function (this: any, ...args: unknown[]) {
        buildingIntegrationEngine = true;
        try {
          return await original.apply(this, args);
        } finally {
          buildingIntegrationEngine = false;
        }
      },
  });

  getCiteProcHelper = new PatchHelper();
  getCiteProcHelper.setData({
    target: Style.prototype,
    funcSign: "getCiteProc",
    enabled: true,
    pluginID: config.addonID,
    patcher: (original: any) =>
      function (this: any, ...args: unknown[]) {
        if (!buildingIntegrationEngine) {
          return original.apply(this, args);
        }

        // CSL 0.8 styles are run through an upgrade XSLT that knows nothing
        // about <intext> and would drop it. Skip rather than do work that is
        // silently discarded.
        if (this._version === "0.8") {
          lastSynthesis = {
            xml: "",
            synthesized: false,
            reason: "CSL 0.8 style; upgrade XSLT would discard <intext>",
            when: new Date().toISOString(),
          };
          // No <intext>, but the style may still be a perfectly good
          // author-date style that composite mode handles at 9/10
          // (SPIKE-RESULTS §4.8). Assess it anyway so the guard and the
          // dialog agree.
          let legacyCapability: StyleCapability;
          try {
            legacyCapability = assessStyle(this.getXML());
          } catch (e) {
            legacyCapability = {
              supported: false,
              code: "error",
              reason: `could not read style: ${(e as Error).message}`,
            };
          }
          const legacyEngine = original.apply(this, args);
          installFallbackGuard(legacyEngine, legacyCapability);
          if (legacyEngine)
            capabilityByEngine.set(legacyEngine, legacyCapability);
          return legacyEngine;
        }

        const { value: engine, capability } = withSynthesizedXML(
          Style,
          this,
          () => original.apply(this, args),
        );
        // Not assessed means getXML was never read, so nothing was synthesized
        // either: leave the engine unguarded and unrecorded, and let
        // getSessionCapability assess the style if the dialog asks.
        if (engine && capability) {
          installFallbackGuard(engine, capability);
          capabilityByEngine.set(engine, capability);
        }
        return engine;
      },
  });
}

/**
 * Rebuild the engines of integration sessions that already exist, so they go
 * through the patched path.
 *
 * A session keeps its engine until its style changes, a style is installed or
 * updated, or Zotero restarts -- a Refresh does not rebuild it. So an engine
 * built before the patches were installed stays unpatched: no <intext> (APA
 * narrative citations render "&" instead of "and") and no fallback guard
 * (unsupported styles render [NO_PRINTED_FORM]). That happens when a Word
 * command arrives during Zotero startup before this plugin has started, and
 * when the plugin is installed, enabled or upgraded while a document is open.
 * It also replaces engines carrying a previous plugin version's guard.
 *
 * Same call Zotero makes itself after a style update
 * (Zotero.Integration.resetSessionStyles, integration.js:225). Never swaps an
 * engine under a running command: waits for it to finish first, and re-checks
 * before each session in case another has started.
 *
 * Each new engine is then filled with the session's citations. A new engine
 * starts with an empty registry, and setData only marks the session for a
 * rebuild (rebuildCiteprocState). The next command clears that mark before
 * checking it -- updateFromDocument calls resetRequest first (integration.js:
 * 1161, 1914) -- and only a forced update (Refresh, Document Preferences, the
 * bibliography commands) sets it again. So without filling it here, the next
 * Add/Edit Citation asked citeproc about citations it did not have: the preview
 * failed and Accept threw "Zotero experienced an error updating your document"
 * until the user clicked Refresh. (Observed in Word, audit 2.)
 */
export async function rebuildExistingIntegrationEngines(): Promise<void> {
  const Integration = (Zotero as any)?.Integration;
  if (!Integration?.sessions) return;

  for (const session of Object.values(Integration.sessions) as any[]) {
    while (Integration.currentDoc) {
      await Integration.currentCommandPromise;
    }
    // Uninstalled while waiting: a rebuild now would produce a stock engine.
    if (!setDataHelper) return;
    if (!session?.data?.style?.styleID) continue;
    try {
      await session.setData(session.data, true);
    } catch (e) {
      // setData logs and throws for a style that is no longer installed; the
      // session keeps its old engine, as it would in Zotero's own reset.
      Zotero.logError(e as Error);
      continue;
    }
    restoreSessionCitations(session);
  }
}

/**
 * Fill a session's new engine with the citations the session already holds,
 * as updateFromDocument does when rebuildCiteprocState is set
 * (integration.js:1192). Synchronous, so no command can start part-way through.
 *
 * If it fails -- an item deleted from the library since the last command, say
 * -- the engine is left empty, which is the state before this existed: the next
 * Add/Edit Citation fails until the user clicks Refresh. Nothing is written to
 * the document either way.
 */
function restoreSessionCitations(session: any): void {
  if (typeof session?.restoreProcessorState !== "function") return;
  try {
    session.restoreProcessorState();
    session.rebuildCiteprocState = false;
  } catch (e) {
    Zotero.logError(e as Error);
  }
}

export function uninstallStyleEnginePatches(): void {
  setDataHelper?.unpatch();
  setDataHelper = undefined;
  getCiteProcHelper?.unpatch();
  getCiteProcHelper = undefined;
  buildingIntegrationEngine = false;
}
