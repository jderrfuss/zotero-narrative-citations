# Narrative Citations for Zotero

Narrative (in-text) citations for Zotero's word processor integration:

> **Smyth and Blitshteyn (2025)** showed that…

instead of Zotero's only option today:

> …as has been shown (Smyth & Blitshteyn, 2025).

Zotero has never supported this. The usual workaround is the **Omit Author**
checkbox, which renders `(2025)` and leaves you to type the names yourself — so
they aren't linked to the item, go stale when the reference changes, and get
APA's `&`/`and` rule wrong unless you remember it.

> **Status: pre-alpha, proof of concept.** It works, and it has been tested, but
> only on macOS with Word, and only by one person. Do not point it at a
> manuscript you care about without a backup.

## What it does

- Adds a **Narrative citation** checkbox to the citation dialog, next to
  Omit Author.
- Renders through citeproc-js's `composite` mode, so et al. thresholds, locators,
  and given-name and year-suffix disambiguation all behave exactly as they do in
  your normal citations.
- Gets APA 7's ampersand rule right: `&` inside parentheses, the word `and` in
  narrative form. It does this by synthesizing a CSL `<intext>` element at
  runtime from the active style's own name macro — so it is not APA-specific and
  needs no modified style files.
- Falls back silently to an ordinary parenthetical citation for styles that
  can't support narrative citations, and disables the checkbox with an
  explanation.

## Limitations, up front

**A document edited without this plugin loses its narrative citations.** They
revert to ordinary parentheticals on the next Refresh, silently. This follows
from Zotero rewriting field codes from a fixed allowlist and cannot be worked
around from a plugin. If you have co-authors, you all need it installed.

**Single references only.** A narrative citation of several works at once is
ill-defined, so the checkbox is disabled when a citation has more than one item.

**Possessives are manual.** Type the `'s` in `Smith's (2020) study` outside the
citation field.

**macOS and Word only, so far.** Windows, LibreOffice and Google Docs are
untested. So is the note editor.

## Supported styles

Any author-date style whose in-text citation names authors and shows a year.
Of the 15 styles shipped with Zotero, 6 qualify:

| Supported                                                                                                                                            | Not supported                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| APA, American Political Science Association, American Sociological Association, Chicago (author-date), Harvard (Cite Them Right), Elsevier (Harvard) | **Numeric** — IEEE, Nature, ACS, AMA, NLM<br>**Note** — Chicago (notes), MHRA<br>**Author-page** — MLA (no year to put in the parentheses) |

Unsupported styles aren't broken, just unavailable: the checkbox is disabled
with the reason, and any citation already flagged renders as an ordinary
parenthetical. The flag stays in the document, so switching back restores it.

## Install

Download the `.xpi` from Releases, then in Zotero:
**Tools → Add-ons → gear icon → Install Add-on From File…**

Requires **Zotero 10.x**. The version pin is deliberately narrow — a Zotero
update should disable this plugin rather than run unverified patches against
your manuscript.

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
line it targets. Expect breakage at some Zotero release; that's what the version
pin is for.

## Development

```bash
npm install
npm run build    # -> scaffold/build/narrative-citations.xpi
npm start        # hot-reload dev server (needs .env, see .env.example)
```

`npm run build` also runs `tools/check-manifest.mjs`, which asserts the manifest
rules Zotero enforces — it reports every manifest defect as the same unhelpful
"may be incompatible with this version of Zotero" dialog.

Anything needing Zotero's runtime is a script in `scripts/`, pasted into
**Tools → Developer → Run JavaScript** with "Run as async function" ticked.

## Build order

|     | Step                                                | Status                          |
| --- | --------------------------------------------------- | ------------------------------- |
| 1   | Scaffold, version pinning                           | done                            |
| 2   | The join: flag → processor → Word, survives refresh | **done** — 13/13                |
| 3   | Field persistence                                   | done                            |
| 4   | Citation dialog UI                                  | **done** — 5/5 plus sweep S1–S4 |
| 5   | `<intext>` synthesis (the APA ampersand)            | **done** — 9/9                  |
| 6   | Style capability detection, silent fallback         | **done** — 8/8                  |

## Documents

|                                                                                          |                                                                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [MILESTONE-RESULTS.md](MILESTONE-RESULTS.md)                                             | What has been verified in the plugin, milestone by milestone, including what hasn't. |
| [DECISIONS.md](DECISIONS.md)                                                             | Storage slot, multi-item policy, version pinning.                                    |
| [SPIKE-RESULTS.md](SPIKE-RESULTS.md)                                                     | What was verified before building, and what the original brief got wrong.            |
| [FORUM-POST-DRAFT.md](FORUM-POST-DRAFT.md)                                               | A question to the Zotero developers about field format.                              |
| [assets/zotero-narrative-citations-brief.md](assets/zotero-narrative-citations-brief.md) | The original brief. Superseded by SPIKE-RESULTS where they disagree.                 |

## Licence

AGPL-3.0-or-later, matching Zotero.
