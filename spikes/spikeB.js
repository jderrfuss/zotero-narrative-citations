/* =====================================================================
 * SPIKE B — does synthesized <intext> + mode:"composite" give correct APA?
 *
 * HOW TO RUN
 *   Zotero -> Tools -> Developer -> Run JavaScript
 *   TICK "Run as async function". Paste, Run, paste output back.
 *   Word is NOT involved. Nothing is written to disk or to your library.
 *
 * It builds citeproc engines in memory from your installed apa.csl and a
 * fixed set of synthetic items, so the result does not depend on your library.
 *
 * Four style variants are compared:
 *   V0  stock apa.csl, no <intext>            (shows the fallback)
 *   V1  <intext> with et-al attrs ON the <intext> element   (what the brief says)
 *   V2  <intext> with et-al attrs ON the <name> element
 *   V3  cloned author macro with attributes pushed down     (the real proposal)
 * ===================================================================== */

var LOG = [];
function log(...a) {
	LOG.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
}
function hr(t) { LOG.push(''); LOG.push('======== ' + t + ' ========'); }
function fail(where, e) {
	log('!! ' + where + ' THREW: ' + (e && e.message ? e.message : String(e)));
	if (e && e.stack) log('   ' + String(e.stack).split('\n').slice(0, 5).join('\n   '));
}

const CSLNS = 'http://purl.org/net/xbiblio/csl';

/* ---------------- test items ---------------------------------------- */
function art(id, authors, year, title) {
	return {
		id: id, type: 'article-journal', title: title || ('Work ' + id),
		'container-title': 'Journal of Testing', volume: '1', page: '1-10',
		author: authors, issued: { 'date-parts': [[year]] }
	};
}
const ITEMS = {
	// Group A — basic rendering
	twoAuthor: art('twoAuthor',
		[{ family: 'Smith', given: 'Jane M.' }, { family: 'Jones', given: 'Peter' }], 2024),
	threeAuthor: art('threeAuthor',
		[{ family: 'Alvarez', given: 'Maria' }, { family: 'Brown', given: 'David' },
		 { family: 'Chen', given: 'Li' }], 2023),
	oneAuthor: art('oneAuthor', [{ family: 'Okafor', given: 'Ngozi' }], 2020),

	// Group B — two different people with the same surname
	smithJane: art('smithJane', [{ family: 'Smith', given: 'Jane M.' }], 2020),
	smithRobert: art('smithRobert', [{ family: 'Smith', given: 'Robert' }], 2021),

	// Group C — same author, same year (year-suffix)
	jonesA: art('jonesA', [{ family: 'Jones', given: 'Peter' }], 2020, 'First work'),
	jonesB: art('jonesB', [{ family: 'Jones', given: 'Peter' }], 2020, 'Second work')
};

/* ---------------- engine construction -------------------------------- */
function makeEngine(xml) {
	const sys = new Zotero.Cite.System({});
	sys.retrieveItem = function (id) {
		const key = (typeof id === 'object' && id !== null) ? id.id : id;
		const it = ITEMS[key];
		if (!it) throw new Error('spikeB: unknown test item ' + key);
		return JSON.parse(JSON.stringify(it));
	};
	const e = new Zotero.CiteProc.CSL.Engine(sys, xml, 'en-US', false);
	e.setOutputFormat('text');
	// Match what Zotero.Style.getCiteProc() does, so we test the real config.
	e.opt.development_extensions.wrap_url_and_doi = true;
	e.opt.development_extensions.parse_names = false;
	return e;
}

var CID = 0;
function cite(id, opts) {
	opts = opts || {};
	const item = Object.assign({ id: id }, opts.item || {});
	const props = Object.assign({ noteIndex: 0 }, opts.properties || {});
	return { citationID: 'spikeB' + (++CID), properties: props, citationItems: [item] };
}

// Feed clusters through the processor in document order, exactly as
// integration.js does, so the document-global registry/disambiguation runs.
function runDoc(engine, clusters) {
	const texts = new Array(clusters.length).fill('(not returned)');
	const pre = [];
	for (let i = 0; i < clusters.length; i++) {
		const res = engine.processCitationCluster(clusters[i], pre.slice(), []);
		const out = res[1];
		for (let j = 0; j < out.length; j++) texts[out[j][0]] = out[j][1];
		pre.push([clusters[i].citationID, 0]);
	}
	return texts;
}

/* ---------------- <intext> synthesis --------------------------------- */
function parseStyle(xml) {
	return new DOMParser().parseFromString(xml, 'application/xml');
}
function serialize(doc) {
	return new XMLSerializer().serializeToString(doc);
}
function el(doc, name) { return doc.createElementNS(CSLNS, name); }
function firstByTag(doc, name) {
	const n = doc.getElementsByTagNameNS(CSLNS, name);
	return n.length ? n[0] : doc.getElementsByTagName(name)[0];
}

function insertIntext(doc, intext) {
	const cit = firstByTag(doc, 'citation');
	cit.parentNode.insertBefore(intext, cit.nextSibling);
}

// V1 — what the brief describes: et-al settings on the <intext> element.
function synthV1(xml) {
	const doc = parseStyle(xml);
	const intext = el(doc, 'intext');
	intext.setAttribute('et-al-min', '3');
	intext.setAttribute('et-al-use-first', '1');
	const layout = el(doc, 'layout');
	const names = el(doc, 'names');
	names.setAttribute('variable', 'author');
	const name = el(doc, 'name');
	name.setAttribute('and', 'text');
	name.setAttribute('form', 'short');
	names.appendChild(name);
	const sub = el(doc, 'substitute');
	const t = el(doc, 'text');
	t.setAttribute('macro', 'title-and-descriptions-short');
	sub.appendChild(t);
	names.appendChild(sub);
	layout.appendChild(names);
	intext.appendChild(layout);
	insertIntext(doc, intext);
	return serialize(doc);
}

// V2 — same, but the et-al settings live on the <name> element instead.
function synthV2(xml) {
	const doc = parseStyle(xml);
	const intext = el(doc, 'intext');
	const layout = el(doc, 'layout');
	const names = el(doc, 'names');
	names.setAttribute('variable', 'author');
	const name = el(doc, 'name');
	name.setAttribute('and', 'text');
	name.setAttribute('form', 'short');
	name.setAttribute('et-al-min', '3');
	name.setAttribute('et-al-use-first', '1');
	name.setAttribute('initialize-with', '. ');
	names.appendChild(name);
	const sub = el(doc, 'substitute');
	const t = el(doc, 'text');
	t.setAttribute('macro', 'title-and-descriptions-short');
	sub.appendChild(t);
	names.appendChild(sub);
	layout.appendChild(names);
	intext.appendChild(layout);
	insertIntext(doc, intext);
	return serialize(doc);
}

/* V3 — the actual proposal, and style-agnostic:
 *   1. find the macro the <citation> layout uses for names
 *   2. deep-clone it under a new name (macros are global and built once, so a
 *      clone is the only way to give the intext area different name settings)
 *   3. push inheritable name attributes from <style> and <citation> down onto
 *      the clone's <name>/<names> elements (the intext area inherits nothing)
 *   4. flip and="symbol" to and="text"
 *   5. reference the clone from a new <intext>
 */
const NAME_ATTRS = ['et-al-min', 'et-al-use-first', 'et-al-subsequent-min',
	'et-al-subsequent-use-first', 'and', 'delimiter-precedes-last',
	'delimiter-precedes-et-al', 'initialize', 'initialize-with',
	'name-as-sort-order', 'sort-separator'];
const NAME_RENAMED = { 'name-form': 'form', 'name-delimiter': 'delimiter' };
const NAMES_RENAMED = { 'names-delimiter': 'delimiter' };

function collectInherited(doc) {
	const out = {};
	const styleEl = doc.documentElement;
	const cit = firstByTag(doc, 'citation');
	for (const src of [styleEl, cit]) {           // <citation> wins over <style>
		if (!src) continue;
		for (const a of Array.from(src.attributes)) out[a.name] = a.value;
	}
	return out;
}

function synthV3(xml, reportTo) {
	const doc = parseStyle(xml);
	const cit = firstByTag(doc, 'citation');
	const inherited = collectInherited(doc);

	// Which macro renders the names? First <text macro> in the citation layout
	// whose macro subtree contains a <names> element.
	const layoutEl = cit.getElementsByTagNameNS(CSLNS, 'layout')[0]
		|| cit.getElementsByTagName('layout')[0];
	let macroName = null;
	const refs = layoutEl.getElementsByTagNameNS(CSLNS, 'text').length
		? layoutEl.getElementsByTagNameNS(CSLNS, 'text')
		: layoutEl.getElementsByTagName('text');
	const macros = {};
	const allMacros = doc.getElementsByTagNameNS(CSLNS, 'macro').length
		? doc.getElementsByTagNameNS(CSLNS, 'macro')
		: doc.getElementsByTagName('macro');
	for (const m of Array.from(allMacros)) macros[m.getAttribute('name')] = m;

	for (const r of Array.from(refs)) {
		const mn = r.getAttribute('macro');
		if (!mn || !macros[mn]) continue;
		const m = macros[mn];
		const hasNames = (m.getElementsByTagNameNS(CSLNS, 'names').length
			|| m.getElementsByTagName('names').length);
		if (hasNames) { macroName = mn; break; }
	}
	if (!macroName) throw new Error('could not find a names-bearing macro in <citation>');
	if (reportTo) reportTo.push('V3: cloning macro "' + macroName + '"');

	const clone = macros[macroName].cloneNode(true);
	const cloneName = macroName + '--intext';
	clone.setAttribute('name', cloneName);

	// Push inheritable attributes down, then flip `and`.
	const cNames = clone.getElementsByTagNameNS(CSLNS, 'names').length
		? clone.getElementsByTagNameNS(CSLNS, 'names')
		: clone.getElementsByTagName('names');
	const cName = clone.getElementsByTagNameNS(CSLNS, 'name').length
		? clone.getElementsByTagNameNS(CSLNS, 'name')
		: clone.getElementsByTagName('name');

	for (const n of Array.from(cNames)) {
		for (const k in NAMES_RENAMED) {
			if (inherited[k] !== undefined && !n.hasAttribute(NAMES_RENAMED[k])) {
				n.setAttribute(NAMES_RENAMED[k], inherited[k]);
			}
		}
	}
	let flipped = 0;
	for (const n of Array.from(cName)) {
		for (const k of NAME_ATTRS) {
			if (inherited[k] !== undefined && !n.hasAttribute(k)) n.setAttribute(k, inherited[k]);
		}
		for (const k in NAME_RENAMED) {
			if (inherited[k] !== undefined && !n.hasAttribute(NAME_RENAMED[k])) {
				n.setAttribute(NAME_RENAMED[k], inherited[k]);
			}
		}
		if (n.getAttribute('and') === 'symbol') { n.setAttribute('and', 'text'); flipped++; }
	}
	if (reportTo) reportTo.push('V3: pushed attrs onto ' + cName.length +
		' <name> elements; flipped and="symbol"->"text" on ' + flipped);

	macros[macroName].parentNode.insertBefore(clone, macros[macroName].nextSibling);

	const intext = el(doc, 'intext');
	const lay = el(doc, 'layout');
	const t = el(doc, 'text');
	t.setAttribute('macro', cloneName);
	lay.appendChild(t);
	intext.appendChild(lay);
	insertIntext(doc, intext);
	return serialize(doc);
}

/* ---------------- test cases ----------------------------------------- */
// Each group gets a fresh engine: disambiguation is document-global, so items
// must not leak between groups.
const GROUPS = [
	{
		name: 'A — basic rendering',
		cases: [
			{ label: 'two authors, narrative', id: 'twoAuthor', narrative: true,
			  expect: 'Smith and Jones (2024)' },
			{ label: 'three authors, narrative', id: 'threeAuthor', narrative: true,
			  expect: 'Alvarez et al. (2023)' },
			{ label: 'one author + locator, narrative', id: 'oneAuthor', narrative: true,
			  item: { locator: '5', label: 'page' }, expect: 'Okafor (2020, p. 5)' }
		]
	},
	{
		name: 'A(control) — same items, parenthetical',
		cases: [
			{ label: 'two authors, parenthetical', id: 'twoAuthor',
			  expect: '(Smith & Jones, 2024)' },
			{ label: 'three authors, parenthetical', id: 'threeAuthor',
			  expect: '(Alvarez et al., 2023)' },
			{ label: 'one author + locator, parenthetical', id: 'oneAuthor',
			  item: { locator: '5', label: 'page' }, expect: '(Okafor, 2020, p. 5)' }
		]
	},
	{
		name: 'B — given-name disambiguation, two Smiths in one document',
		cases: [
			{ label: 'Smith, Jane M. 2020, narrative', id: 'smithJane', narrative: true,
			  expect: 'J. M. Smith (2020)' },
			{ label: 'Smith, Robert 2021, narrative', id: 'smithRobert', narrative: true,
			  expect: 'R. Smith (2021)' }
		]
	},
	{
		name: 'C — year-suffix disambiguation, same author same year',
		cases: [
			{ label: 'Jones 2020 first, narrative', id: 'jonesA', narrative: true,
			  expect: 'Jones (2020a)' },
			{ label: 'Jones 2020 second, narrative', id: 'jonesB', narrative: true,
			  expect: 'Jones (2020b)' }
		]
	}
];

function runGroup(xml, group) {
	const engine = makeEngine(xml);
	const clusters = group.cases.map(c => cite(c.id, {
		item: c.item,
		properties: c.narrative ? { mode: 'composite' } : {}
	}));
	const texts = runDoc(engine, clusters);
	const rows = [];
	for (let i = 0; i < group.cases.length; i++) {
		const c = group.cases[i];
		const got = texts[i];
		rows.push({ label: c.label, expect: c.expect, got: got, pass: got === c.expect });
	}
	return rows;
}

/* ---------------- main ------------------------------------------------ */
hr('PHASE 0 — environment and style');
var APA_XML = null;
try {
	log('Zotero.version            :', Zotero.version);
	log('citeproc PROCESSOR_VERSION:', Zotero.CiteProc.CSL.PROCESSOR_VERSION);
	const style = Zotero.Styles.get('http://www.zotero.org/styles/apa');
	if (!style) {
		log('!! apa style not found. Installed styles:');
		for (const s of Zotero.Styles.getAll()) log('   ' + s.styleID);
	} else {
		APA_XML = style.getXML();
		log('style title               :', style.title);
		log('style XML length          :', APA_XML.length);
		log('stock apa.csl contains <intext>:', APA_XML.indexOf('<intext') !== -1);
	}
} catch (e) { fail('PHASE 0', e); }

const VARIANTS = [
	{ key: 'V0', desc: 'stock apa.csl, NO <intext> (fallback behaviour)', fn: (x) => x },
	{ key: 'V1', desc: '<intext>, et-al attrs ON THE <intext> ELEMENT (per brief)', fn: synthV1 },
	{ key: 'V2', desc: '<intext>, et-al attrs ON THE <name> ELEMENT', fn: synthV2 },
	{ key: 'V3', desc: 'cloned author macro, attrs pushed down (the proposal)', fn: synthV3 }
];

var SUMMARY = [];
for (const v of VARIANTS) {
	hr('VARIANT ' + v.key + ' — ' + v.desc);
	if (!APA_XML) { log('skipped (no style XML)'); continue; }
	let xml, notes = [];
	try {
		xml = v.fn(APA_XML, notes);
		for (const n of notes) log(n);
		log('synthesized XML contains <intext>:', xml.indexOf('<intext') !== -1);
	} catch (e) { fail('VARIANT ' + v.key + ' synthesis', e); continue; }

	let pass = 0, total = 0;
	for (const g of GROUPS) {
		log('');
		log('  -- ' + g.name);
		let rows;
		try { rows = runGroup(xml, g); }
		catch (e) { fail('VARIANT ' + v.key + ' / ' + g.name, e); continue; }
		for (const r of rows) {
			total++;
			if (r.pass) pass++;
			log('    [' + (r.pass ? 'PASS' : 'FAIL') + '] ' + r.label);
			log('           expected: ' + JSON.stringify(r.expect));
			log('           got     : ' + JSON.stringify(r.got));
		}
	}
	SUMMARY.push(v.key + '  ' + pass + '/' + total + '  ' + v.desc);
}

hr('SUMMARY');
for (const s of SUMMARY) log(s);
log('');
log('Spike B success criteria are the narrative rows in groups A, B and C.');
log('Group A(control) just confirms parenthetical output is unchanged.');

try { Zotero.Utilities.Internal.copyTextToClipboard(LOG.join('\n')); } catch (e) {}
return LOG.join('\n');
