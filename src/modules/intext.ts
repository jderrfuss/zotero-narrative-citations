/**
 * <intext> synthesis.
 *
 * APA 7 uses "&" inside parentheses but the word "and" in narrative form.
 * Stock apa.csl has no <intext> element, so composite mode reuses the citation
 * area's own `and="symbol"` and renders `Smith & Jones (2024)`. That single
 * character is the only thing the fallback gets wrong -- et al. threshold,
 * locator placement, given-name and year-suffix disambiguation are all already
 * correct (SPIKE-RESULTS §4.8).
 *
 * This is a port of variant V3 from `spikes/spikeB.js`, which scored 10/10.
 * The three non-obvious constraints it exists to satisfy, all established in
 * SPIKE-RESULTS §4.6 and §4.7:
 *
 *  1. **Attributes on <intext> are silently ignored.** `CSL.Engine.setOpt`
 *     routes `inheritedAttributes` only for tokens named `style`, `citation`
 *     or `bibliography`; `intext` falls through to `token.strings[name]`. So
 *     `<intext et-al-min="3">` does nothing.
 *  2. **Style-level attributes do not reach the intext area either.**
 *     `<style initialize-with=". ">` is copied into `opt`, `citation.opt` and
 *     `bibliography.opt` -- never `intext.opt`.
 *     => Everything inheritable must be written onto the <name>/<names>
 *        elements *inside* the <intext> block.
 *  3. **Macros cannot be reused across areas.** `CSL.getMacroTarget` caches by
 *     name in `state.macros[mkey]`, and every area executes the same token
 *     list. `<intext><text macro="author-short"/></intext>` therefore reuses
 *     tokens with `and="symbol"` already baked into `token.strings.and`, and
 *     can never produce "and".
 *     => The macro must be deep-cloned under a new name.
 *
 * Hence: clone the style's own names-bearing macro, push inheritable
 * attributes down onto the clone's <name> elements, flip `and="symbol"` to
 * `and="text"`, and point a new <intext> at the clone. Derived from the
 * style's own markup, so it is style-agnostic rather than APA-specific -- and
 * because it clones the style's real substitute chain (for APA: composer →
 * author → illustrator → … → editor → title), it handles films, podcasts and
 * edited volumes that a hand-written <intext> would get wrong.
 */

const CSL_NS = "http://purl.org/net/xbiblio/csl";

/** Inheritable attributes that belong on a <name> element. */
const NAME_ATTRS = [
  "et-al-min",
  "et-al-use-first",
  "et-al-subsequent-min",
  "et-al-subsequent-use-first",
  "and",
  "delimiter-precedes-last",
  "delimiter-precedes-et-al",
  "initialize",
  "initialize-with",
  "name-as-sort-order",
  "sort-separator",
];
/** Inheritable attributes that change name when pushed onto <name>. */
const NAME_RENAMED: Record<string, string> = {
  "name-form": "form",
  "name-delimiter": "delimiter",
};
/** Inheritable attributes that change name when pushed onto <names>. */
const NAMES_RENAMED: Record<string, string> = {
  "names-delimiter": "delimiter",
};

export interface SynthesisResult {
  /** The XML to hand to the engine: transformed, or the original on failure. */
  xml: string;
  /** Did we actually add an <intext>? */
  synthesized: boolean;
  /** Why not, or what we did. Human-readable; surfaced in diagnostics. */
  reason: string;
  /** Name of the macro that was cloned, when we got that far. */
  macro?: string;
  /** How many `and="symbol"` attributes were flipped to "text". */
  flipped?: number;
}

function tagged(root: any, name: string): any[] {
  // Styles in the wild are inconsistent about declaring the CSL namespace, so
  // fall back to a namespace-agnostic lookup rather than silently finding
  // nothing.
  const ns = root.getElementsByTagNameNS(CSL_NS, name);
  return Array.from(ns.length ? ns : root.getElementsByTagName(name));
}

function first(root: any, name: string): any {
  return tagged(root, name)[0];
}

const localName = (node: any): string => node?.localName ?? node?.nodeName;

/**
 * Is `node` a direct child of a <group> that also directly contains a <names>
 * element? Such a node is wording shown alongside the names, as in APA's
 * `<group delimiter=", "><names .../><text term="personal-communication"/></group>`.
 */
function accompaniesNames(node: any): boolean {
  const parent = node.parentNode;
  if (localName(parent) !== "group") return false;
  return Array.from(parent.childNodes).some(
    (child: any) => child.nodeType === 1 && localName(child) === "names",
  );
}

/**
 * Attributes inherited by the citation area, in precedence order: <style>
 * first, then <citation>, which overrides it.
 */
function collectInherited(doc: any, citation: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const src of [doc.documentElement, citation]) {
    if (!src) continue;
    for (const attr of Array.from(src.attributes) as any[]) {
      out[attr.name] = attr.value;
    }
  }
  return out;
}

/**
 * Find the macro that actually renders names for the <citation> area.
 *
 * Breadth-first from the macros the layout references, following nested
 * `<text macro="...">` references, and returning the first macro that
 * *directly* contains a <names> element.
 *
 * The indirection matters. A single-level search works for apa.csl, whose
 * citation layout references `author-short` and where `author-short` holds the
 * <names> itself. It fails for chicago-author-date.csl, whose layout references
 * `citation-author-date-item`, which contains no <names> at all -- only
 * `<text macro="author-inline"/>`, and the <names> is one level further down.
 * A single-level search finds nothing and the style falls back unnecessarily.
 * (Observed: sweep S5.)
 *
 * Breadth-first rather than depth-first so a directly referenced names macro
 * wins over a more deeply nested one.
 *
 * Returns null for styles that render no names in-text at all -- numeric styles
 * such as IEEE, Nature and Vancouver -- which is what keeps us away from them.
 */
function findNamesMacro(
  doc: any,
  citation: any,
): { name: string; element: any } | null {
  const layout = first(citation, "layout");
  if (!layout) return null;

  const macros: Record<string, any> = {};
  for (const m of tagged(doc, "macro")) {
    const n = m.getAttribute("name");
    if (n) macros[n] = m;
  }

  const queue: string[] = [];
  const seen = new Set<string>();

  const enqueueRefs = (root: any) => {
    for (const ref of tagged(root, "text")) {
      const n = ref.getAttribute("macro");
      if (n && !seen.has(n)) queue.push(n);
    }
  };

  enqueueRefs(layout);

  while (queue.length) {
    const name = queue.shift() as string;
    if (seen.has(name)) continue;
    seen.add(name);

    const macro = macros[name];
    if (!macro) continue;
    if (tagged(macro, "names").length) {
      return { name, element: macro };
    }
    // Not this one -- follow the macros it references. `seen` makes a cyclic
    // or diamond macro graph terminate.
    enqueueRefs(macro);
  }
  return null;
}

/**
 * Does the citation area render a date?
 *
 * Narrative citations are an author-**date** construct. A style whose in-text
 * citation carries no date cannot produce one: composite mode renders the
 * author chunk, then the citation with the author suppressed -- and if all that
 * remains is an optional locator, the second chunk is empty and citeproc emits
 * the literal string `[NO_PRINTED_FORM]` into the document.
 *
 * modern-language-association.csl is the case in point. Its citation layout is
 * `author-short` plus a locator, with no date anywhere, and narrative mode
 * renders `Smyth and Blitshteyn [NO_PRINTED_FORM]`. (Observed: sweep S5e, which
 * this check exists to make unnecessary -- the invariant "narrative is
 * non-empty and differs from parenthetical" was satisfied by that string.)
 *
 * Follows macro references the same way findNamesMacro does, since the date is
 * usually a macro or two down from the layout.
 */
function citationRendersADate(doc: any, citation: any): boolean {
  const layout = first(citation, "layout");
  if (!layout) return false;

  const macros: Record<string, any> = {};
  for (const m of tagged(doc, "macro")) {
    const n = m.getAttribute("name");
    if (n) macros[n] = m;
  }

  const seen = new Set<string>();
  const queue: string[] = [];

  const scan = (root: any): boolean => {
    if (tagged(root, "date").length) return true;
    for (const el of [root, ...tagged(root, "*")]) {
      const v = el.getAttribute?.("variable");
      if (!v) continue;
      const names = v.split(/\s+/);
      if (names.includes("issued") || names.includes("original-date")) {
        return true;
      }
    }
    for (const ref of tagged(root, "text")) {
      const n = ref.getAttribute("macro");
      if (n && !seen.has(n)) queue.push(n);
    }
    return false;
  };

  if (scan(layout)) return true;
  while (queue.length) {
    const name = queue.shift() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    const macro = macros[name];
    if (!macro) continue;
    if (scan(macro)) return true;
  }
  return false;
}

/**
 * Why a style cannot support narrative citations. Machine-readable, so the UI
 * can look up a localized string and diagnostics can stay in English -- these
 * were one field to begin with, which made the user-facing text impossible to
 * translate.
 */
export type UnsupportedReason =
  | "note-style"
  | "no-names"
  | "no-date"
  | "unparseable"
  | "no-citation-element"
  | "error";

export interface StyleCapability {
  /** Can this style produce a meaningful narrative citation at all? */
  supported: boolean;
  /** Set when `supported` is false. Drives the tooltip the user sees. */
  code?: UnsupportedReason;
  /** English, for logs and diagnostics. Not shown to the user. */
  reason: string;
  /** The names-bearing macro, when one was found. */
  macro?: string;
}

/**
 * Decide whether a style can support narrative citations, from its XML alone.
 *
 * Three requirements, each of which has a concrete failure behind it:
 *  - not a note-class style (a narrative citation in a footnote has nowhere to
 *    go);
 *  - the citation renders names via some macro (numeric styles do not);
 *  - the citation renders a date (see citationRendersADate above).
 */
export function assessStyle(xml: string): StyleCapability {
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.documentElement?.nodeName === "parsererror") {
      return {
        supported: false,
        code: "unparseable",
        reason: "style XML did not parse",
      };
    }
    if (doc.documentElement?.getAttribute("class") === "note") {
      return {
        supported: false,
        code: "note-style",
        reason: "note-class style: citations are footnotes",
      };
    }
    const citation = first(doc, "citation");
    if (!citation) {
      return {
        supported: false,
        code: "no-citation-element",
        reason: "style has no <citation> element",
      };
    }
    const found = findNamesMacro(doc, citation);
    if (!found) {
      return {
        supported: false,
        code: "no-names",
        reason: "no names-bearing macro in the citation layout (numeric style)",
      };
    }
    if (!citationRendersADate(doc, citation)) {
      return {
        supported: false,
        code: "no-date",
        reason: "citation renders no date (author-page style)",
        macro: found.name,
      };
    }
    return { supported: true, reason: "author-date style", macro: found.name };
  } catch (e) {
    return {
      supported: false,
      code: "error",
      reason: `could not assess style: ${(e as Error).message}`,
    };
  }
}

/**
 * Add a synthesized <intext> to a style's XML.
 *
 * Never throws. On any failure it returns the original XML with
 * `synthesized: false` and a reason -- a style we cannot handle falls back to
 * the no-<intext> rendering, which SPIKE-RESULTS §4.8 measured at 9/10 for
 * APA, rather than breaking citation rendering.
 */
export function synthesizeIntext(xml: string): SynthesisResult {
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");

    if (doc.documentElement?.nodeName === "parsererror") {
      return { xml, synthesized: false, reason: "style XML did not parse" };
    }
    if (tagged(doc, "intext").length) {
      return {
        xml,
        synthesized: false,
        reason: "style already defines <intext>; leaving it alone",
      };
    }

    // One gate for both questions, so the checkbox's tooltip and the renderer's
    // fallback can never disagree about whether a style is supported.
    const capability = assessStyle(xml);
    if (!capability.supported) {
      return { xml, synthesized: false, reason: capability.reason };
    }

    const citation = first(doc, "citation");
    if (!citation) {
      return { xml, synthesized: false, reason: "no <citation> element" };
    }

    const found = findNamesMacro(doc, citation);
    if (!found) {
      return { xml, synthesized: false, reason: "no names-bearing macro" };
    }

    const inherited = collectInherited(doc, citation);

    // Deep clone under a new name. Constraint 3 above: macros are cached
    // globally by name and built once, so the intext area cannot be given
    // different name settings without a separate macro.
    const clone = found.element.cloneNode(true);
    const cloneName = `${found.name}--zotero-narrative-intext`;
    clone.setAttribute("name", cloneName);

    // Drop literal wording that sits beside the names rather than inside them.
    // In composite mode the <intext> renders the part before the parentheses
    // and the citation renders the rest with the author suppressed; wording
    // grouped with the names in the citation area already appears in that
    // second part, so keeping it in the clone prints it twice. APA's in-text
    // format for personal communications is the case in point: its names macro
    // renders "S. Lee, personal communication", which gave
    // "S. Lee, personal communication (personal communication, 2018)".
    //
    // Only `term` and `value` text *accompanying* names is removed: a direct
    // child of a <group> that also directly contains a <names>. Everything
    // else stays --
    //  - macro and variable references, because some item types are named by
    //    something other than a <names> element (APA names legal cases by their
    //    title through a macro);
    //  - wording inside <names>, e.g. in a <substitute>, which is the name;
    //  - wording that *replaces* the names, e.g. `<else><text
    //    term="anonymous"/></else>` for authorless items, as eleven styles in
    //    the CSL repository do. Removing it broke their narrative citations for
    //    those items.
    let removedWording = 0;
    for (const text of tagged(clone, "text")) {
      if (!text.hasAttribute("term") && !text.hasAttribute("value")) continue;
      if (!accompaniesNames(text)) continue;
      text.parentNode.removeChild(text);
      removedWording++;
    }

    // Constraints 1 and 2: push everything inheritable down onto the elements
    // that will actually be read. Never overwrite an attribute the macro sets
    // for itself -- the style's own choice is more specific than what it
    // inherits.
    for (const names of tagged(clone, "names")) {
      for (const [from, to] of Object.entries(NAMES_RENAMED)) {
        if (inherited[from] !== undefined && !names.hasAttribute(to)) {
          names.setAttribute(to, inherited[from]);
        }
      }
    }

    let flipped = 0;
    const nameEls = tagged(clone, "name");
    for (const nameEl of nameEls) {
      for (const attr of NAME_ATTRS) {
        if (inherited[attr] !== undefined && !nameEl.hasAttribute(attr)) {
          nameEl.setAttribute(attr, inherited[attr]);
        }
      }
      for (const [from, to] of Object.entries(NAME_RENAMED)) {
        if (inherited[from] !== undefined && !nameEl.hasAttribute(to)) {
          nameEl.setAttribute(to, inherited[from]);
        }
      }
      // The whole point: "&" in parentheses, "and" in narrative.
      if (nameEl.getAttribute("and") === "symbol") {
        nameEl.setAttribute("and", "text");
        flipped++;
      }
    }

    found.element.parentNode.insertBefore(clone, found.element.nextSibling);

    const intext = doc.createElementNS(CSL_NS, "intext");
    const layout = doc.createElementNS(CSL_NS, "layout");
    const text = doc.createElementNS(CSL_NS, "text");
    text.setAttribute("macro", cloneName);
    layout.appendChild(text);
    intext.appendChild(layout);
    citation.parentNode.insertBefore(intext, citation.nextSibling);

    return {
      xml: new XMLSerializer().serializeToString(doc),
      synthesized: true,
      reason: `cloned macro "${found.name}"; pushed attributes onto ${nameEls.length} <name> element(s); flipped ${flipped} and="symbol"; removed ${removedWording} piece(s) of wording beside the names`,
      macro: found.name,
      flipped,
    };
  } catch (e) {
    return {
      xml,
      synthesized: false,
      reason: `synthesis threw: ${(e as Error).message}`,
    };
  }
}
