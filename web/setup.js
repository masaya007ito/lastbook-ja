'use strict';
/* Lastbook setup: choose a library and the local AI, then download, check, unpack and switch. The contract is docs/SETUP-API.md.
   Works on its own page in setup mode (no library, so none of /api/topics and the rest) and inside the app (Library → Library and local AI).
   Views: manage (what is here now), choose (what to get), job (progress, pause, errors), done. Plain fetch: in the app the bridge adds the key. */
(() => {
  const $ = s => document.querySelector(s);
  const main = $('#main'), live = $('#live');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const WIN = document.documentElement.classList.contains('plat-win');
  const UNIT = WIN ? 1024 : 1000;   // each system's own way of counting a gigabyte, so the numbers match Finder or Explorer
  const CAN = { removeAi: true, repair: true };   // one switch each, should a build of the engine be without remove-ai or repair
  const MANAGE_ASKED = /manage/.test(location.hash);   // #manage: the bridge allows no ?query on the top page

  const ICO = {
    disk: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 15h.01M11 15h6"/>',
    chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    gpu: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="9" cy="12" r="3"/><path d="M15 10h3M15 14h3"/>',
    book: '<path d="M4 4v16M9 4v16M14 5l4 15M3 20h18"/>',
    ai: '<path d="M4 5h16v11H9l-5 4z"/><path d="M9 9.5h6M9 12.5h4"/>',
    ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    pause: '<path d="M9 6v12M15 6v12"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    back: '<path d="M15 18 9 12l6-6"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    retry: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    repair: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8 6.2 21l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
    down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  };
  const ico = (k, cls) => `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${ICO[k] || ''}</svg>`;

  /* ------------------------------------------------------------ numbers */
  function size(b) {
    if (b == null || !isFinite(b)) return '';
    const g = b / UNIT ** 3;
    if (g >= 100) return Math.round(g).toLocaleString() + ' GB';
    if (g >= 1) return g.toFixed(1) + ' GB';
    const m = b / UNIT ** 2;
    return (m >= 10 ? Math.round(m) : m.toFixed(1)) + ' MB';
  }
  const ram = b => Math.round(b / 1024 ** 3) + ' GB';   // memory is counted in binary by both systems
  const rate = bps => bps > 0 ? (bps / UNIT ** 2 >= 10 ? Math.round(bps / UNIT ** 2) : (bps / UNIT ** 2).toFixed(1)) + ' MB/s' : '';
  function eta(s) {
    if (s == null || !isFinite(s) || s < 0) return '';
    if (s < 60) return tr('under a minute left');
    const m = Math.round(s / 60);
    if (m < 60) return tr('about {m} min left', { m });
    const h = Math.floor(m / 60), r = m % 60;
    return r ? tr('about {h} h {m} min left', { h, m: r }) : tr('about {h} h left', { h });
  }
  const home = p => String(p || '').replace(/^\/Users\/[^/]+/, '~').replace(/^[A-Z]:\\Users\\[^\\]+\\/i, '');   // ~/… on a Mac; Documents\… on Windows, as Explorer names it

  /* names the manifest sends in English (docs/SETUP-API.md): shown in the chosen language when known, as they are otherwise */
  const KNOWN = () => ({ Small: tr('Small'), Medium: tr('Medium'), All: tr('All') });
  const tt = t => { const k = KNOWN(); return Object.prototype.hasOwnProperty.call(k, t) ? k[t] : t };
  const packTitle = p => tt(p && p.title);
  const PACK_SUMMARY = () => ({
    'Essential first aid, water, food, shelter and repair knowledge.': tr('Essential first aid, water, food, shelter and repair knowledge.'),
    'Everything in the library: every video, document and encyclopedia, Wikipedia included, with detailed maps for the whole US.': tr('Everything in the library: every video, document and encyclopedia, Wikipedia included, with detailed maps for the whole US.'),
  });
  const MEDIUM_SUMMARY = 'Small, plus the core how-to videos, all documents, Wikibooks and a detailed map of California.';
  /* a list in words: "a", "a and b", "a, b and c" */
  const listWords = a => a.length < 2 ? (a[0] || '') : tr('{a} and {b}', { a: a.slice(0, -1).join(tr(', ')), b: a[a.length - 1] });

  /* ------------------------------------------------------------ the engine */
  async function call(path, body) {
    const opts = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    let r; try { r = await fetch('/api/setup/' + path, opts) } catch { throw Object.assign(new Error(tr('Lastbook did not answer. Close it and open it again.')), { status: 0 }) }
    let d = null; try { d = await r.json() } catch { }
    if (!r.ok && !(d && (d.error || d.need_bytes))) throw Object.assign(new Error(r.status === 404 ? tr('Not available.') : tr('Lastbook sent an unreadable reply.')), { status: r.status });
    return d;
  }
  const errCode = e => e && (typeof e === 'object' ? e.code : null);
  const errText = e => e && (typeof e === 'object' ? e.message || e.error : e);

  /* ------------------------------------------------------------ state */
  let S = null;           // GET state
  let view = 'choose';
  let choice = { pack: null, ai: false, map: null };   // map: the selected state code
  let folder = '';
  let shortfall = null;   // the answer to a start that had no room: {need_bytes, free_bytes}
  let pollT = 0;
  let confirmCancel = false, confirmRemove = false, confirmOld = false;
  let note = '', noteOk = false;
  let repair = null;      // a repair under way: {fixed} turns true once it had to download something

  const packs = () => (S.manifest && S.manifest.packs) || [];
  const model = () => ((S.manifest && S.manifest.models) || [])[0] || null;
  const cur = () => S.current || null;
  const packById = id => packs().find(p => p.id === id);
  function packNeedsInstall(pack) {
    if (!pack) return false;
    const current = cur();
    if (!current || pack.id !== current.pack) return true;
    return Boolean(pack.revision && pack.revision !== current.content_revision);
  }

  /* state maps (docs/SETUP-API.md, State maps). The person picks the state; Lastbook never looks for where it is */
  const maps = () => ((S.manifest && S.manifest.maps) || []).slice().sort((a, b) => String(a.title).localeCompare(String(b.title)));   // by name, as people look for theirs
  const mapById = id => maps().find(m => m.id === id);
  const mapName = id => id === 'us' ? tr('the whole US') : (mapById(id) || {}).title || id;
  /* the detailed map the library will have once the chosen pack is in: the person's state map, or the one the pack carries */
  const PACK_MAP = { medium: 'CA', all: 'us' };   // what the packs carry today; a manifest packs[].map, when there, wins
  const packMap = id => { const p = packById(id) || {}; return 'map' in p ? p.map || null : PACK_MAP[id] || null };
  const mapNow = () => { const c = cur() || {}; return choice.pack && choice.pack !== c.pack ? packMap(choice.pack) : (c.map && c.map !== 'base' ? c.map : packMap(c.pack)) };
  const selectedState = () => choice.map || (mapNow() !== 'us' && mapNow()) || ((cur() || {}).address_indexes || [])[0] || '';
  const addresses = () => (S.manifest && S.manifest.address_indexes) || [];
  const addressById = id => addresses().find(a => a.id === id);
  const addressAdds = () => { const a = addressById(selectedState()); return a && a.available !== false && !((cur() || {}).address_indexes || []).includes(a.id) ? a : null };
  const mapMissing = () => !selectedState();
  const mapAdds = () => choice.map && choice.map !== mapNow() && mapNow() !== 'us' ? mapById(choice.map) : null;
  function packSummary(p) {
    const text = p.summary || '';
    const known = PACK_SUMMARY();
    if (p.id !== 'medium' || !maps().length) return Object.prototype.hasOwnProperty.call(known, text) ? known[text] : text;
    // The manifest describes the archive's bundled map. Setup replaces it with the chosen state map.
    const state = selectedState();
    if (text === MEDIUM_SUMMARY) return tr('Small, plus the core how-to videos, all documents, Wikibooks and a detailed map of {state}.', { state: state ? mapName(state) : tr('your state') });
    return text.replace(/\ba detailed map of California\b/, () => 'a detailed map of ' + (state ? mapName(state) : 'your state'));
  }
  const packDl = p => p.download_bytes || (p.files || []).reduce((n, f) => n + (f.size || 0), 0);
  const SEP = WIN ? '\\' : '/', DATA = 'LastbookData';
  const asData = p => /[\\/]LastbookData[\\/]?$/i.test(p) ? p.replace(/[\\/]$/, '') : String(p).replace(/[\\/]$/, '') + SEP + DATA;
  /* a file already on this computer, of the right size, for a pack or the model: setup uses it instead of downloading */
  const foundFor = (kind, id) => (S.found || []).find(f => f.kind === kind && (f.size_ok !== false) && (kind === 'model' || f.id === id || f.pack === id));
  const aiFits = () => !!(S.hardware && S.hardware.ai && S.hardware.ai.fits);

  function diskFor(path) {
    const ds = (S.hardware && S.hardware.disks) || [];
    const norm = s => WIN ? String(s).toLowerCase().replace(/\//g, '\\') : String(s);
    const p = norm(path);
    let best = null;
    for (const d of ds) if (p.startsWith(norm(d.path)) && (!best || d.path.length > best.path.length)) best = d;
    return best || (path ? null : ds[0] || null);   // a folder on a disk the engine did not report: its free space is not known here
  }
  const diskName = d => !d ? tr('this disk') : d.name || (WIN ? (String(d.path).match(/^[A-Z]:/i) || [tr('this disk')])[0].toUpperCase()   // C:, D:
    : /^\/Volumes\/[^/]+/.test(d.path) ? d.path.split('/')[2] : /Linux/.test(navigator.platform || '') ? tr('this computer') : tr('this Mac'));

  function plan() {   // what the current choice adds: bytes to download, space it needs (download + unpacked + 2 GB, as the engine counts)
    const c = cur() || {};
    let dl = 0, need = 0;
    const p = packById(choice.pack);
    if (packNeedsInstall(p)) {
      const got = foundFor('pack', p.id);
      if (!got) dl += packDl(p);
      need += (got ? 0 : packDl(p)) + (p.installed_bytes || 0);
      if (p.id === c.pack) need += c.map_bytes || 0;
    }
    const m = model();
    if (choice.ai && m && !c.model && aiFits()) { const got = foundFor('model'); if (!got) { dl += m.size || 0; need += m.size || 0 } else need += m.size || 0 }
    const mp = mapAdds();
    if (mp) { const got = foundFor('map', mp.id); if (!got) dl += packDl(mp); need += (got ? 0 : packDl(mp)) + (mp.installed_bytes || 0) }
    const a = addressAdds();
    if (a) { dl += packDl(a); need += packDl(a) + (a.installed_bytes || 0) }
    if (need) need += 2 * 1000 ** 3;
    return { dl, need };
  }

  async function load() {
    try { S = await call('state') }
    catch (e) { main.innerHTML = `<div class="s-err" role="alert">${ico('warn')}<div><b>${tr('Setup could not start.')}</b><p>${esc(e.message)}</p><p><button class="btn" id="again">${tr('Try again')}</button></p></div></div>`; $('#again').onclick = load; return }
    const rf = (S.recommend || {}).folder;
    folder = folder || (cur() && cur().folder) || S.default_folder || (rf ? asData(rf) : '');
    if (!choice.pack) {
      const rec = S.recommend || {};
      const small = packById('small');
      choice.pack = small && small.available !== false ? 'small' : null;
      choice.ai = !!rec.ai && aiFits();
      if (cur()) { choice.pack = cur().pack; choice.ai = !!cur().model }
    }
    const j = S.job;
    if (j && j.state && j.state !== 'done' && !(j.state === 'failed' && errCode(j.error) === 'cancelled')) view = 'job';
    else if (j && j.state === 'done') view = 'done';
    else if (cur() || S.mode === 'manage' || MANAGE_ASKED) view = cur() ? 'manage' : 'choose';
    $('#sBack').hidden = !cur();
    render(true);
  }

  /* ------------------------------------------------------------ views */
  function render(focus) {
    clearTimeout(pollT);
    shapeKey = '';
    if (view === 'manage') manageView();
    else if (view === 'choose') chooseView();
    else if (view === 'job') jobView(S.job);
    else if (view === 'done') doneView();
    if (focus) { const h = main.querySelector('h1'); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }) } scrollTo(0, 0) }
  }
  function go(v) { view = v; confirmCancel = confirmRemove = confirmOld = false; note = ''; render(true) }

  /* ---- this computer */
  function computer() {
    const h = S.hardware || {}, d = diskFor(folder), tiles = [];
    if (d) tiles.push([ico('disk'), size(d.free_bytes), tr('free on {disk}', { disk: esc(diskName(d)) })]);
    if (h.ram_bytes) tiles.push([ico('chip'), ram(h.ram_bytes), h.unified_memory ? tr('memory, shared with graphics') : tr('memory')]);
    if (!h.unified_memory) {
      const g = (h.gpus || []).slice().sort((a, b) => (b.vram_bytes || 0) - (a.vram_bytes || 0))[0];
      tiles.push(g ? [ico('gpu'), g.vram_bytes ? ram(g.vram_bytes) : '—', tr('graphics: {name}', { name: esc(g.name) })] : [ico('gpu'), tr('None'), tr('graphics card for the AI')]);
    }
    return `<section class="s-pc" aria-label="${tr('This computer')}">${tiles.map(t => `<div class="s-tile">${t[0]}<b>${t[1]}</b><small>${t[2]}</small></div>`).join('')}</section>`;
  }
  function recommendLine() {
    const r = S.recommend || {}, p = packById(r.pack);
    if (!p) return r.why ? `<p class="s-rec bad">${ico('warn')}<span>${esc(r.why)}</span></p>` : '';
    const what = r.ai && aiFits() ? tr('{pack} with the local AI', { pack: esc(packTitle(p)) }) : esc(packTitle(p));
    return `<p class="s-rec">${ico('ok')}<span><b>${tr('Suggested: {what}.', { what })}</b> ${esc(r.why || '')}</span></p>`;
  }

  /* ---- choose */
  function chooseView() {
    const c = cur(), m = model();
    const packCards = packs().map(p => {
      const update = c && c.pack === p.id && packNeedsInstall(p);
      const off = p.available === false, here = c && c.pack === p.id && !update, rec = (S.recommend || {}).pack === p.id && !c;
      const badge = off ? `<span class="s-badge later">${tr('Coming later')}</span>` : update ? `<span class="s-badge rec">${tr('Update available')}</span>` : here ? `<span class="s-badge here">${tr('Installed')}</span>` : rec ? `<span class="s-badge rec">${tr('Suggested')}</span>` : '';
      return `<label class="s-opt${off ? ' off' : ''}">
        <input type="radio" name="pack" value="${esc(p.id)}"${choice.pack === p.id ? ' checked' : ''}${off ? ' disabled' : ''}>
        <span class="s-opt-in"><span class="s-opt-h"><b>${esc(packTitle(p))}</b>${badge}</span>
        <small data-pack-summary="${esc(p.id)}">${esc(packSummary(p))}</small>
        <span class="s-sizes">${off ? tr('Not ready to download yet') : here ? tr('On this computer') : `<span>${foundFor('pack', p.id) ? tr('Already downloaded') : tr('{size} download', { size: size(packDl(p)) })}</span><span>${tr('{size} on disk', { size: size(p.installed_bytes) })}</span>`}</span></span></label>`;
    }).join('');
    let ai = '';
    if (m && m.available !== false) {
      const has = c && c.model;
      ai = aiFits() || has
        ? `<label class="s-opt s-ai"><input type="checkbox" id="aiBox"${choice.ai || has ? ' checked' : ''}${has ? ' disabled' : ''}>
            <span class="s-opt-in"><span class="s-opt-h"><b>${tr('Local AI')}</b>${has ? `<span class="s-badge here">${tr('Installed')}</span>` : (S.recommend || {}).ai && !c ? `<span class="s-badge rec">${tr('Suggested')}</span>` : `<span class="s-badge">${tr('Optional')}</span>`}</span>
            <small>${tr('Answers questions from the library, in plain words. Works offline.')}</small>
            <span class="s-sizes">${has ? tr('On this computer') : foundFor('model') ? `<span>${tr('Already downloaded')}</span>` : `<span>${tr('About {size} download', { size: size(m.size) })}</span>`}</span></span></label>`
        : `<div class="s-opt s-ai off" role="group" aria-label="${tr('Local AI')}"><span class="s-opt-in"><span class="s-opt-h"><b>${tr('Local AI')}</b><span class="s-badge later">${tr('Not for this computer')}</span></span>
            <small>${esc((S.hardware.ai && S.hardware.ai.why) || tr('This computer does not have enough memory for it.'))}</small></span></div>`;
    }
    const found = (S.found || []).map((f, i) => f.rejected ? `<div class="s-found off">${ico('file')}<span><b>${esc(f.name || f.path.split(/[\\/]/).pop())}</b><small>${esc(home(f.path))} · ${tr('doesn’t match the published file, so it is not used')}</small></span></div>`
      : f.size_ok === false ? '' : `<div class="s-found">${ico(f.kind === 'library' ? 'folder' : 'file')}<span><b>${esc(f.kind === 'library' ? tr('A Lastbook library') : f.kind === 'model' ? tr('The local AI file') : (packById(f.id) ? tr('{title} library', { title: packTitle(packById(f.id)) }) : f.title || f.name))}</b><small>${esc(home(f.path))}${f.size ? ' · ' + size(f.size) : ''}</small></span>
        <button class="btn plain" data-use="${i}">${tr('Use the file you already have')}</button></div>`).join('');

    main.innerHTML = `${c ? `<button class="s-link" id="toManage">${ico('back')}<span>${tr('Library and local AI')}</span></button>` : ''}
      <h1>${c ? tr('Change the library') : tr('Set up Lastbook')}</h1>
      ${c ? '' : `<p class="lead">${tr('Choose your state and library. Lastbook downloads them for offline use.')}</p>`}
      ${computer()}
      ${c ? '' : recommendLine()}
      ${found ? `<h2>${tr('Found on this computer')}</h2><div class="s-founds">${found}</div>` : ''}
      <section id="mapBox" class="s-map-panel" aria-label="${tr('Your local map')}"></section>
      <h2 id="packH">${tr('Library')}</h2>
      <div class="s-opts" role="radiogroup" aria-labelledby="packH">${packCards}</div>
      ${ai ? `<h2>${tr('Local AI')}</h2>${ai}` : ''}
      <section class="s-sum" id="sum" aria-live="polite"></section>
      <div class="s-go">
        <button class="btn big" id="start"></button>
        ${c ? '' : `<button class="s-link" id="haveLib">${tr('Choose an existing library folder')}</button>`}
        <button class="s-link" id="haveFile">${tr('Choose a library zip or AI model file')}</button>
      </div>
      <p class="s-note" id="haveNote" hidden></p>`;
    main.querySelectorAll('input[name=pack]').forEach(r => r.onchange = () => { choice.pack = r.value; shortfall = null; mapSection(); summary() });
    const box = $('#aiBox'); if (box && !box.disabled) box.onchange = () => { choice.ai = box.checked; shortfall = null; summary() };
    main.querySelectorAll('[data-use]').forEach(b => b.onclick = () => useFile((S.found || [])[+b.dataset.use].path, b));
    $('#start').onclick = start;
    if ($('#toManage')) $('#toManage').onclick = () => go('manage');
    if ($('#haveLib')) $('#haveLib').onclick = () => haveLibrary(false);
    $('#haveFile').onclick = () => haveLibrary(true);
    mapSection();
    summary();
  }
  /* Map geometry and address indexes are separate downloads, chosen by state. */
  function mapSection() {
    const box = $('#mapBox'), now = mapNow();
    if (!box) return;
    main.querySelectorAll('[data-pack-summary]').forEach(el => { el.textContent = packSummary(packById(el.dataset.packSummary)) });
    const selected = selectedState();
    const opts = maps().map(m => {
      const a = addressById(m.id), included = now === 'us' || m.id === now;
      const addressIncluded = ((cur() || {}).address_indexes || []).includes(m.id);
      const off = !included && m.available === false;
      const bytes = (included ? 0 : packDl(m)) + (a && a.available !== false && !addressIncluded ? packDl(a) : 0);
      const details = off ? tr('coming later') : bytes ? tr('{size} download', { size: size(bytes) }) : tr('included');
      return `<option value="${esc(m.id)}"${selected === m.id ? ' selected' : ''}${off ? ' disabled' : ''}>${esc(m.title)} — ${details}</option>`;
    }).join('');
    const sel = mapById(selected), a = addressAdds();
    const mapIncluded = now === 'us' || selected === now;
    const bytes = (sel && !mapIncluded ? packDl(sel) : 0) + (a ? packDl(a) : 0);
    const disk = (sel && !mapIncluded ? sel.installed_bytes || 0 : 0) + (a ? a.installed_bytes || 0 : 0);
    const unavailable = selected && addresses().length && (!addressById(selected) || addressById(selected).available === false);
    let hint = !sel ? tr('Select your state to continue.') : bytes ? (mapIncluded && a ? tr('{size} download · {disk} on disk. Your map is already included; only the address index downloads.', { size: size(bytes), disk: size(disk) }) : tr('{size} download · {disk} on disk', { size: size(bytes), disk: size(disk) })) : tr('Your state map and available address index are already included.');
    if (unavailable) hint = (bytes ? tr('{size} download · {disk} on disk.', { size: size(bytes), disk: size(disk) }) : tr('Your state map is already included.')) + ' ' + tr('Street-address search is not available for this state yet.');
    box.innerHTML = `<h2>${ico('map')}${tr('Your local map')}</h2>
      <p class="s-mapnote">${tr('Local streets, buildings, water and places to get help. Available offline.')}</p>
      ${now === 'us' ? `<p class="s-mapnote">${tr('All includes every state map. Choose your state for offline street-address search.')}</p>` : ''}
      <label class="s-maplabel" for="mapSel">${tr('Choose your state')}</label>
      <select id="mapSel" class="s-select" required aria-describedby="mapHint"><option value="" disabled${selected ? '' : ' selected'}>${tr('Select a state')}</option>${opts}</select>
      <p class="s-hint" id="mapHint">${hint}</p>`;
    $('#mapSel').onchange = e => { choice.map = e.target.value; shortfall = null; mapSection(); summary(); $('#mapSel').focus() };
  }
  function summary() {
    const { dl, need } = plan(), d = diskFor(folder), free = d ? d.free_bytes : null;
    const short = shortfall || (need && free != null && free < need ? { need_bytes: need, free_bytes: free } : null);
    const pct = need && free ? Math.min(100, need / free * 100) : short ? 100 : 0;
    const c = cur();
    $('#sum').innerHTML = need ? `
      <div class="s-nums"><span><small>${tr('Download')}</small><b>${dl ? size(dl) : tr('None')}</b></span><span><small>${tr('Space needed')}</small><b>${size(short ? short.need_bytes : need)}</b></span><span><small>${tr('Free on {disk}', { disk: esc(diskName(d)) })}</small><b>${short ? size(short.free_bytes) : free != null ? size(free) : tr('Checked at start')}</b></span></div>
      ${free == null && !short ? '' : `<div class="s-meter${short ? ' bad' : ''}" role="img" aria-label="${tr('Uses {pct} percent of the free space', { pct: Math.round(pct) })}"><i style="width:${pct}%"></i></div>`}
      ${short ? `<p class="s-short">${ico('warn')}<span>${tr('Not enough room: this needs {need}, and {disk} has {free} free. Pick a smaller library or another folder.', { need: size(short.need_bytes), disk: esc(diskName(d)), free: size(short.free_bytes) })}</span></p>` : ''}
      ${folderRow()}`
      : `<p class="s-nothing">${c ? tr('This is what you have now.') : tr('Pick a library.')}</p>${c ? '' : folderRow()}`;
    const b = $('#start');
    b.disabled = !need || !!short || mapMissing();
    const newPack = c && packNeedsInstall(packById(choice.pack)), newAi = c && choice.ai && !c.model, newMap = c && mapAdds(), newAddresses = c && addressAdds();
    const parts = [newPack && packTitle(packById(choice.pack)), newAi && tr('the local AI'), newMap && tr('the {title} map', { title: newMap.title }), newAddresses && !newMap && tr('offline address search')].filter(Boolean);
    b.textContent = mapMissing() ? tr('Choose your state to continue') : !c ? tr('Download and install') : parts.length ? tr('Get {items}', { items: listWords(parts) }) : tr('Nothing to add');
    if (newPack && choice.pack === c.pack && !mapMissing()) b.textContent = tr('Download and install update');
    const ch = $('#chFolder'); if (ch) ch.onclick = pickFolder;
  }
  const folderRow = () => `<div class="s-folder">${ico('folder')}<span><small>${tr('Saves to')}</small><b title="${esc(folder)}">${esc(home(folder))}</b></span>${cur() ? '' : `<button class="btn plain" id="chFolder">${tr('Change…')}</button>`}</div>`;

  async function pickFolder() {
    const b = $('#chFolder'); b.disabled = true;
    try {
      const r = await call('pick', {});
      if (r && r.path) {
        folder = asData(r.path);
        if (r.free_bytes != null) (S.hardware.disks = S.hardware.disks || []).push({ path: r.path, name: r.disk, free_bytes: r.free_bytes });   // the chosen place's own disk
        shortfall = null;
        const pc = main.querySelector('.s-pc'); if (pc) pc.outerHTML = computer();
      }
      summary();
    } catch { b.disabled = false; b.textContent = tr('Can’t change here') }
  }
  async function haveLibrary(files) {
    const n = $('#haveNote');
    try {
      const r = await call('pick', { files });
      if (r && r.path) return useFile(r.path, $(files ? '#haveFile' : '#haveLib'));
      if (r && (r.cancelled || r.path === null)) return;
      throw 0;
    } catch {
      n.hidden = false;
      n.textContent = tr('The picker could not open. Try choosing the file or folder again.');
    }
  }
  async function useFile(path, btn) {
    if (btn) btn.disabled = true;
    try {
      const r = await call('use', { path });
      if (r && r.error) throw new Error(r.error);
      if (r && r.noted) { S = await call('state').catch(() => S); choice.ai = true; chooseView(); const n = $('#haveNote'); n.hidden = false; n.textContent = tr('The local AI file will be used. No need to download it.'); return }
      S.job = r; go(r.state === 'done' ? 'done' : 'job'); poll();
    } catch (e) {
      if (btn) btn.disabled = false;
      const n = $('#haveNote'); n.hidden = false; n.textContent = e.message;
    }
  }
  async function start() {
    if (mapMissing()) { $('#mapSel')?.focus(); return }
    const b = $('#start'); b.disabled = true;
    const r = await call('start', { pack: packNeedsInstall(packById(choice.pack)) ? choice.pack : null, ai: !!choice.ai && aiFits() && !(cur() || {}).model, map: mapAdds() ? choice.map : null, address_id: addressById(selectedState())?.available !== false && addressById(selectedState()) ? selectedState() : null, folder }).catch(e => ({ error: e.message }));
    if (r && r.need_bytes) { shortfall = r; summary(); return }
    if (!r || r.error) { b.disabled = false; const n = $('#haveNote'); n.hidden = false; n.textContent = (r && r.error) || tr('Setup could not start.'); return }
    S.job = r; go('job'); poll();
  }

  /* ---- manage */
  function manageView() {
    const c = cur(), p = packById(c.pack), m = model();
    const libraryUpdate = p && p.available !== false && packNeedsInstall(p);
    const o = [].concat(c.old || [])[0], old = o ? (typeof o === 'string' ? { path: o } : o) : null;   // the engine lists the paths it moved aside
    const larger = packs().filter(x => (x.installed_bytes || 0) > ((p && p.installed_bytes) || 0));
    const bigger = larger.filter(x => x.available !== false), later = larger.find(x => x.available === false);
    main.innerHTML = `<h1>${tr('Library and local AI')}</h1>
      <div class="s-have">
        <div class="s-row">${ico('book', 's-ri')}<span><b>${tr('{title} library', { title: esc(p ? packTitle(p) : c.pack || tr('Library')) })}</b><small>${libraryUpdate ? tr('Updated edition available') + ' · ' : p ? size(p.installed_bytes) + ' · ' : ''}${esc(home(c.folder))}</small></span>
          ${libraryUpdate ? `<button class="btn" id="libraryUpdate">${tr('Update {title}', { title: esc(packTitle(p)) })}</button>` : bigger.length ? `<button class="btn" id="upgrade">${ico('up')}${tr('Get {title}', { title: esc(packTitle(bigger[0])) })}</button>` : later ? `<span class="s-badge later">${tr('{title} comes later', { title: esc(packTitle(later)) })}</span>` : `<span class="s-badge here">${tr('The largest')}</span>`}</div>
        ${m && m.available !== false ? `<div class="s-row">${ico('ai', 's-ri')}<span><b>${tr('Local AI')}</b><small>${c.model ? tr('On this computer · {size}', { size: size(m.size) }) : aiFits() ? tr('Not installed · about {size}', { size: size(m.size) }) : esc((S.hardware.ai && S.hardware.ai.why) || tr('Not for this computer.'))}</small></span>
          ${c.model ? (!CAN.removeAi ? '' : confirmRemove ? `<span class="s-confirm"><button class="btn danger" id="rmYes">${tr('Remove')}</button><button class="btn plain" id="rmNo">${tr('Keep')}</button></span>` : `<button class="btn plain" id="rmAi">${tr('Remove')}</button>`) : aiFits() ? `<button class="btn" id="addAi">${tr('Add')}</button>` : ''}</div>` : ''}
        ${maps().length ? (() => { const mNow = c.map && c.map !== 'base' ? c.map : packMap(c.pack);
          return `<div class="s-row">${ico('map', 's-ri')}<span><b>${mNow ? tr('Detailed map: {name}', { name: esc(mapName(mNow)) }) : tr('Detailed map')}</b><small>${mNow ? (mNow === 'us' ? tr('Local streets and terrain everywhere') : tr('Local streets, buildings and terrain')) : tr('None yet. Add one for your state.')}</small></span>
          <button class="btn plain" id="mapCh">${(c.address_indexes || []).length ? tr('Choose state') : tr('Add address search')}</button></div>` })() : ''}
      </div>
      ${old ? `<div class="s-row s-old">${ico('folder', 's-ri')}<span><b>${tr('The old library is still here')}</b><small>${esc(home(old.path))}${old.bytes ? ' · ' + size(old.bytes) : ''}</small></span>${confirmOld ? `<span class="s-confirm"><span>${tr('Delete it for good?')}</span><button class="btn danger" id="oldYes">${tr('Delete')}</button><button class="btn plain" id="oldNo">${tr('Keep')}</button></span>` : `<button class="btn plain" id="rmOld">${ico('trash')}${tr('Delete it')}</button>`}</div>` : ''}
      ${computer()}
      ${CAN.repair ? `<div class="s-go left"><button class="btn plain" id="repair">${ico('repair')}${tr('Check and repair')}</button></div>` : ''}
      <p class="s-note${noteOk ? ' ok' : ''}" id="haveNote"${note ? '' : ' hidden'}>${esc(note)}</p>`;
    if ($('#libraryUpdate')) $('#libraryUpdate').onclick = () => { choice.pack = c.pack; choice.ai = !!c.model; go('choose') };
    if ($('#upgrade')) $('#upgrade').onclick = () => { choice.pack = bigger[0].id; choice.ai = !!c.model; go('choose') };
    if ($('#mapCh')) $('#mapCh').onclick = () => { choice.pack = c.pack; choice.ai = !!c.model; choice.map = null; go('choose'); const m = $('#mapSel'); if (m) m.focus() };
    if ($('#addAi')) $('#addAi').onclick = () => { choice.pack = c.pack; choice.ai = true; go('choose') };
    if ($('#rmAi')) $('#rmAi').onclick = () => { confirmRemove = true; manageView(); $('#rmNo').focus() };
    if ($('#rmNo')) $('#rmNo').onclick = () => { confirmRemove = false; manageView(); $('#rmAi').focus() };
    if ($('#rmYes')) $('#rmYes').onclick = () => act('remove-ai', tr('The local AI was removed.'));   // the engine stops the AI first
    if ($('#rmOld')) $('#rmOld').onclick = () => { confirmOld = true; manageView(); $('#oldNo').focus() };
    if ($('#oldNo')) $('#oldNo').onclick = () => { confirmOld = false; manageView(); $('#rmOld').focus() };
    if ($('#oldYes')) $('#oldYes').onclick = () => act('delete-old', tr('The old library is being deleted.'), { path: old.path });
    if ($('#repair')) $('#repair').onclick = async () => {
      const r = await call('start', { repair: true, ai: !!c.model }).catch(e => ({ error: e.message }));
      if (!r || r.error) { note = (r && r.error) || tr('Repair could not start.'); manageView(); return }
      repair = { fixed: false }; S.job = r; go('job'); poll();
    };
  }
  async function act(path, done, body) {
    const r = await call(path, body || {}).catch(e => ({ error: e.status === 404 ? tr('This Lastbook cannot do that yet.') : e.message }));
    confirmRemove = confirmOld = false;
    noteOk = !(r && r.error);
    if (r && r.error) note = r.error;
    else { note = done; S = await call('state').catch(() => S) }
    manageView();
    const n = $('#haveNote'); if (n) { n.tabIndex = -1; n.focus() }
  }

  /* ---- job */
  const STEPS = { pack: [['downloading', tr('Download')], ['verifying', tr('Check')], ['unpacking', tr('Unpack')], ['activating', tr('Finish')]],
                  model: [['downloading', tr('Download')], ['verifying', tr('Check')], ['activating', tr('Finish')]] };
  STEPS.map = [['downloading', tr('Download')], ['unpacking', tr('Unpack')]];   // the engine's map item: waiting, downloading, unpacking, done
  STEPS.addresses = STEPS.map;
  const WORD = { waiting: tr('Waiting'), downloading: tr('Downloading'), paused: tr('Paused'), verifying: tr('Checking'), unpacking: tr('Unpacking'), activating: tr('Finishing'), done: tr('Done'), failed: tr('Stopped') };
  const ACTIVE = new Set(['waiting', 'downloading', 'verifying', 'unpacking', 'activating']);
  let shapeKey = '', lastAct = null;   // lastAct: the button just pressed, so focus lands on what replaced it

  function errorBox(j) {
    const e = j.error, code = errCode(e) || j.code, c = cur();
    const safe = c ? tr('Your library is untouched and still works.') : tr('Nothing else on this computer was changed.');
    const d = diskFor(j.folder || folder);
    const T = {
      found_mismatch: (() => {   // a file of the person's own that did not match: nothing was downloaded, and their file is left alone
        const f = String((e && e.file) || ''), name = f.split(/[\\/]/).pop() || tr('file'), at = f.split(/[\\/]/).slice(-2, -1)[0];
        return [at ? tr('The {name} in {at} doesn’t match the published file, so it was not used.', { name: esc(name), at: esc(at) }) : tr('The {name} doesn’t match the published file, so it was not used.', { name: esc(name) }), tr('It was left as it is. Download it instead?'), 'download'];
      })(),
      no_space: [e && e.need_bytes ? tr('Not enough room on {disk}: this needs {need}, and {free} is free.', { disk: esc(diskName(d)), need: size(e.need_bytes), free: size(e.free_bytes) }) : tr('Not enough room on {disk}.', { disk: esc(diskName(d)) }), tr('Free some space, then retry, or go back and choose less.'), 'retry'],
      network: [tr('The internet connection dropped.'), tr('What is downloaded is kept. Retry when you are online again.'), 'retry'],
      checksum: [tr('The download came out damaged twice, so it was not used.'), tr('Retry to download it once more.'), 'retry'],
      unpack: [tr('Unpacking did not finish.'), tr('Check there is room on the disk, then retry.'), 'retry'],
      activate: [tr('The new library is ready but could not be switched in.'), tr('Retry, or close Lastbook and open it again.'), 'retry'],
      cancelled: [tr('The download was cancelled.'), tr('Start again when you are ready.'), 'back'],
    }[code] || [esc(errText(e) || tr('Something went wrong.')), tr('Retry, or go back and choose again.'), 'retry'];
    return `<div class="s-err" role="alert">${ico('warn')}<div><b>${T[0]}</b><p>${T[1]}${code === 'found_mismatch' && !c ? '' : ' ' + safe}</p>
      <p class="s-acts">${T[2] === 'retry' ? `<button class="btn" data-act="retry">${ico('retry')}${tr('Retry')}</button>` : T[2] === 'download' ? `<button class="btn" data-act="retry">${ico('down')}${tr('Download it')}</button>` : ''}<button class="btn ${T[2] === 'back' ? '' : 'plain'}" data-act="back">${tr('Choose again')}</button></p></div></div>`;
  }
  function itemHTML(it, j) {
    const FAILED_AT = { checksum: 'verifying', found_mismatch: 'verifying', unpack: 'unpacking', activate: 'activating' };
    const steps = STEPS[it.kind] || STEPS.pack;
    const st = it.state === 'paused' && noDownload(it) ? (it.paused_from && it.paused_from !== 'downloading' ? it.paused_from : 'verifying')
      : it.state === 'paused' || it.state === 'waiting' ? 'downloading' : it.state === 'failed' ? FAILED_AT[errCode(it.error) || errCode(j.error)] || 'downloading' : it.state;
    const at = it.state === 'done' ? steps.length : (it.state === 'waiting' || it.state === 'paused') && !it.bytes_done && !noDownload(it) ? -1 : Math.max(0, steps.findIndex(s => s[0] === st));
    const busy = ['verifying', 'activating'].includes(it.state) || (it.state === 'unpacking' && !it.bytes_total);
    return `<div class="s-item${it.state === 'failed' ? ' bad' : ''}${it.state === 'done' ? ' ok' : ''}" data-item="${esc(it.id)}" data-kind="${esc(it.kind)}">
      <div class="s-item-h">${ico(it.kind === 'model' ? 'ai' : it.kind === 'map' ? 'map' : 'book', 's-ri')}<b>${esc(itemTitle(it))}</b><span class="s-state" data-f="word">${it.state === 'done' ? ico('ok') : ''}${Object.hasOwn(WORD, it.state) ? WORD[it.state] : ''}</span></div>
      <div class="s-bar new${busy && j.state !== 'paused' ? ' busy' : ''}" role="progressbar" aria-label="${esc(it.title)}" aria-valuemin="0" aria-valuemax="100" data-f="bar"><i></i></div>
      <p class="s-line" data-f="line"></p>
      <ol class="s-steps" aria-label="${tr('Steps')}">${steps.map((s, i) => `<li class="${i < at ? 'done' : i === at && it.state !== 'failed' ? 'now' : i === at ? 'stop' : ''}">${s[1]}</li>`).join('')}</ol>
    </div>`;
  }
  const itemTitle = it => it.kind === 'model' ? tr('Local AI') : it.kind === 'map' ? tr('{title} map', { title: (mapById(it.id) || it).title || it.id }) : it.kind === 'addresses' ? it.title : it.id === 'library' || it.id === 'repair' || /library/i.test(it.title) ? it.title : tr('{title} library', { title: tt(it.title) });
  /* an item that needs nothing from the internet: the person's own file, or one stopped after its download was complete.
     source and paused_from come from the engine (docs/SETUP-API.md); without them, a complete download still counts */
  const noDownload = it => it.source === 'found' || (!!it.paused_from && it.paused_from !== 'downloading') || (it.bytes_total > 0 && it.bytes_done >= it.bytes_total);
  const STOPPED = { verifying: tr('Checking stopped'), unpacking: tr('Unpacking stopped'), activating: tr('Finishing stopped') };
  const behind = it => { const items = (S.job && S.job.items) || [], i = items.findIndex(x => x.id === it.id && x.kind === it.kind); return items.slice(0, i).some(x => x.state !== 'done' && !noDownload(x)) };
  function fillItem(el, it) {
    const pct = it.bytes_total ? Math.min(100, it.bytes_done / it.bytes_total * 100) : it.state === 'done' ? 100 : 0;
    const bar = el.querySelector('[data-f=bar]'), line = el.querySelector('[data-f=line]');
    const showPct = !bar.classList.contains('busy');
    bar.firstChild.style.width = (showPct ? pct : 100) + '%';
    if (showPct) bar.setAttribute('aria-valuenow', Math.round(pct)); else bar.removeAttribute('aria-valuenow');
    let t = '';
    if (it.state === 'done') t = it.bytes_total ? size(it.bytes_total) : '';
    else if (it.state === 'downloading') t = [tr('{done} of {total}', { done: size(it.bytes_done), total: size(it.bytes_total) }), rate(it.rate_bps), eta(it.eta_s)].filter(Boolean).join(' · ');
    else if (it.state === 'paused' && noDownload(it)) t = it.paused_from === 'unpacking' && it.bytes_done && it.bytes_total ? tr('{what} at {done} of {total}. Nothing to download.', { what: STOPPED[it.paused_from], done: size(it.bytes_done), total: size(it.bytes_total) }) : tr('{what}. Nothing to download.', { what: STOPPED[it.paused_from] || tr('Stopped') });
    else if ((it.state === 'waiting' || it.state === 'paused') && !it.bytes_done) t = it.bytes_total ? (behind(it) ? tr('{size} to download, after the one above', { size: size(it.bytes_total) }) : tr('{size} to download', { size: size(it.bytes_total) })) : '';
 else if (it.state === 'paused' || it.state === 'waiting' || it.state === 'failed') t = it.bytes_total && it.bytes_done ? tr('{done} of {total}', { done: size(it.bytes_done), total: size(it.bytes_total) }) : '';
    else if (it.state === 'verifying') t = tr('Making sure every byte is right');
    else if (it.state === 'unpacking') t = it.bytes_total ? tr('Unpacking: {done} of {total}', { done: size(it.bytes_done), total: size(it.bytes_total) }) + (it.eta_s != null ? ' · ' + eta(it.eta_s) : '') : tr('Opening the files into the library folder');
    else if (it.state === 'activating') t = it.kind === 'map' ? tr('Switching to the new map') : tr('Switching to the new library');
    line.textContent = t;
  }
  function jobView(j) {
    if (!j) { go(cur() ? 'manage' : 'choose'); return }
    if (j.state === 'done') { go('done'); return }
    const key = j.state + '|' + errCode(j.error) + '|' + confirmCancel + '|' + j.items.map(i => i.kind + ':' + i.id + ':' + i.state).join(',');
    const head = { paused: tr('Paused'), failed: errCode(j.error) === 'cancelled' ? tr('Cancelled') : tr('Stopped') }[j.state] || (repair && !repair.fixed ? tr('Checking the library') : repair ? tr('Repairing') : tr('Installing'));
    if (key !== shapeKey) {
      const had = lastAct || (document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.act : null);
      lastAct = null;
      const first = !shapeKey;
      shapeKey = key;
      const quiet = j.state === 'paused' && j.items.filter(i => i.state === 'paused').every(noDownload);
      const lead = quiet ? tr('Stopped when Lastbook closed. Resume to finish; nothing needs downloading.')
        : j.state === 'paused' ? tr('What is downloaded is kept. Resume when you are ready, even after closing Lastbook.')
        : j.state === 'failed' ? '' : tr('You can keep using this computer. Closing Lastbook pauses it.');
      main.innerHTML = `<h1>${head}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}
        ${j.state === 'failed' ? errorBox(j) : ''}
        <div class="s-items">${j.items.map(it => itemHTML(it, j)).join('')}</div>
        ${j.state === 'failed' ? '' : `<div class="s-go left">${confirmCancel
          ? `<span class="s-confirm"><span>${tr('Stop and throw away the download?')}</span><button class="btn danger" data-act="cancel-yes">${tr('Stop')}</button><button class="btn plain" data-act="cancel-no">${tr('Keep going')}</button></span>`
          : `${j.state === 'paused' ? `<button class="btn" data-act="resume">${ico('play')}${tr('Resume')}</button>` : j.state === 'downloading' || j.state === 'waiting' ? `<button class="btn plain" data-act="pause">${ico('pause')}${tr('Pause')}</button>` : ''}
             <button class="btn plain" data-act="cancel">${ico('x')}${tr('Cancel')}</button>`}</div>`}`;
      main.querySelectorAll('[data-act]').forEach(b => b.onclick = () => jobAct(b.dataset.act, b));
      const again = had && main.querySelector(`[data-act="${had}"]`) || (had && main.querySelector('[data-act]'));
      if (again) again.focus();
      else if (first) { const h = main.querySelector('h1'); h.tabIndex = -1; h.focus({ preventScroll: true }) }
      const s = j.state === 'failed' ? '' : head + (j.items.find(i => ACTIVE.has(i.state)) ? ': ' + WORD[j.items.find(i => ACTIVE.has(i.state)).state] + ' ' + j.items.find(i => ACTIVE.has(i.state)).title : '');
      if (s && live.textContent !== s) live.textContent = s;
    }
    const fresh = main.querySelectorAll('.s-bar.new');
    j.items.forEach(it => { const el = main.querySelector(`[data-item="${CSS.escape(it.id)}"][data-kind="${CSS.escape(it.kind)}"]`); if (el) fillItem(el, it) });
    if (fresh.length) { void main.offsetWidth; fresh.forEach(b => b.classList.remove('new')) }   // a new screen shows the bar where it is, without growing from nothing
  }
  async function jobAct(a, b) {
    if (a === 'back') { S = await call('state').catch(() => S); S.job = null; shortfall = null; go('choose'); return }   // fresh: found[] may now mark a file as not matching
    if (a === 'cancel') { confirmCancel = true; jobView(S.job); main.querySelector('[data-act="cancel-no"]').focus(); return }
    if (a === 'cancel-no') { confirmCancel = false; jobView(S.job); return }
    if (a === 'cancel-yes') { confirmCancel = false; a = 'cancel' }
    b.disabled = true; lastAct = a;
    try { const j = await call(a, {}); if (j && j.items) S.job = j } catch { }
    if (a === 'cancel') { S = await call('state').catch(() => S); S.job = null; go(cur() ? 'manage' : 'choose'); live.textContent = tr('The download was cancelled.'); return }
    jobView(S.job);
    poll();
  }
  function poll() {
    clearTimeout(pollT);
    if (!S.job || !ACTIVE.has(S.job.state)) return;
    pollT = setTimeout(async () => {
      try { const j = await call('job'); if (j) S.job = j } catch { pollT = setTimeout(poll, 3000); return }
      if (repair && S.job && S.job.items.some(i => i.state === 'downloading' || i.state === 'unpacking')) repair.fixed = true;
      if (view !== 'job') return;
      if (S.job && S.job.state === 'done') { go('done'); return }
      jobView(S.job);
      poll();
    }, 1000);
  }

  /* ---- done */
  function doneView() {
    const j = S.job || { items: [] }, fixed = repair && repair.fixed, checked = repair && !fixed;
    const got = listWords(j.items.filter(i => i.id !== 'repair' && i.id !== 'library').map(i => esc(itemTitle(i))));
    main.innerHTML = `<div class="s-done">${ico('ok', 's-big')}<h1>${checked ? tr('All good') : fixed ? tr('Repaired') : tr('Ready')}</h1>
      <p class="lead">${checked ? tr('The library was checked and is complete.') : fixed ? tr('A damaged part was downloaded again. The damaged copy is kept aside; you can delete it in Library and local AI.') : got ? tr('Installed: {items}.', { items: got }) : tr('The library is installed.')}</p>
      <button class="btn big" id="open">${tr('Open the library')}</button><p class="s-note" id="openNote" hidden></p></div>`;
    live.textContent = checked ? tr('The library was checked.') : tr('Installed. Ready to open.');
    $('#open').onclick = async () => {
      const b = $('#open'); b.disabled = true; b.textContent = tr('Opening your library…');
      const r = await call('finish', {}).catch(e => ({ error: e.message }));   // on {ok} the app relaunches itself into the library
      if (!r || r.error) { b.disabled = false; b.textContent = tr('Open the library'); const n = $('#openNote'); n.hidden = false; n.textContent = (r && r.error) || tr('The library did not open. Try again.') }
      else live.textContent = tr('Opening your library…');
    };
  }

  /* keyboard: Escape closes a question that is open */
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (confirmCancel) { confirmCancel = false; jobView(S.job); const b = main.querySelector('[data-act="cancel"]'); if (b) b.focus() }
    else if (confirmRemove || confirmOld) { const f = confirmRemove ? '#rmAi' : '#rmOld'; confirmRemove = confirmOld = false; manageView(); $(f).focus() }
  });
  /* the window comes back to the front: the job may have moved on, or a restart paused it */
  addEventListener('focus', () => { if (view === 'job') call('job').then(j => { if (j) { S.job = j; jobView(j); poll() } }).catch(() => { }) });

  load().then(() => { if (view === 'job') poll() });
})();
