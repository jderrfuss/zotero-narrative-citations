# Narrative Citations for Zotero

Narrative (in-text) citations for Zotero's word processor integration:

> **Smyth and Blitshteyn (2025)** showed that…

instead of Zotero's only option today:

> …as has been shown (Smyth & Blitshteyn, 2025).

Zotero has never supported this. The usual workaround is the **Omit Author**
checkbox, which renders `(2025)` and leaves you to type the names yourself — so
they aren't linked to the item, go stale when the reference changes, and get
APA's `&`/`and` rule wrong unless you remember it.

> **Status: pre-alpha, proof of concept.** It works, and it has been tested and
> audited, but only on macOS with Word, and only by one person. Do not point it
> at a manuscript you care about without a backup.

## What it does

- Adds a **Narrative citation** checkbox to the citation dialog, next to
  Omit Author.
- Renders through citeproc-js's `composite` mode, so et al. thresholds, locators,
  and given-name and year-suffix disambiguation follow the same rules as your
  normal citations. (Checked for APA.)
- Gets APA 7's ampersand rule right: `&` inside parentheses, the word `and` in
  narrative form. It does this by synthesizing a CSL `<intext>` element at
  runtime from the active style's own name macro, rather than hard-coding APA,
  so it needs no modified style files.
- Falls back silently to an ordinary parenthetical citation for styles that
  can't support narrative citations, and disables the checkbox with an
  explanation. A citation already marked narrative can still be unticked.

## Limitations, up front

**A document edited without this plugin loses its narrative citations.** They
revert to ordinary parentheticals on the next Refresh, silently. This follows
from Zotero rewriting field codes from a fixed allowlist and cannot be worked
around from a plugin. If you have co-authors, you all need it installed.

**Let Zotero finish starting before you use it from Word.** Zotero accepts
commands from Word a few seconds before it loads plugins — longer if other
plugins load first. A Refresh in that window runs without this plugin and
reverts the narrative citations it touches, as above. Once the plugin has
loaded, a Refresh puts right anything else that window affected, such as
narrative citations shown with `&` instead of "and".

**Single references only.** A narrative citation of several works at once is
ill-defined, so the checkbox is disabled when a citation has more than one item,
and a citation that gains a second item becomes an ordinary citation. That
includes Zotero's Refresh merging two citations typed with nothing between them
— so a narrative citation typed directly against another citation, without a
space, is merged into it and loses its narrative form.

**Possessives are manual.** Type the `'s` in `Smith's (2020) study` outside the
citation field.

**References without an author may not work as narrative citations.** In some
less common styles, a narrative citation of a reference with no author (a web
page with no byline, say, or a book with only editors) shows
`[NO_PRINTED_FORM]` or repeats the year. The styles bundled with Zotero don't do
that, but when a title stands in for the author they drop its formatting in
narrative form: APA and Harvard (Cite Them Right) lose the italics, and Chicago
(author-date) and Elsevier (Harvard) lose the quotation marks. Add the author to
the reference in Zotero, or use an ordinary citation.

**A few less common styles are wrongly offered.** Styles whose in-text
citations show no year cannot have narrative citations, and the checkbox is
normally disabled for them. A handful are not recognised — among them Chicago's
"in-text, shortened author" variants — and render `[NO_PRINTED_FORM]` in place
of the year. Use ordinary citations with those styles.

**Only tested on macOS with Word.** Nothing in the plugin is
platform-specific — it patches Zotero's integration layer, which sits above the
word-processor shims, so Windows, LibreOffice and Google Docs should work. But
"should" is not "does", and nobody has tried. Reports welcome. The note editor
is a genuinely separate problem: composite mode is not supported by
`makeCitationCluster()`, which is what the note editor uses.

## Supported styles

Author-date styles whose in-text citations name authors and show a year. The
plugin decides this automatically from the style. Of the 15 styles shipped with
Zotero, 6 qualify, and those six have been checked:

| Supported                                                                                                                                            | Not supported                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| APA, American Political Science Association, American Sociological Association, Chicago (author-date), Harvard (Cite Them Right), Elsevier (Harvard) | **Numeric** — IEEE, Nature, ACS, AMA, NLM<br>**Note** — Chicago (notes), MHRA<br>**Author-page** — MLA (no year to put in the parentheses) |

Unsupported styles aren't broken, just unavailable: the checkbox is disabled
with the reason, and any citation already flagged renders as an ordinary
parenthetical. The flag stays in the document, so switching back restores it.

The detection also runs for the thousands of other styles you can install. In
an offline check against the CSL styles repository it was right for most of
them, but see the limitations above for the less common styles it gets wrong.

## Install

Download the `.xpi` from Releases, then in Zotero:
**Tools → Plugins → gear icon → Install Plugin From File…**

### Or build it yourself

No release yet, or you'd rather build from source? Needs Node 18+:

```bash
git clone https://github.com/jderrfuss/zotero-narrative-citations.git
cd zotero-narrative-citations
npm install
npm run build
```

That produces `scaffold/build/narrative-citations.xpi`, which you install the
same way.

Requires **Zotero 10.x**. The version pin is deliberately narrow: a move to
Zotero 11 disables this plugin rather than running unverified patches against
your manuscript. Updates within 10.x do not disable it. At startup the plugin
only checks that the internals it patches still exist, not that they still
behave the same.

## Use

1. In Word, put the cursor in a citation (or where you want a new one) and use
   **Add/Edit Citation** as normal.
2. Click the citation's bubble in the dialog to open its details.
3. Tick **Narrative citation**. The preview updates immediately.
4. Accept.

The choice is stored in the document, so it survives Refresh, style changes and
reopening.

## How it works

citeproc-js — bundled in every Zotero install — has supported cluster-level
`composite` mode since 1.1.225. Nothing in Zotero ever sets it. This plugin sets
it, makes it persist, and gives the style an `<intext>` element to render it
with.

The flag is stored as `citation.properties.mode = "composite"`, citeproc's own
cluster key. See [DECISIONS.md](DECISIONS.md) §1 for why that rather than the
per-item `author-only` slot, and for the code paths the choice depends on.

No official extension point exists for Zotero's integration pipeline, so this
patches core internals — four of them, each documented in place with the source
line it targets — and wraps two functions inside the citation dialog. Expect
breakage at some Zotero release; the version pin guards against major releases
only.

## Development

```bash
npm install
npm run build          # -> scaffold/build/narrative-citations.xpi
npm run test:offline   # automated tests, no Zotero needed
npm start              # hot-reload dev server (needs .env, see .env.example)
```

`npm run test:offline` runs the tests in `test-offline/` against citeproc-js
1.4.61 from npm, with the styles bundled with Zotero as fixtures. That is the
version inside Zotero 10.0.2, but not quite the same code: Zotero's copy has
changes of its own, mostly in how it recovers from errors. In the renders
compared during the first audit, the two gave identical output. The tests cover
`<intext>` synthesis, style detection, exact narrative output for every
supported bundled style, the fallback guard, and shutdown's wait for a running
Word command (against a stand-in for Zotero). Output is checked as plain text;
the formatted RTF that Word receives is not. They do not cover Word, the
citation dialog or Zotero's internals; those are still checked by hand.

`npm run build` also runs `tools/check-manifest.mjs`, which asserts the manifest
rules Zotero enforces — it reports every manifest defect as the same unhelpful
"may be incompatible with this version of Zotero" dialog.

Anything needing Zotero's runtime is a script in `scripts/`, pasted into
**Tools → Developer → Run JavaScript** with "Run as async function" ticked.
Before a release, and after any Zotero update, run `scripts/regression.js`: it
checks the plugin inside Zotero, warns if Zotero code the plugin depends on has
changed, and prints a checklist of steps to repeat in Word. The other scripts
there are records of individual milestones.

## Build order

|     | Step                                                | Status |
| --- | --------------------------------------------------- | ------ |
| 1   | Scaffold, version pinning                           | done   |
| 2   | The join: flag → processor → Word, survives refresh | done   |
| 3   | Field persistence                                   | done   |
| 4   | Citation dialog UI                                  | done   |
| 5   | `<intext>` synthesis (the APA ampersand)            | done   |
| 6   | Style capability detection, silent fallback         | done   |
| 7   | Pre-release audit and fixes                         | done   |
| 8   | Second audit and fixes                              | done   |

What each step's checks did and did not establish is in
[MILESTONE-RESULTS.md](MILESTONE-RESULTS.md), including where they were weaker
than their pass counts suggest.

## Documents

|                                              |                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [MILESTONE-RESULTS.md](MILESTONE-RESULTS.md) | What has been verified in the plugin, milestone by milestone, including what hasn't.     |
| [DECISIONS.md](DECISIONS.md)                 | Storage slot, multi-item policy, version pinning, rendering fallback, startup, shutdown. |
| [SPIKE-RESULTS.md](SPIKE-RESULTS.md)         | What was verified before building, and what the original brief got wrong.                |

## Licence

AGPL-3.0-or-later, matching Zotero.
