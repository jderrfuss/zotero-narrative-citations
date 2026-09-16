import { expect } from "chai";
import { assessStyle, synthesizeIntext } from "../src/modules/intext";
import { BUNDLED_STYLES, citation, engine, preview, style } from "./support";

const SUPPORTED = [
  "american-political-science-association",
  "american-sociological-association",
  "apa",
  "chicago-author-date",
  "elsevier-harvard",
  "harvard-cite-them-right",
];

const UNSUPPORTED: Record<string, string> = {
  "american-chemical-society": "no-names",
  "american-medical-association": "no-names",
  ieee: "no-names",
  nature: "no-names",
  "nlm-citation-sequence": "no-names",
  "chicago-notes-bibliography": "note-style",
  "chicago-shortened-notes-bibliography": "note-style",
  "mhra-notes": "note-style",
  "modern-language-association": "no-date",
};

const UNSUPPORTED_ENTRIES = Object.entries(UNSUPPORTED);

const ITEM_IDS = [
  "one",
  "two",
  "three",
  "edited",
  "translated",
  "letter",
  "interview",
  "interviewWithURL",
  "noAuthor",
];

/**
 * Expected narrative output for every bundled supported style.
 *
 * Reviewed by hand against each style's parenthetical output when these were
 * written (2026-09-16), not just recorded. Where the output is a known quirk
 * rather than the ideal form, a comment says so.
 */
const EXPECTED: Record<string, Record<string, string>> = {
  apa: {
    one: "Okafor (2022)",
    two: "Smyth and Blitshteyn (2025)",
    three: "Alvarez et al. (2023)",
    edited: "Ruiz and Park (2020)",
    translated: "Tolstoy (2019)",
    letter: "P. Novak (personal communication, 2017)",
    interview: "S. Lee (personal communication, 2018)",
    interviewWithURL: "Lee (2016)",
    noAuthor: "Anonymous Page (2021)",
  },
  "american-political-science-association": {
    one: "Okafor (2022)",
    two: "Smyth and Blitshteyn (2025)",
    three: "Alvarez, Brown, and Chen (2023)",
    edited: "Ruiz and Park (2020)",
    translated: "Tolstoy (2019)",
    letter: "Novak (2017)",
    interview: "Lee (2018)",
    interviewWithURL: "Lee (2016)",
    noAuthor: "Anonymous Page (2021)",
  },
  "american-sociological-association": {
    one: "Okafor (2022)",
    two: "Smyth and Blitshteyn (2025)",
    three: "Alvarez, Brown, and Chen (2023)",
    edited: "Ruiz and Park (2020)",
    translated: "Tolstoy (2019)",
    letter: "Novak (2017)",
    interview: "Lee (2018)",
    interviewWithURL: "Lee (2016)",
    noAuthor: "Anonymous Page (2021)",
  },
  "chicago-author-date": {
    one: "Okafor (2022)",
    two: "Smyth and Blitshteyn (2025)",
    three: "Alvarez et al. (2023)",
    edited: "Ruiz and Park (2020)",
    translated: "Tolstoy (2019)",
    letter: "Petra Novak (“A Letter”)",
    interview: "Sam Lee (“An Interview,” 2018)",
    interviewWithURL: "Lee (2016)",
    // Quirk: the parenthetical quotes the title, the narrative form does not.
    // citeproc's composite mode, with or without the synthesized <intext>.
    noAuthor: "Anonymous Page (2021)",
  },
  "elsevier-harvard": {
    one: "Okafor (2022)",
    two: "Smyth and Blitshteyn (2025)",
    three: "Alvarez et al. (2023)",
    edited: "Ruiz and Park (2020)",
    translated: "Tolstoy (2019)",
    letter: "Novak (2017)",
    interview: "Lee (2018)",
    interviewWithURL: "Lee (2016)",
    // Same quotation-mark quirk as chicago-author-date.
    noAuthor: "Anonymous Page (2021)",
  },
  "harvard-cite-them-right": {
    one: "Okafor (2022)",
    two: "Smyth and Blitshteyn (2025)",
    three: "Alvarez, Brown and Chen (2023)",
    edited: "Ruiz and Park (2020)",
    translated: "Tolstoy (2019)",
    letter: "Novak (2017)",
    interview: "Lee (2018)",
    interviewWithURL: "Lee (2016)",
    noAuthor: "Anonymous Page (2021)",
  },
};

// Disambiguation depends on the other citations in the document, so these
// are processed in sequence rather than previewed.
function renderSequence(ids: string[], narrativeIndex: number) {
  const e = engine(synthesizeIntext(style("apa")).xml);
  const pre: [string, number][] = [];
  const out: Record<string, string> = {};
  ids.forEach((id, i) => {
    const c = {
      citationID: `c${i}`,
      ...citation(id, i === narrativeIndex),
    };
    const [, updates] = e.processCitationCluster(c, pre, []);
    for (const [, text, citationID] of updates) out[citationID] = text;
    pre.push([c.citationID, 0]);
  });
  return out;
}

describe("intext.ts", function () {
  describe("style capability (assessStyle)", function () {
    it("covers every bundled style", function () {
      expect([...SUPPORTED, ...Object.keys(UNSUPPORTED)].sort()).to.deep.equal(
        BUNDLED_STYLES,
      );
    });

    for (const name of SUPPORTED) {
      it(`supports ${name}`, function () {
        expect(assessStyle(style(name)).supported).to.equal(true);
      });
    }

    for (const [name, code] of UNSUPPORTED_ENTRIES) {
      it(`refuses ${name} (${code})`, function () {
        const capability = assessStyle(style(name));
        expect(capability.supported).to.equal(false);
        expect(capability.code).to.equal(code);
      });
    }

    it("refuses input that is not a CSL style, without throwing", function () {
      for (const input of ["", "not xml", "<html/>", "<style><citation>"]) {
        expect(assessStyle(input).supported).to.equal(false);
      }
    });
  });

  describe("<intext> synthesis (synthesizeIntext)", function () {
    it("synthesizes for every supported bundled style", function () {
      for (const name of SUPPORTED) {
        expect(synthesizeIntext(style(name)).synthesized, name).to.equal(true);
      }
    });

    it("leaves every unsupported bundled style unchanged", function () {
      for (const name of Object.keys(UNSUPPORTED)) {
        const xml = style(name);
        const result = synthesizeIntext(xml);
        expect(result.synthesized, name).to.equal(false);
        expect(result.xml, name).to.equal(xml);
      }
    });

    it("never throws, and returns unusable input unchanged", function () {
      for (const input of ["", "not xml", "<html/>", "<style><citation>"]) {
        const result = synthesizeIntext(input);
        expect(result.synthesized).to.equal(false);
        expect(result.xml).to.equal(input);
      }
    });

    it("leaves a style that already has an <intext> unchanged", function () {
      const once = synthesizeIntext(style("apa")).xml;
      const twice = synthesizeIntext(once);
      expect(twice.synthesized).to.equal(false);
      expect(twice.xml).to.equal(once);
    });

    it("adds exactly one <intext> and one macro", function () {
      const count = (xml: string, tag: string) =>
        (xml.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length;
      for (const name of SUPPORTED) {
        const before = style(name);
        const after = synthesizeIntext(before).xml;
        expect(count(after, "intext"), name).to.equal(1);
        expect(count(after, "macro"), name).to.equal(
          count(before, "macro") + 1,
        );
      }
    });
  });

  describe("wording in the copied names macro", function () {
    // Eleven styles in the CSL repository (e.g. water-sa, iso690-author-date-cs)
    // show a term *instead of* names for authorless items. None of the bundled
    // styles do, so this is a minimal style with that shape. Removing such
    // wording from the clone made those items render [NO_PRINTED_FORM].
    const REPLACEMENT_WORDING = `<?xml version="1.0" encoding="utf-8"?>
  <style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
    <info><title>Replacement wording</title><id>test-replacement-wording</id><updated>2026-01-01T00:00:00+00:00</updated></info>
    <macro name="author-short">
      <choose>
        <if variable="author"><names variable="author"><name form="short" and="symbol"/></names></if>
        <else><text term="anonymous" form="short" text-case="capitalize-first"/></else>
      </choose>
    </macro>
    <macro name="year"><date variable="issued"><date-part name="year"/></date></macro>
    <citation>
      <layout prefix="(" suffix=")" delimiter="; ">
        <group delimiter=", "><text macro="author-short"/><text macro="year"/></group>
      </layout>
    </citation>
  </style>`;

    it("keeps wording that replaces the names", function () {
      const e = engine(synthesizeIntext(REPLACEMENT_WORDING).xml);
      expect(preview(e, "noAuthor", false)).to.equal("(Anon., 2021)");
      expect(preview(e, "noAuthor", true)).to.equal("Anon. (Anon., 2021)");
      expect(preview(e, "two", true)).to.equal("Smyth and Blitshteyn (2025)");
    });
  });

  describe("rendering with the synthesized <intext>", function () {
    for (const name of SUPPORTED) {
      describe(name, function () {
        let stock: any;
        let transformed: any;

        before(function () {
          stock = engine(style(name));
          transformed = engine(synthesizeIntext(style(name)).xml);
        });

        for (const id of ITEM_IDS) {
          it(`narrative ${id}`, function () {
            expect(preview(transformed, id, true)).to.equal(EXPECTED[name][id]);
          });
        }

        it("leaves every parenthetical citation unchanged", function () {
          for (const id of ITEM_IDS) {
            expect(preview(transformed, id, false), id).to.equal(
              preview(stock, id, false),
            );
          }
        });
      });
    }

    describe("APA", function () {
      it("uses & in parentheses and 'and' in narrative form", function () {
        const e = engine(synthesizeIntext(style("apa")).xml);
        expect(preview(e, "two", false)).to.equal("(Smyth & Blitshteyn, 2025)");
        expect(preview(e, "two", true)).to.equal("Smyth and Blitshteyn (2025)");
      });

      it("keeps given-name disambiguation in narrative form", function () {
        const out = renderSequence(
          ["smithJane", "smithRobert", "smithJane"],
          2,
        );
        expect(out).to.deep.equal({
          c0: "(J. Smith, 2020)",
          c1: "(R. Smith, 2020)",
          c2: "J. Smith (2020)",
        });
      });

      it("keeps year-suffix disambiguation in narrative form", function () {
        const out = renderSequence(["kimA", "kimB", "kimA"], 2);
        expect(out).to.deep.equal({
          c0: "(Kim, 2019a)",
          c1: "(Kim, 2019b)",
          c2: "Kim (2019a)",
        });
      });
    });
  });
});
