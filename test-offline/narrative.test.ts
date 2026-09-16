import { expect } from "chai";
import {
  NARRATIVE_MODE,
  canBeNarrative,
  isNarrative,
  modeToPersist,
  setNarrative,
} from "../src/modules/narrative";

const withMode = (mode?: string, items = 1): any => ({
  properties: mode === undefined ? {} : { mode },
  citationItems: Array.from({ length: items }, (_, i) => ({ id: i + 1 })),
});

describe("narrative flag", function () {
  describe("isNarrative", function () {
    it("is true only for the value that is saved", function () {
      expect(isNarrative(withMode("composite"))).to.equal(true);
      expect(modeToPersist(withMode("composite").properties)).to.equal(
        NARRATIVE_MODE,
      );
    });

    // citeproc leaves these behind only if it throws mid-render. The gate
    // drops them, so the checkbox must not show them as narrative.
    for (const transient of ["author-only", "suppress-author"]) {
      it(`is false for citeproc's transient "${transient}", which is not saved`, function () {
        expect(isNarrative(withMode(transient))).to.equal(false);
        expect(modeToPersist(withMode(transient).properties)).to.equal(
          undefined,
        );
      });
    }

    it("is false without a flag, and for missing citations", function () {
      expect(isNarrative(withMode())).to.equal(false);
      expect(isNarrative(undefined)).to.equal(false);
      expect(isNarrative(null)).to.equal(false);
      expect(isNarrative({} as any)).to.equal(false);
    });
  });

  describe("canBeNarrative", function () {
    it("requires exactly one item", function () {
      expect(canBeNarrative(withMode("composite", 0))).to.equal(false);
      expect(canBeNarrative(withMode("composite", 1))).to.equal(true);
      expect(canBeNarrative(withMode("composite", 2))).to.equal(false);
      expect(canBeNarrative(null)).to.equal(false);
    });
  });

  describe("setNarrative", function () {
    it("sets and clears the flag without touching other properties", function () {
      const c: any = {
        citationItems: [{ id: 1 }],
        properties: { unsorted: true },
      };
      setNarrative(c, true);
      expect(c.properties).to.deep.equal({ unsorted: true, mode: "composite" });
      setNarrative(c, false);
      expect(c.properties).to.deep.equal({ unsorted: true });
    });

    it("creates properties when missing", function () {
      const c: any = { citationItems: [{ id: 1 }] };
      setNarrative(c, true);
      expect(c.properties).to.deep.equal({ mode: "composite" });
    });

    it("restores a transient value to the saved one when ticked", function () {
      const c = withMode("author-only");
      setNarrative(c, true);
      expect(isNarrative(c)).to.equal(true);
    });
  });
});
