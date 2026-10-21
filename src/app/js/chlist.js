// Channel list overlay with filter tabs: all, favourites and language groups (M3U group-title).
import { actions } from './actions.js';
import { channels } from './channels.js';
import { epg } from './epg.js';
import { player } from './player.js';
import { KEY as K, esc, progress } from './util.js';

const root = document.getElementById('chlist');
const ROW_H = 92;
const PAGE = 7;
const LANGS = ['de', 'fr', 'it', 'en'];
const TABS = [
  { key: 'all', label: 'All', filter: () => channels.all() },
  { key: 'fav', label: '★', filter: () => channels.favourites() },
  ...LANGS.map((l) => ({ key: l, label: l.toUpperCase(), filter: () => channels.all().filter((c) => c.group === l) })),
  { key: 'world', label: 'World', filter: () => channels.all().filter((c) => !LANGS.includes(c.group)) },
];
let tab = 'all';
let items = [];
let focus = 0;

root.innerHTML = `
  <div class="cl-tabs">
    ${TABS.map((t) => `<span class="cl-tab" data-tab="${t.key}">${t.label}</span>`).join('')}
  </div>
  <div class="cl-view"><div class="cl-items"></div></div>
  <div class="hints">
    <span><i class="key">OK</i>Watch</span>
    <span><i class="key">Hold OK</i>Favourite</span>
    <span><i class="key">CH ∧∨</i>Page</span>
    <span><i class="key">◀▶</i>Filter</span>
    <span><i class="key">BACK</i>Close</span>
  </div>`;
const view = root.querySelector('.cl-view');
const list = root.querySelector('.cl-items');

function render() {
  root.querySelectorAll('.cl-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  const current = player.current();
  if (!items.length) {
    list.innerHTML =
      '<div class="cl-empty">' +
      (tab === 'fav' ? 'No favourites yet.<br>Hold OK on a channel to add it.' : 'No channels here.') +
      '</div>';
    list.style.transform = '';
    return;
  }
  list.innerHTML = items
    .map((c, i) => {
      const { now } = epg.nowNext(c.id);
      const cls = (i === focus ? ' focus' : '') + (current && current.id === c.id ? ' playing' : '');
      return `
        <div class="cl-row${cls}" data-i="${i}">
          <span class="cl-num">${c.num}</span>
          <span class="logo"><img src="${esc(c.logo)}" alt=""></span>
          <span class="cl-text">
            <span class="cl-name">${esc(c.name)}${channels.isFav(c.id) ? ' <span class="fav">★</span>' : ''}</span>
            <span class="cl-now">${now ? esc(now.title) : '&nbsp;'}</span>
            ${now ? `<span class="progress"><span style="width:${progress(now).toFixed(1)}%"></span></span>` : ''}
          </span>
        </div>`;
    })
    .join('');
  scroll();
}

function scroll() {
  const visibleRows = Math.floor(view.clientHeight / ROW_H);
  const maxTop = Math.max(0, items.length - visibleRows);
  const top = Math.max(0, Math.min(maxTop, focus - Math.floor(visibleRows / 2)));
  list.style.transform = 'translateY(' + -top * ROW_H + 'px)';
}

function setFocus(i) {
  if (!items.length) return;
  focus = (i + items.length) % items.length;
  list.querySelectorAll('.cl-row').forEach((r) => r.classList.toggle('focus', Number(r.dataset.i) === focus));
  scroll();
}

function setTab(t) {
  tab = t;
  items = TABS.find((x) => x.key === tab).filter();
  const current = player.current();
  const i = current ? items.findIndex((c) => c.id === current.id) : -1;
  focus = Math.max(0, i);
  render();
}

function hide() {
  root.classList.add('hidden');
}

function choose(i) {
  const ch = items[i];
  if (!ch) return;
  hide();
  actions.tune(ch, { favMode: tab === 'fav' });
}

function toggleFav() {
  const ch = items[focus];
  if (!ch) return;
  actions.toast((channels.toggleFav(ch.id) ? 'Added to' : 'Removed from') + ' favourites: ' + ch.name);
  if (tab === 'fav') {
    items = channels.favourites();
    focus = Math.min(focus, Math.max(0, items.length - 1));
  }
  render();
}

// Magic Remote pointer support.
list.addEventListener('mousemove', (e) => {
  const row = e.target.closest('.cl-row');
  if (row && Number(row.dataset.i) !== focus) setFocus(Number(row.dataset.i));
});
list.addEventListener('click', (e) => {
  const row = e.target.closest('.cl-row');
  if (row) choose(Number(row.dataset.i));
});
root.querySelector('.cl-tabs').addEventListener('click', (e) => {
  const t = e.target.closest('.cl-tab');
  if (t) setTab(t.dataset.tab);
});

const visible = () => !root.classList.contains('hidden');

export const chlist = {
  visible,
  show(favMode) {
    root.classList.remove('hidden');
    setTab(favMode ? 'fav' : 'all');
  },
  hide,
  toggleFav,
  refresh() {
    if (visible()) render();
  },
  onKey(k) {
    switch (k) {
      case K.UP:
        setFocus(focus - 1);
        break;
      case K.DOWN:
        setFocus(focus + 1);
        break;
      case K.CH_UP:
        setFocus(Math.max(0, focus - PAGE));
        break;
      case K.CH_DOWN:
        setFocus(Math.min(items.length - 1, focus + PAGE));
        break;
      case K.LEFT:
      case K.RIGHT: {
        const i = TABS.findIndex((x) => x.key === tab) + (k === K.RIGHT ? 1 : -1);
        setTab(TABS[(i + TABS.length) % TABS.length].key);
        break;
      }
      case K.OK:
        choose(focus);
        break;
      case K.RED:
        toggleFav();
        break;
      case K.BACK:
        hide();
        break;
      default:
        return false;
    }
    return true;
  },
};
