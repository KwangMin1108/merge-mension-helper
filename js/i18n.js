// ── i18n ──────────────────────────────────────────────────────────
let currentLang = 'en';
let I18N = {};
const SUPPORTED_LANGS = ['en','ko','fr','de','es','it','pt','ru','ja'];

function t(mpcKey, fallback) {
  return (mpcKey && I18N[mpcKey]) || fallback || '';
}

function detectLang() {
  const saved = localStorage.getItem('mmh_lang');
  if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  const browser = (navigator.language || 'en').split('-')[0].toLowerCase();
  return SUPPORTED_LANGS.includes(browser) ? browser : 'en';
}

async function loadI18n(lang) {
  try {
    const resp = await fetch(`data/i18n/${lang}.json`);
    I18N = await resp.json();
    currentLang = lang;
    localStorage.setItem('mmh_lang', lang);
    document.documentElement.lang = lang;
    document.querySelectorAll('.lang-select').forEach(s => s.value = lang);
  } catch(e) { console.warn('i18n load failed:', lang); }
}

async function changeLang(lang) {
  await loadI18n(lang);
  if (document.getElementById('screenArea').classList.contains('active') && currentArea) {
    render();
  } else {
    showAreaList();
  }
}
