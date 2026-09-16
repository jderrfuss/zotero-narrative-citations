/* =====================================================================
 * SWEEP — the paths from steps 4 and 5 that have never executed
 *
 * Five things have been built but never run:
 *   S1  inserting a NEW citation with the box ticked
 *   S2  the multi-item disable (checkbox greyed out)
 *   S3  clearing a stale flag when the citation gains a second item
 *   S4  Escape-to-discard reverting the checkbox
 *   S5  the fallback for styles that cannot support narrative citations
 *
 * S5 is fully automated below. S1-S4 need you to drive the dialog; the plugin
 * now keeps a short history of dialog sessions, so do all four exercises in a
 * row and then run this once.
 *
 * ---------------------------------------------------------------------
 * PART A — four dialog exercises, in this order
 * ---------------------------------------------------------------------
 *   Install scaffold/build/narrative-citations.xpi and RESTART Zotero.
 *   cp assets/test_document.docx spikes/sweep_working_copy.docx
 *   Open spikes/sweep_working_copy.docx in Word, front document.
 *
 *   EXERCISE 1 (S1) — new citation, narrative from the start
 *     Click at the very END of the first paragraph, after the full stop.
 *     Zotero tab -> Add/Edit Citation. Search for any item, press Return to
 *     add it as a bubble. Click the bubble, tick "Narrative citation",
 *     accept.
 *     >>> Q1: is the inserted text narrative, e.g. "Smyth and Blitshteyn
 *         (2025)" rather than "(Smyth & Blitshteyn, 2025)"? <<<
 *
 *   EXERCISE 2 (S2) — multi-item disable
 *     Cursor inside the citation you just inserted. Add/Edit Citation.
 *     Type to find a SECOND item and press Return so the citation has two
 *     bubbles. Now click the FIRST bubble.
 *     >>> Q2: is "Narrative citation" greyed out / unclickable? <<<
 *     >>> Q3: hovering the row, does a tooltip explain why? <<<
 *     Press Escape to close the dialog WITHOUT accepting.
 *
 *   EXERCISE 3 (S3) — stale flag cleared when a second item is added
 *     Cursor inside the narrative citation from exercise 1. Add/Edit Citation.
 *     Confirm the preview shows narrative text. Now add a second item.
 *     >>> Q4: does the preview go back to an ordinary parenthetical
 *         citation as soon as the second bubble appears? <<<
 *     Accept.
 *     >>> Q5: is the text in Word now an ordinary parenthetical citation? <<<
 *
 *   EXERCISE 4 (S4) — Escape discards the checkbox
 *     Cursor inside ANY plain parenthetical citation. Add/Edit Citation.
 *     Click the bubble, tick "Narrative citation" (preview should change),
 *     then press Escape ONCE to close the details popup.
 *     >>> Q6: does the preview go back to parenthetical? <<<
 *     Accept the dialog.
 *     >>> Q7: is the citation in Word still parenthetical? <<<
 *
 * ---------------------------------------------------------------------
 * PART B — then run this
 * ---------------------------------------------------------------------
 *   Run JavaScript, "Run as async function" TICKED.
 *   Answer Q1-Q7 in your reply too; the script cannot see the dialog.
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

var addon = null;

/* ------------------------------------------------------------------ */
hr('PHASE 0 — plugin state');
try {
	addon = Zotero.NarrativeCitations;
	log('plugin present   :', !!addon);
	if (addon) {
		log('  toJSON patched :', addon.data.patched);
		log('  intext patched :', addon.data.intextPatched);
		log('  probe history  :', typeof addon.api.getDialogProbes === 'function');
	}
} catch (e) { fail('PHASE 0', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 1 — S5: style capability across EVERY installed style');
// Fully offline. Runs the transform against each installed style and reports
// which get an <intext> and which fall back, and why. This is the first
// exercise of findNamesMacro()'s null path (numeric styles) and the only
// evidence so far that the transform is style-agnostic rather than
// APA-shaped.
try {
	await Zotero.Styles.init();
	const styles = Zotero.Styles.getVisible();
	log('installed visible styles:', styles.length);
	log('');

	const rows = [];
	let threw = 0;
	for (const style of styles) {
		let xml = null, r = null, err = null;
		try {
			xml = style.getXML();
			r = addon.api.synthesizeIntext(xml);
		} catch (e) {
			err = e.message;
			threw++;
		}
		rows.push({
			id: (style.styleID || '').replace('http://www.zotero.org/styles/', ''),
			cls: style.class,
			ok: r ? r.synthesized : false,
			flipped: r ? (r.flipped || 0) : 0,
			macro: r ? r.macro : null,
			reason: err ? ('THREW: ' + err) : (r ? r.reason : '?')
		});
	}

	const yes = rows.filter(r => r.ok);
	const no = rows.filter(r => !r.ok);
	log('synthesized <intext> :', yes.length);
	log('fell back            :', no.length);
	log('threw                :', threw);
	log('');
	log('RESULT S5a — nothing threw (the transform never breaks a style):', threw === 0);
	log('');

	log('-- synthesized (first 25) --');
	yes.slice(0, 25).forEach(r =>
		log('  ' + r.cls.padEnd(8) + r.id.padEnd(42) + 'macro=' + String(r.macro).padEnd(22) + 'flips=' + r.flipped));
	if (yes.length > 25) log('  ... and ' + (yes.length - 25) + ' more');
	log('');
	log('-- fell back (all) --');
	no.forEach(r => log('  ' + r.cls.padEnd(8) + r.id.padEnd(42) + r.reason));
	log('');

	// A note style rendering composite is meaningless; a numeric style has no
	// names in-text at all. Both should fall back rather than synthesize.
	const numericFellBack = no.filter(r => /ieee|vancouver|acs-nano|nature|numeric/.test(r.id));
	const noteSynthesized = yes.filter(r => r.cls === 'note');
	log('RESULT S5b — recognisably numeric styles fell back:',
		numericFellBack.length + ' of them (listed above, if installed)');
	log('RESULT S5c — note-class styles that synthesized:', noteSynthesized.length);
	if (noteSynthesized.length) {
		log('        NOTE: a note style with an <intext> is not necessarily wrong —');
		log('        <intext> is inert unless a cluster sets mode. But narrative mode');
		log('        in a footnote style is meaningless and should be offered.');
		noteSynthesized.slice(0, 10).forEach(r => log('          ' + r.id));
	}
} catch (e) { fail('PHASE 1', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 1b — does every synthesizing style still RENDER correctly?');
// A style that synthesizes but renders garbage is worse than one that falls
// back. For each style that gets an <intext>, build two in-memory engines
// (stock and transformed) and render the same two-author item both ways.
// Fully offline; nothing is written and no installed style is modified.
//
// Two invariants, checked for every style rather than hardcoding expected
// output per style:
//   L1  parenthetical output is IDENTICAL between the two engines
//       (the <intext> block must never leak into ordinary citations)
//   L2  narrative output is non-empty and differs from parenthetical
// Plus, where the transform flipped an ampersand:
//   L3  narrative has no "&" while parenthetical does
try {
	const ITEM = {
		id: 'x', type: 'article-journal', title: 'A Study of Things',
		'container-title': 'Journal of Testing', volume: '1', issue: '2', page: '1-10',
		author: [{ family: 'Smyth', given: 'Jane M.' }, { family: 'Blitshteyn', given: 'Peter' }],
		issued: { 'date-parts': [[2025]] }
	};
	function engineFor(xml) {
		const sys = new Zotero.Cite.System({});
		sys.retrieveItem = function () { return JSON.parse(JSON.stringify(ITEM)); };
		const e = new Zotero.CiteProc.CSL.Engine(sys, xml, 'en-US', false);
		e.setOutputFormat('text');
		e.opt.development_extensions.wrap_url_and_doi = true;
		e.opt.development_extensions.parse_names = false;
		return e;
	}
	var RID = 0;
	function render(engine, narrative) {
		const props = { noteIndex: 0 };
		if (narrative) props.mode = 'composite';
		const res = engine.processCitationCluster(
			{ citationID: 'sw' + (++RID), properties: props, citationItems: [{ id: 'x' }] }, [], []);
		return res[1].length ? res[1][0][1] : '';
	}

	const styles = Zotero.Styles.getVisible();
	let l1 = 0, l1fail = [], l2 = 0, l2fail = [], l3 = 0, l3fail = [];
	log('%s', '');
	log('  style                                    parenthetical                     narrative');
	log('  ' + '-'.repeat(104));
	for (const style of styles) {
		let xml, r;
		try { xml = style.getXML(); r = addon.api.synthesizeIntext(xml); }
		catch (e) { continue; }
		if (!r.synthesized) continue;
		const id = (style.styleID || '').replace('http://www.zotero.org/styles/', '');
		let stockParen, newParen, newNarr;
		try {
			const a = engineFor(xml), b = engineFor(r.xml);
			stockParen = render(a, false);
			newParen = render(b, false);
			newNarr = render(b, true);
		} catch (e) {
			log('  ' + id.padEnd(40) + 'ENGINE THREW: ' + e.message);
			l1fail.push(id); l2fail.push(id);
			continue;
		}
		const okL1 = (stockParen === newParen);
		const okL2 = (!!newNarr && newNarr !== newParen);
		if (okL1) l1++; else l1fail.push(id);
		if (okL2) l2++; else l2fail.push(id);
		let l3note = '';
		if ((r.flipped || 0) > 0) {
			const okL3 = (stockParen.indexOf('&') !== -1 && newNarr.indexOf('&') === -1);
			if (okL3) { l3++; l3note = '  [& -> and OK]'; }
			else { l3fail.push(id); l3note = '  [& FIX FAILED]'; }
		}
		log('  ' + id.padEnd(40) + JSON.stringify(newParen).padEnd(34) + JSON.stringify(newNarr) +
			(okL1 ? '' : '  [PAREN LEAKED]') + (okL2 ? '' : '  [NARRATIVE EMPTY/SAME]') + l3note);
	}
	log('');
	log('RESULT S5d — L1 parenthetical identical stock vs transformed:',
		l1fail.length === 0, l1fail.length ? '(failed: ' + l1fail.join(', ') + ')' : '(' + l1 + ' styles)');
	log('RESULT S5e — L2 narrative renders and differs from parenthetical:',
		l2fail.length === 0, l2fail.length ? '(failed: ' + l2fail.join(', ') + ')' : '(' + l2 + ' styles)');
	log('RESULT S5f — L3 ampersand fixed where the transform flipped one:',
		l3fail.length === 0, l3fail.length ? '(failed: ' + l3fail.join(', ') + ')' : '(' + l3 + ' styles)');
	log('');
	log('READ BY EYE: chicago-author-date is newly enabled by the macro-indirection');
	log('fix. Its narrative output above should look like a sensible author-year.');
} catch (e) { fail('PHASE 1b', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 2 — S1-S4: what the plugin recorded for each dialog session');
try {
	const probes = addon && addon.api.getDialogProbes ? addon.api.getDialogProbes() : [];
	log('dialog sessions recorded:', probes.length, '(most recent first)');
	if (!probes.length) {
		log('!! None. Do PART A first, in the same Zotero session as this run.');
	}
	probes.forEach((p, i) => {
		log('');
		log('  --- session ' + i + ' (' + p.when + ') ---');
		log('    injected              :', p.injected);
		log('    opened on new citation:', p.newCitation);
		log('    mode on open          :', JSON.stringify(p.modeOnOpen));
		log('    items at popup open   :', p.itemCountAtPopup);
		log('    checkbox disabled     :', p.checkboxDisabledAtPopup);
		log('    escape discarded      :', !!p.escapeDiscarded);
		log('    cleared on item change:', !!p.clearedOnItemChange);
		log('    cleared at accept     :', !!p.clearedOnAccept);
		log('    accept observed       :', !!p.acceptSeen);
		log('    checkbox at accept    :', p.checkboxAtAccept);
		log('    items at accept       :', p.itemCountAtAccept);
		log('    mode at accept        :', JSON.stringify(p.modeAtAccept));
		log('    errors                :', p.errors.length ? p.errors.join(' | ') : '(none)');
	});

	log('');
	const any = f => probes.some(f);
	log('RESULT S1 — a NEW citation was accepted as narrative:',
		any(p => p.newCitation && p.acceptSeen && p.modeAtAccept === 'composite'));
	log('RESULT S2 — the checkbox was disabled for a multi-item citation:',
		any(p => p.checkboxDisabledAtPopup === true && p.itemCountAtPopup > 1));
	log('RESULT S3 — a stale flag was cleared live when items changed:',
		any(p => p.clearedOnItemChange === true));
	log('RESULT S4 — Escape reverted the checkbox:',
		any(p => p.escapeDiscarded === true));
	log('');
	log('RESULT S6 — no errors in any session:',
		probes.every(p => p.errors.length === 0));
} catch (e) { fail('PHASE 2', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 3 — the document as it stands');
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
		let mode = '(none)', items = '?';
		const s = code.indexOf('{'), e2 = code.lastIndexOf('}');
		if (s !== -1 && e2 !== -1) {
			try {
				const o = JSON.parse(code.substring(s, e2 + 1));
				mode = (o.properties && 'mode' in o.properties) ? JSON.stringify(o.properties.mode) : '(none)';
				items = (o.citationItems || []).length;
			} catch (e) { mode = '<unparseable>'; }
		}
		if (mode === '"composite"') narrative++;
		log('  [' + n + '] items=' + items + ' mode=' + mode + '  ' + JSON.stringify(text));
		n++;
	}
	try { await doc.cleanup(); } catch (e) {}
	try { if (doc.complete) await doc.complete(); } catch (e) {}
	log('');
	log(n + ' citation field(s); ' + narrative + ' flagged narrative');
	log('');
	log('RESULT S7 — no multi-item citation is flagged narrative:');
	log('        (check the list above: any row with items>1 and mode="composite"');
	log('         is a bug — the single-item rule failed)');
} catch (e) { fail('PHASE 3', e); }

hr('END');
try { Zotero.Utilities.Internal.copyTextToClipboard(LOG.join('\n')); } catch (e) {}
return LOG.join('\n');
