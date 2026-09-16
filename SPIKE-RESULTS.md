# Spike results — Narrative Citations for Zotero

**Date:** 2026-09-15
**Verdict: GO.** Both spikes pass. The approach in the brief is viable, with two
design corrections that came out of reading source rather than from the spikes.

---

## 1. Environment actually tested

|                     |                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------- |
| Zotero              | **10.0.2** (brief said 9.x)                                                         |
| citeproc-js bundled | **1.4.61**                                                                          |
| Word                | 16.112.4, macOS Tahoe 26.6.2                                                        |
| apa.csl             | user's installed copy, 85,656 bytes, **no `<intext>`**                              |
| Reference source    | `/Applications/Zotero.app/Contents/Resources/app/omni.ja` (the shipped 10.0.2 code) |
| Cross-check         | `github.com/zotero/zotero` @ `3c959e1`, version file `11.0.SOURCE`                  |

Source was read from the _shipped_ build, not the repo, because the repo trunk is
a major version ahead of what is installed. Where they differ it is noted.

---

## 2. Spike A — field round-trip

**Question.** Does an unknown property added to the citation object survive a
round trip through the Word field?

**Method.** `spikes/spikeA.js`, run in Tools → Developer → Run JavaScript against
a copy of `test_document.docx` (5 real citation fields) open in Word. Injected
`properties.zncMode` and `citationItems[0].zncNarrative` into every field via the
MacWord `Field.setCode()` API, then read back, then refreshed, then refreshed
again with a patch applied.

**Results.**

| ID     | Test                                                                              | Result                |
| ------ | --------------------------------------------------------------------------------- | --------------------- |
| —      | `Citation.toJSON()` in isolation drops `mode`, `infix`, `zncMode`, `zncNarrative` | confirmed             |
| —      | `Citation.toJSON()` keeps `suppress-author` **and `author-only`**                 | confirmed             |
| **A1** | Word preserves a foreign key in a field code                                      | **PASS** (5/5 fields) |
| **A2** | Foreign key survives a stock Zotero Refresh                                       | **FAIL** (0/5 fields) |
| **A3** | Foreign key survives with `Citation.prototype.toJSON` patched                     | **PASS** (5/5 fields) |

**Interpretation.** A2 failing is the expected, correct behaviour, not a
surprise — and not a project-killer. The loss is not passive: `_updateDocument()`
does

```js
var serializedCitation = citation.serialize();
if (serializedCitation != citation.properties.field) {
    await citationField.setCode(serializedCitation);   // writes the stripped version
}
```

so a foreign key is _actively scrubbed_ on the first refresh that touches the
citation. A3 is the decision point and it passes: a single monkey-patch of
`toJSON()` makes the flag persist end to end.

**Why one patch is worth two things.** `_updateCitations()` calls
`citation = citation.toJSON()` immediately before `processCitationCluster()`.
So the same allowlist that blocks persistence also blocks `properties.mode` from
reaching citeproc. Patching that one method fixes both.

---

## 3. Spike B — rendering

**Question.** Does synthesized `<intext>` + `mode: "composite"` produce correct APA?

**Method.** `spikes/spikeB.js`. Builds `Zotero.CiteProc.CSL.Engine` instances
in memory from the user's real installed `apa.csl` plus synthetic CSL-JSON items,
replicating the engine configuration `Zotero.Style.getCiteProc()` applies. Four
style variants × four test groups. No Word, no library access.

**Results (narrative rows; the parenthetical control passed in every variant).**

| Variant                                | two authors              | three authors                       | locator | two Smiths          | year-suffix | total     |
| -------------------------------------- | ------------------------ | ----------------------------------- | ------- | ------------------- | ----------- | --------- |
| **V0** stock, no `<intext>`            | `Smith & Jones (2024)` ✗ | ✓                                   | ✓       | ✓                   | ✓           | 9/10      |
| **V1** attrs on `<intext>` element     | ✓                        | `Alvarez, Brown, and Chen (2023)` ✗ | ✓       | `JM Smith (2020)` ✗ | ✓           | 7/10      |
| **V2** attrs on `<name>` element       | ✓                        | ✓                                   | ✓       | ✓                   | ✓           | **10/10** |
| **V3** cloned macro, attrs pushed down | ✓                        | ✓                                   | ✓       | ✓                   | ✓           | **10/10** |

All four of the required criteria pass under V3:

- two authors render `Smith and Jones (2024)` — the word, not the ampersand
- three authors collapse to `Alvarez et al. (2023)` from the first citation
- the locator sits inside the parens: `Okafor (2020, p. 5)`
- given-name disambiguation still fires: `J. M. Smith (2020)` / `R. Smith (2021)`

and the parenthetical control is unchanged throughout — `(Smith & Jones, 2024)`
still uses the ampersand, so the `<intext>` block is not leaking into normal
citations.

**V2 and V3 tie, but the tie is an artifact of the test items.** V2 is a
hand-written APA-shaped `<intext>` (`<names variable="author">` with a substitute
to one title macro). Every test item is an `article-journal` with a populated
`author`, which never exercises APA's real `author-short` substitute chain
(composer → author → illustrator → script-writer → director → guest/host →
producer → … → editor → title). V3 clones that chain wholesale, so it handles
those item types; V2 would silently render the wrong name for a film, a podcast
episode, or an edited volume. **V3 is the correct choice on generality grounds,
not on this scoreboard.**

---

## 4. What the brief got wrong

**4.1 "Current Zotero is 9.x."** It is 10.0.2; trunk is 11. Re-derive any version
pinning from the installed build.

**4.2 "No slot in the citation JSON stored in the Word field."** Not true.
`Citation.toJSON()` allowlists `author-only` per citation item today:

```js
const saveCitationItemKeys = ["locator", "label", "suppress-author", "author-only",
                              "prefix", "suffix", "ignoreRetraction"];
```

Spike A confirmed empirically that `author-only` round-trips. Nothing in Zotero
ever _sets_ it — grepping the whole tree, the only other reference is
`citeprocRsBridge.js`. So the slot exists and is already wired to citeproc; the
UI and the mode plumbing are what is missing. Same allowlist verbatim on trunk.

**4.3 There are three strip points, not one.** The brief anticipates the field
format problem but not its shape:

| #   | Location                                                                              | Effect                                                                                |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | `Citation.toJSON()` allowlists                                                        | drops unknown keys on **write-back to the field**                                     |
| 2   | `_updateCitations()` — `citation = citation.toJSON()` before `processCitationCluster` | drops unknown keys **on the way into the processor**                                  |
| 3   | `BubbleItem.getCitationItem()` in `citationDialog.js`                                 | rebuilds each item field-by-field, so **editing a citation in the dialog** drops them |

(1) and (2) are the same method, so one patch covers both. **(3) needs a second,
separate patch** and the brief does not mention it. The Zotero 10 citation dialog
is also a rewrite — `chrome/content/zotero/integration/citationDialog.js` plus a
`citationDialog/` directory of `.mjs` modules — so any UI work should be planned
against that, not against older descriptions of the dialog.

**4.4 `getCiteProc` signature.** The brief guesses
`Zotero.Styles.get(styleID).getCiteProc(locale)`. Actual:

```js
Zotero.Style.prototype.getCiteProc = function (locale, format, options = {})
```

`format` defaults to `'text'`; `options` is `{automaticJournalAbbreviations, cache}`.
More usefully, `new Zotero.CiteProc.CSL.Engine(sys, xmlString, locale, overrideLocale)`
is directly constructible — **no custom style needs to be installed** to render
with a synthesized `<intext>`. Spike B relies on this.

**4.5 "composite is only supported by `processCitationCluster()`."** Correct about
`makeCitationCluster()`, but incomplete: `previewCitationCluster()` delegates to
`processCitationCluster(…, CSL.PREVIEW)`, so composite works there too. This
matters because Zotero's live citation preview uses `previewCitationCluster`.

**4.6 The `<intext>` synthesis described in the brief does not work.** This is the
substantive correction. The brief says to write an `<intext>` block with "same
et-al settings". Variant V1 tested exactly that and scored 7/10. Two reasons,
both confirmed in source before the spike ran:

- **Attributes on `<intext>` are silently ignored.** `CSL.Engine.prototype.setOpt`
  routes `inheritedAttributes` only for tokens named `style`, `citation` or
  `bibliography`; `intext` falls through to `token.strings[name]`. And
  `CSL.Engine.InText` is constructed with `opt.inheritedAttributes = {}` which
  nothing ever fills. Hence `Alvarez, Brown, and Chen (2023)` — `et-al-min` never
  arrived.
- **Style-level attributes do not reach the area either.** `<style initialize-with=". ">`
  is copied into `opt`, `citation.opt` and `bibliography.opt` — not `intext.opt`.
  Hence `JM Smith (2020)` instead of `J. M. Smith (2020)`.

Everything inheritable must be written onto the `<name>`/`<names>` elements
_inside_ the `<intext>` block.

**4.7 Macros cannot be reused across areas.** Not mentioned in the brief at all,
and it is what forces the clone. `CSL.getMacroTarget` caches by name in
`state.macros[mkey]` and every area executes the same token list, so
`<intext><text macro="author-short"/></intext>` reuses tokens with `and="symbol"`
already baked into `token.strings.and`. Referencing the style's existing macro
can never produce "and". The macro must be deep-cloned under a new name, the
inheritable attributes pushed down onto its `<name>` elements, and `and="symbol"`
flipped to `and="text"` there. That is what V3 does and it is style-agnostic —
on apa.csl it found `author-short`, pushed attributes onto 3 `<name>` elements
and flipped 3.

**4.8 The scope of the APA fallback bug is one character.** The brief implies the
missing `<intext>` breaks APA broadly. V0 — stock apa.csl, composite mode, no
`<intext>` at all — scored 9/10: et al., locator placement, given-name
disambiguation and year-suffix all come out correct. The _only_ thing it gets
wrong is `&` where APA wants `and`. This is good news for the override table
idea in §5.5 of the brief: the fallback is a much safer default for unknown
styles than the brief assumes, so styles the heuristic can't handle can fall back
rather than be greyed out.

**4.9 Minor.** `unserialize()` lives on `Zotero.Integration.CitationField` (and
`BibliographyField`), not on the base `Zotero.Integration.Field`;
`Field.loadExisting()` picks the subclass by sniffing the code prefix.

---

## 5. Verified vs. not verified

**Verified by spike:**

- Word stores, and returns verbatim, a foreign key inside a citation field code.
- Stock Zotero strips it on refresh; a `toJSON()` patch prevents that.
- `author-only` and `suppress-author` persist through the field format today.
- Composite mode + a correctly synthesized `<intext>` produces correct APA 7
  narrative output across all four required criteria plus year-suffix.
- Parenthetical citations are unaffected by the presence of `<intext>`.
- The synthesis transform is style-agnostic in construction (derived from the
  style's own macro), though only exercised against apa.csl.

**Verified by source reading, not by spike:**

- The three strip points and which patch covers which.
- `previewCitationCluster` supports composite.
- Attribute inheritance and macro-caching behaviour (the spike then confirmed
  the observable consequences).

**Not verified at all — do these first in the build session:**

- **The join.** Spike A proved the flag persists; Spike B proved rendering works.
  The two halves have never been run together: a patched `toJSON()` putting
  `properties.mode = "composite"` into the _real_ `_updateCitations` pipeline and
  producing narrative text in a Word document. Low risk — both halves are
  verified and the seam is the same method — but it is unproven.
- The citation-dialog strip point (3). Never exercised.
- `properties.infix` (possessives), multi-item narrative clusters, note styles,
  numeric styles, style switching, and any style other than APA.
- Windows. Everything here is macOS.

---

## 6. Go / no-go

**GO.**

Spike A was the one that could kill the project and it did not. The failure mode
that would have been fatal — the field format being closed, so a narrative flag
could not be persisted at all — is not what happens. The format is open; Zotero
just rewrites it from an allowlist, and that allowlist is reachable from a
plugin. A3 demonstrated the flag surviving a real refresh of a real Word document.

Spike B removes the remaining uncertainty about the engine and the style. The
engine has everything needed and has had since long before 1.4.61. The one thing
APA genuinely gets wrong without `<intext>` is the ampersand, and the synthesis
fixes it without disturbing anything else.

**What changed in the design as a result:**

1. The `<intext>` synthesis must clone the style's names macro and push
   inheritable attributes down onto its `<name>` elements. The 12-line
   hand-written block in the brief does not work.
2. Budget for **two** monkey-patches, not one: `Citation.prototype.toJSON` and
   `BubbleItem.getCitationItem`.
3. The storage slot needs deciding rather than defaulting — see §7.1.

**The known limitation to state up front.** A document edited on a machine
without the plugin loses its narrative flags on the next refresh, silently,
reverting those citations to parenthetical. This follows directly from A2 and
cannot be engineered around from a plugin. It is a documentation and
expectation-setting problem, not a blocker, but co-authors are a normal case in
the target audience and it should be in the README before the first release.

---

## 7. Open decisions

Both of these should be settled before the persistence layer exists, because both
change what gets written into users' documents.

### 7.1 Which slot stores the narrative flag

**Options.** (a) reuse `citationItem["author-only"]`, which is already in Zotero's
allowlist and already persists unpatched; (b) introduce a new key, patched through
`toJSON()` as Spike A demonstrated.

**Recommendation: (b), a new key.** Reusing `author-only` looks attractive because
it needs no patch to persist, but it is not an inert storage slot — it is a live
processor input, and it reaches citeproc unpatched by exactly the same route.
`_updateCitations()` passes `citation.toJSON()` straight into
`processCitationCluster()`, and `author-only` is allowlisted, so on a machine
_without_ the plugin the flag still arrives at the engine. There, in
`CSL.getCitationCluster`:

```js
if (item && item["author-only"]) {
    this.tmp.suppress_decorations = true;   // layout prefix/suffix not applied
}
...
if (item["author-only"]) {
    break;                                  // stop after the first item
}
```

With stock apa.csl (no `<intext>`, so `getCite` does not switch areas) the result
is the citation rendered with **no parentheses** and truncated to the first item —
`Smith & Jones, 2024` sitting bare in the running text. That is visibly broken
output, and worse than the §6 limitation of silently reverting to parenthetical.

A separate key degrades safely instead: stock Zotero ignores it, strips it on the
next refresh, and the citation renders as an ordinary parenthetical.

**What would change this:** the answer to 7.2. If the Zotero developers say
`author-only` is the slot they intend, matching them is worth more than the
degradation behaviour — the whole point of asking is to avoid a private format.

### 7.2 The forum question (brief §9.1)

Asking the Zotero developers what field format they intend for native narrative
citations is a sharper question than the brief frames it as, because
`author-only` already exists in the allowlist and is unused. Whether they intend
that as the narrative slot or something new decides 7.1, decides whether the
plugin needs one patch or two, and decides whether documents created with the
plugin migrate cleanly when Zotero ships the feature.

Cheap, asynchronous, and the answer could invalidate a format we would otherwise
commit users to. Worth drafting and posting at the start of the build session so
an answer can arrive while the work proceeds, rather than after.

---

## 8. Artifacts

| Path                              |                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `spikes/spikeA.js`                | field round-trip, needs Word                                                                                                                                                   |
| `spikes/spikeB.js`                | rendering, standalone                                                                                                                                                          |
| `spikes/spikeA_working_copy.docx` | **dirty** — still contains injected `zncMode` / `zncNarrative` keys from Spike A phase 5, and has been refreshed twice. Delete it or re-copy from `assets/test_document.docx`. |

`assets/test_document.docx` was not modified.

Note: Spike A's Phase 2 errors by design-flaw (it instantiates the base
`Field` class, which has no `unserialize`). Harmless — Phase 5 proves the same
point. Fix or drop it if the script gets reused.
