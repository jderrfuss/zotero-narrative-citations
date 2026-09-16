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
 * behind on any prototype, so there is no dead-object hazard when the plugin
 * sandbox is torn down.
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
 * correctness depending on it.
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

let setDataHelper: PatchHelper | undefined;
let getCiteProcHelper: PatchHelper | undefined;

/** Raised only while an integration session is building its engine. */
let buildingIntegrationEngine = false;

/** Diagnostics from the most recent synthesis attempt. */
let lastSynthesis: (SynthesisResult & { when: string }) | undefined;

/**
 * Whether the style the integration session is currently using can support
 * narrative citations at all. Read by the citation dialog to decide whether to
 * enable the checkbox, and by the fallback guard below.
 */
let lastCapability: StyleCapability | undefined;

export function getLastSynthesis() {
  return lastSynthesis;
}

export function getLastCapability() {
  return lastCapability;
}

/**
 * Silent fallback for styles that cannot support narrative citations.
 *
 * A flagged citation outlives the style that supported it: write in APA with
 * narrative citations, switch to MLA for submission, and the flags are still in
 * the document with no dialog involved. Without this guard every one of them
 * would render `[NO_PRINTED_FORM]` (see intext.ts citationRendersADate).
 *
 * The flag is dropped at the *processor boundary*, not in the document, so
 * switching back to a supporting style restores the narrative form. That
 * distinction is why this cannot live in the `Citation.toJSON` patch: that one
 * method feeds both the processor and the field write-back, and cannot tell
 * them apart. An engine instance can -- and every render route
 * (`_updateCitations`, `restoreProcessorState`, and the dialog's live preview
 * via `previewCitationCluster`) funnels through this one method.
 *
 * Instance-level, so no prototype is touched and nothing survives teardown.
 */
function installFallbackGuard(engine: any, capability: StyleCapability): void {
  if (!engine || capability.supported) return;
  const stock = engine.processCitationCluster;
  if (typeof stock !== "function") return;

  engine.processCitationCluster = function (
    this: any,
    citation: any,
    ...rest: unknown[]
  ) {
    if (!citation?.properties?.mode) {
      return stock.call(this, citation, ...rest);
    }

    // Copy before stripping. restoreProcessorState() passes the *live*
    // Zotero.Integration.Citation object (integration.js:2383), so mutating
    // it here would delete the user's flag from the document itself.
    //
    // Not mutate-and-restore instead: citeproc keeps the object it is given in
    // its registry and later re-renders tainted citations from there directly
    // via process_CitationCluster, bypassing this guard, so a restored flag
    // would render [NO_PRINTED_FORM].
    const live = citation;
    const copy = {
      ...live,
      properties: { ...live.properties },
    };
    delete copy.properties.mode;
    delete copy.properties.infix;

    try {
      return stock.call(this, copy, ...rest);
    } finally {
      // citeproc also *returns* data by writing onto the citation object, and
      // callers read it back from the object they passed. Without this the
      // citation dialog's sort (citationDialog.js:2324) reads
      // io.citation.sortedItems, finds it undefined, and throws inside
      // accept() -- leaving the dialog and Zotero's Word integration hung
      // until restart. These are the only two fields citeproc writes onto the
      // citation in processCitationCluster and setCitationId (10.0.2).
      if ("sortedItems" in copy) live.sortedItems = copy.sortedItems;
      if (!live.citationID && copy.citationID) {
        live.citationID = copy.citationID;
      }
    }
  };
}

/**
 * Run `fn` with the style instance's `getXML` temporarily returning XML that
 * carries a synthesized <intext>. Installed and removed within one synchronous
 * turn, so nothing else can observe it and nothing is left on any prototype.
 */
function withSynthesizedXML<T>(Style: any, style: any, fn: () => T): T {
  const hadOwn = Object.prototype.hasOwnProperty.call(style, "getXML");
  const previous = style.getXML;

  style.getXML = function (this: any, ...xmlArgs: unknown[]) {
    const xml = (hadOwn ? previous : Style.prototype.getXML).apply(
      this,
      xmlArgs,
    );
    // Never throws; on failure it returns its input unchanged, so a style we
    // cannot handle falls back to the no-<intext> rendering rather than
    // breaking citations.
    lastCapability = assessStyle(xml);
    const result = synthesizeIntext(xml);
    lastSynthesis = { ...result, when: new Date().toISOString() };
    return result.xml;
  };

  try {
    return fn();
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
          try {
            lastCapability = assessStyle(this.getXML());
          } catch (e) {
            lastCapability = {
              supported: false,
              reason: `could not read style: ${(e as Error).message}`,
            };
          }
          const legacyEngine = original.apply(this, args);
          installFallbackGuard(legacyEngine, lastCapability);
          return legacyEngine;
        }

        const engine = withSynthesizedXML(Style, this, () =>
          original.apply(this, args),
        );
        installFallbackGuard(
          engine,
          lastCapability ?? { supported: true, reason: "not assessed" },
        );
        return engine;
      },
  });
}

export function uninstallStyleEnginePatches(): void {
  setDataHelper?.unpatch();
  setDataHelper = undefined;
  getCiteProcHelper?.unpatch();
  getCiteProcHelper = undefined;
  buildingIntegrationEngine = false;
  lastCapability = undefined;
}
