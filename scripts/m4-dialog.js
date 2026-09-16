/* =====================================================================
 * MILESTONE 4 — THE CITATION DIALOG
 *
 * Two questions:
 *   1. Does the "Narrative citation" checkbox work — set it, see the live
 *      preview change, accept, and get narrative text in the document?
 *   2. Does a cluster-level flag actually survive the dialog?
 *
 * (2) is the one that matters. DECISIONS.md §1 claims no second monkey-patch
 * is needed, because CitationDataManager.updateCitationObject() rebuilds
 * io.citation.citationItems but never rebuilds io.citation.properties. That is
 * a source reading of citationDialog.js:2286 and has never been tested.
 * SPIKE-RESULTS §4.3 assumed the opposite and budgeted a patch for it.
 *
 * THIS SCRIPT DOES NOT DRIVE THE DIALOG. You drive it; the plugin records what
 * happened, and this prints the recording. So there are two parts.
 *
 * ---------------------------------------------------------------------
 * PART A — do this by hand first
 * ---------------------------------------------------------------------
 *   1. Install the new build:
 *        scaffold/build/narrative-citations.xpi
 *      Restart Zotero afterwards so the old build is fully gone.
 *   2. Make a fresh working copy — do NOT reuse the m2 one, it already has a
 *      narrative citation in field 0:
 *        cp assets/test_document.docx spikes/m4_working_copy.docx
 *   3. Open spikes/m4_working_copy.docx in Word, front document.
 *   4. Put the cursor inside the SECOND citation — "(Houlgreave et al., 2025)".
 *   5. Word: Zotero tab -> Add/Edit Citation.
 *   6. In the dialog, CLICK THE BUBBLE to open the item details popup.
 *
 *      >>> Is there a "Narrative citation" checkbox under "Omit Author"? <<<
 *
 *   7. Tick it. Watch the citation preview at the bottom of the dialog.
 *      (If you don't see a preview pane, click the preview toggle button in
 *      the bottom bar.)
 *
 *      >>> Does the preview change to "Houlgreave et al. (2025)"? <<<
 *
 *   8. Press Return / click the accept button.
 *
 *      >>> Does the text in Word become "Houlgreave et al. (2025)"? <<<
 *
 *   9. Now re-open that same citation (cursor inside it, Add/Edit Citation),
 *      click the bubble again.
 *
 *      >>> Is the checkbox still ticked? <<<
 *
 *      Close the dialog with the accept button (not Escape).
 *
 * ---------------------------------------------------------------------
 * PART B — then run this
 * ---------------------------------------------------------------------
 *   Zotero -> Tools -> Developer -> Run JavaScript
 *   TICK "Run as async function". Paste this file, Run, paste output back.
 *
 *   It reads the diagnostics the plugin recorded during the LAST dialog you
 *   opened, then re-reads the document to confirm what was written.
 *
 * Answer the four >>> questions <<< above in your reply as well — the script
 * cannot see the checkbox or the preview.
 * ===================================================================== */

var LOG = [];
function log(...a) {
	LOG.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
}
function hr(t) { LOG.push(''); LOG.push('======== ' + t + ' ========'); }
function fail(phase, e) {
	log('!! ' + phase + ' THREW: ' + (e && e.message ? e.message : String(e)));
	if (e && e.stack) log('   ' + String(e.stack).split('\n').slice(0, 5).join('\n   '));
}

const MACWORD_TEMPLATE_VERSION = 2;
const NARRATIVE = 'composite';

function extractJSON(code) {
	let s = code.indexOf('{');
	let e = code.lastIndexOf('}');
	if (s === -1 || e === -1) return null;
	return code.substring(s, e + 1);
}

/* ------------------------------------------------------------------ */
hr('PHASE 0 — plugin state');
var addon = null;
try {
	addon = Zotero.NarrativeCitations;
	log('Zotero.NarrativeCitations present :', !!addon);
	if (!addon) {
		log('!! Plugin not loaded. Install scaffold/build/narrative-citations.xpi');
	} else {
		log('  data.initialized :', addon.data.initialized);
		log('  data.patched     :', addon.data.patched);
		log('  api.getDialogProbe present:', typeof addon.api.getDialogProbe === 'function');
	}
	// If Services was not reachable from the plugin sandbox, the dialog hook
	// would have failed to register and no probe would ever be recorded.
	log('');
	log('(If every probe field below is missing, the most likely cause is that');
	log(' the dialog hook failed to register — check Help > Debug Output Logging.)');
} catch (e) { fail('PHASE 0', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 1 — what the plugin recorded during the last citation dialog');
var probe = null;
try {
	probe = addon && addon.api.getDialogProbe && addon.api.getDialogProbe();
	if (!probe) {
		log('!! No probe recorded.');
		log('!! Either no citation dialog has been opened since Zotero started,');
		log('!! or the dialog hook did not register. Do PART A first.');
	} else {
		log('recorded at                    :', probe.when);
		log('');
		log('-- assumptions this design rests on --');
		log('io reachable via window.arguments:', probe.ioReachable);
		log('window.CitationDataManager reachable:', probe.citationDataManagerReachable);
		log('checkbox injected into #itemDetails :', probe.injected);
		log('');
		log('-- state when the dialog opened --');
		log('properties.mode on open        :', JSON.stringify(probe.modeOnOpen));
		log('citation item count on open    :', probe.itemCountOnOpen);
		log('');
		log('-- state at accept, AFTER updateCitationObject(true) rebuilt it --');
		log('accept was observed            :', !!probe.acceptSeen);
		log('checkbox ticked at accept      :', probe.checkboxAtAccept);
		log('citation item count at accept  :', probe.itemCountAtAccept);
		log('properties.mode at accept      :', JSON.stringify(probe.modeAtAccept));
		log('stale flag cleared (multi-item):', !!probe.clearedOnAccept);
		log('');
		log('errors recorded                :', probe.errors.length ? probe.errors.join(' | ') : '(none)');
		log('');

		// D1 is the real test. If the dialog stripped cluster properties,
		// modeAtAccept would be undefined despite the box being ticked.
		if (probe.acceptSeen && probe.checkboxAtAccept && probe.itemCountAtAccept === 1) {
			log('RESULT D1 — properties.mode survived the citation dialog:',
				probe.modeAtAccept === NARRATIVE);
			log('        (this is the DECISIONS.md §1 claim: no second monkey-patch needed)');
		} else if (probe.acceptSeen && !probe.checkboxAtAccept) {
			log('RESULT D1 — INCONCLUSIVE: the checkbox was not ticked at accept.');
			log('        Re-do PART A and make sure the box is ticked before accepting.');
		} else {
			log('RESULT D1 — INCONCLUSIVE: no accept observed. Was the dialog cancelled?');
		}
		log('RESULT D2 — checkbox was injected      :', !!probe.injected);
		log('RESULT D3 — no errors during injection :', probe.errors.length === 0);
	}
} catch (e) { fail('PHASE 1', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 2 — what is actually in the document now');
try {
	const mod = ChromeUtils.importESModule(
		'chrome://zotero-macword-integration/content/zoteroMacWordIntegration.mjs');
	const app = new mod.Application();
	const doc = await app.getActiveDocument();
	const fields = await doc.getFields('Field');
	let n = 0, narrative = 0;
	for (let f of fields) {
		const code = await f.getCode();
		if (code.indexOf('CSL_CITATION') === -1) continue;
		let text = '';
		try { text = await f.getText(); } catch (e) { text = '<getText failed>'; }
		const js = extractJSON(code);
		let mode = '(none)';
		if (js) {
			try {
				const o = JSON.parse(js);
				mode = (o.properties && 'mode' in o.properties)
					? JSON.stringify(o.properties.mode) : '(none)';
			} catch (e) { mode = '<unparseable>'; }
		}
		if (mode === '"composite"') narrative++;
		log('  [' + n + '] mode=' + mode + '  text=' + JSON.stringify(text));
		n++;
	}
	try { await doc.cleanup(); } catch (e) {}
	try { if (doc.complete) await doc.complete(); } catch (e) {}
	log('');
	log(n + ' citation field(s); ' + narrative + ' flagged narrative');
	log('');
	log('RESULT D4 — exactly one field is flagged narrative:', narrative === 1);
	log('');
	log('READ BY EYE: the flagged field should read like');
	log('  Houlgreave et al. (2025)     <- correct for this stage');
	log('  (Houlgreave et al., 2025)    <- the flag did not take');
} catch (e) { fail('PHASE 2', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 3 — does it survive a refresh from the dialog-set flag?');
try {
	log('running a refresh ...');
	await Zotero.Integration.execCommand('MacWord16', 'refresh', null, MACWORD_TEMPLATE_VERSION);
	log('refresh complete');
	const mod = ChromeUtils.importESModule(
		'chrome://zotero-macword-integration/content/zoteroMacWordIntegration.mjs');
	const app = new mod.Application();
	const doc = await app.getActiveDocument();
	const fields = await doc.getFields('Field');
	let n = 0, narrative = 0;
	for (let f of fields) {
		const code = await f.getCode();
		if (code.indexOf('CSL_CITATION') === -1) continue;
		let text = '';
		try { text = await f.getText(); } catch (e) { text = '<getText failed>'; }
		const js = extractJSON(code);
		let mode = '(none)';
		if (js) {
			try {
				const o = JSON.parse(js);
				mode = (o.properties && 'mode' in o.properties)
					? JSON.stringify(o.properties.mode) : '(none)';
			} catch (e) {}
		}
		if (mode === '"composite"') narrative++;
		log('  [' + n + '] mode=' + mode + '  text=' + JSON.stringify(text));
		n++;
	}
	try { await doc.cleanup(); } catch (e) {}
	try { if (doc.complete) await doc.complete(); } catch (e) {}
	log('');
	log('RESULT D5 — still exactly one narrative field after refresh:', narrative === 1);
} catch (e) { fail('PHASE 3', e); }

hr('END');

try { Zotero.Utilities.Internal.copyTextToClipboard(LOG.join('\n')); } catch (e) {}
return LOG.join('\n');
