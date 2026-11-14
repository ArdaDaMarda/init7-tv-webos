// The player's audio-track fallback, with a minimal fake of the <video> element and the relay service.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const listeners = {};
const video = {
  firstChild: null,
  audioTracks: [],
  currentTime: 0,
  addEventListener: (type, fn) => (listeners[type] = fn),
  appendChild: (el) => (video.firstChild = el),
  removeChild: () => (video.firstChild = null),
  removeAttribute() {},
  pause() {},
  load() {},
  play: () => Promise.resolve(),
};
const fire = (type) => listeners[type]();
const src = () => (video.firstChild ? video.firstChild.src : null);
const settle = () => new Promise((r) => setImmediate(r)); // lets the relay's promise callbacks run

globalThis.window = globalThis;
globalThis.document = { hidden: false, getElementById: () => video, createElement: () => ({}) };
// The relay service answers its "start" call at once.
globalThis.PalmServiceBridge = class {
  call() {
    this.onservicecallback(JSON.stringify({ returnValue: true, port: 8077 }));
  }
};
globalThis.fetch = async () => ({ json: async () => ({ audio: null }) }); // no track descriptions

test('a single-track stream that fails twice falls back to the default track', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { actions } = await import('../src/app/js/actions.js');
  const { player } = await import('../src/app/js/player.js');
  const { settings } = await import('../src/app/js/settings.js');
  const toasts = [];
  actions.toast = (msg) => toasts.push(msg);
  settings.set('audioLang', 'en');
  const ch = { id: '233.50.230.1:5000', hls: 'https://api.tv.init7.net/ch/index.m3u8' };
  const filtered = 'http://127.0.0.1:8077/hls?track=1&url=' + encodeURIComponent(ch.hls);

  // The channel starts as plain HLS; the remembered language is track 2, which comes from the relay.
  player.play(ch);
  assert.equal(src(), ch.hls);
  video.audioTracks = [{ language: 'de' }, { language: 'en' }];
  fire('playing');
  await settle();
  assert.equal(src(), filtered);

  // First failure: the same stream is tried again.
  fire('error');
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(src(), filtered);
  assert.deepEqual(toasts, []);

  // Second failure: back to the plain stream, and it stays there.
  fire('error');
  assert.equal(toasts.length, 1);
  t.mock.timers.tick(2000);
  await settle();
  assert.equal(src(), ch.hls);
  fire('playing');
  await settle();
  assert.equal(src(), ch.hls);
  assert.equal(player.audioInfo().index, 1);

  // A later reload of the plain stream doesn't go back to the failing track by itself.
  fire('error');
  t.mock.timers.tick(1000);
  await settle();
  fire('playing');
  await settle();
  assert.equal(src(), ch.hls);

  // Choosing the track by hand tries it again.
  player.selectAudio(1);
  await settle();
  assert.equal(src(), filtered);
  fire('playing');
  assert.equal(player.audioInfo().index, 2);
});
