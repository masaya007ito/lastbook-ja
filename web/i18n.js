/* Interface language. Loaded first, before any other script. No DOM work until the page is parsed, no network.

   tr('English text', {name: value}) returns the text in the chosen language, or the English text itself when no
   translation exists, so a missing entry never breaks a screen. {name} placeholders are filled from the second argument.
   The English text is the key: code stays readable and upstream changes to a string simply fall back to English.

   Translations live in web/i18n-<lang>-*.js (top level of web/, so the app builds ship them), each calling lbWords('<lang>', {...}).
   Static HTML uses data-i18n (text), data-i18n-aria (aria-label), data-i18n-title and data-i18n-placeholder,
   each holding the English text; applyI18n() fills them in when the page has been parsed.

   Language: the person's choice ('sg.lang' in localStorage, set from About), else the system language. */
(function (root) {
  'use strict';
  const SUPPORTED = ['en', 'ja'];

  function chosen() {
    try { const v = JSON.parse(root.localStorage.getItem('sg.lang')); if (SUPPORTED.includes(v)) return v } catch (e) { }
    return null;
  }
  const systemLang = () => /^ja\b/i.test((root.navigator && root.navigator.language) || '') ? 'ja' : 'en';
  const LANG = chosen() || systemLang();
  const DICT = {};

  function fill(s, vars) {
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m)) : s;
  }
  function tr(s, vars) {
    const key = String(s);
    return fill(LANG !== 'en' && Object.prototype.hasOwnProperty.call(DICT, key) ? DICT[key] : key, vars);
  }
  function lbWords(lang, words) { if (lang === LANG) Object.assign(DICT, words) }

  const ATTRS = [['i18nAria', 'aria-label'], ['i18nTitle', 'title'], ['i18nPlaceholder', 'placeholder']];
  function applyI18n(scope) {
    const el0 = scope || root.document;
    el0.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = tr(el.dataset.i18n) });
    for (const [key, attr] of ATTRS) {
      const sel = '[data-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + ']';
      el0.querySelectorAll(sel).forEach(el => el.setAttribute(attr, tr(el.dataset[key])));
    }
  }
  // Save the choice and reload, so every screen is drawn once in the new language. null goes back to the system language.
  function setLang(lang) {
    try {
      if (lang && SUPPORTED.includes(lang)) root.localStorage.setItem('sg.lang', JSON.stringify(lang));
      else root.localStorage.removeItem('sg.lang');
    } catch (e) { }
    root.location.reload();
  }

  root.LB_LANG = LANG;
  root.LB_LANGS = SUPPORTED;
  root.tr = tr;
  root.lbWords = lbWords;
  root.applyI18n = applyI18n;
  root.setLang = setLang;
  root.lbLangChosen = chosen;
  if (root.document) {
    root.document.documentElement.lang = LANG;
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', () => applyI18n());
    else applyI18n();
  }
})(typeof window !== 'undefined' ? window : globalThis);
