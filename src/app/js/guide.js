// Full-screen programme guide grid with the live picture as picture-in-picture.
import { actions } from './actions.js';
import { channels } from './channels.js';
import { epg } from './epg.js';
import { player } from './player.js';
import { KEY as K, esc, hhmm, day } from './util.js';

const root = document.getElementById('guide');
const SLOT = 30 * 60000;
const SPAN = 5 * SLOT; // visible time window
const AHEAD = 3 * 24 * 3600000; // how far ahead the guide can scroll
const ROWS = 7;
const LINE_W = 1472; // timeline width in px (1792 grid - 320 channel column)

let list = [];
let row = 0;
let top = 0;
let cursor = 0; // time the focus is anchored to
let viewStart = 0;

root.innerHTML = `
  <div class="g-backdrop"></div>
  <div class="g-content">
    <div class="g-info"></div>
    <div class="g-grid"></div>
    <div class="hints g-hints">
      <span><i class="key">OK</i>Watch</span>
      <span><i class="key">◀▶</i>Time</span>
      <span><i class="key">▲▼</i>Channel</span>
      <span><i class="key">CH ∧∨</i>Page</span>
      <span><i class="key">BACK</i>Close</span>
    </div>
  </div>`;
const info = root.querySelector('.g-info');
const grid = root.querySelector('.g-grid');

const floorSlot = (t) => Math.floor(t / SLOT) * SLOT;
const minView = () => floorSlot(Date.now()) - SLOT;
const maxTime = () => Date.now() + AHEAD;
const focused = () => (list[row] ? epg.at(list[row].id, cursor) : null);

function renderInfo() {
  const ch = list[row];
  const p = focused();
  if (!ch) {
    info.innerHTML = '';
    return;
  }
  if (!p) {
    info.innerHTML = `
      <div class="g-ch">${ch.num} · ${esc(ch.name)}</div>
      <div class="g-title dim">No programme information</div>`;
    return;
  }
  const live = p.start <= Date.now() && Date.now() < p.stop;
  info.innerHTML = `
    <div class="g-ch">${ch.num} · ${esc(ch.name)}${live ? ' <span class="live">LIVE</span>' : ''}</div>
    <div class="g-title">${esc(p.title)}</div>
    <div class="g-meta">${day(p.start)} · ${hhmm(p.start)} – ${hhmm(p.stop)}${p.cats.length ? ' · ' + esc(p.cats.join(', ')) : ''}</div>
    ${p.sub ? `<div class="g-sub">${esc(p.sub)}</div>` : ''}
    ${p.desc ? `<div class="g-desc">${esc(p.desc)}</div>` : ''}`;
}

function renderGrid() {
  const now = Date.now();
  const viewEnd = viewStart + SPAN;
  const px = (t) => ((t - viewStart) / SPAN) * LINE_W;
  const fp = focused();

  let html = `<div class="g-timebar"><span class="g-day">${day(viewStart)}</span>`;
  for (let t = viewStart; t < viewEnd; t += SLOT) {
    html += `<span class="g-tick" style="left:${px(t)}px">${hhmm(t)}</span>`;
  }
  html += '</div>';

  for (let r = top; r < Math.min(list.length, top + ROWS); r++) {
    const ch = list[r];
    html += `
      <div class="g-row${r === row ? ' active' : ''}" data-r="${r}">
        <div class="g-chan">
          <span class="num">${ch.num}</span>
          <span class="logo"><img src="${esc(ch.logo)}" alt=""></span>
          <span class="name">${esc(ch.name)}</span>
        </div>
        <div class="g-line">`;
    const progs = epg.range(ch.id, viewStart, viewEnd);
    if (!progs.length) {
      html += `<div class="g-cell empty${r === row ? ' focus' : ''}" style="left:0;width:${LINE_W - 6}px">
        <span class="t">No programme information</span></div>`;
    }
    for (const p of progs) {
      const left = px(Math.max(p.start, viewStart));
      const width = px(Math.min(p.stop, viewEnd)) - left - 6;
      if (width < 4) continue;
      const cls = (p.stop <= now ? ' past' : p.start <= now ? ' live' : '') + (r === row && p === fp ? ' focus' : '');
      html += `
        <div class="g-cell${cls}" data-r="${r}" data-t="${Math.max(p.start, viewStart)}" style="left:${left}px;width:${width}px">
          ${width > 70 ? `<span class="t">${esc(p.title)}</span>` : ''}
          ${width > 140 ? `<span class="s">${hhmm(p.start)} – ${hhmm(p.stop)}</span>` : ''}
        </div>`;
    }
    html += '</div></div>';
  }
  if (now >= viewStart && now < viewEnd) {
    html += `<div class="g-now" style="left:${320 + px(now)}px"></div>`;
  }
  grid.innerHTML = html;
}

function render() {
  renderInfo();
  renderGrid();
  epg.ensure(viewStart - SLOT, viewStart + SPAN + 6 * 3600000);
}

function keepVisible() {
  if (cursor < viewStart) viewStart = Math.max(minView(), floorSlot(cursor));
  else if (cursor >= viewStart + SPAN - SLOT) viewStart = floorSlot(cursor) - SLOT;
  if (row < top) top = row;
  else if (row >= top + ROWS) top = row - ROWS + 1;
}

function moveTime(dir) {
  const ch = list[row];
  if (!ch) return;
  const cur = focused();
  const progs = epg.range(ch.id, minView(), maxTime());
  if (dir > 0) {
    const ref = cur ? cur.stop : cursor + 1;
    const next = progs.find((p) => p.start >= ref);
    cursor = Math.min(next ? next.start : cursor + SLOT, maxTime());
  } else {
    const ref = cur ? cur.start : cursor;
    const prev = progs.filter((p) => p.stop <= ref).pop();
    if (prev && prev.stop > minView()) cursor = Math.max(prev.start, minView());
    else if (!prev) cursor = Math.max(cursor - SLOT, minView());
  }
  keepVisible();
  // Anchor to the visible part so vertical moves pick what is on screen.
  cursor = Math.max(cursor, viewStart);
  render();
}

function moveRow(delta) {
  if (!list.length) return;
  row = Math.max(0, Math.min(list.length - 1, row + delta));
  keepVisible();
  render();
}

function jumpTo(t) {
  cursor = t;
  viewStart = Math.max(minView(), floorSlot(t));
  render();
}

function hide() {
  root.classList.add('hidden');
  document.body.classList.remove('guide-open');
}

function activate(r, t) {
  const ch = list[r];
  const p = epg.at(ch.id, t);
  const now = Date.now();
  if (!p || (p.start <= now && now < p.stop)) {
    hide();
    actions.tune(ch);
  } else {
    actions.toast(`“${p.title}” starts ${day(p.start)} at ${hhmm(p.start)}`);
  }
}

grid.addEventListener('click', (e) => {
  const cell = e.target.closest('.g-cell');
  const rowEl = e.target.closest('.g-row');
  if (!rowEl) return;
  const r = Number(rowEl.dataset.r);
  const t = cell && cell.dataset.t ? Number(cell.dataset.t) : cursor;
  if (r === row && focused() === epg.at(list[r].id, t)) {
    activate(r, t);
  } else {
    row = r;
    cursor = t;
    render();
  }
});

const visible = () => !root.classList.contains('hidden');

export const guide = {
  visible,
  show() {
    list = channels.all();
    const current = player.current();
    row = Math.max(0, current ? list.findIndex((c) => c.id === current.id) : 0);
    top = Math.max(0, Math.min(row - Math.floor(ROWS / 2), list.length - ROWS));
    cursor = Date.now();
    viewStart = floorSlot(cursor);
    document.body.classList.add('guide-open');
    root.classList.remove('hidden');
    render();
  },
  hide,
  refresh() {
    if (visible()) render();
  },
  onKey(k) {
    switch (k) {
      case K.UP:
        moveRow(-1);
        break;
      case K.DOWN:
        moveRow(1);
        break;
      case K.CH_UP:
        moveRow(-ROWS);
        break;
      case K.CH_DOWN:
        moveRow(ROWS);
        break;
      case K.LEFT:
        moveTime(-1);
        break;
      case K.RIGHT:
        moveTime(1);
        break;
      case K.YELLOW:
        jumpTo(Date.now());
        break;
      case K.GREEN:
        jumpTo(Math.min(cursor + 24 * 3600000, maxTime()));
        break;
      case K.OK:
        activate(row, cursor);
        break;
      case K.GUIDE:
      case K.BLUE:
        // First press returns to "now"; pressing again while there closes the guide.
        if (viewStart !== floorSlot(Date.now())) jumpTo(Date.now());
        else hide();
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
