/* =====================================================================
 * MILESTONE 5 — <intext> SYNTHESIS (the APA ampersand)
 *
 * APA 7 wants "Smith and Jones (2024)". Without an <intext> element the
 * processor reuses the citation area's and="symbol" and gives
 * "Smith & Jones (2024)". That one character is the only thing the fallback
 * gets wrong (SPIKE-RESULTS §4.8).
 *
 * spikeB variant V3 fixed it at 10/10 in an isolated engine. This checks the
 * same transform running inside the real integration pipeline.
 *
 * BEFORE YOU RUN
 *   1. Install the new build, then RESTART Zotero:
 *        scaffold/build/narrative-citations.xpi
 *   2. Fresh working copy:
 *        cp assets/test_document.docx spikes/m5_working_copy.docx
 *   3. Open spikes/m5_working_copy.docx in Word, FRONT document.
 *   4. Run JavaScript, "Run as async function" TICKED.
 *
 * Phases 0-2 touch nothing. Phase 3 onward drives Word.
 *
 * NOTE ON THE TEST ITEM: field 0 is "(Smyth & Blitshteyn, 2025)" — a
 * two-author work, which is exactly the case the ampersand rule applies to.
 * Field 1 is "(Houlgreave et al., 2025)", which has no "&" at all and so
 * cannot show the difference. Field 0 is the one that matters here.
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
	log('plugin present     :', !!addon);
	if (addon) {
		log('  toJSON patched   :', addon.data.patched);
		log('  intext patched   :', addon.data.intextPatched);
		log('  getLastSynthesis :', typeof addon.api.getLastSynthesis === 'function');
	} else {
		log('!! Install scaffold/build/narrative-citations.xpi and restart Zotero.');
	}
} catch (e) { fail('PHASE 0', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 1 — the transform, offline: does it render "and"?');
// Builds throwaway in-memory engines from the installed apa.csl, before and
// after the plugin's transform, and renders the same synthetic items through
// both. This is spikeB's V0-vs-V3 comparison, re-run against the code that
// actually ships. Nothing is written anywhere; your installed style is not
// touched. If this fails, the bug is in the transform. If this passes but
// phase 4 fails, the bug is in the plumbing.
try {
	await Zotero.Styles.init();
	const style = Zotero.Styles.get('http://www.zotero.org/styles/apa');
	log('style              :', style && style.styleID);
	log('style class        :', style && style.class);
	log('style version      :', style && style._version);

	const rawXML = style.getXML();
	log('raw XML length     :', rawXML.length);
	log('raw XML has <intext>:', /<intext[\s>]/.test(rawXML));
	log('');

	const result = addon.api.synthesizeIntext(rawXML);
	log('synthesized        :', result.synthesized);
	log('reason             :', result.reason);
	log('macro cloned       :', result.macro);
	log('and="symbol" flips :', result.flipped);
	log('output XML length  :', result.xml.length);
	log('output has <intext>:', /<intext[\s>]/.test(result.xml));
	log('');
	log('RESULT E0a — transform produced an <intext>:',
		result.synthesized && /<intext[\s>]/.test(result.xml));
	log('RESULT E0b — at least one ampersand flipped:', (result.flipped || 0) > 0);
	log('        (spikeB found "author-short", 3 <name> elements, 3 flips)');
	log('');

	// --- render the same items through both engines ---
	const ITEMS = {
		two: { id: 'two', type: 'article-journal', title: 'Work',
			'container-title': 'Journal of Testing', volume: '1', page: '1-10',
			author: [{ family: 'Smyth', given: 'Jane M.' }, { family: 'Blitshteyn', given: 'Peter' }],
			issued: { 'date-parts': [[2025]] } },
		three: { id: 'three', type: 'article-journal', title: 'Work',
			'container-title': 'Journal of Testing', volume: '1', page: '1-10',
			author: [{ family: 'Alvarez', given: 'Maria' }, { family: 'Brown', given: 'David' },
				{ family: 'Chen', given: 'Li' }],
			issued: { 'date-parts': [[2023]] } }
	};
	function makeEngine(xml) {
		const sys = new Zotero.Cite.System({});
		sys.retrieveItem = function (id) {
			const key = (typeof id === 'object' && id !== null) ? id.id : id;
			if (!ITEMS[key]) throw new Error('unknown test item ' + key);
			return JSON.parse(JSON.stringify(ITEMS[key]));
		};
		const e = new Zotero.CiteProc.CSL.Engine(sys, xml, 'en-US', false);
		e.setOutputFormat('text');
		e.opt.development_extensions.wrap_url_and_doi = true;
		e.opt.development_extensions.parse_names = false;
		return e;
	}
	var CID = 0;
	function render(engine, id, narrative) {
		const props = { noteIndex: 0 };
		if (narrative) props.mode = 'composite';
		const cluster = { citationID: 'm5_' + (++CID), properties: props,
			citationItems: [{ id: id }] };
		const res = engine.processCitationCluster(cluster, [], []);
		return res[1].length ? res[1][0][1] : '(nothing returned)';
	}

	const v0 = makeEngine(rawXML);
	const v3 = makeEngine(result.xml);

	const rows = [
		['two authors, narrative',     'two',   true,  'Smyth and Blitshteyn (2025)'],
		['two authors, parenthetical', 'two',   false, '(Smyth & Blitshteyn, 2025)'],
		['three authors, narrative',   'three', true,  'Alvarez et al. (2023)'],
		['three authors, parenthetical','three', false,'(Alvarez et al., 2023)']
	];
	log('  ' + 'case'.padEnd(30) + 'stock (V0)'.padEnd(32) + 'transformed (V3)');
	let allOK = true;
	for (const [label, id, narrative, expect] of rows) {
		const a = render(v0, id, narrative);
		const b = render(v3, id, narrative);
		const ok = (b === expect);
		if (!ok) allOK = false;
		log('  ' + label.padEnd(30) + JSON.stringify(a).padEnd(32) + JSON.stringify(b) +
			(ok ? '  OK' : '  EXPECTED ' + JSON.stringify(expect)));
	}
	log('');
	log('RESULT E0c — all four offline cases correct after the transform:', allOK);
} catch (e) { fail('PHASE 1', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 2 — force an integration engine rebuild and inspect the synthesis');
try {
	// Opening the document creates a session and calls setData, which is what
	// the patch is gated on. A refresh does that.
	log('running a refresh to force Session.setData -> getCiteProc ...');
	await Zotero.Integration.execCommand('MacWord16', 'refresh', null, MACWORD_TEMPLATE_VERSION);
	log('refresh complete');
	log('');
	const s = addon && addon.api.getLastSynthesis && addon.api.getLastSynthesis();
	if (!s) {
		log('!! No synthesis recorded.');
		log('!! Either the patches did not install, or setData did not rebuild the');
		log('!! engine (it only does so when the style actually changes). Try');
		log('!! Document Preferences and re-pick APA to force a style reset.');
	} else {
		log('recorded at        :', s.when);
		log('synthesized        :', s.synthesized);
		log('reason             :', s.reason);
		log('macro cloned       :', s.macro);
		log('and="symbol" flips :', s.flipped);
		log('');
		log('RESULT E1 — an <intext> was synthesized:', !!s.synthesized);
		log('RESULT E2 — at least one ampersand flipped:', (s.flipped || 0) > 0);
		if (s.macro) {
			log('        (spikeB found "author-short" on apa.csl, 3 <name> elements, 3 flips)');
		}
	}
} catch (e) { fail('PHASE 2', e); }

/* ------------------------------------------------------------------ */
// Everything below touches the live Word document.
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
				mode = (o.properties && 'mode' in o.properties)
					? JSON.stringify(o.properties.mode) : '(none)';
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

hr('PHASE 3 — flag the TWO-AUTHOR citation (field ' + TARGET_FIELD + ') narrative');
var before = null;
try {
	before = await readFields();
	describe(before, 'BEFORE');
	if (!before.length) {
		log('!! No citation fields. Open spikes/m5_working_copy.docx frontmost.');
	} else {
		const ok = await injectMode(TARGET_FIELD);
		log('');
		log('injected mode="composite" into field ' + TARGET_FIELD + ':', ok);
	}
} catch (e) { fail('PHASE 3', e); }

hr('PHASE 4 — refresh and read the ampersand');
try {
	if (!before || !before.length) {
		log('skipped');
	} else {
		await Zotero.Integration.execCommand('MacWord16', 'refresh', null, MACWORD_TEMPLATE_VERSION);
		log('refresh complete');
		log('');
		const after = await readFields();
		describe(after, 'AFTER');
		const t = after[TARGET_FIELD].text;
		log('');
		log('target text        :', JSON.stringify(t));
		log('');
		log('RESULT E3 — renders narrative (no wrapping parens):',
			!(t.trim().startsWith('(') && t.trim().endsWith(')')));
		log('RESULT E4 — uses the word "and", not "&":',
			/\band\b/.test(t) && t.indexOf('&') === -1);
		log('        THIS IS THE MILESTONE. Expected: "Smyth and Blitshteyn (2025)"');
		log('        Before step 5 it read:            "Smyth & Blitshteyn (2025)"');
		log('');
		log('RESULT E5 — parenthetical controls still use "&":',
			after.some((r, i) => i !== TARGET_FIELD && r.text.indexOf('&') !== -1));
		log('        (the <intext> block must NOT leak into normal citations)');
		log('');
		log('Controls:');
		after.forEach((r, i) => {
			if (i === TARGET_FIELD) return;
			log('  [' + i + '] unchanged=' + (r.text === before[i].text) + '  ' + JSON.stringify(r.text));
		});
		log('');
		log('RESULT E6 — no control drifted:',
			after.every((r, i) => i === TARGET_FIELD || r.text === before[i].text));
	}
} catch (e) { fail('PHASE 4', e); }

hr('PHASE 5 — bibliography unaffected?');
try {
	const s = addon && addon.api.getLastSynthesis && addon.api.getLastSynthesis();
	log('last synthesis reason:', s && s.reason);
	log('');
	log('READ BY EYE: scroll to the bibliography in the Word document.');
	log('  >>> Are the entries unchanged and correctly formatted? <<<');
	log('  The synthesis is gated to the integration engine, but the same engine');
	log('  renders the bibliography, so this is worth a look.');
} catch (e) { fail('PHASE 5', e); }

hr('END');
try { Zotero.Utilities.Internal.copyTextToClipboard(LOG.join('\n')); } catch (e) {}
return LOG.join('\n');
