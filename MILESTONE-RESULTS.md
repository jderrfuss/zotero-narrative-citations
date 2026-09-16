# Milestone results

Running record of what has been verified _in the plugin_, as opposed to in the
spikes. Companion to `SPIKE-RESULTS.md`, same conventions.

The milestone sections are kept as written at the time. Where the pre-release
audit found that a result established less than it claimed, a note marked
**Audit correction** says so in place. The audit itself is recorded in the last
section.

---

## M2 — the join

**Date:** 2026-09-16
**Verdict: PASS.** 13/13. `scripts/m2-join.js`, Zotero 10.0.2, Word 16.112.4,
macOS Tahoe 26.6.2, plugin 0.0.1, stock installed `apa.csl` (no `<intext>`).

**Question.** Spike A proved a flag persists. Spike B proved composite mode
renders. Do the two work together through Zotero's real `_updateCitations`
pipeline and produce narrative text in a Word document that survives a refresh?

**Method.** Flag one citation field out of five by writing
`properties.mode = "composite"` into its field code via the MacWord
`Field.setCode()` API, leaving the other four as controls. Refresh twice.

**Results.**

| ID      | Test                                                          | Result   |
| ------- | ------------------------------------------------------------- | -------- |
| **B1**  | `toJSON()` persists `properties.mode = "composite"`           | **PASS** |
| **B2**  | transient `"author-only"` filtered out by the validating gate | **PASS** |
| **B3**  | transient `"suppress-author"` filtered out                    | **PASS** |
| **B4**  | absent mode stays absent                                      | **PASS** |
| **B5**  | flag present in the field code before any refresh             | **PASS** |
| **B6**  | flag survives a real Zotero Refresh                           | **PASS** |
| **B7**  | rendered text changed                                         | **PASS** |
| **B8**  | text is not wrapped in parentheses                            | **PASS** |
| **B9**  | year sits inside parentheses                                  | **PASS** |
| **B10** | `plainCitation` resynced to the new text                      | **PASS** |
| **B11** | flag still present after a second refresh                     | **PASS** |
| **B12** | text stable across refreshes                                  | **PASS** |
| **B13** | no control field drifted                                      | **PASS** |

> **Audit correction.** B2 and B3 check that the gate drops a transient value,
> which is a silent loss of the flag by design (DECISIONS.md §1). They do not
> show that a transient value cannot occur.

**The rendering.**

```
before:  (Smyth & Blitshteyn, 2025)
after:    Smyth & Blitshteyn (2025)
```

This is the expected V0 result, not a defect. The ampersand is the single thing
stock `apa.csl` gets wrong without an `<intext>` element (SPIKE-RESULTS §4.8);
APA 7 wants `Smyth and Blitshteyn (2025)`. Step 5 fixes it. Everything else —
parenthesis placement, year position — is already correct.

**What this retires from the risk list.**

- **The join itself**, listed in SPIKE-RESULTS §5 as "not verified at all".
- **The spurious "citation has been modified" prompt.** It did not fire, in
  either refresh. B10 shows why: `_updateDocument` writes the new text and then
  resyncs `properties.plainCitation` from `citationField.getText()` in the same
  pass, so the comparison on the next refresh matches. Changing the field _code_
  without touching the document _text_ never trips the check.
- **RTF field writing.** Spike B rendered in `text` format and never went
  through Zotero's field writing. MacWord's output format is `rtf`, so
  `citationField.setText(formattedCitation)` took the RTF path here and produced
  clean text.
- **The live-object path (`restoreProcessorState`).** Refresh calls
  `updateFromDocument(FORCE_CITATIONS_REGENERATE)`, which sets
  `rebuildCiteprocState` when `cite.useCiteprocRs` is false — confirmed false in
  the Phase 0 output — so `restoreProcessorState()` ran and handed the _live_
  `Citation` objects to `rebuildProcessorState()`. That is path 4 in
  `DECISIONS.md` §1, and it worked with no hook of its own. The storage decision
  is validated end to end, not just in theory.

  > **Audit correction.** This overstates what B6–B13 show. Zotero discards
  > what `rebuildProcessorState()` returns, and a Refresh then re-renders every
  > citation through the `toJSON` path (path 2). So the rendered text came from
  > path 2; the test shows path 4 ran without error, not that it rendered
  > correctly.

**Still not verified.**

- Style switching, and what a flagged citation does under a numeric or note
  style.
- Document close and reopen, and a Zotero restart. _(Observed during the audit:
  the flag survived closing and reopening the document without saving, and
  several Zotero restarts.)_
- The citation dialog (`DECISIONS.md` §1 argues no patch is needed there; that
  is a source reading, still untested).
- `properties.infix` (possessives), multi-item clusters, any style but APA,
  Windows.

---

## M4 — the citation dialog

**Date:** 2026-09-16
**Verdict: PASS.** 5/5 automated, 4/4 by hand. `scripts/m4-dialog.js`, same
environment as M2, plugin 0.0.1.

**Questions.** Does the injected "Narrative citation" checkbox work end to end?
And — the one that mattered — does a _cluster-level_ flag survive Zotero 10's
citation dialog without a second monkey-patch?

**Method.** Edit an existing parenthetical citation in Word, tick the checkbox,
accept. The plugin records diagnostics from inside the dialog (including a
wrapper on `io.accept`, which runs _after_
`CitationDataManager.updateCitationObject(true)` has rebuilt the citation
object); the script prints them and re-reads the document.

**Results.**

| ID     | Test                                                | Result   |
| ------ | --------------------------------------------------- | -------- |
| **D1** | `properties.mode` survives the citation dialog      | **PASS** |
| **D2** | checkbox injected into `#itemDetails`               | **PASS** |
| **D3** | no errors during injection                          | **PASS** |
| **D4** | exactly one field flagged narrative in the document | **PASS** |
| **D5** | still exactly one after a refresh                   | **PASS** |

> **Audit note.** The `io.accept` wrapper also runs on Cancel, because
> `CitationEditInterface.cancel()` empties the citation's items and then calls
> `accept()`. So `acceptSeen` alone does not mean the dialog was accepted. D1
> cannot false-pass this way: on Cancel the flag is cleared for having no
> items.

By hand, all yes: the checkbox appears under "Omit Author"; the live preview
updates to `Houlgreave et al. (2025)` on ticking it; the document text matches
after accept; and re-opening the citation shows the box still ticked.

```
[0] mode=(none)       "(Smyth & Blitshteyn, 2025)"
[1] mode="composite"  "Houlgreave et al. (2025)"
[2] mode=(none)       "(Erb et al., 2025)"
```

**What this settles.**

- **SPIKE-RESULTS §4.3's second monkey-patch is not needed.** It budgets one for
  `BubbleItem.getCitationItem()`, which is a real strip point — for a _per-item_
  flag. `updateCitationObject()` rebuilds `citationItems` but leaves
  `properties` alone, so the cluster-level flag passes through. `properties.mode`
  was `"composite"` at `io.accept` with the box ticked. **The plugin ships one
  patch.**

  > **Audit correction.** One patch _for persistence_. The plugin as a whole
  > patches four Zotero internals and wraps two functions in the citation
  > dialog.

- **The document → dialog → document round trip works.** `modeOnOpen` was
  `"composite"` when re-opening an already-narrative citation, so the dialog
  reads the persisted flag, not just writes it.
- **The three dialog seams hold at runtime**: `io` via
  `window.arguments[0].wrappedJSObject`, `window.CitationDataManager`, and the
  `item-details-updated` event driving `CitationPreview.update()`. The live
  preview confirms composite mode works through `previewCitationCluster`
  (SPIKE-RESULTS §4.5) in the real dialog, not just in theory.

**Tested only in the "edit an existing citation" path.** Not yet exercised:

- inserting a **new** citation with the box ticked (`newField` branch of
  `Session.cite()`)
- the multi-item disable, and the stale-flag clear at accept
  (`clearedOnAccept` was false throughout)
- Escape-to-discard reverting the checkbox
- the label is a hardcoded English string; not localized

---

## M5 — `<intext>` synthesis

**Date:** 2026-09-16
**Verdict: PASS.** 9/9 (E0a–E0c offline, E1–E6 in Word). `scripts/m5-intext.js`,
same environment, plugin 0.0.1, stock installed `apa.csl`.

**Question.** Does spikeB's V3 transform, ported into the plugin and run inside
the real integration pipeline, produce APA 7's "and" instead of "&" — without
disturbing parenthetical citations?

**Results.**

| ID      | Test                                                  | Result   |
| ------- | ----------------------------------------------------- | -------- |
| **E0a** | transform produces an `<intext>`                      | **PASS** |
| **E0b** | at least one `and="symbol"` flipped                   | **PASS** |
| **E0c** | all four offline render cases correct                 | **PASS** |
| **E1**  | `<intext>` synthesized by the live integration engine | **PASS** |
| **E2**  | ampersand flipped in the live engine                  | **PASS** |
| **E3**  | target renders narrative (no wrapping parens)         | **PASS** |
| **E4**  | **target uses "and", not "&"**                        | **PASS** |
| **E5**  | parenthetical controls still use "&"                  | **PASS** |
| **E6**  | no control field drifted                              | **PASS** |

**The milestone.**

```
before step 5:  Smyth & Blitshteyn (2025)
after step 5:   Smyth and Blitshteyn (2025)
```

**The transform reproduced spikeB exactly** against the user's installed
apa.csl: cloned macro `author-short`, pushed inheritable attributes onto 3
`<name>` elements, flipped 3 `and="symbol"`. XML grew 85,656 → 89,656 bytes.

**Offline comparison** (same items through stock and transformed engines, built
in memory — this isolates a transform bug from a plumbing bug):

| case                         | stock (V0)                   | transformed (V3)              |
| ---------------------------- | ---------------------------- | ----------------------------- |
| two authors, narrative       | `Smyth & Blitshteyn (2025)`  | `Smyth and Blitshteyn (2025)` |
| two authors, parenthetical   | `(Smyth & Blitshteyn, 2025)` | `(Smyth & Blitshteyn, 2025)`  |
| three authors, narrative     | `Alvarez et al. (2023)`      | `Alvarez et al. (2023)`       |
| three authors, parenthetical | `(Alvarez et al., 2023)`     | `(Alvarez et al., 2023)`      |

E5 is the important guard: the `<intext>` block does not leak into ordinary
citations. Parenthetical output is byte-identical before and after.

**The injection point, and what was rejected.** The style XML is assembled
inside `getCiteProc` (style.js:769) and never escapes it, so one of its three
internal calls had to be intercepted.

- `CSL.Engine` — rejected twice over. Its constructor resolves `CSL.Engine.Opt`,
  `.Tmp`, `.InText` etc. off itself at construction time (citeproc.js:3794-3807),
  so replacing it breaks construction. And `PatchHelper` must never wrap a
  constructor: its disabled path is `origin.apply(this, arguments)`, which for a
  constructor returns undefined and yields an object with the wrapper's
  prototype. Since `unpatch()` deliberately leaves the wrapper installed,
  **disabling the plugin would have broken all citation rendering until
  restart.**
- `_eventToEventTitle()` — right stage, but underscore-private and
  self-documented as temporary.
- `getXML()` patched on the prototype — also feeds the CSL editor
  (tools/csledit.js:125), so it would change the style source shown when
  editing a style.

**Chosen:** patch `getCiteProc` (an ordinary method, safe for PatchHelper) and
override `getXML` **on the style instance** for the duration of that call.
`getCiteProc` contains no `await`, so the override lives and dies inside one
synchronous turn; nothing is left on a prototype to become a dead object at
teardown.

**Still not verified.**

- The bibliography, by eye. The synthesis is gated to the integration engine,
  but that same engine renders the bibliography.
- Any style other than APA. The transform is style-agnostic by construction but
  has only ever been run against apa.csl.
- Numeric and note styles — `findNamesMacro()` returns null for them, so they
  fall back silently, but that path is untested. This is step 6.

---

## Sweep — the never-executed paths from M4 and M5

**Date:** 2026-09-16
**Verdict: PASS, with one defect found that the sweep was not designed to catch.**
`scripts/m6-sweep.js`. S1–S7 and S5a–S5f all pass.

**Results.**

| ID      | Test                                                           | Result   |
| ------- | -------------------------------------------------------------- | -------- |
| **S1**  | a NEW citation accepted as narrative (`newField` branch)       | **PASS** |
| **S2**  | checkbox disabled for a multi-item citation                    | **PASS** |
| **S3**  | stale flag cleared live when the cluster gains an item         | **PASS** |
| **S4**  | Escape reverts the checkbox                                    | **PASS** |
| **S5a** | transform never throws, across all 15 installed styles         | **PASS** |
| **S5d** | parenthetical output identical stock vs transformed (7 styles) | **PASS** |
| **S5e** | narrative renders and differs from parenthetical (7 styles)    | **PASS** |
| **S5f** | ampersand fixed where a flip occurred                          | **PASS** |
| **S6**  | no errors in any dialog session                                | **PASS** |
| **S7**  | no multi-item citation flagged narrative                       | **PASS** |

> **Audit correction.** S2–S4 are read from diagnostic flags the plugin sets on
> itself, not from the dialog or the document: S3's flag is set by the same
> statement that clears the narrative flag, and S4's is set before the revert
> runs. Each passes if it held in any of the last ten dialog sessions. S7 was
> not an automated check; the script lists the fields and asks for inspection
> by eye.

### Two bugs found by reading before testing

**The live single-item guard never fired.** It asked
`io.citation.citationItems.length`, which is stale at that point:
`addItemsToCitation()` does `await CitationDataManager.addItems(...)` →
`this.updateBubbleInput()` (where the guard runs) → `await
CitationPreview.render()` — and only that last call runs
`updateCitationObject()` to sync `io.citation`. Fixed to count via
`CitationDataManager`, the dialog's live source of truth. S3 now passes.

**Macro indirection.** `findNamesMacro()` searched one level: macros referenced
directly by the citation layout. That works for apa.csl, where the layout
references `author-short` and `author-short` holds the `<names>`. It fails for
chicago-author-date.csl, whose layout references `citation-author-date-item` —
which contains no `<names>` at all, only `<text macro="author-inline"/>`. The
style fell back unnecessarily. Now breadth-first through nested macro
references, with a `seen` set so cyclic or diamond macro graphs terminate.

Also: note-class styles now skip synthesis outright (`mhra-notes` was building
an `<intext>` — inert, but meaningless in a footnote style), and Escape now
unchecks the control as well as reverting the flag.

### Style coverage, 15 installed styles

**Synthesize (7):** apa (`author-short`, 3 flips), american-political-science-association,
american-sociological-association, chicago-author-date (`author-inline`),
elsevier-harvard, harvard-cite-them-right, modern-language-association.

**Fall back (8):** american-chemical-society, american-medical-association,
ieee, nature, nlm-citation-sequence (no names-bearing macro — numeric);
chicago-notes-bibliography, chicago-shortened-notes-bibliography, mhra-notes
(note class).

Every in-text author-date style synthesizes; every numeric and note style falls
back. This is the first evidence that the transform is genuinely style-agnostic
rather than APA-shaped — SPIKE-RESULTS listed that as unverified.

> **Audit correction.** Synthesizing is not rendering correctly, and seven
> styles is a small sample. The audit rendered 1,345 supported styles from the
> CSL repository: most are fine, but some less common styles break for
> authorless references or pick the wrong macro, and APA itself printed
> "personal communication" twice. See the Audit section.

### THE DEFECT: MLA renders `[NO_PRINTED_FORM]`

```
modern-language-association   parenthetical "(Smyth and Blitshteyn)"
                              narrative     "Smyth and Blitshteyn [NO_PRINTED_FORM]"
```

MLA is author-**page**, not author-date: its citation layout is
`author-short` + locator, with no date anywhere. Composite mode renders the
author chunk, then the citation with the author suppressed — which, absent a
locator, is nothing at all. citeproc emits `[NO_PRINTED_FORM]`.

**Narrative citations are structurally meaningless for author-page styles.**
`Smith and Jones (2024)` is an author-date construct.

The sweep's L2 invariant (narrative non-empty and different from parenthetical)
was too weak to catch this: `"Smyth and Blitshteyn [NO_PRINTED_FORM]"` satisfies
both. That is a flaw in the test, not just in the code.

**Fix, for step 6:** require the citation area to render a date — a `<date>`
element or the `issued`/`original-date` variable, following macro references the
same way `findNamesMacro` does. Simulated across all 15 installed styles, this
excludes MLA and nothing else; all six genuine author-date styles keep working,
and note/numeric styles were already excluded.

### Unexplained

Session 0 recorded `itemsAtAccept: 0` for a citation that demonstrably had one
item (the document was correct afterwards, and Q7 confirmed it). The field reads
`io.citation.citationItems?.length ?? 0` inside the `io.accept` wrapper, which
runs _after_ `updateCitationObject(true)`, so it should have been 1. Diagnostic
only — no behavioural impact observed — but not understood. Worth a cross-check
field against `CitationDataManager.items.length` if it recurs.

> **Audit: explained.** Almost certainly a cancelled dialog.
> `CitationEditInterface.cancel()` sets `citationItems = []` and then calls
> `accept()`, which is the wrapper. See the note under M4.

---

## M6 — style capability detection

**Date:** 2026-09-16
**Verdict: PASS.** Both halves.
`scripts/m6-capability.js`.

**Two halves, deliberately different behaviour.** The control is _disabled with
an explanation_ when the active style cannot support narrative citations; an
already-flagged citation _falls back silently_ to an ordinary parenthetical.

> **Audit correction.** The fallback had a defect none of these tests reached:
> _editing_ a flagged citation under an unsupported style that sorts its
> citations — all five bundled numeric styles — hung the dialog on Accept and
> blocked Zotero's Word integration until restart. MLA does not sort, so the
> MLA round trip below could not show it. Fixed in the audit (DECISIONS.md §4).
> The second matters because a flag outlives the style that made it — write in
> APA, switch to MLA for submission, and no dialog is involved.

**Results.**

| ID     | Test                                                      | Result   |
| ------ | --------------------------------------------------------- | -------- |
| **F1** | no style judged supported renders broken narrative output | **PASS** |
| **F2** | modern-language-association is refused                    | **PASS** |
| **F3** | apa is still supported                                    | **PASS** |
| **Q1** | no `[NO_PRINTED_FORM]` in the document under MLA          | **PASS** |
| **Q2** | flagged citation renders as an ordinary MLA citation      | **PASS** |
| **Q3** | switching back to APA restores the narrative form         | **PASS** |
| **Q4** | control disabled under an unsupported style               | **PASS** |
| **Q5** | tooltip gives the style-specific reason (MLA _and_ IEEE)  | **PASS** |

> **Audit notes.** F1 uses the same kind of invariant as sweep L2 — narrative
> output is `[NO_PRINTED_FORM]` or empty — with one item type (a two-author
> article), on engines built directly rather than through the plugin. It cannot
> see wrong or repeated names, or failures for other item types. The script also
> computes F4–F7; their results were not recorded here.

**Q3 is the one that validates the design.** The flag survived a round trip
through an unsupported style. That is the payoff from stripping `mode` at the
_processor boundary_ rather than in the field, and from copying the citation
before stripping: `restoreProcessorState()` passes the live
`Zotero.Integration.Citation` object, so mutating it in place would have
silently deleted the user's flags the moment they switched to MLA.

**Clean separation across all 15 installed styles: 6 supported, 9 refused.**

| supported (all render `Smyth and Blitshteyn (2025)`)                                                                                           | refused                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| apa, american-political-science-association, american-sociological-association, chicago-author-date, harvard-cite-them-right, elsevier-harvard | american-chemical-society, american-medical-association, ieee, nature, nlm-citation-sequence (numeric); chicago-notes-bibliography, chicago-shortened-notes-bibliography, mhra-notes (note); modern-language-association (no date) |

**The script's "over-strict" warning was a flaw in the test, not a finding.**
It flagged the three note styles as "would have rendered fine". They would not:

```
chicago-shortened-notes   "Smyth and Blitshteyn Smyth and Blitshteyn"
mhra-notes                "Jane M. Smyth and Peter Blitshteyn, pp. Jane M. Smyth and Peter Blitshteyn, pp."
```

The author appears twice — in a note style, suppressing the author does not
remove it, because the note macro renders names by another path, so both
composite chunks contain it. The check only looked for `[NO_PRINTED_FORM]` or an
empty string and could not see this. Relabelled in the script. **Zero genuinely
over-strict refusals.**

**Q5 was checked against two styles deliberately.** MLA and IEEE are refused
for different reasons ("carries no year" vs "numbers its citations"), and both
tooltips were correct -- so the text reflects the live assessment rather than a
generic string, and `getLastCapability()` is not stale after a style switch.

> **Audit correction.** Not stale with one document open. With two documents in
> different styles, the style built last decided the checkbox in both. Fixed in
> the audit: support is now recorded per engine (`getSessionCapability()`,
> DECISIONS.md §4).

This is the second time an invariant of mine has been too weak to catch broken
output (the first being sweep L2, which MLA satisfied). Worth remembering: "the
output is non-empty and differs from the parenthetical" is a very low bar.

---

## Audit — pre-release

**Date:** 2026-09-16
**Environment:** Zotero 10.0.2, Word 16 on macOS, Better BibTeX 9.0.64 also
installed. Fixes on branch `audit-fixes`.

**Method.** An adversarial review of the plugin against the shipped Zotero
10.0.2 source (not these documents), with runtime evidence collected three ways:

- a Run JavaScript script building engines through the plugin's patched path;
- checks by hand in Word, on a copy of the test document;
- Zotero's own citeproc run offline over the CSL styles repository (2,862
  independent styles; 1,345 judged supported), rendering seven to ten item
  types per style. An XML library stood in for the browser's parser. The
  harness reproduced M5's outputs exactly.

**Found and fixed, each verified in Word.**

| Commit    | Problem                                                                                                                                                                            | Verified                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `3dc0487` | Editing a narrative citation under a sorting unsupported style (e.g. IEEE) threw in the dialog's sort and hung Word integration until restart. The flag also could not be removed. | Hang reproduced first (error at `citationDialog.js:2324`, command never finished); after the fix, Accept works and unticking removes the flag. |
| `6722e71` | A Word command could run before the plugin's patches existed (a Refresh arrived about 4 s early, behind another plugin), leaving the document's engine unpatched until restart.    | The early arrival and stale engine observed; after the fix, a deliberately stale engine is rebuilt on plugin startup and renders "and" again.  |
| `bba2edb` | One global style-support value: with two documents open, the style built last decided the checkbox in both.                                                                        | APA and IEEE documents open together, IEEE built last: checkbox enabled in APA, disabled with the numeric-style reason in IEEE.                |
| `6edba12` | APA personal communications printed the phrase twice: `S. Lee, personal communication (personal communication, 2018)`.                                                             | Letter and Interview items render `S. Lee (personal communication, 2018)` form; an interview with a URL is unchanged. Offline: no regressions. |
| `e3b9956` | Refresh merged a parenthetical citation typed directly before a narrative one into a saved narrative citation of two works.                                                        | Refresh now produces an ordinary two-item citation with no flag in the field code.                                                             |

Also changed without a Word-level trigger to test against: the dialog's
checkbox used to count citeproc's transient mode values as narrative, which the
saved field does not. It now counts only the saved value (DECISIONS.md §1).

**Observed, not changed.**

- On Word for Mac, citations are merged on Refresh only when nothing at all is
  between them; a space or a line break prevents it. A narrative citation typed
  directly before another citation is still folded into it (README).
- Word for Mac does not start Zotero itself; a Refresh with Zotero closed only
  shows an error. The startup window applies when Zotero is starting.
- Offline rendering, supported styles × seven item types: 276 renders showed
  `[NO_PRINTED_FORM]` or an error, in 200 styles — mostly authorless references
  in less common styles, plus a few styles that pick the wrong macro or have no
  year. None are bundled styles. Rules to avoid synthesis for such styles were
  measured and rejected (DECISIONS.md §6); the cases are documented in README.

**Not verified.**

- A real startup race after the startup fix, and the rebuild's wait for a
  running Word command.
- Windows, LibreOffice, Google Docs, and delayed citation updates.
- One theoretical issue left open: the flag raised while building an engine is
  a single boolean, so overlapping engine builds could clear it early (see the
  comment in `styleEngine.ts`).
