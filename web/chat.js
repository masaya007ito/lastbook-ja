'use strict';
/* "Ask the library" — chat with the local model, grounded in the library. Conversations stay on this device only. */
const Chat = (() => {
  const STARTERS = [
    ['water', tr('The tap water is off. How do I make water safe to drink?')],
    ['hurt', tr('Someone has a deep cut that won’t stop bleeding. What do I do?')],
    ['power', tr('How do I run a generator safely during a power outage?')],
    ['food', tr('The fridge has been off for 6 hours. What food is still safe?')],
    ['sanitation', tr('The toilets don’t work. How do we make an emergency toilet?')],
    ['comms', tr('Phones are down. How can our household stay in contact?')],
    ['grow', tr('What vegetables can I plant this month?')],
    ['repair', tr('How do I change the oil on a Honda EU2200i generator?')],
  ];
  const ABOUT_STARTERS = { doc: [tr('Explain this page in simple words'), tr('What are the warnings on this page?'), tr('Is there a video that shows this?')],
    video: [tr('Summarise what this video shows'), tr('What safety points does this video make?'), tr('Find a manual page that covers the same thing')],
    topic: [tr('What should I do first?'), tr('What are the most important warnings?'), tr('Which video should I watch first?')] };
  const STATES = { starting: tr('Starting the local AI…'), thinking: tr('Thinking…'), searching: tr('Searching the library…'), reading: tr('Reading the pages it found…'), writing: tr('Writing the answer…') };
  let chats = load(), live = {};   // live[chatId] = {abort, state, steps}
  let status = null;

  function load() { try { return JSON.parse(localStorage.getItem('sg.chats')) || [] } catch { return [] } }
  const keep = () => { try { return localStorage.getItem('sg.chatKeep') !== 'no' } catch { return true } };
  function persist() { if (!keep()) return; try { localStorage.setItem('sg.chats', JSON.stringify(chats.slice(0, 60))) } catch { } }
  const byId = id => chats.find(c => c.id === id);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const count = () => chats.length;

  async function getStatus() {
    try { status = await (await fetch('/api/assistant/status')).json() } catch { status = { online: false, error: 'server' } }
    return status;
  }

  /* ---------------------------------------------------------------- page -- */
  let root = null, cur = null, aboutCtx = null;
  async function page(main, parts, q) {
    root = main;
    const id = parts[0];
    cur = id ? byId(id) : null;
    if (id && !cur) { swap('#/ask'); return }
    const about = q.get('about');
    aboutCtx = !cur && about ? await describe(about) : (cur && cur.about ? cur.aboutInfo : null);
    document.title = (cur ? cur.title : tr('Chat')) + ' · Lastbook';
    $('#tbTitle').textContent = cur ? cur.title : tr('Chat');
    main.innerHTML = `<div class="chat">
      <aside class="chat-side" id="chatSide" aria-label="${tr('Conversations')}">
        <div class="cs-head"><b>${tr('Chats')}</b><button class="iconbtn" id="closeSide" aria-label="${tr('Close chat list')}">${ico('back')}</button></div>
        <a class="btn plain" href="#/ask" id="newChat2">${ico('ask')}${tr('New chat')}</a>
        <ul class="cs-list" id="csList"></ul>
        <div class="cs-privacy">
          <label><input type="checkbox" id="keepChats" ${keep() ? 'checked' : ''}> ${tr('Keep chat history on this device')}</label>
          <p class="small muted">${tr('Chats stay on this device. Nothing is sent anywhere except this computer’s own assistant.')}</p>
          <button class="btn plain" id="clearChats">${tr('Delete all chats')}</button>
        </div>
      </aside>
      <section class="chat-main">
        <div class="chat-top">
          <button class="btn plain chat-histbtn" id="openSide" aria-label="${tr('Show chats')}">${ico("clock")}<span>${tr('Chats')}</span></button>
          <div class="chat-status" id="chatStatus" aria-live="polite"></div>
          <a class="btn plain" href="#/ask" id="newChat" aria-label="${tr('New chat')}">${ico('ask')}<span>${tr('New')}</span></a>
        </div>
        ${q.get('from') && !cur ? `<div style="margin:2px 0 8px">${backButton(q.get('from'))}</div>` : ''}
        <div class="ai-setup" id="aiSetup" hidden></div>
        <div class="chat-log" id="chatLog" role="log" aria-live="polite" aria-label="${tr('Conversation')}"></div>
        <form class="composer" id="composer">
          <div class="ctxchip" id="ctxChip" hidden></div>
          <div class="comp-row">
            <label class="sr" for="chatIn">${tr('Your question')}</label>
            <textarea id="chatIn" rows="1" placeholder="${tr('Ask a question…')}" enterkeyhint="send"></textarea>
            <button class="sendbtn" id="sendBtn" aria-label="${tr('Send')}">${ico("up")}</button>
          </div>
          <p class="comp-note">${tr('Answers come from the library on this computer and can be wrong. Check the linked pages; get trained help for anything serious.')}</p>
        </form>
      </section></div>`;
    renderSide(); renderCtx(); renderLog();
    const ta = $('#chatIn');
    ta.addEventListener('input', autosize);
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit() }
      if (e.key === 'Escape') stop();
    });
    $('#composer').addEventListener('submit', e => { e.preventDefault(); if (busy()) return stop(); send(ta.value) });
    $('#openSide').onclick = () => $('#chatSide').classList.add('open');
    $('#closeSide').onclick = () => $('#chatSide').classList.remove('open');
    $('#keepChats').onchange = e => {
      try { localStorage.setItem('sg.chatKeep', e.target.checked ? 'yes' : 'no') } catch { }
      if (!e.target.checked) { try { localStorage.removeItem('sg.chats') } catch { } toast(tr('Chats will be forgotten when you close this page')) } else { persist(); toast(tr('Chats will be kept on this device')) }
    };
    $('#clearChats').onclick = () => { if (!confirm(tr('Delete all chats on this device?'))) return; Object.values(live).forEach(l => l.abort && l.abort()); chats = []; try { localStorage.removeItem('sg.chats') } catch { } location.hash = '#/ask' };
    leaving = () => { document.removeEventListener('keydown', escStop) };
    document.addEventListener('keydown', escStop);
    statusLine();
    const initial = q.get('q');
    if (initial && !cur) { history.replaceState(null, '', '#/ask'); send(initial) }
    else if (matchMedia('(hover:hover)').matches) setTimeout(() => ta.focus({ preventScroll: true }), 60);
    const y = scrolls[here()];
    if (y != null) requestAnimationFrame(() => scrollTo(0, y)); else if (cur && cur.messages.length) scrollEnd(true); else scrollTo(0, 0);   // a new chat opens at its top
  }
  const escStop = e => { if (e.key === 'Escape' && busy()) stop() };
  function autosize() { const ta = $('#chatIn'); if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px' }
  const busy = () => cur && live[cur.id] && live[cur.id].running;
  // The optional local AI (desktop app): [ready?, the line to show]. The server version has no s.local.
  function localLine(l) {
    const gb = n => (n / 1e9).toFixed(0) + ' GB';
    return ({
      ready: [true, tr('Local AI ready')],
      stopped: [true, tr('Local AI ready · it starts when you ask')],
      loading: [true, l.pct ? tr('Starting the local AI {pct}%', { pct: l.pct }) : tr('Starting the local AI…')],
      checking: [false, l.pct != null ? tr('Checking the local AI file {pct}%', { pct: l.pct }) : tr('Checking the local AI file…')],
      measuring: [false, tr('Checking this computer’s memory…')],
      absent: [false, tr('No local AI added')],
      wrong: [false, l.message || tr('The local AI file is not the right one.')],
      too_big: [false, l.message || tr('The local AI needs about {gb} of memory.', { gb: gb(l.needs_bytes || 0) })],
      off: [false, tr('Local AI is off')],
      error: [false, l.message || tr('The local AI could not start.')],
    })[l.state] || [false, l.message || tr('Local AI unavailable')];
  }
  let polling = null;
  async function statusLine() {
    const s = await getStatus(), el = $('#chatStatus'); if (!el) return;
    const ix = s.index || {}, l = s.local;
    const still = ix.state === 'indexing' || ix.state === 'indexing (other process)' ? ` · <span class="muted">${tr('still indexing ({n} passages so far)', { n: (ix.chunks || 0).toLocaleString() })}</span>` : '';
    if (l && (/ready|stopped|loading/.test(l.state) || !s.online)) {
      const [ok, line] = localLine(l);
      el.innerHTML = `<span class="${ok ? 'dotok' : 'dotoff'}"></span><span>${esc(line)}${ok ? still : '<span class="long"> — ' + tr('search and reading still work') + '</span>'}</span>`;
    } else {
      el.innerHTML = s.online ? `<span class="dotok"></span>${tr('Local assistant ready')}${still}`
        : `<span class="dotoff"></span><span>${tr('Assistant offline')}<span class="long"> — ${tr('search and browsing still work')}</span></span>`;
    }
    const sb = $('#sendBtn'); if (sb) sb.title = s.online ? tr('Send') : tr('The assistant is offline; you will get matching pages instead');
    setupCard(s);
    clearTimeout(polling);
    if (l && /checking|measuring|loading/.test(l.state) && $('#chatStatus')) polling = setTimeout(statusLine, 1000);
  }
  // How to add the local AI, on a new chat when it is missing, wrong or off. The file comes from the website, outside the app.
  function setupCard(s) {
    const box = $('#aiSetup'), l = s.local; if (!box) return;
    const show = !!l && !s.online && /absent|wrong|off|error/.test(l.state) && !(cur && cur.messages.length);
    box.hidden = !show;
    if (!show) return;
    box.innerHTML = l.state === 'off'
      ? `<p>${tr('The local AI is turned off.')}</p><div class="row"><button class="btn" data-ai="on">${tr('Turn on')}</button></div>`
      : l.state === 'error' ? `<p>${esc(l.message || tr('The local AI could not start.'))}</p><div class="row"><button class="btn" data-ai="rescan">${tr('Look again')}</button></div>`
      : `<p>${tr('<b>Add the local AI to get written answers.</b> It is about 17 GB, and runs on this computer only.')}</p>
         <div class="row"><a class="btn" href="/ui/setup.html#manage">${tr('Add the local AI')}</a><button class="btn plain" data-ai="rescan">${tr('Look again')}</button></div>
         <p class="small">${tr('Already downloaded <code>{file}</code>? Put it in your <b>LastbookData</b> folder or Downloads, then Look again.', { file: esc(l.file) })}</p>`;
    $$('[data-ai]', box).forEach(b => b.onclick = async () => {
      b.disabled = true;
      try { await fetch('/api/assistant/local', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: b.dataset.ai }) }) } catch { }
      setTimeout(statusLine, 300);
    });
  }
  async function describe(about) {
    const [kind, id, n] = about.split(':');
    try {
      if (kind === 'topic') { const t = (await topics()).find(x => x.id === id); return { about, label: t ? (SHORT[id] || t.title) : id, sub: tr('Guide'), kind } }
      const d = await api('/api/doc/' + encodeURIComponent(id));
      return { about, kind, label: d.title, sub: kind === 'video' ? (n ? tr('Video at {time}', { time: clock(+n) }) : tr('Video')) : tr('Page {n}', { n: n || 1 }), href: kind === 'video' ? `#/watch/${encodeURIComponent(id)}${n ? '?t=' + n : ''}` : `#/read/${encodeURIComponent(id)}?p=${n || 1}` };
    } catch { return null }
  }
  function renderCtx() {
    const el = $('#ctxChip'); if (!el) return;
    const a = aboutCtx;
    if (!a) { el.hidden = true; return }
    el.hidden = false;
    el.innerHTML = `${ico(a.kind === 'video' ? 'video' : a.kind === 'topic' ? 'book' : 'page')}<span>${tr('Asking about:')} <b>${esc(a.label)}</b> <span class="muted">${esc(a.sub || '')}</span></span>${cur && cur.messages.length ? '' : `<button type="button" aria-label="${tr('Don’t use this as context')}" id="ctxX">×</button>`}`;
    const x = $('#ctxX'); if (x) x.onclick = () => { aboutCtx = null; renderCtx(); renderLog() };
  }
  function renderSide() {
    const el = $('#csList'); if (!el) return;
    el.innerHTML = chats.length ? chats.map(c => { const n = c.messages.filter(m => m.role === 'user').length; return `<li><a href="#/ask/${c.id}" ${cur && cur.id === c.id ? 'aria-current="page"' : ''}><b>${esc(c.title)}</b><small>${new Date(c.updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${n > 1 ? tr('{n} questions', { n }) : tr('{n} question', { n })}</small></a><button class="iconbtn" data-del="${c.id}" aria-label="${tr('Delete this chat')}">×</button></li>` }).join('')
      : `<li class="muted small" style="padding:8px 4px">${tr('No chats yet.')}</li>`;
    const clr = $('#clearChats'); if (clr) clr.hidden = !chats.length;   // nothing to delete
    $$('[data-del]', el).forEach(b => b.onclick = () => { const id = b.dataset.del; live[id]?.abort?.(); chats = chats.filter(c => c.id !== id); persist(); if (cur && cur.id === id) location.hash = '#/ask'; else renderSide() });
    // the list fades at an edge with more chats past it, so a row cut off there reads as more to scroll to
    const edge = () => { const more = el.scrollHeight - el.clientHeight; el.classList.toggle('more-b', more > 1 && el.scrollTop < more - 1); el.classList.toggle('more-t', more > 1 && el.scrollTop > 1) };
    el.onscroll = edge; edge();
    if (!el.lbEdge) { el.lbEdge = new ResizeObserver(edge); el.lbEdge.observe(el) }
  }

  /* --------------------------------------------------------------- log --- */
  function renderLog() {
    const log = $('#chatLog'); if (!log) return;
    if (!cur || !cur.messages.length) {
      const st = aboutCtx ? ABOUT_STARTERS[aboutCtx.kind] || [] : null;
      log.innerHTML = `<div class="chat-empty">
        <div class="ce-mark">${ico('ask')}</div>
        <h1>${tr('Chat')}</h1>
        <p class="lead">${tr('Answers are built only from the manuals, guides and video transcripts on this computer — with the exact page or video moment for each point.')}</p>
        <div class="starters">${(st ? st.map(t => ['ask', t]) : STARTERS).map(([i, t]) => `<button class="starter" ${tcStyle(i)} data-start="${esc(t)}"><span class="ico">${ico(i)}</span><span>${esc(t)}</span></button>`).join('')}</div>
        <p class="small muted" style="margin-top:18px">${tr('It reads text only: it can’t see inside videos without captions, scanned pages without text, or raw map files. It tells you when the library has nothing on a question.')}</p></div>`;
      $$('[data-start]', log).forEach(b => b.onclick = () => send(b.dataset.start));
      fitEmpty();
      return;
    }
    log.innerHTML = cur.messages.map((m, i) => m.role === 'user' ? `<div class="msg user"><div class="bubble">${esc(m.content)}</div></div>` : `<div class="msg bot" id="m${i}">${botHtml(m, i)}</div>`).join('');
    wire(log);
  }
  // The page itself never scrolls while a chat is empty: in a window too short for every suggestion (or with lines wrapped narrow beside
  // the chats column), the last ones go, a row at a time down to one row, then the note under them, the introduction and the mark.
  function fitEmpty() {
    const e = $('.chat-empty'); if (!e) return;
    const all = $$('.starter', e), extra = ['p.small', '.lead', '.ce-mark'].map(s => $(s, e)).filter(Boolean);
    [...all, ...extra].forEach(x => x.style.removeProperty('display'));
    const over = () => document.scrollingElement.scrollHeight > innerHeight;
    if (!over()) return;
    const shown = all.filter(x => x.offsetWidth);
    for (let k = shown.length; k > 2 && over(); k -= 2) shown.slice(k - 2, k).forEach(x => x.style.display = 'none');
    for (const x of extra) if (over()) x.style.display = 'none';
  }
  addEventListener('resize', () => { if ($('.chat-empty')) fitEmpty() });
  function updateBot(i) {
    const el = $('#m' + i); if (!el || !cur) return renderLog();
    el.innerHTML = botHtml(cur.messages[i], i); wire(el);
  }
  function botHtml(m, i) {
    const l = live[cur.id], running = l && l.running && i === cur.messages.length - 1;
    const steps = (m.steps || []).map(s => `<li>${stepText(s)}</li>`).join('');
    const found = m.sources || [];
    let h = '';
    if (running) h += `<div class="working"><span class="pulse"></span><b>${esc(STATES[m.state] || tr('Working…'))}${m.state === 'starting' && m.pct ? ` ${m.pct}%` : ''}</b>${steps ? `<ul class="steps">${steps}</ul>` : ''}</div>`;
    if (m.error) h += `<div class="ans-error">${ico('warn')}<div><b>${esc(m.error)}</b>${m.offline ? `<p>${tr('You can keep browsing and searching. Here are the pages that best match your question:')}</p>` : ''}</div></div>`;
    if (m.content) h += `<div class="answer">${md(m.content, m)}</div>`;
    if (running && found.length) h += `<div class="prefound"><p class="small muted">${tr('Pages found so far — you can open them while the answer is written:')}</p>${srcCards(found.slice(0, 6), true)}</div>`;
    if (m.fallback) h += srcCards(m.fallback, true);
    if (!running && m.content) {
      const cited = m.cited || [];
      if ((m.invalid || []).length) h += `<p class="small" style="color:var(--stop)">${tr('The model referred to sources that don’t exist ({keys}); those markers were removed.', { keys: esc(m.invalid.join(', ')) })}</p>`;
      h += `<div class="legend small"><span><span class="lg-c">1</span> ${tr('linked to a page or video')}</span><span><span class="lg-u">${tr('dotted')}</span> ${tr('the model’s own wording, not linked to a source')}</span></div>`;
      if (cited.length) h += `<h3 class="srch">${tr('Sources ({n})', { n: cited.length })}</h3>${srcCards(cited, false)}`;
      else h += `<p class="notice small">${tr('This answer has no linked sources. Treat it as unverified.')}</p>`;
      const other = (m.consulted || []).filter(s => s.kind !== 'place');
      if (other.length) h += `<details class="also"><summary>${tr('Also looked at ({n}, not used)', { n: other.length })}</summary>${srcCards(other.slice(0, 10), true)}</details>`;
      if ((m.steps || []).length) {
        const nst = m.steps.length, stepsLbl = nst === 1 ? tr('{n} step', { n: nst }) : tr('{n} steps', { n: nst });
        const how = m.latency ? tr('How it searched ({steps}, {s}s)', { steps: stepsLbl, s: m.latency.total_s }) : tr('How it searched ({steps})', { steps: stepsLbl });
        h += `<details class="also"><summary>${how}</summary><ul class="steps">${steps}</ul></details>`;
      }
      h += `<div class="ans-actions"><button class="btn plain" data-act="copy" data-i="${i}">${tr('Copy')}</button><button class="btn plain" data-act="save" data-i="${i}">${ico('save')}${tr('Save answer')}</button><button class="btn plain" data-act="export">${tr('Export chat')}</button>${i === cur.messages.length - 1 ? `<button class="btn plain" data-act="retry">${tr('Ask again')}</button>` : ''}</div>`;
    }
    return h;
  }
  function stepText(s) {
    const a = s.args || {}, r = s.summary || {};
    if (s.name === 'search_library') {
      const cnt = r.count === 1 ? tr('{n} passage', { n: r.count }) : tr('{n} passages', { n: r.count ?? '…' });
      return `${tr('Searched “{query}”', { query: esc(a.query || '') })}${a.kind && a.kind !== 'any' ? ' ' + tr('({kind}s)', { kind: esc(a.kind) }) : ''} — ${cnt}`;
    }
    if (s.name === 'read_pages') return r.error ? tr('Tried to read an unknown document') : (a.pages || []).length > 1 ? tr('Read {title}, pages {pages}', { title: esc(r.title || a.doc_id), pages: (a.pages || []).join(', ') }) : tr('Read {title}, page {pages}', { title: esc(r.title || a.doc_id), pages: (a.pages || []).join(', ') });
    if (s.name === 'view_page') return r.error ? tr('Couldn’t view that page') : tr('Looked at the picture of {title}, page {page}', { title: esc(r.title || ''), page: esc(a.page) });
    if (s.name === 'get_timed_transcript') return r.error ? tr('No transcript for {title}', { title: esc(r.title || tr('that video')) }) : tr('Read the transcript of {title}', { title: esc(r.title || '') });
    if (s.name === 'lookup_place') return tr('Looked up “{query}” on the offline map', { query: esc(a.query || '') });
    if (s.name === 'found') return s.count === 1 ? tr('Matched {n} passage for your question', { n: s.count }) : tr('Matched {n} passages for your question', { n: s.count });
    return esc(s.name);
  }
  function srcHref(s) {
    if (s.kind === 'place') return `#/map?lat=${s.lat}&lon=${s.lon}&z=16&pin=${encodeURIComponent(s.title || s.name || tr('Place from the answer'))}`;
    if (s.kind === 'video') return `#/watch/${encodeURIComponent(s.doc_id)}?${s.t != null ? 't=' + Math.floor(s.t) + '&' : ''}from=${encodeURIComponent(here())}`;
    return `#/read/${encodeURIComponent(s.doc_id)}?${s.page ? 'p=' + s.page + '&' : ''}from=${encodeURIComponent(here())}`;
  }
  function srcCards(list, compact) {
    return `<div class="srccards ${compact ? 'compact' : ''}">${list.map(s => {
      let pv;
      if (s.kind === 'video') pv = `<span class="pv v">${s.thumb ? `<img loading="lazy" alt="" src="${fileUrl(s.thumb)}">` : ''}<span class="pg">${s.t != null ? clock(s.t) : tr('video')}</span></span>`;
      else if (s.kind === 'pdf' && s.page) pv = `<span class="pv"><img loading="lazy" alt="" src="/api/page/${encodeURIComponent(s.doc_id)}/${s.page}.png?w=300" onerror="this.remove()"><span class="pg">${tr('p. {n}', { n: s.page })}</span></span>`;
      else pv = `<span class="pv w">${ico(s.kind === 'place' ? 'pin' : 'page')}</span>`;
      const where = s.kind === 'video' ? (s.t != null ? tr('at {time}', { time: clock(s.t) }) : '') : s.page ? (s.pages ? tr('page {page} of {pages}', { page: s.page, pages: s.pages }) : tr('page {page}', { page: s.page })) : '';
      return `<a class="srccard" href="${srcHref(s)}" id="src-${esc(s.key || '')}">${pv}<span class="sc-body">${s.key ? `<span class="sc-key">${esc(s.key.replace(/^S/, ''))}</span>` : ''}<b>${esc(s.title)}</b>
        <small>${esc(s.publisher || '')}${s.year ? ' · ' + esc(s.year) : ''}${where ? ' · ' + where : ''}${s.trust ? ' · ' + esc(tr(s.trust)) : ''}</small>
        ${!compact && s.excerpt ? `<span class="sc-ex">“${esc(s.excerpt.slice(0, 220))}${s.excerpt.length > 220 ? '…' : ''}”</span>` : ''}
        ${s.image ? `<span class="sc-tag">${tr('diagram viewed')}</span>` : ''}</span></a>`;
    }).join('')}</div>`;
  }

  /* markdown-lite with citation chips; sentences without a citation are marked as the model's own wording */
  function md(text, m) {
    const keys = new Set((m.cited || m.sources || []).map(s => s.key));
    const cite = k => keys.has(k) || !m.cited ? `<a class="cite" href="#src-${k}" data-key="${k}" title="${tr('Source {key}', { key: k })}">${k.replace(/^S/, '')}</a>` : '';
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, '$1<em>$2</em>')
      .replace(/\[([SM]\d+)\]/g, (_, k) => cite(k));
    const lines = text.replace(/\r/g, '').split('\n');
    let out = '', list = null, section = 'main';
    const close = () => { if (list) { out += `</${list}>`; list = null } };
    // Sentence breaks: after . ! ? and a space (English), or after 。！？ with no space (Japanese); a [S1] marker stays with its sentence.
    const ja = LB_LANG === 'ja', splitAt = ja ? /(?<=(?:[。！？]|[.!?]\s+)(?:\[[SM]\d+\])*)(?=[^\s」』）)”"\[])/ : /(?<=[.!?])\s+(?=[A-Z(“"])/;
    const mark = raw => {  // wrap sentences that carry no citation (main sections only)
      if (section !== 'main' || m.running) return inline(raw);
      return raw.split(splitAt).map(sn => /\[[SM]\d+\]/.test(sn) || sn.replace(/\*|_/g, '').trim().length < (ja ? 10 : 28) || /[:：]$/.test(sn.trim()) ? inline(sn) : `<span class="uncited" title="${tr('Not linked to a source')}">${inline(sn)}</span>`).join(ja ? '' : ' ');
    };
    for (let ln of lines) {
      const t = ln.trim();
      if (!t) { close(); continue }
      const head = /^#{1,4}\s+(.*)$/.exec(t) || /^\*\*([^*]+:)\*\*$/.exec(t) || /^\*\*([^*]+)\*\*:?$/.exec(t);
      const hText = head ? head[1] : '';
      // The headings the model writes (English, or the Japanese ones assistant.py asks for in Japanese) pick a section.
      const sec = /not found in the library|ライブラリに見つからない/i.test(t) ? 'missing' : /sources disagree|資料によって異なる/i.test(t) ? 'disagree' : /own reasoning|私自身の推論/i.test(t) ? 'reasoning' : null;
      if (sec || head) {
        close();
        if (out.includes('<div class="sec-')) out += '</div>';
        section = sec || (head ? 'main' : section);
        if (sec) { out += `<div class="sec-${sec}"><h4>${sec === 'missing' ? tr('Not found in the library') : sec === 'disagree' ? tr('Sources disagree') : tr('The model’s own reasoning — not from the library')}</h4>`; const rest = t.replace(/^[#*\s「『]*(not found in the library|sources disagree|my own reasoning \(not from the library\)|my own reasoning|ライブラリに見つからないこと|資料によって異なる点|私自身の推論[（(]ライブラリ外[）)]|私自身の推論)[:：*\s」』]*/i, ''); if (rest) out += `<p>${inline(rest)}</p>`; continue }
        out += `<h4>${inline(hText.replace(/:$/, ''))}</h4>`; continue;
      }
      const ul = /^[-*•]\s+(.*)$/.exec(t), ol = /^(\d+)[.)]\s+(.*)$/.exec(t);
      if (ul || ol) {
        const want = ul ? 'ul' : 'ol';
        if (list !== want) { close(); out += `<${want}>`; list = want }
        out += `<li>${mark(ul ? ul[1] : ol[2])}</li>`; continue;
      }
      close(); out += `<p>${mark(t)}</p>`;
    }
    close();
    if (out.includes('<div class="sec-')) out += '</div>';
    return out;
  }

  function wire(el) {
    $$('[data-act]', el).forEach(b => b.onclick = () => {
      const i = +b.dataset.i, m = cur.messages[i];
      if (b.dataset.act === 'copy') { navigator.clipboard?.writeText(plain(m)).then(() => toast(tr('Copied')), () => toast(tr('Couldn’t copy'))) }
      if (b.dataset.act === 'save') {
        const q = cur.messages[i - 1]?.content || cur.title;
        toggleSave({ key: `a:${cur.id}:${i}`, title: tr('Answer: {q}', { q: q.slice(0, 80) }), href: '#/ask/' + cur.id, sub: `${tr('{n} sources', { n: (m.cited || []).length })} · ${new Date().toLocaleDateString()}` }, null);
      }
      if (b.dataset.act === 'export') exportChat(cur);
      if (b.dataset.act === 'retry') { const q = cur.messages[cur.messages.length - 2]?.content; cur.messages.splice(-2, 2); send(q) }
    });
    // citation chips scroll to their card instead of changing the route
    $$('a.cite', el).forEach(a => a.onclick = e => { e.preventDefault(); const c = $('#src-' + a.dataset.key, el.closest('.msg') || el); if (c) { c.scrollIntoView({ block: 'center', behavior: 'smooth' }); c.classList.add('flash'); setTimeout(() => c.classList.remove('flash'), 1200) } });
  }
  function plain(m) {
    const map = Object.fromEntries((m.cited || []).map(s => [s.key, s]));
    let t = m.content.replace(/\[([SM]\d+)\]/g, (_, k) => map[k] ? `[${k.replace(/^S/, '')}]` : '');
    if ((m.cited || []).length) t += '\n\n' + tr('Sources:') + '\n' + m.cited.map(s => `[${s.key.replace(/^S/, '')}] ${s.title} — ${s.publisher || ''}${s.year ? ', ' + s.year : ''}${s.page ? ', ' + tr('page {page}', { page: s.page }) : ''}${s.t != null ? ', ' + tr('at {time}', { time: clock(s.t) }) : ''}  ${location.origin}/${srcHref(s).replace(/&?from=[^&]*/, '')}`).join('\n');
    return t;
  }
  function exportChat(c) {
    let md = `# ${c.title}\n\n${tr('Exported from Lastbook (offline library) on {date}.', { date: new Date().toLocaleString() })}\n${tr('Answers were written by a local AI model from the library’s documents. Check the linked pages; get trained help for anything serious.')}\n`;
    for (const m of c.messages) md += m.role === 'user' ? `\n## ${tr('Question')}\n\n${m.content}\n` : `\n## ${tr('Answer')}\n\n${m.content ? plain(m) : tr('(no answer: {reason})', { reason: m.error || tr('stopped') })}\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `survival-chat-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 500);
    toast(tr('Saved as a file on this device'));
  }
  // Earlier answers' [S#] keys only mean something inside their own turn; give the model readable references instead.
  // This text goes to the model, not the person, so the `p.` reference stays English on purpose (not tr()).
  function history_(c) {
    return c.messages.filter(m => m.content).map(m => {
      if (m.role !== 'assistant') return { role: m.role, content: m.content };
      const map = Object.fromEntries((m.cited || []).map(s => [s.key, s]));
      return { role: 'assistant', content: m.content.replace(/\[([SM]\d+)\]/g, (_, k) => map[k] ? `(${map[k].title}${map[k].page ? ', p. ' + map[k].page : ''}${map[k].t != null ? ', ' + clock(map[k].t) : ''})` : '') };
    });
  }

  /* -------------------------------------------------------------- send --- */
  async function send(text) {
    text = (text || '').trim();
    if (!text) return;
    if (!cur) {
      cur = { id: newId(), title: text.slice(0, 70), created: Date.now(), updated: Date.now(), messages: [], about: aboutCtx ? aboutCtx.about : null, aboutInfo: aboutCtx };
      chats.unshift(cur);
      history.replaceState(null, '', '#/ask/' + cur.id);
    }
    const c = cur;
    c.messages.push({ role: 'user', content: text });
    const m = { role: 'assistant', content: '', state: 'thinking', steps: [], sources: [], running: true };
    c.messages.push(m);
    c.updated = Date.now(); persist();
    const ta = $('#chatIn'); if (ta) { ta.value = ''; autosize() }
    renderSide(); renderCtx(); renderLog(); setBusy(true); scrollEnd(true);
    const idx = c.messages.length - 1, ctl = new AbortController();
    live[c.id] = { running: true, abort: () => ctl.abort() };
    const redraw = throttle(() => { if (cur === c) { updateBot(idx); scrollEnd() } }, 80);
    try {
      const st = await getStatus();
      if (!st.online) throw Object.assign(new Error('offline'), { offline: true, why: st.local && localLine(st.local)[1] });
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history_(c).slice(0, -1).concat([{ role: 'user', content: text }]), about: c.about, lang: LB_LANG }), signal: ctl.signal });
      if (!r.ok || !r.body) throw new Error(tr('The server refused the question ({status}).', { status: r.status }));
      const rd = r.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let k;
        while ((k = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, k); buf = buf.slice(k + 2);
          if (!chunk.startsWith('data:')) continue;
          let ev; try { ev = JSON.parse(chunk.slice(5)) } catch { continue }
          onEvent(m, ev);
          redraw();
        }
      }
      if (m.running && !m.content && !m.error) m.error = tr('The answer stopped unexpectedly.');
    } catch (e) {
      if (e.name === 'AbortError') { m.stopped = true; if (!m.content) m.error = tr('Stopped.') }
      else if (e.offline || /model_unavailable/.test(e.message)) { m.offline = true; m.error = e.why || tr('The local assistant model isn’t running right now.'); await fallback(m, text) }
      else m.error = e.message || tr('Something went wrong.');
    }
    m.running = false; delete m.state;
    if (m.stopped && m.content) m.content += '\n\n' + tr('(Stopped.)');
    live[c.id].running = false;
    c.updated = Date.now(); persist();
    if (cur === c) { updateBot(idx); setBusy(false); scrollEnd(); const t = $('#chatIn'); if (t && matchMedia('(hover:hover)').matches) t.focus({ preventScroll: true }) }
  }
  function onEvent(m, ev) {
    if (ev.type === 'state') { m.state = ev.state; m.pct = ev.pct }
    else if (ev.type === 'found') m.steps.push({ name: 'found', count: ev.count });
    else if (ev.type === 'tool') { if (ev.phase === 'start') m.steps.push({ name: ev.name, args: ev.args }); else { const s = [...m.steps].reverse().find(x => x.name === ev.name && !x.summary); if (s) s.summary = ev.summary } m.state = 'searching' }
    else if (ev.type === 'sources') m.sources = ev.sources;
    else if (ev.type === 'delta') m.content += ev.text;
    else if (ev.type === 'reset') m.content = '';
    else if (ev.type === 'done') { m.content = ev.answer; m.cited = ev.sources; m.consulted = ev.consulted; m.invalid = ev.invalid; m.latency = ev.latency; m.content = m.content.replace(/\[([SM]\d+)\]/g, (x, k) => (ev.invalid || []).includes(k) ? '' : x) }
    else if (ev.type === 'error') {
      if (ev.error === 'model_unavailable') { m.offline = true; m.error = tr(ev.text); fallback(m, (cur.messages[cur.messages.length - 2] || {}).content || '') }
      else { m.error = tr(ev.text); if (ev.sources) m.fallback = ev.sources.slice(0, 8) }
    }
    else if (ev.type === 'stopped') m.stopped = true;
  }
  async function fallback(m, q) {
    try { const d = await api('/api/retrieve?q=' + encodeURIComponent(q) + '&k=8'); m.fallback = d.results.map((r, i) => ({ ...r, key: '' })); if (!m.fallback.length) m.error += ' ' + tr('The library search also found nothing for this question.') }
    catch { m.fallback = [] }
  }
  function stop() { if (cur && live[cur.id]) live[cur.id].abort() }
  function setBusy(on) {
    const b = $('#sendBtn'); if (!b) return;
    b.innerHTML = on ? '<span class="stopsq"></span>' : ico('up');
    b.setAttribute('aria-label', on ? tr('Stop the answer') : tr('Send'));
    b.classList.toggle('stop', on);
  }
  function scrollEnd(force) {
    const near = innerHeight + scrollY > document.body.scrollHeight - 260;
    if (force || near) requestAnimationFrame(() => scrollTo(0, document.body.scrollHeight));
  }
  function throttle(f, ms) { let t = 0, p = null; return () => { const n = Date.now(); if (n - t > ms) { t = n; f() } else { clearTimeout(p); p = setTimeout(() => { t = Date.now(); f() }, ms) } } }

  return { page, count };
})();
