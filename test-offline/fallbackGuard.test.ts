import { expect } from "chai";
import { installFallbackGuard } from "../src/modules/fallbackGuard";
import { assessStyle } from "../src/modules/intext";
import { citation, engine, style } from "./support";

const UNSUPPORTED = {
  supported: false,
  code: "no-names",
  reason: "test",
} as const;
const SUPPORTED = { supported: true, reason: "test" } as const;

/** An IEEE engine with the guard, as the getCiteProc patch builds one. */
function guardedIEEE() {
  const e = engine(style("ieee"));
  installFallbackGuard(e, assessStyle(style("ieee")));
  return e;
}

describe("fallback guard (installFallbackGuard)", function () {
  it("is not installed for a supported style", function () {
    const e = engine(style("apa"));
    installFallbackGuard(e, SUPPORTED);
    expect(Object.prototype.hasOwnProperty.call(e, "processCitationCluster")).to
      .be.false;
  });

  it("is installed for an unsupported style", function () {
    expect(
      Object.prototype.hasOwnProperty.call(
        guardedIEEE(),
        "processCitationCluster",
      ),
    ).to.be.true;
  });

  describe("previewing a flagged citation, as the citation dialog does", function () {
    it("renders it as an ordinary citation", function () {
      const e = guardedIEEE();
      const flagged = e.previewCitationCluster(
        citation("two", true),
        [],
        [],
        "text",
      );
      const ordinary = e.previewCitationCluster(
        citation("two", false),
        [],
        [],
        "text",
      );
      expect(flagged).to.equal(ordinary);
      expect(flagged).to.not.include("NO_PRINTED_FORM");
    });

    it("keeps the flag on the caller's citation", function () {
      const live = citation("two", true);
      live.properties.infix = "'s";
      guardedIEEE().previewCitationCluster(live, [], [], "text");
      expect(live.properties.mode).to.equal("composite");
      expect(live.properties.infix).to.equal("'s");
    });

    // The IEEE hang: the dialog's sort reads io.citation.sortedItems back
    // (citationDialog.js:2324) and threw when it was left on the copy.
    it("writes sortedItems back to the caller's citation", function () {
      const live = citation("two", true);
      guardedIEEE().previewCitationCluster(live, [], [], "text");
      expect(live.sortedItems).to.be.an("array").with.lengthOf(1);
      expect(() =>
        live.sortedItems.map((entry: any) => entry[1]),
      ).to.not.throw();
    });

    it("gives the caller a citationID when it had none, as citeproc does", function () {
      const live = citation("two", true);
      guardedIEEE().processCitationCluster(live, [], []);
      expect(live.citationID).to.be.a("string").and.not.equal("");
    });

    it("does not replace an existing citationID", function () {
      const live = { citationID: "kept", ...citation("two", true) };
      guardedIEEE().processCitationCluster(live, [], []);
      expect(live.citationID).to.equal("kept");
    });
  });

  describe("processing a flagged citation into the document", function () {
    it("registers a copy without the flag, and keeps the flag on the caller's citation", function () {
      const e = guardedIEEE();
      const live = { citationID: "flagged", ...citation("two", true) };
      e.processCitationCluster(live, [], []);
      const registered = e.registry.citationreg.citationById.flagged;
      expect(registered).to.not.equal(live);
      expect(registered.properties.mode).to.equal(undefined);
      expect(live.properties.mode).to.equal("composite");
    });

    it("passes an unflagged citation through untouched", function () {
      const e = guardedIEEE();
      const live = { citationID: "plain", ...citation("two", false) };
      e.processCitationCluster(live, [], []);
      expect(e.registry.citationreg.citationById.plain).to.equal(live);
    });
  });

  it("writes back even when citeproc throws, and rethrows", function () {
    const fake: any = {
      processCitationCluster(c: any) {
        c.sortedItems = ["partial"];
        throw new Error("render failed");
      },
    };
    installFallbackGuard(fake, UNSUPPORTED);
    const live = citation("two", true);
    expect(() => fake.processCitationCluster(live, [], [])).to.throw(
      "render failed",
    );
    expect(live.sortedItems).to.deep.equal(["partial"]);
    expect(live.properties.mode).to.equal("composite");
  });
});
