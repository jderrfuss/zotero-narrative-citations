/* =====================================================================
 * MILESTONE 2 — THE JOIN
 *
 * Does a persisted narrative flag actually produce narrative text in a real
 * Word document, and survive a refresh?
 *
 * Spike A proved the flag persists. Spike B proved composite mode renders.
 * Neither ran the two together through Zotero's real _updateCitations
 * pipeline. That is what this checks.
 *
 * WHAT IT TESTS
 *   The storage decision: the flag is citeproc's own cluster key,
 *   citation.properties.mode = "composite". Nothing per-item, nothing private.
 *
 * BEFORE YOU RUN
 *   1. Install the plugin:
 *        Zotero -> Tools -> Add-ons -> gear -> Install Add-on From File...
 *        scaffold/build/narrative-citations.xpi
 *      (or point it at scaffold/build/addon/ if you are using hot reload)
 *   2. Make a CLEAN working copy -- the existing spikeA_working_copy.docx is
 *      dirty:
 *        cp assets/test_document.docx spikes/m2_working_copy.docx
 *   3. Open spikes/m2_working_copy.docx in Word and make it the FRONT document.
 *   4. Zotero -> Tools -> Developer -> Run JavaScript
 *   5. TICK "Run as async function".  (Required: top-level await.)
 *   6. Paste this whole file, Run, paste the entire output back.
 *
 * It runs two full document refreshes. Word will come to the front and
 * progress bars will appear. That is expected; let it finish.
 *
 * If a "citation has been modified" dialog appears, that is a RESULT, not a
 * malfunction -- note which phase it appeared in and dismiss it with "No"
 * (keep Zotero's version). SPIKE-RESULTS §5 flags this as unexercised.
 *
 * Phases
 *   0  environment + is the plugin actually loaded and patched
 *   1  toJSON allowlist now, offline (does "composite" survive? do the
 *      transient values get filtered?)
 *   2  read the document as it stands
 *   3  inject properties.mode="composite" into citation field #1 only
 *   4  refresh -- does field #1 render narrative and keep its flag?
 *   5  refresh again -- idempotent? flag still there? text unchanged?
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

// integration.js TEMPLATE_VERSIONS = { MacWord16: 2, WinWord: 1, OpenOffice: 1 }.
// execCommand() defaults templateVersion to 0, which makes warnOutdatedTemplate()
// fire a bogus "plugin is outdated" prompt and abort the command.
const MACWORD_TEMPLATE_VERSION = 2;

// The flag. citeproc-js's own cluster-level key.
const MODE_KEY = 'mode';
const NARRATIVE = 'composite';

// Which citation field to flag. 0 = the first one in the document. The rest
// stay parenthetical and act as controls.
const TARGET_FIELD = 0;

function extractJSON(code) {
	let s = code.indexOf('{');
	let e = code.lastIndexOf('}');
	if (s === -1 || e === -1) return null;
	return code.substring(s, e + 1);
}

function makeFakeField(code) {
	return {
		_c: code || '{}',
		getText: async function () { return ''; },
		setCode: async function (c) { this._c = c; },
		getCode: function () { return this._c; },
		equals: async function () { return false; },
		getNoteIndex: async function () { return 0; },
		isAdjacentToNextField: async function () { return false; }
	};
}

/* ------------------------------------------------------------------ */
hr('PHASE 0 — environment and plugin state');
var pluginOK = false;
try {
	log('Zotero.version            :', Zotero.version);
	log('citeproc PROCESSOR_VERSION:', Zotero.CiteProc.CSL.PROCESSOR_VERSION);
	log('pref cite.useCiteprocRs   :', Zotero.Prefs.get('cite.useCiteprocRs'));
	log('');

	const addon = Zotero.NarrativeCitations;
	log('Zotero.NarrativeCitations present :', !!addon);
	if (addon) {
		log('  data.initialized :', addon.data.initialized);
		log('  data.env         :', addon.data.env);
		log('  data.patched     :', addon.data.patched);
		log('  api.NARRATIVE_MODE:', addon.api && addon.api.NARRATIVE_MODE);
		pluginOK = !!addon.data.patched;
	} else {
		log('!! Plugin is not loaded. Install the XPI and re-run.');
		log('!! scaffold/build/narrative-citations.xpi');
	}

	// Independent check: is the prototype method actually wrapped?
	const fnSrc = String(Zotero.Integration.Citation.prototype.toJSON);
	log('');
	log('toJSON source looks wrapped (not the stock allowlist body):',
		fnSrc.indexOf('saveCitationItemKeys') === -1);
	log('toJSON source (first 160 chars):');
	log('  ' + fnSrc.replace(/\s+/g, ' ').substring(0, 160));
} catch (e) { fail('PHASE 0', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 1 — toJSON allowlist now, offline');
try {
	// id contains "/" so toJSON() treats it as an embedded item and does not
	// need a live Zotero.Integration.currentSession.
	function roundTrip(props) {
		const c = new Zotero.Integration.Citation(
			makeFakeField(),
			{
				citationID: 'M2TEST',
				properties: props,
				citationItems: [{
					id: 'm2/TESTITEM',
					uris: ['http://zotero.org/users/local/m2/items/M2ITEM'],
					itemData: {
						id: 'm2/TESTITEM', type: 'article-journal', title: 'Test',
						author: [{ family: 'Smith', given: 'Jane' }],
						issued: { 'date-parts': [[2024]] }
					}
				}]
			},
			0
		);
		return JSON.parse(c.serialize()).properties;
	}

	const a = roundTrip({ noteIndex: 0, mode: 'composite' });
	log('IN  properties.mode = "composite"   OUT:', JSON.stringify(a.mode));
	log('RESULT B1 — narrative flag persists        :', a.mode === 'composite');
	log('');

	// The validating gate: citeproc mutates properties.mode in place during
	// process_CitationCluster. A throw mid-render could strand one of these on
	// a live Citation. They must NOT reach the document.
	const b = roundTrip({ noteIndex: 0, mode: 'author-only' });
	log('IN  properties.mode = "author-only" OUT:', JSON.stringify(b.mode));
	log('RESULT B2 — transient "author-only" filtered  :', b.mode === undefined);

	const c2 = roundTrip({ noteIndex: 0, mode: 'suppress-author' });
	log('IN  properties.mode = "suppress-author" OUT:', JSON.stringify(c2.mode));
	log('RESULT B3 — transient "suppress-author" filtered:', c2.mode === undefined);

	const d = roundTrip({ noteIndex: 0 });
	log('IN  no mode                        OUT:', JSON.stringify(d.mode));
	log('RESULT B4 — absent stays absent            :', d.mode === undefined);
} catch (e) { fail('PHASE 1', e); }

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
		try { text = await f.getText(); } catch (e) { text = '<getText failed: ' + e.message + '>'; }
		out.push({ code: code, text: text });
	}
	try { await doc.cleanup(); } catch (e) {}
	try { if (doc.complete) await doc.complete(); } catch (e) {}
	return out;
}

function describe(fields, label) {
	log(label + ' — ' + fields.length + ' citation field(s):');
	const rows = [];
	for (let i = 0; i < fields.length; i++) {
		const js = extractJSON(fields[i].code);
		let mode = '<unparseable>', nItems = '?', fc = '', pc = '';
		if (js) {
			try {
				const o = JSON.parse(js);
				mode = (o.properties && MODE_KEY in o.properties)
					? JSON.stringify(o.properties[MODE_KEY]) : '(none)';
				nItems = (o.citationItems || []).length;
				fc = (o.properties && o.properties.formattedCitation) || '';
				pc = (o.properties && o.properties.plainCitation) || '';
			} catch (e) {}
		}
		log('  [' + i + '] items=' + nItems + '  mode=' + mode);
		log('        document text  : ' + JSON.stringify(fields[i].text));
		log('        plainCitation  : ' + JSON.stringify(pc));
		log('        formattedCit.  : ' + JSON.stringify(fc.length > 90 ? fc.substring(0, 90) + '...' : fc));
		rows.push({ mode: mode, text: fields[i].text, plainCitation: pc });
	}
	return rows;
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
		obj.properties[MODE_KEY] = NARRATIVE;
		await f.setCode('ITEM CSL_CITATION ' + JSON.stringify(obj));
		done = true;
		break;
	}
	try { await doc.cleanup(); } catch (e) {}
	try { if (doc.complete) await doc.complete(); } catch (e) {}
	return done;
}

/* ------------------------------------------------------------------ */
hr('PHASE 2 — the document as it stands');
var before = null;
try {
	const fields = await readFields();
	if (!fields.length) {
		log('!! No Zotero citation fields in the front Word document.');
		log('!! Open spikes/m2_working_copy.docx, make it frontmost, re-run.');
	} else {
		before = describe(fields, 'BEFORE');
		log('');
		log('Any field already carrying a mode? :',
			before.some(r => r.mode !== '(none)'));
		log('(If yes, this is not a clean copy. cp assets/test_document.docx ...)');
	}
} catch (e) { fail('PHASE 2', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 3 — flag field #' + TARGET_FIELD + ' as narrative');
var injected = false;
try {
	if (!before) {
		log('skipped (no fields)');
	} else if (!pluginOK) {
		log('!! SKIPPED — the plugin is not loaded/patched, so a refresh would');
		log('!! simply scrub the flag (that is Spike A result A2, already known).');
		log('!! Install the XPI and re-run.');
	} else {
		injected = await injectMode(TARGET_FIELD);
		log('injected properties.mode="composite" into field #' + TARGET_FIELD + ':', injected);
		const fields = await readFields();
		const rows = describe(fields, 'AFTER injection, read straight back');
		log('');
		log('RESULT B5 — flag is in the field code before any refresh:',
			rows[TARGET_FIELD] && rows[TARGET_FIELD].mode === '"composite"');
	}
} catch (e) { fail('PHASE 3', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 4 — refresh #1: does it render narrative and keep the flag?');
var after1 = null;
try {
	if (!injected) {
		log('skipped (nothing injected)');
	} else {
		log('running Zotero.Integration.execCommand("MacWord16", "refresh", null, 2) ...');
		await Zotero.Integration.execCommand('MacWord16', 'refresh', null, MACWORD_TEMPLATE_VERSION);
		log('refresh complete');
		log('');
		const fields = await readFields();
		after1 = describe(fields, 'AFTER refresh #1');
		log('');

		const t = after1[TARGET_FIELD];
		const wasText = before[TARGET_FIELD].text;

		log('target field text BEFORE:', JSON.stringify(wasText));
		log('target field text AFTER :', JSON.stringify(t.text));
		log('');
		log('RESULT B6 — flag survived the refresh          :', t.mode === '"composite"');
		log('RESULT B7 — rendered text changed              :', t.text !== wasText);
		log('RESULT B8 — text is NOT wrapped in parentheses :',
			!(t.text.trim().startsWith('(') && t.text.trim().endsWith(')')));
		log('RESULT B9 — text has a year inside parentheses :', /\(\s*\d{4}/.test(t.text));
		log('RESULT B10 — plainCitation was resynced to the new text:',
			t.plainCitation === t.text);
		log('');
		log('Control fields (should be unchanged and parenthetical):');
		for (let i = 0; i < after1.length; i++) {
			if (i === TARGET_FIELD) continue;
			log('  [' + i + '] mode=' + after1[i].mode +
				'  unchanged=' + (after1[i].text === before[i].text) +
				'  text=' + JSON.stringify(after1[i].text));
		}
		log('');
		log('READ THIS BY EYE: is the target text a correct narrative citation?');
		log('  APA 7 wants:  Smith and Jones (2024)      <- the word "and"');
		log('  V0 fallback:  Smith & Jones (2024)        <- expected until <intext>');
		log('  Broken:       Smith & Jones, 2024         <- bare, no parens');
		log('  Broken:       (Smith & Jones, 2024)       <- flag did not take');
	}
} catch (e) { fail('PHASE 4', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 5 — refresh #2: idempotent?');
try {
	if (!after1) {
		log('skipped');
	} else {
		log('running a second refresh ...');
		await Zotero.Integration.execCommand('MacWord16', 'refresh', null, MACWORD_TEMPLATE_VERSION);
		log('refresh complete');
		log('');
		const fields = await readFields();
		const after2 = describe(fields, 'AFTER refresh #2');
		log('');
		const t1 = after1[TARGET_FIELD], t2 = after2[TARGET_FIELD];
		log('RESULT B11 — flag still present     :', t2.mode === '"composite"');
		log('RESULT B12 — text stable across refreshes:', t2.text === t1.text);
		log('RESULT B13 — no control field drifted    :',
			after2.every((r, i) => i === TARGET_FIELD || r.text === after1[i].text));
		log('');
		log('If a "citation has been modified" prompt appeared during this phase,');
		log('say so — it would mean the plainCitation resync in _updateDocument is');
		log('not keeping up with the mode change.');
	}
} catch (e) { fail('PHASE 5', e); }

hr('END');

try { Zotero.Utilities.Internal.copyTextToClipboard(LOG.join('\n')); } catch (e) {}
return LOG.join('\n');
