#!/usr/bin/env node
/* Every interface text marked for translation has a Japanese entry, and every entry is still used.

   Reads tr('…') calls in web/*.js and data-i18n* attributes in web/*.html, and the entries in web/i18n-ja-*.js.
       node tools/check_ja_words.js          # all files; exit 1 if anything is missing
       node tools/check_ja_words.js map.js   # only texts used in web/map.js
   A tr() whose text is built at run time (a variable, or a template with ${…}) cannot be checked and is listed. */
'use strict';
const fs = require('fs');
const path = require('path');
const WEB = path.join(__dirname, '..', 'web');
const only = process.argv.slice(2);

const dict = {};
const byFile = {};   // dictionary file -> its entries
// setup.html loads only its own dictionary, so a text both pages use has an entry in each. That is fine while they agree.
let loading = null;
global.lbWords = (lang, words) => { if (lang === 'ja') for (const k of Object.keys(words)) { if (k in dict && dict[k] !== words[k]) { console.log(`two different translations: ${JSON.stringify(k)} -> ${JSON.stringify(dict[k])} / ${JSON.stringify(words[k])}`); process.exitCode = 1 } dict[k] = words[k]; byFile[loading][k] = words[k] } };
for (const f of fs.readdirSync(WEB).filter(f => /^i18n-ja-.*\.js$/.test(f)).sort()) {
  loading = f; byFile[f] = {};
  try { require(path.join(WEB, f)) } catch (e) { console.log(`${f}: ${e.message}`); process.exitCode = 1 }
}

const used = new Map();   // text -> files
const dynamic = [];
const unq = (q, s) => q === '`' ? s : JSON.parse(q === '"' ? '"' + s + '"' : '"' + s.replace(/\\'/g, "'").replace(/"/g, '\\"') + '"');
for (const f of fs.readdirSync(WEB).filter(f => /\.(js|html)$/.test(f) && !/^i18n/.test(f)).sort()) {
  const src = fs.readFileSync(path.join(WEB, f), 'utf8');
  const add = t => { if (!used.has(t)) used.set(t, new Set()); used.get(t).add(f) };
  for (const m of src.matchAll(/\btr\(\s*(?:(['"])((?:\\.|(?!\1)[^\\])*)\1|`((?:\\.|[^`\\])*)`|([^'"`)\s][^,)]*))/g)) {
    if (m[4] !== undefined) { dynamic.push(`${f}: tr(${m[4].trim()}…)`); continue }
    if (m[3] !== undefined) { if (m[3].includes('${')) { dynamic.push(`${f}: tr(\`${m[3].slice(0, 50)}…\`)`); continue } add(m[3]); continue }
    try { add(unq(m[1], m[2])) } catch (e) { dynamic.push(`${f}: could not read tr(${m[1]}${m[2].slice(0, 40)}…)`) }
  }
  for (const m of src.matchAll(/data-i18n(?:-aria|-title|-placeholder)?="([^"]*)"/g)) add(m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
}

// Each page has only the dictionaries it loads: a text on the main screen with its entry only in setup's file shows in English.
const pageMissing = [];
for (const page of fs.readdirSync(WEB).filter(f => /\.html$/.test(f))) {
  const html = fs.readFileSync(path.join(WEB, page), 'utf8');
  const scripts = [...html.matchAll(/<script src="\/ui\/([^"?]+)/g)].map(m => m[1]);
  const dicts = scripts.filter(f => byFile[f]);
  if (!dicts.length) continue;
  const files = new Set([page, ...scripts.filter(f => !/^i18n/.test(f))]);
  for (const [t, where] of used) {
    if ([...where].some(f => files.has(f)) && !dicts.some(d => t in byFile[d]) && t in dict) pageMissing.push(`missing on ${page}: ${JSON.stringify(t)}  (entry only in ${Object.keys(byFile).filter(d => t in byFile[d]).join(', ')})`);
  }
}
for (const line of pageMissing) console.log(line);
if (pageMissing.length) process.exitCode = 1;

const inScope = t => !only.length || [...used.get(t)].some(f => only.includes(f));
const missing = [...used.keys()].filter(t => !(t in dict) && inScope(t));
// i18n-ja-server.js entries are reached through tr(variable) (labels the server sends), so they never look used.
const unused = only.length ? [] : Object.keys(dict).filter(t => !used.has(t) && !(t in byFile['i18n-ja-server.js'] || {}));
const badVars = Object.keys(dict).filter(k => { const a = (k.match(/\{\w+\}/g) || []).sort().join(), b = (String(dict[k]).match(/\{\w+\}/g) || []).sort().join(); return a !== b });
for (const t of missing) console.log(`missing: ${JSON.stringify(t)}  (${[...used.get(t)].join(', ')})`);
for (const t of unused) console.log(`unused entry: ${JSON.stringify(t)}`);
for (const t of badVars) console.log(`placeholders differ: ${JSON.stringify(t)} -> ${JSON.stringify(dict[t])}`);
for (const d of dynamic.filter(d => !only.length || only.some(f => d.startsWith(f + ':')))) console.log(`not checkable: ${d}`);
console.log(`${used.size} texts marked, ${Object.keys(dict).length} entries, ${missing.length} missing, ${unused.length} unused, ${badVars.length} placeholder mismatches`);
if (missing.length || badVars.length) process.exitCode = 1;
