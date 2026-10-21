// Persistent per-TV settings (last channel, favourites, audio language, lineup cache).
// localStorage access is guarded so the module also loads outside a browser (unit tests).
const KEY = 'init7tv.settings';
let data = {};
try {
  data = JSON.parse(localStorage.getItem(KEY)) || {};
} catch (e) {
  data = {};
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch (e) {
    // no storage available (tests) or quota exceeded - settings stay in memory
  }
}

export const settings = {
  get: (k, def) => (k in data ? data[k] : def),
  set(k, v) {
    data[k] = v;
    save();
  },
};
