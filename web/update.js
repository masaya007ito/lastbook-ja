/* Check for updates, in About (desktop app only). It runs only when the person presses Check for updates, or chooses
   Lastbook > Check for Updates… (the menu calls LBUpdate.fromMenu; no address starts it). It only says whether a newer version
   is on the website: nothing is downloaded or installed. engine/update.py does the check. */
(() => {
  const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let timer = null, menuAsked = false;

  async function call(action) {
    const r = await fetch('/api/update/' + action, action === 'state' ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    return r.json();
  }

  function view(s) {
    const btn = (t) => `<button class="btn plain" data-upd="check">${t}</button>`;
    const ver = s.current ? tr('Version {version}.', { version: E(s.current) }) : tr('This copy has no version number (it was not built as an app).');
    switch (s.state) {
      case 'checking': return `${ver} ${tr('Checking for updates…')}`;
      case 'up_to_date': return `${ver} ${tr('Lastbook is up to date.')} ${btn(tr('Check again'))}`;
      case 'available': return `${ver} ${tr('Version {version} is available. Download it from {website}. Your library, local AI and chats stay.', { version: E(s.version), website: E(s.website) })} ${btn(tr('Check again'))}`;
      case 'not_published': return `${ver} ${tr('No update information yet.')} ${btn(tr('Try again'))}`;
      case 'too_old_os': case 'error': return `${ver} ${E(s.message)} ${btn(tr('Try again'))}`;
      default: return `${ver} ${btn(tr('Check for updates'))}`;
    }
  }

  function paint(el, s) {
    el.innerHTML = view(s);
    clearTimeout(timer);
    if (s.state === 'checking') timer = setTimeout(() => refresh(el), 400);
  }

  async function refresh(el) {
    if (!el.isConnected) return;
    try { paint(el, await call('state')) } catch { el.textContent = tr('Lastbook could not ask about updates.') }
  }

  async function check(el) {
    try {
      const s = await call('check');
      if (s.error && !s.state) { el.textContent = s.error; return }
      paint(el, s);
    } catch { el.textContent = tr('Lastbook could not ask about updates.') }
  }

  window.LBUpdate = {
    card: () => `<div class="card"><b>${tr('Lastbook app')}</b><small id="updBox">…</small></div>`,
    mount(root) {
      const el = root.querySelector('#updBox'); if (!el) return;
      el.addEventListener('click', e => { if (e.target.closest('[data-upd]')) check(el) });
      if (menuAsked) { menuAsked = false; return check(el) }
      refresh(el);
    },
    fromMenu() {     // Lastbook > Check for Updates…: About, then one check
      const el = document.getElementById('updBox');
      if (el && location.hash.startsWith('#/about')) return check(el);
      menuAsked = true;
      location.hash = '#/about';
    },
  };
})();
