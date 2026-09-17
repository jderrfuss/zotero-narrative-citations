/* =====================================================================
 * REGRESSION CHECK — run before a release and after every Zotero update
 *
 * Unlike the milestone scripts beside it, which record one-off experiments,
 * this is meant to be re-run. Every check compares against an exact expected
 * value, and the summary lists FAIL and WARN results first.
 *
 *   FAIL  the plugin is not doing what it should
 *   WARN  something changed that needs a human look (e.g. a Zotero update
 *         moved code the plugin patches)
 *
 * PART 1 (this script) changes nothing: it builds throwaway engines in memory
 * and only READS field codes from Word. No Zotero restart is needed after it.
 * PART 2 is a checklist of steps in Word, printed at the end. Re-run this
 * script afterwards: phase 4 then checks the document you edited.
 *
 * BEFORE YOU RUN
 *   1. Install the build under test and restart Zotero.
 *   2. For phase 4 (optional): open a COPY of assets/test_document.docx in
 *      Word as the front document. Never the original.
 *   3. Tools → Developer → Run JavaScript, "Run as async function" TICKED.
 *
 * Expected narrative output is the same table as EXPECTED in
 * test-offline/intext.test.ts. Keep the two in sync. If Zotero updates a
 * bundled style, a difference here may be the style's doing, not the
 * plugin's: compare with the offline tests before changing either.
 * ===================================================================== */

var LOG = [];
var RESULTS = [];
function log(...a) {
	LOG.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
}
function hr(t) { LOG.push(''); LOG.push('======== ' + t + ' ========'); }
function check(id, name, ok, detail) {
	const status = ok === true ? 'PASS' : ok === false ? 'FAIL' : 'WARN';
	RESULTS.push({ id, name, status, detail });
	log(`  ${status}  ${id}  ${name}` + (detail && status !== 'PASS' ? `\n        ${detail}` : ''));
}
function fail(phase, e) {
	check(phase, 'phase threw', false, (e && e.message) + '\n        ' +
		String(e && e.stack || '').split('\n').slice(0, 4).join('\n        '));
}

const VERIFIED_ZOTERO = '10.0.2';
const addon = Zotero.NarrativeCitations;
const STYLE = (name) => 'http://www.zotero.org/styles/' + name;

/* ------------------------------------------------------------------ */
hr('PHASE 0 — environment and plugin state');
try {
	log('Zotero ' + Zotero.version + ', citeproc ' + Zotero.CiteProc.CSL.PROCESSOR_VERSION);
	check('E1', 'Zotero is the version this was verified against (' + VERIFIED_ZOTERO + ')',
		Zotero.version === VERIFIED_ZOTERO ? true : null,
		Zotero.version === VERIFIED_ZOTERO ? '' : 'Other version: read phase 1 carefully.');
	check('E2', 'citeproc-js is 1.4.61',
		Zotero.CiteProc.CSL.PROCESSOR_VERSION === '1.4.61' ? true : null,
		'test-offline pins citeproc@2.4.63 (processor 1.4.61); update it to match.');
	check('E3', 'citeproc-rs is off (the plugin is untested with it)',
		!Zotero.Prefs.get('cite.useCiteprocRs') ? true : null);
	check('E4', 'plugin loaded and initialized', !!(addon && addon.data.initialized));
	check('E5', 'toJSON patch installed', !!(addon && addon.data.patched));
	check('E6', 'style engine patches installed', !!(addon && addon.data.intextPatched));
} catch (e) { fail('PHASE 0', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 1 — Zotero code the plugin depends on is still there');
// Each anchor is a line of Zotero 10.0.2 source that a patch or a design
// decision relies on (see the comments in src/ and DECISIONS.md). A missing
// anchor does not prove breakage; it means re-read that file before release.
try {
	const ANCHORS = {
		'xpcom/integration.js': [
			['saveProperties still lacks "mode" (why the toJSON patch exists)',
				'const saveProperties = ["custom", "unsorted", "formattedCitation", "plainCitation", "dontUpdate", "noteIndex"];'],
			['_updateCitations hands citeproc toJSON()', 'citation = citation.toJSON();'],
			['_updateDocument writes serialize()', 'var serializedCitation = citation.serialize();'],
			['restoreProcessorState passes live citations', 'this.style.rebuildProcessorState(citations, this.outputFormat, uncited);'],
			['dialog preview passes the live citation', 'this.style.previewCitationCluster(citation, citationsPre, citationsPost, format || "rtf");'],
			['Refresh merges adjacent citations', 'citation.mergeCitation(adjacentCitation);'],
			['setData builds the engine with getCiteProc', 'this.style = getStyle.getCiteProc(data.style.locale, this.outputFormat, {'],
			['resetSessionStyles exists (engine rebuild)', 'this.resetSessionStyles = async function () {'],
			['currentCommandPromise exists (rebuild waits on it)', 'Zotero.Integration.currentCommandPromise = deferred.promise;'],
			['currentSession is set per command (per-document capability)', 'Zotero.Integration.currentSession = session;'],
			['cancel() empties items then calls accept()', 'this.citation.citationItems = [];'],
		],
		'xpcom/style.js': [
			['getCiteProc reads getXML on the style instance', 'var xml = this.getXML();'],
			['_eventToEventTitle still follows it', 'xml = this._eventToEventTitle(xml);'],
		],
		'xpcom/citeproc.js': [
			['composite mode mutates properties.mode', 'citation.properties.mode = "author-only";'],
			['citeproc writes sortedItems onto the citation (guard copy-back)', 'citation.sortedItems = sortedItems;'],
			['previewCitationCluster goes through processCitationCluster', 'ret = this.processCitationCluster(citation, citationsPre, citationsPost, CSL.PREVIEW);'],
			['rebuildProcessorState goes through processCitationCluster', 'var res = this.processCitationCluster(citations[i],pre,post,CSL.ASSUME_ALL_ITEMS_REGISTERED);'],
		],
		'integration/citationDialog.js': [
			['dialog sort reads io.citation.sortedItems back', 'let sortedIOItems = io.citation.sortedItems.map((entry) => entry[1]);'],
			['updateCitationObject rebuilds citationItems only', 'io.citation.citationItems = this.items.map((item) => item.getCitationItem({ includeDialogReferenceID: !final }));'],
			['CitationDataManager exposed on window', 'window.CitationDataManager = CitationDataManager;'],
			['IOManager exposed on window', 'window.IOManager = IOManager;'],
			['item-details-updated refreshes bubbles and preview', 'doc.addEventListener("item-details-updated", () => this.updateBubbleInput());'],
		],
		'integration/citationDialog.xhtml': [
			['Omit Author row the checkbox is inserted after', 'id="suppress-author-container"'],
			['item details popup', 'id="itemDetails"'],
		],
	};
	for (const [file, anchors] of Object.entries(ANCHORS)) {
		let source;
		try {
			source = await Zotero.File.getContentsFromURLAsync('chrome://zotero/content/' + file);
		} catch (e) {
			check('S-' + file, 'read ' + file, null, e.message);
			continue;
		}
		anchors.forEach(([name, text], i) => {
			check(`S-${file}#${i + 1}`, name, source.includes(text) ? true : null,
				source.includes(text) ? '' : 'Not found: ' + text);
		});
	}
	const zoteroJS = await Zotero.File.getContentsFromURLAsync('chrome://zotero/content/xpcom/zotero.js');
	const a = zoteroJS.indexOf('Zotero.Integration.init();');
	const b = zoteroJS.indexOf('await Zotero.Plugins.init();');
	check('S-startup', 'Word integration still starts before plugins (README startup limitation)',
		a !== -1 && b !== -1 && a < b ? true : null,
		'If this changed, the startup limitation in README may no longer apply.');
} catch (e) { fail('PHASE 1', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 2 — saving and the narrative flag');
try {
	const embedded = (id) => ({ id, itemData: { id, type: 'book', title: 'Regression' } });
	const saved = (mode, n) => new Zotero.Integration.Citation({}, {
		citationID: 'REGRESSION',
		properties: mode ? { mode } : {},
		citationItems: Array.from({ length: n }, (_, i) => embedded('regression/' + i)),
	}).toJSON().properties.mode;

	check('F1', 'a single-item narrative citation keeps its flag when saved', saved('composite', 1) === 'composite');
	check('F2', 'a two-item citation is saved without the flag', saved('composite', 2) === undefined);
	check('F3', 'transient "author-only" is not saved', saved('author-only', 1) === undefined);
	check('F4', 'transient "suppress-author" is not saved', saved('suppress-author', 1) === undefined);
	check('F5', 'an unflagged citation stays unflagged', saved(undefined, 1) === undefined);

	const c = (mode) => ({ properties: mode ? { mode } : {}, citationItems: [{ id: 1 }] });
	check('F6', 'checkbox counts only "composite" as narrative',
		addon.api.isNarrative(c('composite')) === true &&
		addon.api.isNarrative(c('author-only')) === false &&
		addon.api.isNarrative(c('suppress-author')) === false &&
		addon.api.isNarrative(c()) === false);
} catch (e) { fail('PHASE 2', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 3 — engines built through the patched path');
// A throwaway session on the real prototype, so setData and getCiteProc run
// through the plugin's patches exactly as for a Word document. Items come from
// the table below instead of the library, so the output is predictable. This
// also runs synthesis on Firefox's own XML parser, which test-offline cannot.
const ITEMS = {
	one: { type: 'article-journal', title: 'One Author', author: [{ family: 'Okafor', given: 'Ngozi' }], issued: { 'date-parts': [[2022]] } },
	two: { type: 'article-journal', title: 'Two Authors', author: [{ family: 'Smyth', given: 'Jane' }, { family: 'Blitshteyn', given: 'Peter' }], issued: { 'date-parts': [[2025]] } },
	three: { type: 'article-journal', title: 'Three Authors', author: [{ family: 'Alvarez', given: 'Ana' }, { family: 'Brown', given: 'Bo' }, { family: 'Chen', given: 'Cy' }], issued: { 'date-parts': [[2023]] } },
	edited: { type: 'book', title: 'Edited Volume', editor: [{ family: 'Ruiz', given: 'Rosa' }, { family: 'Park', given: 'Min' }], issued: { 'date-parts': [[2020]] } },
	translated: { type: 'book', title: 'Translated Work', author: [{ family: 'Tolstoy', given: 'Leo' }], translator: [{ family: 'Garnett', given: 'Constance' }], issued: { 'date-parts': [[2019]] } },
	letter: { type: 'personal_communication', title: 'A Letter', author: [{ family: 'Novak', given: 'Petra' }], issued: { 'date-parts': [[2017]] } },
	interview: { type: 'interview', title: 'An Interview', author: [{ family: 'Lee', given: 'Sam' }], issued: { 'date-parts': [[2018]] } },
	interviewWithURL: { type: 'interview', title: 'An Online Interview', author: [{ family: 'Lee', given: 'Sam' }], URL: 'https://example.org/interview', issued: { 'date-parts': [[2016]] } },
	noAuthor: { type: 'webpage', title: 'Anonymous Page', issued: { 'date-parts': [[2021]] } },
};
for (const [id, item] of Object.entries(ITEMS)) item.id = id;

const EXPECTED = {
	'apa': { one: 'Okafor (2022)', two: 'Smyth and Blitshteyn (2025)', three: 'Alvarez et al. (2023)', edited: 'Ruiz and Park (2020)', translated: 'Tolstoy (2019)', letter: 'P. Novak (personal communication, 2017)', interview: 'S. Lee (personal communication, 2018)', interviewWithURL: 'Lee (2016)', noAuthor: 'Anonymous Page (2021)' },
	'american-political-science-association': { one: 'Okafor (2022)', two: 'Smyth and Blitshteyn (2025)', three: 'Alvarez, Brown, and Chen (2023)', edited: 'Ruiz and Park (2020)', translated: 'Tolstoy (2019)', letter: 'Novak (2017)', interview: 'Lee (2018)', interviewWithURL: 'Lee (2016)', noAuthor: 'Anonymous Page (2021)' },
	'american-sociological-association': { one: 'Okafor (2022)', two: 'Smyth and Blitshteyn (2025)', three: 'Alvarez, Brown, and Chen (2023)', edited: 'Ruiz and Park (2020)', translated: 'Tolstoy (2019)', letter: 'Novak (2017)', interview: 'Lee (2018)', interviewWithURL: 'Lee (2016)', noAuthor: 'Anonymous Page (2021)' },
	'chicago-author-date': { one: 'Okafor (2022)', two: 'Smyth and Blitshteyn (2025)', three: 'Alvarez et al. (2023)', edited: 'Ruiz and Park (2020)', translated: 'Tolstoy (2019)', letter: 'Petra Novak (“A Letter”)', interview: 'Sam Lee (“An Interview,” 2018)', interviewWithURL: 'Lee (2016)', noAuthor: 'Anonymous Page (2021)' },
	'elsevier-harvard': { one: 'Okafor (2022)', two: 'Smyth and Blitshteyn (2025)', three: 'Alvarez et al. (2023)', edited: 'Ruiz and Park (2020)', translated: 'Tolstoy (2019)', letter: 'Novak (2017)', interview: 'Lee (2018)', interviewWithURL: 'Lee (2016)', noAuthor: 'Anonymous Page (2021)' },
	'harvard-cite-them-right': { one: 'Okafor (2022)', two: 'Smyth and Blitshteyn (2025)', three: 'Alvarez, Brown and Chen (2023)', edited: 'Ruiz and Park (2020)', translated: 'Tolstoy (2019)', letter: 'Novak (2017)', interview: 'Lee (2018)', interviewWithURL: 'Lee (2016)', noAuthor: 'Anonymous Page (2021)' },
};
const UNSUPPORTED = {
	'ieee': 'no-names', 'nature': 'no-names', 'american-chemical-society': 'no-names',
	'american-medical-association': 'no-names', 'nlm-citation-sequence': 'no-names',
	'chicago-notes-bibliography': 'note-style', 'chicago-shortened-notes-bibliography': 'note-style',
	'mhra-notes': 'note-style', 'modern-language-association': 'no-date',
};

function useFixtureItems(engine) {
	engine.sys.retrieveItem = (id) => JSON.parse(JSON.stringify(ITEMS[id]));
	return engine;
}
async function patchedSession(name) {
	const session = Object.create(Zotero.Integration.Session.prototype);
	session.sessionID = 'regression-' + name;
	session.outputFormat = 'text';
	await session.setData({ style: { styleID: STYLE(name), locale: 'en-US' }, prefs: { automaticJournalAbbreviations: false } }, true);
	useFixtureItems(session.style);
	return session;
}
function stockEngine(name) {
	// Outside setData, so the plugin leaves it untouched.
	return useFixtureItems(Zotero.Styles.get(STYLE(name)).getCiteProc('en-US', 'text'));
}
const cite = (id, narrative) => ({
	properties: narrative ? { noteIndex: 0, mode: 'composite' } : { noteIndex: 0 },
	citationItems: [{ id }],
});
const preview = (engine, id, narrative) => engine.previewCitationCluster(cite(id, narrative), [], [], 'text');

try {
	await Zotero.Styles.init();
	for (const [name, expected] of Object.entries(EXPECTED)) {
		if (!Zotero.Styles.get(STYLE(name))) {
			check('R-' + name, name + ' installed', null, 'Style not installed; skipped.');
			continue;
		}
		try {
			const session = await patchedSession(name);
			const capability = addon.api.getSessionCapability(session);
			check('R-' + name + '-cap', name + ' is supported', capability && capability.supported === true, JSON.stringify(capability));
			check('R-' + name + '-intext', name + ' engine has a synthesized <intext>',
				!!(session.style.intext && session.style.intext.tokens.length));
			const wrong = [];
			for (const [id, text] of Object.entries(expected)) {
				const got = preview(session.style, id, true);
				if (got !== text) wrong.push(`${id}: expected ${JSON.stringify(text)}, got ${JSON.stringify(got)}`);
			}
			check('R-' + name + '-narrative', name + ' narrative output matches, all item types', wrong.length === 0, wrong.join('\n        '));
			const stock = stockEngine(name);
			const changed = Object.keys(expected).filter((id) => preview(session.style, id, false) !== preview(stock, id, false));
			check('R-' + name + '-paren', name + ' parenthetical output unchanged by the plugin', changed.length === 0, changed.join(', '));
		} catch (e) { fail('R-' + name, e); }
	}

	for (const [name, code] of Object.entries(UNSUPPORTED)) {
		if (!Zotero.Styles.get(STYLE(name))) {
			check('U-' + name, name + ' installed', null, 'Style not installed; skipped.');
			continue;
		}
		try {
			const session = await patchedSession(name);
			const capability = addon.api.getSessionCapability(session);
			check('U-' + name, `${name} is refused (${code})`,
				capability && capability.supported === false && capability.code === code, JSON.stringify(capability));
		} catch (e) { fail('U-' + name, e); }
	}

	// The IEEE dialog hang and its fix, on a guarded engine.
	const ieee = await patchedSession('ieee');
	const guard = Object.prototype.hasOwnProperty.call(ieee.style, 'processCitationCluster');
	check('G1', 'IEEE engine has the fallback guard', guard);
	const flagged = cite('two', true);
	const flaggedText = ieee.style.previewCitationCluster(flagged, [], [], 'text');
	check('G2', 'a flagged citation renders as an ordinary one under IEEE',
		flaggedText === preview(ieee.style, 'two', false) && !flaggedText.includes('NO_PRINTED_FORM'), JSON.stringify(flaggedText));
	check('G3', 'the flag stays on the citation', flagged.properties.mode === 'composite');
	let sortOK = false;
	try {
		// Verbatim from CitationDataManager.sort(), citationDialog.js.
		flagged.sortedItems.map((entry) => entry[1]);
		sortOK = true;
	} catch (e) {}
	check('G4', 'the dialog sort can read sortedItems back (the IEEE hang)', sortOK);

	const apa = await patchedSession('apa');
	check('G5', 'APA engine has no guard', !Object.prototype.hasOwnProperty.call(apa.style, 'processCitationCluster'));
} catch (e) { fail('PHASE 3', e); }

/* ------------------------------------------------------------------ */
hr('PHASE 4 — open Word documents (read-only)');
try {
	const sessions = Object.values(Zotero.Integration.sessions);
	log('open integration sessions: ' + sessions.length);
	sessions.forEach((s, i) => {
		const styleID = s.data && s.data.style && s.data.style.styleID;
		if (!s.style || !styleID) return;
		const capability = addon.api.getSessionCapability(s);
		const guarded = Object.prototype.hasOwnProperty.call(s.style, 'processCitationCluster');
		const intext = !!(s.style.intext && s.style.intext.tokens.length);
		const cited = Object.keys(s.citationsByIndex || {}).length;
		const registered = Object.keys((s.style.registry && s.style.registry.citationreg.citationById) || {}).length;
		log(`  session ${i}: ${styleID} supported=${capability && capability.supported} guard=${guarded} intext=${intext} citations=${cited} registered=${registered}`);
		if (capability && capability.supported) {
			check('D-session' + i, 'supported style: engine has <intext> and no guard', intext && !guarded,
				intext ? '' : 'No <intext>: engine built before the plugin started, and not rebuilt when it did. A Refresh does not rebuild engines; restart Zotero.');
		} else {
			check('D-session' + i, 'unsupported style: engine has the guard', guarded);
		}
		// A rebuilt engine starts empty. If it is not filled, the next Add/Edit
		// Citation fails until a Refresh (audit 2). Counts can differ slightly
		// with delayed citation updates, but an empty engine for a document with
		// citations is always wrong.
		check('D-registry' + i, 'engine holds this document\'s citations', cited === 0 || registered > 0,
			`citations=${cited} registered=${registered}`);
	});

	if (!Zotero.isMac) {
		check('D-word', 'read the Word document', null, 'Field reading is only implemented for Word for Mac.');
	} else {
		let fields = [];
		try {
			const mod = ChromeUtils.importESModule('chrome://zotero-macword-integration/content/zoteroMacWordIntegration.mjs');
			const doc = await new mod.Application().getActiveDocument();
			for (const f of await doc.getFields('Field')) {
				const code = await f.getCode();
				if (code.indexOf('CSL_CITATION') === -1) continue;
				const o = JSON.parse(code.slice(code.indexOf('{'), code.lastIndexOf('}') + 1));
				fields.push({ mode: o.properties && o.properties.mode, items: (o.citationItems || []).length, text: await f.getText() });
			}
			try { await doc.cleanup(); } catch (e) {}
			try { if (doc.complete) await doc.complete(); } catch (e) {}
		} catch (e) {
			check('D-word', 'read the Word document', null, 'No document read (' + e.message + '). Skip phase 4 if none is open.');
			fields = null;
		}
		if (fields) {
			fields.forEach((f, i) => log(`  [${i}] items=${f.items} mode=${f.mode || '(none)'} ${JSON.stringify(f.text)}`));
			const broken = fields.filter((f) => /NO_PRINTED_FORM|CSL STYLE ERROR/.test(f.text));
			check('D1', 'no citation shows [NO_PRINTED_FORM]', broken.length === 0, broken.map((f) => f.text).join(' | '));
			const multi = fields.filter((f) => f.mode === 'composite' && f.items !== 1);
			check('D2', 'no multi-item citation carries the narrative flag', multi.length === 0, multi.map((f) => f.text).join(' | '));
			const odd = fields.filter((f) => f.mode && f.mode !== 'composite');
			check('D3', 'no field code carries a mode other than "composite"', odd.length === 0, odd.map((f) => f.mode).join(', '));
		}
	}
} catch (e) { fail('PHASE 4', e); }

/* ------------------------------------------------------------------ */
hr('PART 2 — by hand in Word, on a fresh copy of assets/test_document.docx (APA)');
log(`
  Tick each off; any other outcome is a failure. Then re-run this script.

  A  Refresh. All five citations stay as they are, e.g. "(Smyth & Blitshteyn, 2025)".
  B  Edit citation 1, click its bubble, tick Narrative citation. The preview
     shows "Smyth and Blitshteyn (2025)". Accept: the document shows the same.
     Refresh: unchanged.
  C  Edit citation 1 again: the box is ticked. Untick, press Escape, click the
     bubble again: the box is ticked again. Cancel.
  D  Document Preferences → IEEE. Citation 1 shows a number, e.g. "[1]", not
     [NO_PRINTED_FORM].
  E  Edit citation 1: the box is enabled and ticked, and its tooltip says it
     appears as an ordinary citation. Press Escape, then Accept. The dialog
     CLOSES normally (it used to hang here).
  F  Edit citation 2: the box is disabled, with a tooltip about numbered
     citations. Cancel.
  G  Document Preferences → APA. Citation 1 reads "Smyth and Blitshteyn
     (2025)" again.
  H  Open a second copy of the test document and set it to IEEE. In this
     (APA) document, citation 2's box is enabled; in the IEEE copy it is
     disabled. Close the second copy without saving.
  I  At the end of this document, add a parenthetical citation, then directly
     after it, with no space, a narrative citation. Refresh. They merge into
     one ordinary citation of two works (phase 4: items=2 mode=(none)).
  J  Tools → Plugins: disable and re-enable Narrative Citations without
     touching Word in between. Re-run this script: phase 4 passes D-registry
     (any Word command refills the engine, so check before one). Then, WITHOUT
     refreshing first (a Refresh hides this failure): edit citation 3. The
     preview shows the citation, and Accept closes with no "error updating your
     document". Finally Refresh: citation 1 still reads "and", not "&".
  K  Optional, needs a Letter item with no archive, URL or publisher: cite it
     as narrative. It reads "X. Surname (personal communication, YEAR)".
`);

/* ------------------------------------------------------------------ */
hr('SUMMARY');
const count = (s) => RESULTS.filter((r) => r.status === s).length;
log(`${count('PASS')} PASS, ${count('FAIL')} FAIL, ${count('WARN')} WARN`);
for (const status of ['FAIL', 'WARN']) {
	RESULTS.filter((r) => r.status === status).forEach((r) =>
		log(`  ${status}  ${r.id}  ${r.name}` + (r.detail ? `\n        ${r.detail}` : '')));
}

try { Zotero.Utilities.Internal.copyTextToClipboard(LOG.join('\n')); } catch (e) {}
return LOG.join('\n');
