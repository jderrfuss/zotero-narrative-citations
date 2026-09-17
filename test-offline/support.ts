/**
 * Shared set-up for the offline tests: citeproc-js and a DOM, without Zotero.
 *
 * citeproc@2.4.63 from npm is processor version 1.4.61, the version bundled in
 * Zotero 10.0.2. Rendering the fixture styles and items through it and through
 * the citeproc.js inside Zotero 10.0.2 gave identical output (10,872 renders
 * across 302 styles, checked during the pre-release audit). The code is not
 * identical: Zotero's copy has changes of its own, e.g. previewCitationCluster
 * restores its state when rendering throws, which npm's does not. Tests of
 * what happens after an error say nothing about Zotero's copy.
 *
 * Zotero parses style XML with Firefox's DOMParser; here @xmldom/xmldom stands
 * in for it. Structural results match, but parse-error behaviour differs.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DOMParser as XmlDomParser, XMLSerializer } from "@xmldom/xmldom";
// @ts-expect-error -- citeproc ships no type declarations
import CSL from "citeproc";

// intext.ts uses the browser globals, as it does inside Zotero.
(globalThis as any).DOMParser = class {
  parseFromString(source: string, type: string) {
    return new XmlDomParser({ onError: () => {} }).parseFromString(
      source,
      type as any,
    );
  }
};
(globalThis as any).XMLSerializer = XMLSerializer;

export { CSL };

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const LOCALE = readFileSync(`${FIXTURES}locales-en-US.xml`, "utf8");

/** Style XML by file name without `.csl`, e.g. `style("apa")`. */
export function style(name: string): string {
  return readFileSync(`${FIXTURES}styles/${name}.csl`, "utf8");
}

export const BUNDLED_STYLES = readdirSync(`${FIXTURES}styles`)
  .filter((f) => f.endsWith(".csl"))
  .map((f) => f.slice(0, -".csl".length))
  .sort();

/** CSL-JSON test items, keyed by id. */
export const ITEMS: Record<string, any> = {
  one: {
    type: "article-journal",
    title: "One Author",
    author: [{ family: "Okafor", given: "Ngozi" }],
    issued: { "date-parts": [[2022]] },
  },
  two: {
    type: "article-journal",
    title: "Two Authors",
    author: [
      { family: "Smyth", given: "Jane" },
      { family: "Blitshteyn", given: "Peter" },
    ],
    issued: { "date-parts": [[2025]] },
  },
  three: {
    type: "article-journal",
    title: "Three Authors",
    author: [
      { family: "Alvarez", given: "Ana" },
      { family: "Brown", given: "Bo" },
      { family: "Chen", given: "Cy" },
    ],
    issued: { "date-parts": [[2023]] },
  },
  edited: {
    type: "book",
    title: "Edited Volume",
    editor: [
      { family: "Ruiz", given: "Rosa" },
      { family: "Park", given: "Min" },
    ],
    issued: { "date-parts": [[2020]] },
  },
  translated: {
    type: "book",
    title: "Translated Work",
    author: [{ family: "Tolstoy", given: "Leo" }],
    translator: [{ family: "Garnett", given: "Constance" }],
    issued: { "date-parts": [[2019]] },
  },
  // Zotero's Letter, E-mail and Instant Message item types.
  letter: {
    type: "personal_communication",
    title: "A Letter",
    author: [{ family: "Novak", given: "Petra" }],
    issued: { "date-parts": [[2017]] },
  },
  // Zotero's Interview; its Interviewee becomes the CSL author.
  interview: {
    type: "interview",
    title: "An Interview",
    author: [{ family: "Lee", given: "Sam" }],
    issued: { "date-parts": [[2018]] },
  },
  interviewWithURL: {
    type: "interview",
    title: "An Online Interview",
    author: [{ family: "Lee", given: "Sam" }],
    URL: "https://example.org/interview",
    issued: { "date-parts": [[2016]] },
  },
  noAuthor: {
    type: "webpage",
    title: "Anonymous Page",
    issued: { "date-parts": [[2021]] },
  },
  // For disambiguation: same family name and year as each other.
  smithJane: {
    type: "article-journal",
    title: "Smith One",
    author: [{ family: "Smith", given: "Jane" }],
    issued: { "date-parts": [[2020]] },
  },
  smithRobert: {
    type: "article-journal",
    title: "Smith Two",
    author: [{ family: "Smith", given: "Robert" }],
    issued: { "date-parts": [[2020]] },
  },
  // For disambiguation: same author and year as each other.
  kimA: {
    type: "article-journal",
    title: "Kim Alpha",
    author: [{ family: "Kim", given: "Min-jun" }],
    issued: { "date-parts": [[2019]] },
  },
  kimB: {
    type: "article-journal",
    title: "Kim Beta",
    author: [{ family: "Kim", given: "Min-jun" }],
    issued: { "date-parts": [[2019]] },
  },
};

for (const [id, item] of Object.entries(ITEMS)) item.id = id;

/** A citeproc engine configured the way Zotero's getCiteProc configures one. */
export function engine(xml: string, format = "text"): any {
  const sys = {
    retrieveLocale: () => LOCALE,
    retrieveItem: (id: string) => structuredClone(ITEMS[id]),
  };
  const e = new CSL.Engine(sys, xml, "en-US", false);
  e.setOutputFormat(format);
  e.opt.development_extensions.wrap_url_and_doi = false;
  e.opt.development_extensions.parse_names = false;
  return e;
}

export function citation(id: string, narrative: boolean, extra = {}): any {
  return {
    properties: narrative
      ? { noteIndex: 0, mode: "composite" }
      : { noteIndex: 0 },
    citationItems: [{ id, ...extra }],
  };
}

/** Render one citation without registering it, as the dialog's preview does. */
export function preview(e: any, id: string, narrative: boolean): string {
  return e.previewCitationCluster(citation(id, narrative), [], [], "text");
}
