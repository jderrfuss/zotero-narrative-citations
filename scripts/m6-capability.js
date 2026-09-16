/* =====================================================================
 * MILESTONE 6 — STYLE CAPABILITY DETECTION
 *
 * Two halves, deliberately different:
 *   UI      the checkbox is DISABLED with an explanation when the active
 *           style cannot support narrative citations (not hidden)
 *   RENDER  a citation already flagged narrative falls back SILENTLY to an
 *           ordinary parenthetical when the style cannot support it, and the
 *           flag stays in the document so switching back restores it
 *
 * The render half matters because a flag outlives the style that made it:
 * write in APA with narrative citations, switch to MLA for submission, and
 * nothing goes near the dialog. Before this step every one of those citations
 * would have rendered "[NO_PRINTED_FORM]".
 *
 * BEFORE YOU RUN
 *   1. Install scaffold/build/narrative-citations.xpi, RESTART Zotero.
 *   2. cp assets/test_document.docx spikes/m6_working_copy.docx
 *   3. Open spikes/m6_working_copy.docx in Word, FRONT document.
 *      Leave it on APA for now.
 *
 * Phase 1 is offline and needs nothing. Phases 2-5 drive Word and ask you to
 * change the document's citation style twice.
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
const TARGET_FIELD = 0;
var addon = null;

function extractJSON(code) {
	let s = code.indexOf('{'), e = code.lastIndexOf('}');
	return (s === -1 || e === -1) ? null : code.substring(s, e + 1);
}

/* ------------------------------------------------------------------ */
hr('PHASE 0 — plugin state');
try {
	addon = Zotero.NarrativeCitations;
	log('plugin present    :', !!addon);
	if (addon) {
		log('  toJSON patched  :', addon.data.patched);
		log('  intext patched  :', addon.data.intextPatched);
		log('  assessStyle     :', typeof addon.api.assessStyle === 'function');
		log('  getLastCapability:', typeof addon.api.getLastCapability === 'function');
		if (typeof addon.api.assessStyle !== 'function') {
			log('!! Old build still loaded. Install the new XPI and restart Zotero.');
		}
	}
} catch (e) { fail('PHASE 0', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 1 — capability + render, every installed style, offline');
// The decisive test: for each style, does assessStyle() agree with what
// composite mode actually produces? A style judged supported must render a
// clean narrative citation; one judged unsupported must be one we refuse.
try {
	await Zotero.Styles.init();
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
			{ citationID: 'm6_' + (++RID), properties: props, citationItems: [{ id: 'x' }] }, [], []);
		return res[1].length ? res[1][0][1] : '';
	}

	const styles = Zotero.Styles.getVisible();
	let supported = [], refused = [], bad = [], missed = [];
	log('');
	log('  style                                    cap   narrative output');
	log('  ' + '-'.repeat(96));
	for (const style of styles) {
		const id = (style.styleID || '').replace('http://www.zotero.org/styles/', '');
		let xml, cap, out = '(not rendered)';
		try {
			xml = style.getXML();
			cap = addon.api.assessStyle(xml);
		} catch (e) {
			log('  ' + id.padEnd(40) + 'THREW ' + e.message);
			continue;
		}
		// Render narrative through the style as the plugin would use it.
		try {
			const r = addon.api.synthesizeIntext(xml);
			out = render(engineFor(r.xml), true);
		} catch (e) {
			out = 'ENGINE THREW: ' + e.message;
		}
		const broken = out.indexOf('NO_PRINTED_FORM') !== -1 || out.trim() === '';
		if (cap.supported) {
			supported.push(id);
			if (broken) bad.push(id + ' -> ' + JSON.stringify(out));
		} else {
			refused.push(id);
			if (!broken) missed.push(id + ' -> ' + JSON.stringify(out));
		}
		log('  ' + id.padEnd(40) + (cap.supported ? 'YES ' : 'no  ') + '  ' + JSON.stringify(out));
		if (!cap.supported) log('  ' + ' '.repeat(40) + '      reason: ' + cap.reason);
	}
	log('');
	log('supported:', supported.length, ' refused:', refused.length);
	log('');
	log('RESULT F1 — no SUPPORTED style renders broken narrative output:',
		bad.length === 0, bad.length ? JSON.stringify(bad) : '');
	log('        (this is the MLA bug: it was supported and rendered [NO_PRINTED_FORM])');
	log('RESULT F2 — modern-language-association is now refused:',
		refused.indexOf('modern-language-association') !== -1);
	log('RESULT F3 — apa is still supported:',
		supported.indexOf('apa') !== -1);
	log('');
	if (missed.length) {
		log('Refused styles whose output did not trip the crude broken-output check.');
		log('This is NOT a list of over-strict refusals — INSPECT BY EYE. The check');
		log('only looks for [NO_PRINTED_FORM] or an empty string, and note styles');
		log('fail in a way it cannot see: suppressing the author does not remove it');
		log('from a note macro, so both composite chunks contain it and the author');
		log('appears twice ("Smyth and Blitshteyn Smyth and Blitshteyn").');
		missed.forEach(m => log('  ' + m));
	}
} catch (e) { fail('PHASE 1', e); }

/* ------------------------------------------------------------------ */
var app = null;
async function openDoc() {
	const mod = ChromeUtils.importESModule(
		'chrome://zotero-macword-integration/content/zoteroMacWordIntegration.mjs');
	if (!app) app = new mod.Application();
	return app.getActiveDocument();
}
async function readFields() {
	const doc = await openDoc();
	const fields = await doc.getFields('Field');
	const out = [];
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
				mode = (o.properties && 'mode' in o.properties) ? JSON.stringify(o.properties.mode) : '(none)';
			} catch (e) { mode = '<unparseable>'; }
		}
		out.push({ mode, text });
	}
	try { await doc.cleanup(); } catch (e) {}
	try { if (doc.complete) await doc.complete(); } catch (e) {}
	return out;
}
function describe(rows, label) {
	log(label + ':');
	rows.forEach((r, i) => log('  [' + i + '] mode=' + r.mode + '  ' + JSON.stringify(r.text)));
}
async function injectMode(index) {
	const doc = await openDoc();
	const fields = await doc.getFields('Field');
	let seen = -1, done = false;
	for (let f of fields) {
		const code = await f.getCode();
		if (code.indexOf('CSL_CITATION') === -1) continue;
		seen++;
		if (seen !== index) continue;
		const js = extractJSON(code);
		if (!js) break;
		const obj = JSON.parse(js);
		obj.properties = obj.properties || {};
		obj.properties.mode = 'composite';
		await f.setCode('ITEM CSL_CITATION ' + JSON.stringify(obj));
		done = true;
		break;
	}
	try { await doc.cleanup(); } catch (e) {}
	try { if (doc.complete) await doc.complete(); } catch (e) {}
	return done;
}

hr('PHASE 2 — flag field 0 narrative under APA');
var apaState = null;
try {
	const ok = await injectMode(TARGET_FIELD);
	log('injected mode="composite":', ok);
	await Zotero.Integration.execCommand('MacWord16', 'refresh', null, MACWORD_TEMPLATE_VERSION);
	apaState = await readFields();
	describe(apaState, 'UNDER APA');
	log('');
	log('RESULT F4 — renders narrative under APA:',
		apaState[TARGET_FIELD].text.indexOf(' and ') !== -1 &&
		!apaState[TARGET_FIELD].text.trim().startsWith('('));
	const cap = addon.api.getLastCapability();
	log('active style capability:', cap && cap.supported, '-', cap && cap.reason);
} catch (e) { fail('PHASE 2', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 3 — NOW SWITCH THE DOCUMENT STYLE TO MLA, BY HAND');
log('');
log('  STOP. Do this in Word before continuing:');
log('    Zotero tab -> Document Preferences -> choose');
log('    "Modern Language Association 9th edition" -> OK');
log('    Let it finish reformatting.');
log('');
log('  >>> Q1: do any citations show "[NO_PRINTED_FORM]"? <<<');
log('  >>> Q2: does field 0 read as an ordinary MLA citation, e.g.');
log('          "(Smyth and Blitshteyn)"? <<<');
log('');
log('  Then RE-RUN THIS SCRIPT. Phase 4 checks what the switch did.');

/* ------------------------------------------------------------------ */
hr('PHASE 4 — state now (meaningful on the re-run, after the style switch)');
try {
	const now = await readFields();
	describe(now, 'CURRENT');
	const t = now[TARGET_FIELD];
	const cap = addon.api.getLastCapability();
	log('');
	log('active style capability:', cap && cap.supported, '-', cap && cap.reason);
	log('');
	log('If you have switched to MLA:');
	log('  RESULT F5 — no [NO_PRINTED_FORM] anywhere:',
		now.every(r => r.text.indexOf('NO_PRINTED_FORM') === -1));
	log('  RESULT F6 — field 0 fell back to a parenthetical citation:',
		t.text.trim().startsWith('(') && t.text.trim().endsWith(')'));
	log('  RESULT F7 — the flag is STILL in the document (so switching back works):',
		t.mode === '"composite"');
	log('        F7 is the point of doing this at the processor boundary rather');
	log('        than stripping the flag from the field.');
} catch (e) { fail('PHASE 4', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 5 — switch BACK to APA by hand, then run once more');
log('');
log('  Document Preferences -> "American Psychological Association 7th edition"');
log('  >>> Q3: does field 0 return to "Smyth and Blitshteyn (2025)"? <<<');
log('  That confirms the flag survived a round trip through an unsupported style.');

hr('END');
try { Zotero.Utilities.Internal.copyTextToClipboard(LOG.join('\n')); } catch (e) {}
return LOG.join('\n');
