/**
 * The fallback guard for integration engines whose style cannot support
 * narrative citations. Installed by the getCiteProc patch in styleEngine.ts.
 *
 * A module of its own, with no runtime imports, so it can be tested offline
 * against citeproc-js without loading Zotero or the plugin toolkit
 * (test-offline/fallbackGuard.test.ts).
 */

import type { StyleCapability } from "./intext";

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
 * via `previewCitationCluster`) funnels through this one method. citeproc's
 * own re-rendering of citations it already holds does not, which is why what
 * it holds must be the stripped copy (see below).
 *
 * Instance-level, so no prototype is touched. The guard does outlive the
 * plugin: it stays on the engine until the engine is rebuilt. That is
 * deliberate -- without it, flagged citations under unsupported styles would
 * render [NO_PRINTED_FORM] (DECISIONS.md §4).
 */
export function installFallbackGuard(
  engine: any,
  capability: StyleCapability,
): void {
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
      // until restart. These are the only fields citeproc writes onto the
      // citation that callers read (10.0.2). It also sets `item` on each
      // citationItems entry, which reaches the caller through the shared array,
      // and `index`/`noteIndex` on the copy's properties, which nothing in
      // Zotero reads from the citation it passed.
      if ("sortedItems" in copy) live.sortedItems = copy.sortedItems;
      if (!live.citationID && copy.citationID) {
        live.citationID = copy.citationID;
      }
    }
  };
}
