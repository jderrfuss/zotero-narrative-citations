# Design decisions

Companion to `SPIKE-RESULTS.md`. Settles the two open questions in its §7.
All source references are to the shipped Zotero **10.0.2** build
(`/Applications/Zotero.app/Contents/Resources/app/omni.ja`), re-read this
session, not to the repo trunk and not to the brief.

---

## 1. Storage slot — where the narrative flag lives

**Decision: `citation.properties.mode = "composite"`.** Cluster-level, using
citeproc-js's own key and its own vocabulary. Not `citationItem["author-only"]`,
not a private key, not per-item at all.

SPIKE-RESULTS §7.1 framed this as a choice between `author-only` (a _citationItem_
key) and a new key. Reading the citation dialog and the processor-restore path
this session turned up a third option that is better than both, and it changes
the shape of the question: **narrative is a property of the cluster, not of an
item**, and citeproc already models it that way.

### Why cluster-level, and why this key specifically

Four code paths touch a citation between the document and the processor. Storing
citeproc's own cluster key means **one** of them needs a patch instead of three.

| #   | Path                              | Source                                                                                                                                                                   | With `properties.mode` | With a private key                  |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ----------------------------------- |
| 1   | Load from field → live object     | `Citation` constructor, `integration.js:3270` — `this.properties = data.properties` wholesale                                                                            | works, no hook         | works, no hook                      |
| 2   | Live object → citeproc            | `_updateCitations()`, `integration.js:2291` — `citation = citation.toJSON()`                                                                                             | **one patch**          | one patch + a translation step      |
| 3   | Live object → field code          | `_updateDocument()`, `integration.js:1424` — `citation.serialize()`                                                                                                      | same patch             | same patch                          |
| 4   | Refresh / style change → citeproc | `restoreProcessorState()`, `integration.js:2361` → `rebuildProcessorState()` → `processCitationCluster()` — passes the **live Citation objects**, never calls `toJSON()` | works, no hook         | **needs a third patch**             |
| 5   | Citation dialog edit              | `CitationDataManager.updateCitationObject()`, `citationDialog.js:2286` — rebuilds `citationItems` only; **`properties` is never rebuilt**, only `.unsorted` is set       | works, no hook         | works, no hook — _if_ cluster-level |
| 6   | Live preview in the dialog        | `previewFn` in `Session.cite()`, `integration.js:1583` — passes the **live Citation object** to `previewCitationCluster()`                                               | works, no hook         | needs a hook                        |

Paths 4 and 6 are not in SPIKE-RESULTS' list of three strip points. Both hand the
_live_ `Zotero.Integration.Citation` object straight to citeproc, bypassing
`toJSON()` entirely. Any private key would have to be translated into
`properties.mode` at each of them; citeproc's own key is already in the right
shape everywhere.

Path 5 is the good news on the other flagged strip point. SPIKE-RESULTS §4.3
budgets a second monkey-patch for `BubbleItem.getCitationItem()`. That patch is
only needed for a **per-item** flag. `getCitationItem()` rebuilds citation
_items_; `updateCitationObject()` assigns the rebuilt array to
`io.citation.citationItems` and leaves `io.citation.properties` alone. A
cluster-level flag passes straight through the dialog untouched.

**Budget one monkey-patch, not two.** **Verified 2026-09-16** (M4/D1 in
`MILESTONE-RESULTS.md`): a citation flagged in the dialog arrived at `io.accept`
still carrying `properties.mode = "composite"`, after
`updateCitationObject(true)` had rebuilt the citation object. The plugin ships
one patch.

### Why not `citationItem["author-only"]`

SPIKE-RESULTS §7.1 already argues this correctly and the argument stands: the key
is allowlisted, so on a machine _without_ the plugin it reaches citeproc anyway,
and `CSL.getCitationCluster` (`citeproc.js`) then sets `tmp.suppress_decorations`
and breaks after the first item — producing bare, unparenthesised, truncated text
in a co-author's document. A flag that degrades to _visibly broken output_ is
worse than one that degrades to an ordinary parenthetical citation.

### How `properties.mode` degrades without the plugin

Safely, and identically to any private key. `mode` is **not** in
`saveProperties`, so stock Zotero:

- drops it on the way into `processCitationCluster` → renders parenthetical;
- omits it from `citation.serialize()` → scrubs it from the field on write-back.

That is exactly the known limitation in SPIKE-RESULTS §6 — no better, no worse.

### The one hazard, and the mitigation

`CSL.Engine.prototype.process_CitationCluster` (`citeproc.js:7829`) **mutates
`properties.mode` in place**:

```js
citation.properties.mode = "author-only"; // render firstChunk
citation.properties.mode = "suppress-author"; // render thirdChunk
citation.properties.mode = "composite"; // restore
```

On paths 2 and 3 this is harmless — `toJSON()` hands citeproc a fresh copy each
time. On paths 4 and 6 it mutates the **live** object, so a throw between the
first and last assignment could strand `"author-only"` or `"suppress-author"` on
a citation that then gets serialised.

Mitigation, one line, in the patch itself: the `toJSON` wrapper is a **validating
gate** — only the literal string `"composite"` is ever written back. A stranded
transient value is dropped, the citation degrades to parenthetical, and the user
re-flags it. See `modeToPersist()` in `src/modules/narrative.ts` and results
B2/B3 in `scripts/m2-join.js`.

### What would change this

Only 7.2. If the Zotero developers say they intend a different slot, matching
them beats every argument above — the point of asking is to avoid a private
format. `properties.mode` is the _least_ private option available, which is part
of why it is the right bet while the question is outstanding.

---

## 2. Multi-item clusters

Enforced at `canBeNarrative()`: narrative requires exactly one citation item.
citeproc's composite mode on a multi-item cluster renders the first item's author
and then the whole cluster with authors suppressed — `Smith (2024; Jones, 2020)`.
The brief §4 already calls multi-item narrative ill-defined; this is where that
is made concrete.

---

## 3. Version pinning

`strict_min_version: "10.0"`, `strict_max_version: "10.*"` in
`addon/manifest.json`.

Zotero 10.0.2 is what is installed and what every source reference here was
verified against; trunk is 11 (`SPIKE-RESULTS` §1). The brief §6 asks for pinning
so that a Zotero update disables the plugin rather than corrupting a manuscript —
with a monkey-patch on the serialiser that writes Word field codes, that is the
right trade. The pin is deliberately narrow and expected to need bumping, with a
re-read of `integration.js`, on each Zotero major.
