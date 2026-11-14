// A/V sync test, run inside the app on the TV through DevTools (see README.md):
//   node tools/cdp.mjs <ws-url> "eval:$(cat tools/avsync/run.js)"
// It plays the test stream from tools/avsync/stream.mjs in its own <video>, switches the audio track
// in 7 labelled steps, and returns a log. The label of each step is shown at the top of the screen, so a
// phone video of the TV shows which method produced which offset. Afterwards the previous channel plays again.
/* global App, PalmServiceBridge */
(async () => {
  const GROUP = '239.255.77.1:5000'; // as in stream.mjs
  const BASE = 'http://127.0.0.1:8077/udp/' + GROUP;
  const PIDS = [257, 258, 259];
  const NAMES = ['track 1 · MP2 · 700 Hz', 'track 2 · MP2 · 1300 Hz', 'track 3 · AC-3 · 2300 Hz'];
  const LANGS = ['deu', 'fra', 'eng'];
  const HOLD = 20000;
  const t0 = Date.now();
  const out = [];
  const note = (s) => out.push(((Date.now() - t0) / 1000).toFixed(1).padStart(6) + ' s  ' + s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  if (document.hidden) return 'The app is in the background: not started.';
  try {
    await fetch('http://127.0.0.1:8077/stats');
  } catch (e) {
    return 'Relay not running (play any multicast channel once, then try again).';
  }

  const luna = (uri, params) =>
    new Promise((resolve) => {
      const bridge = new PalmServiceBridge();
      const timer = setTimeout(() => resolve({ timeout: true }), 4000);
      bridge.onservicecallback = (msg) => {
        clearTimeout(timer);
        resolve(msg);
        bridge.keep = null;
      };
      bridge.keep = bridge; // keep it referenced until the answer arrives
      bridge.call(uri, JSON.stringify(params));
    });

  const previous = App.player.current();
  App.player.stop();
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;left:0;top:0;width:1920px;height:1080px;z-index:9000;background:#000';
  const v = document.createElement('video');
  v.style.cssText = 'position:absolute;left:0;top:0;width:1920px;height:1080px;background:#000';
  const label = document.createElement('div');
  label.style.cssText =
    'position:absolute;left:60px;top:40px;padding:12px 24px;font:bold 44px Arial,sans-serif;color:#fff;' +
    'background:rgba(40,40,40,0.9);border-radius:12px';
  box.appendChild(v);
  box.appendChild(label);
  document.body.appendChild(box);

  let playingAt = 0;
  let waits = 0;
  v.addEventListener('playing', () => (playingAt = Date.now()));
  v.addEventListener('waiting', () => waits++);

  function attach(url) {
    playingAt = 0;
    v.pause();
    while (v.firstChild) v.removeChild(v.firstChild);
    v.removeAttribute('src');
    const s = document.createElement('source');
    s.src = url;
    s.type = 'video/mp2t';
    v.appendChild(s);
    v.load();
    v.play().catch(() => {});
  }
  async function untilPlaying(ms) {
    const start = Date.now();
    while (!playingAt && Date.now() - start < ms) await sleep(50);
    return playingAt ? playingAt - start : null;
  }
  const langs = () => (v.audioTracks ? Array.from(v.audioTracks).map((t) => t.language) : []);

  // LG's switch with the safeguards other webOS players use: a valid media id, playback running for
  // a while with the clock advancing, and one call at a time (awaited).
  async function lgSwitch(i) {
    while (Date.now() - playingAt < 3000) await sleep(100);
    const id = v.mediaId;
    if (!id || /invalid/i.test(id)) return note('no valid mediaId (' + id + '), switch skipped');
    const before = v.currentTime;
    await sleep(500);
    if (v.currentTime === before) note('warning: clock not advancing before the switch');
    const l = langs();
    const index = l.indexOf(LANGS[i]) >= 0 ? l.indexOf(LANGS[i]) : i;
    const reply = await luna('luna://com.webos.media/selectTrack', { mediaId: id, type: 'audio', index });
    note(`selectTrack index ${index} (player tracks: ${l.join(',') || 'none'}) -> ${JSON.stringify(reply)}`);
  }
  async function resync() {
    await sleep(1000);
    const before = v.currentTime;
    v.pause();
    await sleep(300);
    await v.play().catch((e) => note('play() after pause failed: ' + e));
    note(`resync: pause 300 ms + play at ${before.toFixed(2)} s`);
  }
  async function hold(ms) {
    const w0 = waits;
    const samples = [];
    const end = Date.now() + ms;
    while (Date.now() < end) {
      samples.push(v.currentTime);
      await sleep(1000);
    }
    let stuck = 0;
    for (let k = 1; k < samples.length; k++) if (samples[k] === samples[k - 1]) stuck++;
    note(
      `held ${ms / 1000} s: clock ${samples[0].toFixed(1)} -> ${v.currentTime.toFixed(1)} s, ` +
        `${stuck} s without progress, ${waits - w0} waiting events`,
    );
  }
  async function step(n, text, action) {
    label.textContent = `${n}/7  ${text}`;
    note(`step ${n}: ${text}`);
    await action();
    await hold(HOLD);
  }

  try {
    await step(1, 'Reference: ' + NAMES[0], async () => {
      attach(BASE);
      const ms = await untilPlaying(20000);
      if (ms === null) throw new Error('the test stream did not start: is stream.mjs running on the PC?');
      note(`playing after ${ms} ms, player tracks: ${langs().join(',') || 'none'}, mediaId ${v.mediaId}`);
    });
    await step(2, 'LG switch → ' + NAMES[1] + ' (same codec)', () => lgSwitch(1));
    await step(3, 'LG switch → ' + NAMES[2] + ' (codec change)', () => lgSwitch(2));
    await step(4, 'LG switch + resync → ' + NAMES[0] + ' (codec change)', async () => {
      await lgSwitch(0);
      await resync();
    });
    await step(5, 'LG switch + resync → ' + NAMES[2] + ' (codec change)', async () => {
      await lgSwitch(2);
      await resync();
    });
    for (const [n, i] of [
      [6, 1],
      [7, 2],
    ]) {
      await step(n, 'Relay reload → ' + NAMES[i] + " (today's method)", async () => {
        attach(BASE + '?audio=' + PIDS[i]);
        note(`playing after ${await untilPlaying(15000)} ms`);
      });
    }
    label.textContent = 'Done';
    await sleep(3000);
  } catch (e) {
    note('aborted: ' + (e.message || e));
  } finally {
    v.pause();
    while (v.firstChild) v.removeChild(v.firstChild);
    v.load();
    box.remove();
    if (previous) App.tune(previous);
    note('restored ' + (previous ? previous.name : 'nothing (no channel was playing)'));
  }
  return out.join('\n');
})();
