/**
 * Citation dialog integration.
 *
 * Adds a "Narrative citation" checkbox to the item details popup, directly
 * below "Omit Author" -- deliberately, because Omit Author is the workaround
 * people currently misuse to fake narrative citations, so the real control
 * belongs beside it.
 *
 * All source references are to the shipped Zotero 10.0.2 build,
 * chrome/content/zotero/integration/.
 *
 * WHY NO MONKEY-PATCH IS NEEDED HERE
 *
 * SPIKE-RESULTS §4.3 budgets a second patch for `BubbleItem.getCitationItem()`,
 * which rebuilds each citation item field-by-field and so drops unknown keys.
 * That is real, but it only bites a *per-item* flag. Ours is cluster-level:
 * `CitationDataManager.updateCitationObject()` (citationDialog.js:2286) assigns
 * the rebuilt array to `io.citation.citationItems` and touches
 * `io.citation.properties` only to set `.unsorted`. `properties.mode` passes
 * straight through. See DECISIONS.md §1.
 *
 * This module records whether that actually held at runtime, in
 * `addon.data.dialogProbe`, so the claim is tested rather than asserted.
 *
 * THE SEAMS THIS USES, AND WHY THEY ARE SAFE
 *
 *  - `win.arguments[0].wrappedJSObject` is `io`. Set by
 *    `nsIWindowWatcher.openWindow(null, url, '', opts, io)` in
 *    integration.js:490. More reliable than the module-level `var io`.
 *  - `win.CitationDataManager` is explicitly exposed by Zotero
 *    ("Explicitly expose singletons to global window for tests",
 *    citationDialog.js:2337). Used only to count items.
 *  - Dispatching the `item-details-updated` CustomEvent on the document runs
 *    `IOManager.updateBubbleInput()` (registered citationDialog.js:1277), which
 *    ends in `CitationPreview.update()`. That is how the live preview refreshes
 *    without reaching into `CitationPreview`, which is a module-level `const`
 *    and not exposed.
 */

import {
  isNarrative,
  canBeNarrative,
  setNarrative,
  NARRATIVE_MODE,
} from "./narrative";
import { getLastCapability } from "./patches/styleEngine";
import type { UnsupportedReason } from "./intext";
import { getString } from "../utils/locale";
import type { FluentMessageId } from "../../typings/i10n";

const DIALOG_URL = "chrome://zotero/content/integration/citationDialog.xhtml";
const SPACER_ID = "narrativecite-spacer";
const ROW_ID = "narrativecite-row";
const CHECKBOX_ID = "narrativecite-checkbox";

/**
 * Fluent, with an English fallback.
 *
 * `getString` returns the message id verbatim when lookup fails, which would
 * put "narrativecite-narrative-citation-label" in the UI. This module runs in
 * the citation dialog's window rather than the main one, so rather than assume
 * the l10n registry is reachable from there, fall back to English on anything
 * that looks like an unresolved id.
 */
function text(id: FluentMessageId, fallback: string): string {
  try {
    const s = getString(id);
    return !s || s.includes(id) ? fallback : s;
  } catch {
    return fallback;
  }
}

const LABEL = () => text("narrative-citation-label", "Narrative citation");

const TOOLTIP_MULTI = () =>
  text(
    "narrative-citation-unavailable-multi",
    "Narrative citations are only available for a single reference. " +
      "Remove the others, or cite them separately.",
  );

/** One tooltip per reason the active style cannot support narrative mode. */
function tooltipForCode(code: UnsupportedReason | undefined): string {
  switch (code) {
    case "note-style":
      return text(
        "narrative-citation-unavailable-note",
        "This style puts citations in footnotes, where a narrative citation " +
          "has nowhere to go.",
      );
    case "no-names":
      return text(
        "narrative-citation-unavailable-numeric",
        "This style numbers its citations rather than naming authors, so " +
          "there is no author to put in the sentence.",
      );
    case "no-date":
      return text(
        "narrative-citation-unavailable-nodate",
        "This style's citations carry no year, so a narrative citation would " +
          "have nothing to put in the parentheses.",
      );
    default:
      return text(
        "narrative-citation-unavailable-generic",
        "Narrative citations are not available for this citation style.",
      );
  }
}

/** Windows we have injected into, so shutdown can clean them up. */
const hooked = new Set<any>();

let notification: any = null;

/** Diagnostics for the step-4 verification run; read via the plugin's api. */
export interface DialogProbe {
  when: string;
  ioReachable: boolean;
  citationDataManagerReachable: boolean;
  modeOnOpen: string | undefined;
  /** Whether the dialog opened on an empty citation, i.e. inserting a new one. */
  newCitation: boolean;
  /** Item count the last time the item details popup was opened. */
  itemCountAtPopup: number;
  /** Whether the checkbox was disabled the last time the popup was opened. */
  checkboxDisabledAtPopup?: boolean;
  /** Whether the active style supports narrative citations at all. */
  styleSupported?: boolean;
  /** Why not, when it does not. */
  styleReason?: string;
  /** Set when Escape reverted the checkbox. */
  escapeDiscarded?: boolean;
  /** Set when the flag was cleared live because the cluster stopped being single. */
  clearedOnItemChange?: boolean;
  injected: boolean;
  /**
   * Observed inside a wrapper on io.accept, i.e. *after*
   * CitationDataManager.updateCitationObject(true) has rebuilt the citation
   * object. This is the actual test of DECISIONS.md §1: if the dialog stripped
   * cluster properties, modeAtAccept would be undefined despite the box being
   * ticked.
   */
  acceptSeen?: boolean;
  checkboxAtAccept?: boolean;
  modeAtAccept?: string | undefined;
  itemCountAtAccept?: number;
  /** True if a stale narrative flag was cleared because the cluster grew. */
  clearedOnAccept?: boolean;
  errors: string[];
}

export function registerCitationDialogHook(): void {
  if (notification) return;
  notification = {
    observe(subject: any, topic: string) {
      if (topic !== "domwindowopened") return;
      const win = subject as any;
      win.addEventListener(
        "load",
        () => {
          try {
            if (win.location?.href !== DIALOG_URL) return;
            onDialogLoad(win);
          } catch (e) {
            Zotero.logError(e as Error);
          }
        },
        { once: true },
      );
    },
  };
  Services.ww.registerNotification(notification);
}

export function unregisterCitationDialogHook(): void {
  if (notification) {
    try {
      Services.ww.unregisterNotification(notification);
    } catch (e) {
      Zotero.logError(e as Error);
    }
    notification = null;
  }
  for (const win of hooked) {
    try {
      // Both the grid spacer and the control row, or a dead checkbox is left
      // behind in any dialog that happens to be open.
      win.document?.getElementById(SPACER_ID)?.remove();
      win.document?.getElementById(ROW_ID)?.remove();
    } catch {
      // Window already gone; nothing to clean up.
    }
  }
  hooked.clear();
}

function onDialogLoad(win: any): void {
  const doc = win.document;
  const probe: DialogProbe = {
    when: new Date().toISOString(),
    ioReachable: false,
    citationDataManagerReachable: false,
    modeOnOpen: undefined,
    newCitation: false,
    itemCountAtPopup: 0,
    injected: false,
    errors: [],
  };

  const io = getIO(win);
  if (!io?.citation) {
    probe.errors.push("io or io.citation unreachable from window.arguments[0]");
    recordProbe(probe);
    return;
  }
  probe.ioReachable = true;
  probe.modeOnOpen = io.citation.properties?.mode;
  probe.newCitation = (io.citation.citationItems?.length ?? 0) === 0;

  // Notes and annotations dialogs have no citation items to make narrative.
  if (io.isCitingNotes || io.isAddingAnnotations) {
    recordProbe(probe);
    return;
  }

  const details = doc.querySelector("#itemDetails .details");
  const suppressAuthor = doc.querySelector("#suppress-author-container");
  if (!details || !suppressAuthor) {
    probe.errors.push(
      "#itemDetails .details or #suppress-author-container not found -- " +
        "the citation dialog layout has changed",
    );
    recordProbe(probe);
    return;
  }

  // The .details container is a two-column grid; each row is an empty left cell
  // followed by the control. Mirror how #suppress-author-container is laid out.
  const spacer = doc.createElement("div");
  spacer.id = SPACER_ID;

  const row = doc.createElement("div");
  row.id = ROW_ID;
  row.className = "hbox";

  const checkbox = doc.createElement("input");
  checkbox.id = CHECKBOX_ID;
  checkbox.type = "checkbox";

  const label = doc.createElement("label");
  label.setAttribute("for", CHECKBOX_ID);
  label.textContent = LABEL();

  row.append(checkbox, label);
  suppressAuthor.after(spacer, row);
  probe.injected = true;

  // Mode as recorded when the popup opened, so Escape can put it back. The
  // popup's own discard path (PopupsHandler.itemDetailsWhenOpened) only knows
  // about per-item fields, so a cluster-level flag needs its own.
  let modeWhenOpened: string | undefined;
  let discard = false;

  const itemDetails = doc.querySelector("#itemDetails");

  itemDetails.addEventListener("popupshown", () => {
    modeWhenOpened = io.citation.properties?.mode;
    discard = false;
    syncControl();
  });

  // PopupsHandler uses stopPropagation(), not stopImmediatePropagation(), so a
  // second capturing listener on the same node still runs.
  doc.addEventListener(
    "keydown",
    (event: any) => {
      if (event.key !== "Escape") return;
      if (itemDetails.state !== "open") return;
      discard = true;
    },
    true,
  );

  itemDetails.addEventListener("popuphidden", () => {
    if (!discard) return;
    discard = false;
    const restoring = modeWhenOpened === NARRATIVE_MODE;
    if (isNarrative(io.citation) !== restoring) {
      probe.escapeDiscarded = true;
    }
    setNarrative(io.citation, restoring);
    // Put the control back too, not just the flag. syncControl() would fix it
    // on the next popupshown, but until then the checkbox disagrees with the
    // citation -- which is also why `checkboxAtAccept` read true in a session
    // where Escape had already reverted the mode. (Observed: sweep session 0.)
    checkbox.checked = restoring;
    notifyDialog(doc);
  });

  checkbox.addEventListener("change", () => {
    setNarrative(io.citation, checkbox.checked);
    // Refresh bubbles and the live citation preview through Zotero's own event.
    notifyDialog(doc);
    win.dialogNotPristine?.();
  });

  function syncControl() {
    // Two independent reasons the control can be unavailable. The style is
    // checked first because it is the more fundamental of the two: no amount of
    // removing items makes MLA able to render "Smyth and Blitshteyn (2025)".
    const capability = getLastCapability();
    const styleOK = capability ? capability.supported : true;
    probe.styleSupported = styleOK;
    probe.styleReason = capability?.reason;

    const count = itemCount(win, probe);
    probe.itemCountAtPopup = count;
    const countOK = count === 1;

    const allowed = styleOK && countOK;
    checkbox.disabled = !allowed;
    checkbox.checked = allowed && isNarrative(io.citation);

    // Disabled with an explanation rather than hidden: a control that vanishes
    // leaves the user wondering where it went, and the multi-item case already
    // sets this precedent.
    if (!styleOK) {
      row.title = tooltipForCode(capability?.code);
    } else if (!countOK) {
      row.title = TOOLTIP_MULTI();
    } else {
      row.title = "";
    }
    label.style.opacity = allowed ? "" : "0.5";
    probe.checkboxDisabledAtPopup = checkbox.disabled;
  }

  // Enforce the single-item rule *live*, not only at accept. Without this, a
  // citation flagged narrative and then given a second item renders
  // "Smyth (2025; Houlgreave et al., 2025)" in the live preview until accept
  // silently fixes it -- the user sees output the plugin will never produce.
  //
  // IOManager.updateBubbleInput() is the single funnel for "the items in this
  // citation changed": it is called on add, delete and move, and by the
  // `item-details-updated` listener (citationDialog.js:1277). It ends in
  // CitationPreview.update(), so clearing the flag *before* calling through
  // means the preview it triggers is already correct.
  //
  // Count items via CitationDataManager, NOT io.citation.citationItems. At this
  // point in the sequence io.citation is still stale -- addItemsToCitation()
  // does:
  //
  //     await CitationDataManager.addItems(...);   // dialog now has 2 items
  //     this.updateBubbleInput();                  // we run here
  //     await CitationPreview.render();            // only now does
  //                                                // updateCitationObject()
  //                                                // sync io.citation
  //
  // so asking io.citation how many items there are yields the pre-add count and
  // the guard never fires. (Observed: sweep Q4.)
  //
  // This must not dispatch `item-details-updated` itself -- that event calls
  // updateBubbleInput, which would re-enter here forever.
  const ioManager = win.IOManager;
  const stockUpdateBubbleInput = ioManager?.updateBubbleInput;
  if (typeof stockUpdateBubbleInput === "function") {
    ioManager.updateBubbleInput = function (this: any, ...args: unknown[]) {
      try {
        if (isNarrative(io.citation) && itemCount(win, probe) !== 1) {
          setNarrative(io.citation, false);
          probe.clearedOnItemChange = true;
          checkbox.checked = false;
        }
      } catch (e) {
        probe.errors.push(
          `updateBubbleInput guard threw: ${(e as Error).message}`,
        );
      }
      return stockUpdateBubbleInput.apply(this, args);
    };
  } else {
    probe.errors.push(
      "window.IOManager.updateBubbleInput not found -- the live single-item " +
        "guard is not installed; accept-time clearing still applies",
    );
  }

  // accept() calls CitationDataManager.updateCitationObject(true) and only then
  // io.accept(). Wrapping io.accept therefore observes the citation object
  // exactly as it will be handed back to the integration pipeline.
  const stockAccept = io.accept?.bind(io);
  if (stockAccept) {
    io.accept = (...args: unknown[]) => {
      try {
        probe.acceptSeen = true;
        probe.checkboxAtAccept = checkbox.checked;
        probe.itemCountAtAccept = io.citation.citationItems?.length ?? 0;

        // A narrative flag set while the citation had one item, then left in
        // place after a second was added, would render
        // "Smith (2024; Jones, 2020)". Narrative is only defined for a single
        // reference (DECISIONS.md §2), so drop it rather than emit that.
        if (isNarrative(io.citation) && !canBeNarrative(io.citation)) {
          setNarrative(io.citation, false);
          probe.clearedOnAccept = true;
        }

        probe.modeAtAccept = io.citation.properties?.mode;
      } catch (e) {
        probe.errors.push(`accept probe threw: ${(e as Error).message}`);
      }
      return stockAccept(...args);
    };
  }

  hooked.add(win);
  win.addEventListener("unload", () => hooked.delete(win), { once: true });

  recordProbe(probe);
}

/** Most recent first, capped -- enough to review a run of by-hand exercises. */
const PROBE_HISTORY = 10;

function recordProbe(probe: DialogProbe): void {
  addon.data.dialogProbe = probe;
  if (!addon.data.dialogProbes) addon.data.dialogProbes = [];
  addon.data.dialogProbes.unshift(probe);
  addon.data.dialogProbes.length = Math.min(
    addon.data.dialogProbes.length,
    PROBE_HISTORY,
  );
}

function getIO(win: any): any {
  try {
    return win.arguments?.[0]?.wrappedJSObject ?? win.arguments?.[0];
  } catch {
    return undefined;
  }
}

function itemCount(win: any, probe: DialogProbe): number {
  try {
    const n = win.CitationDataManager?.items?.length;
    if (typeof n === "number") {
      probe.citationDataManagerReachable = true;
      return n;
    }
  } catch {
    // fall through
  }
  // Fall back to the citation object itself if the test-only global ever goes.
  const io = getIO(win);
  return io?.citation?.citationItems?.length ?? 0;
}

function notifyDialog(doc: any): void {
  doc.dispatchEvent(
    new doc.defaultView.CustomEvent("item-details-updated", {
      bubbles: true,
      detail: {},
    }),
  );
}
