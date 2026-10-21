// Remote key codes and small helpers.

export const KEY = {
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  OK: 13,
  BACK: 461,
  CH_UP: 33,
  CH_DOWN: 34,
  RED: 403,
  GREEN: 404,
  YELLOW: 405,
  BLUE: 406,
  INFO: 457,
  GUIDE: 458,
};

// PC keyboard equivalents, handy when debugging in a desktop browser.
export const KEY_ALIASES = { 27: 461, 8: 461, 71: 458, 73: 457, 82: 403, 65: 404, 66: 406 };

export function esc(s) {
  return String(s == null ? '' : s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

export function hhmm(ms) {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function day(ms) {
  return new Date(ms).toLocaleDateString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

export function progress(p, t = Date.now()) {
  return Math.max(0, Math.min(100, ((t - p.start) / (p.stop - p.start)) * 100));
}

// DVB/ISO 639 audio language codes as they appear in Init7 streams.
const LANG_NAMES = {
  de: 'Deutsch',
  deu: 'Deutsch',
  ger: 'Deutsch',
  en: 'English',
  eng: 'English',
  fr: 'Français',
  fra: 'Français',
  fre: 'Français',
  it: 'Italiano',
  ita: 'Italiano',
  rm: 'Rumantsch',
  roh: 'Rumantsch',
  mul: 'Multilingual',
  qaa: 'Original audio',
  qad: 'Audio description',
  nar: 'Audio description',
  es: 'Español',
  spa: 'Español',
  pt: 'Português',
  por: 'Português',
  tr: 'Türkçe',
  tur: 'Türkçe',
  nl: 'Nederlands',
  nld: 'Nederlands',
  dut: 'Nederlands',
  pl: 'Polski',
  pol: 'Polski',
};

// Unknown codes are shown as-is (upper case), e.g. "MIS".
export function langName(code) {
  return LANG_NAMES[String(code || '').toLowerCase()] || (code ? String(code).toUpperCase() : 'Unknown');
}

// Tracks that should never become the remembered default language.
export function isRealLanguage(code) {
  const c = String(code || '').toLowerCase();
  return !!c && !['nar', 'qad', 'mul', 'qaa', 'und'].includes(c);
}
