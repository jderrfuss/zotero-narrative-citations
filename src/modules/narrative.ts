/**
 * The narrative flag: where it lives and how it is read and written.
 *
 * Design decision (see DECISIONS.md §1): the flag is stored at *cluster* level,
 * in `citation.properties.mode`, using citeproc-js's own vocabulary
 * (`"composite"`). It is not a private key and not a per-citationItem key.
 *
 * Three consequences, all verified against Zotero 10.0.2 source:
 *
 *  1. `Zotero.Integration.Citation`'s constructor assigns `data.properties`
 *     wholesale, so anything persisted under `properties` is present on the
 *     live Citation object with no load-time hook.
 *  2. `citationDialog.js` rebuilds `io.citation.citationItems` field-by-field
 *     (BubbleItem.getCitationItem) but never rebuilds `io.citation.properties`
 *     -- it only sets `.unsorted`. A cluster-level flag therefore survives the
 *     citation dialog without a second monkey-patch.
 *  3. `Session.restoreProcessorState()` hands the *live* Citation objects to
 *     `rebuildProcessorState()` -> `processCitationCluster()`, bypassing
 *     `toJSON()` entirely. Storing citeproc's own key means that path needs no
 *     patch either.
 *
 * The one hazard of reusing citeproc's key is that
 * `CSL.Engine.prototype.process_CitationCluster` *mutates* `properties.mode`
 * in place ("author-only" -> "suppress-author" -> back to "composite"). A throw
 * mid-render could leave a live Citation carrying a transient value. The
 * toJSON patch therefore acts as a validating gate: only the literal string
 * "composite" is ever written back to the document, and only for a citation
 * with a single item.
 */

/** The only value of `properties.mode` this plugin ever persists. */
export const NARRATIVE_MODE = "composite";

/** Values citeproc-js may leave behind transiently mid-render. */
const TRANSIENT_MODES = ["author-only", "suppress-author"];

export interface CitationProperties {
  mode?: string;
  infix?: string;
  [key: string]: unknown;
}

export interface CitationLike {
  properties: CitationProperties;
  citationItems: Array<{ id: string | number; [key: string]: unknown }>;
}

/**
 * Is this citation flagged narrative?
 *
 * Deliberately tolerant of the transient values above, because a caller may
 * legitimately ask mid-render (e.g. the citation dialog repainting while a
 * preview is in flight).
 */
export function isNarrative(
  citation: CitationLike | undefined | null,
): boolean {
  const mode = citation?.properties?.mode;
  if (!mode) return false;
  return mode === NARRATIVE_MODE || TRANSIENT_MODES.includes(mode);
}

/**
 * Narrative rendering is only well defined for a single item. citeproc's
 * composite mode renders the first item's author, then every item with the
 * author suppressed -- which for a multi-item cluster produces
 * "Smith (2024; Jones, 2020)". The brief (§4) restricts narrative mode to
 * single-item clusters; this is where that is enforced.
 */
export function canBeNarrative(
  citation: CitationLike | undefined | null,
): boolean {
  return !!citation && citation.citationItems?.length === 1;
}

export function setNarrative(citation: CitationLike, narrative: boolean): void {
  if (!citation.properties) citation.properties = {};
  if (narrative) {
    citation.properties.mode = NARRATIVE_MODE;
  } else {
    delete citation.properties.mode;
  }
}

/**
 * The validating gate used by the toJSON patch. Returns the value to persist,
 * or undefined to persist nothing.
 */
export function modeToPersist(
  properties: CitationProperties | undefined,
): string | undefined {
  return properties?.mode === NARRATIVE_MODE ? NARRATIVE_MODE : undefined;
}
