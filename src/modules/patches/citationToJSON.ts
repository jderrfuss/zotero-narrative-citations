/**
 * Patch 1 (and, as it turns out, the only one needed for persistence):
 * `Zotero.Integration.Citation.prototype.toJSON`.
 *
 * Verified against Zotero 10.0.2 (omni.ja), chrome/content/zotero/xpcom/
 * integration.js:3476. The stock method allowlists cluster properties:
 *
 *   const saveProperties = ["custom", "unsorted", "formattedCitation",
 *                           "plainCitation", "dontUpdate", "noteIndex"];
 *
 * `mode` is not in that list, and this one method sits between us and two
 * separate goals (SPIKE-RESULTS §2):
 *
 *   - `_updateDocument()` (integration.js:1424) writes `citation.serialize()`
 *     -> `toJSON()` into the word-processor field code, so an unlisted key is
 *     actively scrubbed on the first refresh that touches the citation.
 *   - `_updateCitations()` (integration.js:2291) does
 *     `citation = citation.toJSON()` immediately before
 *     `processCitationCluster()`, so an unlisted key never reaches citeproc.
 *
 * One patch, both goals.
 *
 * We call through to the original rather than reimplementing the method, so
 * that Zotero's own serialisation concerns (embedded items, URI mapping,
 * retraction flags) keep working across releases.
 *
 * PatchHelper is used rather than a hand-rolled prototype swap because it
 * installs the wrapper in Zotero's global rather than the plugin sandbox. A
 * sandbox-local function left on a core prototype becomes a dead object when
 * the plugin is disabled or upgraded, and restoring a saved original clobbers
 * anything that patched on top of us in the meantime.
 */

import { PatchHelper } from "zotero-plugin-toolkit";
import { config } from "../../../package.json";
import { modeToPersist } from "../narrative";

let helper: PatchHelper | undefined;

type ToJSONFn = (this: any) => any;

export function installCitationToJSONPatch(): void {
  if (helper) return;

  const Citation = (Zotero as any)?.Integration?.Citation;
  const proto = Citation?.prototype;
  if (!proto || typeof proto.toJSON !== "function") {
    throw new Error(
      "Zotero.Integration.Citation.prototype.toJSON not found -- " +
        "Zotero internals have moved; refusing to patch.",
    );
  }

  helper = new PatchHelper();
  helper.setData({
    target: proto,
    funcSign: "toJSON",
    enabled: true,
    pluginID: config.addonID,
    patcher: (original: ToJSONFn): ToJSONFn =>
      function (this: any) {
        const json = original.call(this);
        try {
          // Validating gate. citeproc's process_CitationCluster mutates
          // properties.mode in place ("author-only" -> "suppress-author" ->
          // back to "composite"); a throw mid-render could leave a live
          // Citation carrying a transient value. Only the literal narrative
          // mode is ever written back to the document.
          const mode = modeToPersist(this.properties);
          if (mode) {
            json.properties = json.properties || {};
            json.properties.mode = mode;
          }
        } catch (e) {
          // Never let this plugin break serialisation. A citation that loses
          // its narrative flag degrades to parenthetical; a citation that
          // throws here would abort the whole document update.
          Zotero.logError(e as Error);
        }
        return json;
      },
  });
}

export function uninstallCitationToJSONPatch(): void {
  helper?.unpatch();
  helper = undefined;
}

export function isCitationToJSONPatched(): boolean {
  return !!helper;
}
