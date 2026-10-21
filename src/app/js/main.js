// App entry point: startup, live-TV key handling, number entry, toasts and status messages.
import { actions } from './actions.js';
import { api } from './api.js';
import { banner } from './banner.js';
import { buildLineup, channels } from './channels.js';
import { chlist } from './chlist.js';
import { APP_VERSION, DEFAULT_LANG_ORDER } from './config.js';
import { epg } from './epg.js';
import { guide } from './guide.js';
import { menu } from './menu.js';
import { player } from './player.js';
import { relay } from './relay.js';
import { settings } from './settings.js';
import { KEY as K, KEY_ALIASES } from './util.js';

const toastEl = document.getElementById('toast');
const numEl = document.getElementById('numentry');
const statusEl = document.getElementById('status');
const spinnerEl = document.getElementById('spinner');
let favMode = false;
let toastTimer = 0;
let spinnerTimer = 0;
let numBuf = '';
let numTimer = 0;
let exitArmed = 0;

function toast(msg, ms = 2500) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), ms);
}

const status = {
  show(msg) {
    statusEl.textContent = msg;
    statusEl.classList.remove('hidden');
  },
  hide: () => statusEl.classList.add('hidden'),
};

player.onState = (s) => {
  clearTimeout(spinnerTimer);
  if (s === 'playing') spinnerEl.classList.add('hidden');
  else spinnerTimer = setTimeout(() => spinnerEl.classList.remove('hidden'), 1200);
};
player.onTracks = () => menu.refresh();

function activeList() {
  const favs = channels.favourites();
  return favMode && favs.length ? favs : channels.all();
}

function tune(ch, opts = {}) {
  if (!ch) return;
  if ('favMode' in opts) favMode = opts.favMode;
  settings.set('lastChannel', ch.id);
  player.play(ch);
  banner.show(ch);
}

actions.tune = tune;
actions.toast = toast;

function zap(dir) {
  const list = activeList();
  if (!list.length) return;
  const cur = player.current();
  const i = cur ? list.findIndex((c) => c.id === cur.id) : -1;
  tune(list[(i + dir + list.length) % list.length]);
}

function commitNumber() {
  const n = Number(numBuf);
  numBuf = '';
  numEl.classList.add('hidden');
  const ch = channels.all()[n - 1];
  if (ch) tune(ch, { favMode: false });
  else toast(`Channel ${n} does not exist`);
}

function digit(d) {
  numBuf = (numBuf + d).slice(-3);
  numEl.textContent = numBuf;
  numEl.classList.remove('hidden');
  clearTimeout(numTimer);
  // Switch right away once no longer number is possible.
  if (Number(numBuf) * 10 > channels.all().length) commitNumber();
  else numTimer = setTimeout(commitNumber, 1500);
}

function liveKey(k) {
  switch (k) {
    case K.UP:
    case K.CH_UP:
      zap(1);
      break;
    case K.DOWN:
    case K.CH_DOWN:
      zap(-1);
      break;
    case K.OK:
      banner.hide();
      chlist.show(favMode);
      break;
    // GUIDE never reaches the app on webOS 25 (the TV opens its own guide), so ◀ opens ours.
    case K.LEFT:
      banner.hide();
      guide.show();
      break;
    case K.RIGHT:
      menu.show();
      break;
    case K.INFO:
      banner.toggleDetails();
      break;
    case K.GUIDE:
    case K.BLUE:
      banner.hide();
      guide.show();
      break;
    case K.GREEN: {
      const a = player.cycleAudio();
      toast(a ? `Audio ${a.index}/${a.total}: ${a.text}` : 'No other audio tracks');
      break;
    }
    case K.RED: {
      const ch = player.current();
      if (ch) {
        toast((channels.toggleFav(ch.id) ? 'Added to' : 'Removed from') + ' favourites: ' + ch.name);
        banner.refresh();
      }
      break;
    }
    case K.BACK:
      if (banner.visible()) banner.hide();
      else if (Date.now() - exitArmed < 2500) window.close();
      else {
        exitArmed = Date.now();
        toast('Press BACK again to exit');
      }
      break;
    default:
      return false;
  }
  return true;
}

function dispatch(k) {
  const d = k >= 48 && k <= 57 ? k - 48 : k >= 96 && k <= 105 ? k - 96 : -1;
  if (guide.visible()) return guide.onKey(k);
  if (chlist.visible()) return chlist.onKey(k);
  if (menu.visible()) return menu.onKey(k);
  if (d >= 0) {
    digit(d);
    return true;
  }
  // The on-screen 123 keypad sends OK after the digits: switch right away instead of opening the list.
  if (k === K.OK && numBuf) {
    clearTimeout(numTimer);
    commitNumber();
    return true;
  }
  return liveKey(k);
}

// Recent key codes, readable over the web inspector to map unknown remote buttons.
const keyLog = [];

// In the channel list OK acts on release, so holding it can toggle the favourite instead.
const HOLD_MS = 700;
let okHold = null;
let okDown = false; // OK is physically held (repeats arrive as further keydowns)

document.addEventListener('keydown', (e) => {
  const k = KEY_ALIASES[e.keyCode] || e.keyCode;
  keyLog.push(e.keyCode + (e.key ? ' ' + e.key : ''));
  if (keyLog.length > 40) keyLog.shift();

  const okContinued = k === K.OK && okDown;
  okDown = k === K.OK; // any other key means OK was released, even if its keyup got lost
  if (k === K.OK && chlist.visible()) {
    e.preventDefault();
    // Ignore repeats of a press that began before the list opened.
    if (!okHold && !okContinued) {
      okHold = { fired: false };
      okHold.timer = setTimeout(() => {
        okHold.fired = true;
        chlist.toggleFav();
      }, HOLD_MS);
    }
    return;
  }
  if (dispatch(k)) e.preventDefault();
});

document.addEventListener('keyup', (e) => {
  if ((KEY_ALIASES[e.keyCode] || e.keyCode) !== K.OK) return;
  okDown = false;
  if (!okHold) return;
  clearTimeout(okHold.timer);
  const wasHold = okHold.fired;
  okHold = null;
  if (!wasHold && chlist.visible()) chlist.onKey(K.OK);
});

// Magic Remote scroll wheel: up/down in lists, channel switching in live TV.
let lastWheel = 0;
document.addEventListener('wheel', (e) => {
  const live = !guide.visible() && !chlist.visible() && !menu.visible();
  const now = Date.now();
  if (now - lastWheel < (live ? 400 : 120) || !e.deltaY) return;
  lastWheel = now;
  dispatch(e.deltaY > 0 ? K.DOWN : K.UP);
});

document.getElementById('video').addEventListener('click', () => {
  if (!guide.visible() && !chlist.visible() && !menu.visible()) banner.show(player.current());
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    player.suspend();
  } else {
    player.resume();
    banner.show(player.current());
  }
});

epg.onChange(() => {
  banner.refresh();
  chlist.refresh();
  guide.refresh();
});

function startChannel() {
  return channels.byId(settings.get('lastChannel')) || channels.all()[0];
}

async function loadChannels() {
  const [apiChannels, m3u] = await Promise.all([
    api.channels(settings.get('langOrder', DEFAULT_LANG_ORDER)),
    api.m3u().catch((e) => {
      console.warn('[init7tv] M3U not available, showing HLS channels only', e);
      return '';
    }),
  ]);
  const list = buildLineup(m3u, apiChannels);
  if (!list.length) throw new Error('empty channel list');
  channels.set(list);
  settings.set('lineup', list);
}

async function start() {
  relay.start();
  // Start the last channel from cache immediately; the network checks run alongside.
  const cached = settings.get('lineup');
  if (cached && cached.length && !player.current()) {
    channels.set(cached);
    tune(startChannel());
  }

  try {
    const auth = await api.allowed();
    if (!auth.allowed) {
      player.stop();
      status.show(
        `This connection (${auth.ip}) is not authorized for Init7 TV7.\nIt only works on an Init7 internet connection.`,
      );
      return;
    }
    await loadChannels();
  } catch (e) {
    console.warn('[init7tv] start failed', e);
    if (!player.current()) status.show('Init7 TV server not reachable.\nRetrying…');
    setTimeout(start, 10000);
    return;
  }
  status.hide();
  const cur = player.current();
  const fresh = cur && channels.byId(cur.id);
  if (!fresh || fresh.hls !== cur.hls) tune(fresh || startChannel());

  epg.ensure(Date.now() - 3600000, Date.now() + 6 * 3600000);
}

// Housekeeping: clock/progress refresh, keep the EPG ahead of "now", reload the lineup.
let ticks = 0;
setInterval(() => {
  ticks++;
  banner.refresh();
  epg.ensure(Date.now() - 3600000, Date.now() + 6 * 3600000);
  if (ticks % 120 === 0) epg.prune(); // hourly
  if (ticks % 720 === 0) loadChannels().catch((e) => console.warn('[init7tv] channel refresh failed', e)); // 6 h
}, 30000);

// Debug handle for the web inspector (see CONTRIBUTING.md → Debugging).
window.App = { version: APP_VERSION, player, channels, epg, settings, keyLog, tune };

start();
