/* =====================================================================
 * SPIKE A — does a foreign key survive a round trip through the Word field?
 *
 * HOW TO RUN
 *   1. Open  spikes/spikeA_working_copy.docx  in Word. Make it the FRONT
 *      document. (It is a copy; its field codes will be rewritten.)
 *   2. Zotero -> Tools -> Developer -> Run JavaScript
 *   3. TICK the "Run as async function" checkbox.  (Required: top-level await.)
 *   4. Paste this whole file, Run, paste the entire output back.
 *
 * It will run two full document Refreshes. Progress bars will appear and
 * Word will come to the front. That is expected. Let it finish.
 *
 * Phases:
 *   0  environment
 *   1  Citation.toJSON() allowlist, in isolation (no Word)
 *   2  Field.unserialize(), in isolation (no Word)
 *   3  can Word itself store a foreign key in a field code?
 *   4  does it survive a Refresh with stock Zotero?
 *   5  does it survive a Refresh with toJSON() monkey-patched?
 * ===================================================================== */

var LOG = [];
function log(...a) {
	LOG.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
}
function hr(t) { LOG.push(''); LOG.push('======== ' + t + ' ========'); }
function fail(phase, e) {
	log('!! ' + phase + ' THREW: ' + (e && e.message ? e.message : String(e)));
	if (e && e.stack) log('   ' + String(e.stack).split('\n').slice(0, 4).join('\n   '));
}

// Foreign keys we are trying to smuggle through.
const MARK_PROP = 'zncMode';       // on citation.properties
const MARK_ITEM = 'zncNarrative';  // on a citationItem

// integration.js TEMPLATE_VERSIONS = { MacWord16: 2, WinWord: 1, OpenOffice: 1 }.
// execCommand() defaults templateVersion to 0, which makes warnOutdatedTemplate()
// fire the bogus "plugin is outdated" prompt and abort the command. Pass the real
// number so the command actually runs.
const MACWORD_TEMPLATE_VERSION = 2;

// Minimal stand-in for a word-processor field, for the offline phases.
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

function extractJSON(code) {
	let s = code.indexOf('{');
	let e = code.lastIndexOf('}');
	if (s === -1 || e === -1) return null;
	return code.substring(s, e + 1);
}

/* ------------------------------------------------------------------ */
hr('PHASE 0 — environment');
try {
	log('Zotero.version           :', Zotero.version);
	log('Zotero.platform          :', Zotero.platform);
	log('citeproc PROCESSOR_VERSION:', Zotero.CiteProc.CSL.PROCESSOR_VERSION);
	log('citeproc CSL.AREAS       :', JSON.stringify(Zotero.CiteProc.CSL.AREAS));
	log('CSL.Node.intext present  :', !!Zotero.CiteProc.CSL.Node.intext);
	log('pref cite.useCiteprocRs  :', Zotero.Prefs.get('cite.useCiteprocRs'));
	log('Citation.prototype.toJSON:', typeof Zotero.Integration.Citation.prototype.toJSON);
} catch (e) { fail('PHASE 0', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 1 — Citation.toJSON() allowlist, offline');
try {
	// id contains a "/" so toJSON() treats it as an embedded item and does not
	// need a live Zotero.Integration.currentSession.
	const inProps = {
		unsorted: false,
		formattedCitation: '(Smith, 2024)',
		plainCitation: '(Smith, 2024)',
		noteIndex: 0,
		mode: 'composite',        // citeproc-js cluster mode
		infix: "'s study",        // citeproc-js composite infix
		[MARK_PROP]: 'narrative'  // our own invented key
	};
	const inItem = {
		id: 'spikeA/TESTITEM',
		uris: ['http://zotero.org/users/local/spike/items/SPIKEA'],
		itemData: {
			id: 'spikeA/TESTITEM', type: 'article-journal', title: 'Test',
			author: [{ family: 'Smith', given: 'Jane' }],
			issued: { 'date-parts': [[2024]] }
		},
		locator: '5',
		label: 'page',
		'suppress-author': true,
		'author-only': true,       // already in Zotero's allowlist — control
		[MARK_ITEM]: true
	};

	const propKeysIn = Object.keys(inProps);
	const itemKeysIn = Object.keys(inItem);

	const c = new Zotero.Integration.Citation(
		makeFakeField(), { citationID: 'SPIKEA01', properties: inProps, citationItems: [inItem] }, 0
	);
	const out = JSON.parse(c.serialize());

	const propsOut = Object.keys(out.properties);
	const itemOut = Object.keys(out.citationItems[0]);

	log('properties  IN  :', propKeysIn.join(', '));
	log('properties  OUT :', propsOut.join(', '));
	log('properties LOST :', propKeysIn.filter(k => !propsOut.includes(k)).join(', ') || '(none)');
	log('');
	log('citationItem IN  :', itemKeysIn.join(', '));
	log('citationItem OUT :', itemOut.join(', '));
	log('citationItem LOST:', itemKeysIn.filter(k => !itemOut.includes(k)).join(', ') || '(none)');
	log('');
	log('RESULT properties.' + MARK_PROP + ' survived:', propsOut.includes(MARK_PROP));
	log('RESULT properties.mode survived        :', propsOut.includes('mode'));
	log('RESULT properties.infix survived       :', propsOut.includes('infix'));
	log('RESULT citationItem.' + MARK_ITEM + ' survived:', itemOut.includes(MARK_ITEM));
	log('RESULT citationItem["author-only"] survived:', itemOut.includes('author-only'));
} catch (e) { fail('PHASE 1', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 2 — Field.unserialize() preserves unknown keys?');
try {
	const stored = {
		citationID: 'SPIKEA02',
		properties: { noteIndex: 0, [MARK_PROP]: 'narrative' },
		citationItems: [{ id: 'spikeA/TESTITEM', uris: [], itemData: {}, [MARK_ITEM]: true }],
		schema: 'https://github.com/citation-style-language/schema/raw/master/csl-citation.json'
	};
	const raw = 'ITEM CSL_CITATION ' + JSON.stringify(stored);
	const f = new Zotero.Integration.Field(makeFakeField(raw), raw);
	const back = await f.unserialize();
	log('properties keys after unserialize :', Object.keys(back.properties).join(', '));
	log('citationItem keys after unserialize:', Object.keys(back.citationItems[0]).join(', '));
	log('RESULT unserialize kept ' + MARK_PROP + ':', MARK_PROP in back.properties);
	log('RESULT unserialize kept ' + MARK_ITEM + ':', MARK_ITEM in back.citationItems[0]);
} catch (e) { fail('PHASE 2', e); }

/* ------------------------------------------------------------------ */
// Everything below touches the live Word document.
var app = null, origToJSON = null, patched = false;

async function openDoc() {
	const mod = ChromeUtils.importESModule(
		'chrome://zotero-macword-integration/content/zoteroMacWordIntegration.mjs');
	if (!app) app = new mod.Application();
	return app.getActiveDocument();
}

async function readCitationCodes() {
	const doc = await openDoc();
	const fields = await doc.getFields('Field');
	const out = [];
	for (let f of fields) {
		const code = await f.getCode();
		if (code.indexOf('CSL_CITATION') !== -1) out.push({ field: f, code: code });
	}
	try { await doc.cleanup(); } catch (e) {}
	try { if (doc.complete) await doc.complete(); } catch (e) {}
	return out;
}

async function injectMarks() {
	const doc = await openDoc();
	const fields = await doc.getFields('Field');
	let n = 0;
	for (let f of fields) {
		const code = await f.getCode();
		if (code.indexOf('CSL_CITATION') === -1) continue;
		const js = extractJSON(code);
		if (!js) continue;
		const obj = JSON.parse(js);
		obj.properties[MARK_PROP] = 'narrative';
		if (obj.citationItems && obj.citationItems[0]) obj.citationItems[0][MARK_ITEM] = true;
		await f.setCode('ITEM CSL_CITATION ' + JSON.stringify(obj));
		n++;
	}
	try { await doc.cleanup(); } catch (e) {}
	try { if (doc.complete) await doc.complete(); } catch (e) {}
	return n;
}

function summarise(codes, label) {
	let withProp = 0, withItem = 0;
	for (let c of codes) {
		const js = extractJSON(c.code);
		if (!js) continue;
		let o;
		try { o = JSON.parse(js); } catch (e) { log('  UNPARSEABLE code: ' + c.code.substring(0, 120)); continue; }
		if (o.properties && MARK_PROP in o.properties) withProp++;
		if (o.citationItems && o.citationItems[0] && MARK_ITEM in o.citationItems[0]) withItem++;
	}
	log(label + ': ' + codes.length + ' citation fields; ' +
		withProp + ' still carry properties.' + MARK_PROP + '; ' +
		withItem + ' still carry citationItem.' + MARK_ITEM);
	return { total: codes.length, withProp, withItem };
}

/* ------------------------------------------------------------------ */
hr('PHASE 3 — can Word store a foreign key in the field code?');
var baseline = null;
try {
	const before = await readCitationCodes();
	log('citation fields found in front document:', before.length);
	if (!before.length) {
		log('!! No Zotero citation fields in the front Word document.');
		log('!! Open spikes/spikeA_working_copy.docx and make it frontmost, then re-run.');
	} else {
		log('first field code (first 200 chars):');
		log('  ' + before[0].code.substring(0, 200));
		summarise(before, 'BEFORE injection');

		const n = await injectMarks();
		log('injected foreign keys into', n, 'fields via Field.setCode()');

		const after = await readCitationCodes();
		baseline = summarise(after, 'AFTER injection, read straight back from Word');
		log('');
		log('RESULT A1 — Word preserves a foreign key in a field code:',
			baseline.withProp === baseline.total && baseline.withItem === baseline.total);
	}
} catch (e) { fail('PHASE 3', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 4 — does it survive a Refresh with STOCK Zotero?');
try {
	if (!baseline || !baseline.total) {
		log('skipped (phase 3 did not run)');
	} else {
		log('running Zotero.Integration.execCommand("MacWord16", "refresh", null, 2) ...');
		await Zotero.Integration.execCommand('MacWord16', 'refresh', null, MACWORD_TEMPLATE_VERSION);
		log('refresh complete');
		const after = await readCitationCodes();
		const r = summarise(after, 'AFTER stock refresh');
		log('');
		log('RESULT A2 — foreign key survives a stock Refresh:',
			r.withProp === r.total && r.withItem === r.total);
		log('        (if false, Zotero actively rewrote the field and dropped it)');
	}
} catch (e) { fail('PHASE 4', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 5 — does it survive a Refresh with toJSON() patched?');
try {
	if (!baseline || !baseline.total) {
		log('skipped (phase 3 did not run)');
	} else {
		origToJSON = Zotero.Integration.Citation.prototype.toJSON;
		Zotero.Integration.Citation.prototype.toJSON = function () {
			const json = origToJSON.call(this);
			if (this.properties && (MARK_PROP in this.properties)) {
				json.properties[MARK_PROP] = this.properties[MARK_PROP];
			}
			for (let i = 0; i < this.citationItems.length; i++) {
				if (json.citationItems[i] && (MARK_ITEM in this.citationItems[i])) {
					json.citationItems[i][MARK_ITEM] = this.citationItems[i][MARK_ITEM];
				}
			}
			return json;
		};
		patched = true;
		log('patched Citation.prototype.toJSON');

		const n = await injectMarks();
		log('re-injected foreign keys into', n, 'fields');

		log('running refresh with patch active ...');
		await Zotero.Integration.execCommand('MacWord16', 'refresh', null, MACWORD_TEMPLATE_VERSION);
		log('refresh complete');

		const after = await readCitationCodes();
		const r = summarise(after, 'AFTER patched refresh');
		log('');
		log('RESULT A3 — a plugin patch makes the foreign key persist:',
			r.withProp === r.total && r.withItem === r.total);
	}
} catch (e) { fail('PHASE 5', e); }
finally {
	if (patched && origToJSON) {
		Zotero.Integration.Citation.prototype.toJSON = origToJSON;
		log('');
		log('toJSON() restored to stock.');
	} else if (patched) {
		log('');
		log('!! WARNING: toJSON() may still be patched. Restart Zotero before doing real work.');
	}
}

hr('END');

// Zotero's "Run as async function" wrapper returns only an explicit `return`.
try { Zotero.Utilities.Internal.copyTextToClipboard(LOG.join('\n')); } catch (e) {}
return LOG.join('\n');
