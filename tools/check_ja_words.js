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
global.lbWords = (lang, words) => { if (lang === 'ja') for (const k of Object.keys(words)) { if (k in dict) console.log(`duplicate entry: ${JSON.stringify(k)}`); dict[k] = words[k] } };
for (const f of fs.readdirSync(WEB).filter(f => /^i18n-ja-.*\.js$/.test(f)).sort()) {
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

const inScope = t => !only.length || [...used.get(t)].some(f => only.includes(f));
const missing = [...used.keys()].filter(t => !(t in dict) && inScope(t));
const unused = only.length ? [] : Object.keys(dict).filter(t => !used.has(t));
const badVars = Object.keys(dict).filter(k => { const a = (k.match(/\{\w+\}/g) || []).sort().join(), b = (String(dict[k]).match(/\{\w+\}/g) || []).sort().join(); return a !== b });
for (const t of missing) console.log(`missing: ${JSON.stringify(t)}  (${[...used.get(t)].join(', ')})`);
for (const t of unused) console.log(`unused entry: ${JSON.stringify(t)}`);
for (const t of badVars) console.log(`placeholders differ: ${JSON.stringify(t)} -> ${JSON.stringify(dict[t])}`);
for (const d of dynamic.filter(d => !only.length || only.some(f => d.startsWith(f + ':')))) console.log(`not checkable: ${d}`);
console.log(`${used.size} texts marked, ${Object.keys(dict).length} entries, ${missing.length} missing, ${unused.length} unused, ${badVars.length} placeholder mismatches`);
if (missing.length || badVars.length) process.exitCode = 1;
