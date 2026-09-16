# Design decisions

Companion to `SPIKE-RESULTS.md`. Settles the two open questions in its §7, and
records the design choices made in the pre-release audit (§4–§6).
All source references are to the shipped Zotero **10.0.2** build
(`/Applications/Zotero.app/Contents/Resources/app/omni.ja`), not to the repo
trunk and not to the brief. §1 was re-checked against that source in the audit;
line numbers were corrected where they had drifted.

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

Six code paths were identified as touching a citation between the document and
the processor. Storing citeproc's own cluster key means **one** of them needs a
patch instead of three. The audit found more; see "Paths not in the table"
below.

| #   | Path                              | Source                                                                                                                                                                   | With `properties.mode` | With a private key                  |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ----------------------------------- |
| 1   | Load from field → live object     | `Citation` constructor, `integration.js:3274` — `this.properties = data.properties` wholesale                                                                            | works, no hook         | works, no hook                      |
| 2   | Live object → citeproc            | `_updateCitations()`, `integration.js:2291` — `citation = citation.toJSON()`                                                                                             | **one patch**          | one patch + a translation step      |
| 3   | Live object → field code          | `_updateDocument()`, `integration.js:1421` — `citation.serialize()`                                                                                                      | same patch             | same patch                          |
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

**Budget one monkey-patch for persistence, not two.** **Verified 2026-09-16**
(M4/D1 in `MILESTONE-RESULTS.md`): a citation flagged in the dialog arrived at
`io.accept` still carrying `properties.mode = "composite"`, after
`updateCitationObject(true)` had rebuilt the citation object. Persistence needs
one patch. (The plugin as a whole patches four internals: the other three serve
`<intext>` synthesis and the fallback for unsupported styles, §4.)

### Paths not in the table

The audit found four more. None changes the storage decision, but two needed
fixes.

- **The dialog's sort reads citeproc's output back from the citation.**
  `CitationDataManager.sort()` (`citationDialog.js:2324`) runs the live
  citation through `io.sort()` → the preview path, then reads
  `io.citation.sortedItems`. Anything that hands citeproc a _copy_ must write
  that back, or the dialog throws inside Accept and hangs. See §4.
- **Refresh merges adjacent citations.** `_processFields` (`integration.js:1216`)
  merges fields with nothing between them, keeping the _last_ field's
  properties (`mergeCitation`). That can produce a multi-item citation carrying
  the flag, which the dialog never sees. See §2.
- **Delayed citation updates.** `writeDelayedCitation()`
  (`integration.js:2386`) passes the live citation to `previewCitationCluster()`
  and writes `citation.serialize()`. Same shape as paths 6 and 3; needs no hook.
  Not tested.
- **Engine rebuilds outside a command.** `resetSessionStyles()`
  (`integration.js:225`) calls `setData` on every open session after any style
  install or update. Relevant to §4 and §5, not to storage.

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

- drops it on the way into `processCitationCluster` in `_updateCitations` →
  renders parenthetical;
- omits it from `citation.serialize()` → scrubs it from the field on write-back.

One qualification: `restoreProcessorState()` (path 4) passes the live object,
flag included, so stock citeproc can hold a narrative citation and re-render it
as one when another citation's change affects it. That text can be written to
the document, but the flag is scrubbed from the field in the same write-back, so
the next time the citation is processed it renders as an ordinary citation. The
flag is lost either way.

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
first and last assignment could strand `"author-only"` or `"suppress-author"`.

How much that matters differs by path. On path 4 a throw aborts the whole
command before anything is written. On path 6, the dialog's preview and sort
catch rendering errors, so a stranded value can stay on the dialog's citation
until Accept.

Mitigation, in the patch itself: the `toJSON` wrapper is a **validating gate** —
only the literal string `"composite"` is ever written back. A stranded transient
value is dropped and the citation is saved as an ordinary one. That is a silent
loss of the flag, accepted because the trigger (citeproc throwing mid-render) has
not been observed. The dialog's checkbox (`isNarrative()`) counts only the value
the gate saves, so it shows such a citation unticked rather than contradicting
what Accept will save; ticking it restores the flag. See `modeToPersist()` in
`src/modules/narrative.ts`; results B2/B3 in `scripts/m2-join.js` check that the
value is dropped, not that it cannot occur.

### What would change this

Only 7.2. If the Zotero developers say they intend a different slot, matching
them beats every argument above — the point of asking is to avoid a private
format. `properties.mode` is the _least_ private option available, which is part
of why it is the right bet while the question is outstanding.

---

## 2. Multi-item clusters

Narrative requires exactly one citation item (`canBeNarrative()`). citeproc's
composite mode on a multi-item cluster renders the first item's author and then
the whole cluster with authors suppressed — `Smith (2024; Jones, 2020)`. The
brief §4 already calls multi-item narrative ill-defined.

Enforced in two places, because a citation can gain items in two ways:

- **In the citation dialog**, live as items are added (so the preview never
  shows a multi-item narrative) and again at Accept.
- **In the `toJSON` gate**, for citations the dialog never sees. Refresh merges
  adjacent fields and keeps the last field's properties, so a parenthetical
  citation typed directly before a narrative one became a narrative citation of
  two works, and was saved that way. `toJSON` feeds both the processor and the
  field write-back, so one check there renders and saves it as an ordinary
  citation. (Verified in Word in the audit.)

Not handled: the reverse order. When a narrative citation is typed directly
before an ordinary one, the merge keeps the ordinary citation's properties, so
the narrative one is folded into it and its wording disappears from the
sentence. Preventing that would need a further core patch on field adjacency;
it only happens with no space between the citations, so it is documented
instead.

---

## 3. Version pinning

`strict_min_version: "10.0"`, `strict_max_version: "10.*"` in
`addon/manifest.json`.

Zotero 10.0.2 is what is installed and what every source reference here was
verified against; trunk is 11 (`SPIKE-RESULTS` §1). The brief §6 asks for pinning
so that a Zotero update disables the plugin rather than corrupting a manuscript —
with a monkey-patch on the serialiser that writes Word field codes, that is the
right trade. The pin is expected to need bumping, with a re-read of
`integration.js`, on each Zotero major.

What the pin does **not** do: `10.*` admits every 10.x release, so a minor
update runs these patches unverified. At startup the plugin only checks that the
patched functions exist, not that they behave as they did in 10.0.2. A tighter
pin (`10.0.*`) would trade that risk for the plugin being disabled by routine
updates; not done so far.

---

## 4. Fallback for unsupported styles: copy the citation, write citeproc's output back

A flag outlives the style that supported it (write in APA, switch to IEEE for
submission). Under a style that cannot render narrative citations, the flag must
be ignored when rendering but kept in the document, so switching back restores
it. So it is removed at the processor boundary: each unsupported style's engine
gets a guard on `processCitationCluster`, the method every render route goes
through, including `previewCitationCluster` and `rebuildProcessorState`.

**The guard hands citeproc a copy without the flag, not the live citation.**
Removing the flag from the live object would delete it from the document on the
next write-back. Removing it and restoring it afterwards does not work either:
citeproc keeps the object it is given and later re-renders it directly, bypassing
the guard, and a restored flag then renders `[NO_PRINTED_FORM]`.

**Then it writes back the two fields citeproc sets on that object**:
`sortedItems`, and `citationID` if the caller had none. Callers read them from
the object they passed. Without this, the citation dialog's sort found
`io.citation.sortedItems` undefined, threw inside Accept, and left the dialog
and Zotero's Word integration hung until restart. That happened when editing a
flagged citation under any unsupported style that sorts its citations, which
includes all five bundled numeric styles. (Found and fixed in the audit;
verified in Word.)

**Whether a style is supported is recorded per engine**, the value its guard was
installed with, and the citation dialog asks about the style of the document
whose command opened it. It used to be a single value for the whole plugin, so
with two documents open, the style built last decided the checkbox in both.

The guard stays on an engine after the plugin is disabled, until that engine is
rebuilt. That is deliberate: removing it would make flagged citations under
unsupported styles render `[NO_PRINTED_FORM]`. (Zotero 10.0.2 does not destroy
a plugin's code when it is disabled, so the guard keeps working.)

---

## 5. Startup: patch first, then rebuild existing engines

Zotero accepts Word commands before it starts plugins (the HTTP server starts in
`_initFull`, plugins after `initComplete`), and starts plugins one at a time,
waiting for each. In the audit a Refresh reached Zotero about 4 seconds before
this plugin's patches were installed, behind another plugin's startup. A command
in that window writes field codes without the flag, and leaves the document's
engine unpatched until Zotero restarts: `&` instead of "and", and no fallback
guard.

- **The patches are installed first in startup, without waiting for anything.**
  The plugin used to wait for Zotero's main window, which lengthened the window
  and held up every plugin loaded after it.
- **Then every open document's engine is rebuilt** through the patched path,
  after waiting for any running Word command to finish. This is the same call
  Zotero makes after a style update. It also covers installing, enabling or
  upgrading the plugin while a document is open.

The window cannot be closed from a plugin: whatever loads before it, and
Zotero's own startup, still come first. README tells users to let Zotero finish
starting.

---

## 6. `<intext>` synthesis: what is copied, and what is not handled

The synthesized `<intext>` is a clone of the style's first names-bearing macro
(`src/modules/intext.ts`). Two things were decided in the audit, from rendering
every supported style in the CSL styles repository offline with Zotero's own
citeproc.

**Wording that sits beside the names is dropped from the clone.** In composite
mode the part in parentheses already prints it, so keeping it printed it twice.
APA personal communications rendered as
`S. Lee, personal communication (personal communication, 2018)`. Only `term` and
`value` text in a `<group>` that also contains `<names>` is removed; wording that
_replaces_ the names (e.g. "Anonymous" for authorless items) stays, because
removing that broke eleven styles.

**Rules to skip synthesis for "risky" styles were measured and rejected.** A
style whose citation takes names from different macros by item type gets an
`<intext>` built from the wrong one for some items. And for authorless items, some
styles render `[NO_PRINTED_FORM]`. Measured options:

| Version                                       | `[NO_PRINTED_FORM]`/error renders | Year repeated |
| --------------------------------------------- | --------------------------------- | ------------- |
| Synthesize always (shipped)                   | 276                               | 5             |
| No `<intext>` at all                          | 71                                | 438           |
| Skip when names come from several macros      | 244                               | 11            |
| …and also skip when there is no `&` to change | 104                               | 332           |

(1,345 supported styles × 7 test items.) Skipping trades broken output for
repeated years and does nothing for the bundled styles, all of which render
correctly. So synthesis stays unconditional, and the remaining cases are
documented as limitations: authorless references in some less common styles,
and a few less common styles without a year in their in-text citations that
the capability check does not recognise.
