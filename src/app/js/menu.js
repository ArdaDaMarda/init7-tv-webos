// Options menu for live TV (the LG AI Magic Remote has no colour or INFO keys).
// "Audio" opens a list of all audio tracks with the broadcaster's descriptions.
import { actions } from './actions.js';
import { banner } from './banner.js';
import { channels } from './channels.js';
import { guide } from './guide.js';
import { player } from './player.js';
import { labelText } from './tracks.js';
import { KEY as K, esc } from './util.js';

const root = document.getElementById('menu');
let mode = 'main'; // 'main' | 'audio'
let items = [];
let focus = 0;
let timer = 0;

function mainItems() {
  const ch = player.current();
  const a = player.audioInfo();
  const fav = ch && channels.isFav(ch.id);
  return [
    {
      html: `Audio: ${a ? esc(labelText(a.label)) : '–'}${a && a.total > 1 ? ` <span class="m-sub">(${a.index}/${a.total})</span>` : ''} <span class="m-more">›</span>`,
      act() {
        if (!a || a.total < 2) {
          actions.toast('No other audio tracks');
          return;
        }
        setMode('audio');
      },
    },
    {
      html: fav ? '★ Remove from favourites' : '☆ Add to favourites',
      act() {
        if (ch) channels.toggleFav(ch.id);
      },
    },
    { html: 'Programme details', close: true, act: () => banner.show(ch, { expanded: true }) },
    { html: 'TV guide', close: true, act: () => guide.show() },
  ];
}

function audioItems() {
  return player.audioTracks().map((t) => ({
    html: `<span class="m-check">${t.current ? '✓' : ''}</span>
      <span class="m-name">${esc(t.label.name)}</span>
      ${t.label.purpose ? `<span class="m-purpose">${esc(t.label.purpose)}</span>` : ''}
      <span class="m-codec">${esc(t.label.codec)}</span>`,
    close: true,
    act() {
      if (t.current) return;
      player.selectAudio(t.index);
      actions.toast('Audio: ' + labelText(t.label));
    },
  }));
}

function setMode(m) {
  mode = m;
  items = m === 'audio' ? audioItems() : mainItems();
  focus =
    m === 'audio'
      ? Math.max(
          0,
          player.audioTracks().findIndex((t) => t.current),
        )
      : 0;
  render();
}

function render() {
  items = mode === 'audio' ? audioItems() : mainItems();
  const ch = player.current();
  const head = mode === 'audio' ? 'Audio track' : ch ? `${ch.num} · ${esc(ch.name)}` : 'Options';
  root.classList.toggle('audio', mode === 'audio');
  root.innerHTML = `
    <div class="m-head">${head}</div>
    ${items.map((it, i) => `<div class="m-item${i === focus ? ' focus' : ''}" data-i="${i}">${it.html}</div>`).join('')}
    <div class="hints">
      <span><i class="key">OK</i>Select</span>
      <span><i class="key">BACK</i>${mode === 'audio' ? 'Back' : 'Close'}</span>
    </div>`;
}

function hide() {
  clearTimeout(timer);
  root.classList.add('hidden');
}

function armTimer() {
  clearTimeout(timer);
  timer = setTimeout(hide, 15000);
}

function activate(i) {
  const it = items[i];
  if (!it) return;
  if (it.close) hide();
  it.act();
  if (!it.close && !root.classList.contains('hidden')) {
    render();
    banner.refresh();
  }
}

root.addEventListener('mousemove', (e) => {
  const el = e.target.closest('.m-item');
  if (el && Number(el.dataset.i) !== focus) {
    focus = Number(el.dataset.i);
    render();
  }
  armTimer();
});
root.addEventListener('click', (e) => {
  const el = e.target.closest('.m-item');
  if (el) activate(Number(el.dataset.i));
});

const visible = () => !root.classList.contains('hidden');

export const menu = {
  visible,
  show() {
    banner.hide();
    setMode('main');
    root.classList.remove('hidden');
    armTimer();
  },
  hide,
  // Track descriptions arrived after the menu opened.
  refresh() {
    if (visible()) render();
  },
  onKey(k) {
    armTimer();
    switch (k) {
      case K.UP:
        focus = (focus + items.length - 1) % items.length;
        render();
        break;
      case K.DOWN:
        focus = (focus + 1) % items.length;
        render();
        break;
      case K.OK:
      case K.RIGHT:
        activate(focus);
        break;
      case K.LEFT:
      case K.BACK:
        if (mode === 'audio') setMode('main');
        else hide();
        break;
      default:
        return false;
    }
    return true;
  },
};
