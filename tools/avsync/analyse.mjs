// Measures A/V offsets in a video of the TV playing the A/V sync test stream (see README.md).
// For each flash it finds the nearest beep, names the track by its pitch and prints the offset
// (positive = sound later than picture). Runs of flashes on the same track are summarised.
//
// usage: node tools/avsync/analyse.mjs <recording> [--audio <n>] [--to <s>]
//   --audio n  audio stream of the file to use (default 0; a phone video has one)
//   --to s     analyse only the first s seconds
// needs ffmpeg on PATH or FFMPEG_DIR.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PERIOD, TRACKS } from './stream.mjs';

const ffmpeg = process.env.FFMPEG_DIR ? path.join(process.env.FFMPEG_DIR, 'ffmpeg') : 'ffmpeg';
const file = process.argv[2];
const opt = (name) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
if (!file) {
  console.error('usage: node tools/avsync/analyse.mjs <recording> [--audio <n>] [--to <s>]');
  process.exit(1);
}
const limit = opt('to') ? ['-t', opt('to')] : [];
const RATE = 48000;
const WIN = 480; // 10 ms
const HOP = 240; // 5 ms
const QUIET_MS = 400; // silence/darkness needed before a new onset

function run(args, encoding) {
  const r = spawnSync(ffmpeg, args, { maxBuffer: 1 << 30, encoding });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + String(r.stderr).slice(-500));
  return r;
}

const percentile = (arr, p) => {
  const s = Float64Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

// Rising edges of a signal sampled at times `t`: [{ t, ms }] where v crosses thr after QUIET_MS below it.
function onsets(t, v, thr) {
  const out = [];
  let lastHigh = -Infinity;
  let cur = null;
  for (let i = 0; i < v.length; i++) {
    if (v[i] >= thr) {
      if (!cur && (t[i] - lastHigh) * 1000 >= QUIET_MS) {
        cur = { t: t[i], end: t[i], i0: i, i1: i };
        out.push(cur);
      }
      if (cur) {
        cur.end = t[i];
        cur.i1 = i;
      }
      lastHigh = t[i];
    } else if (cur && (t[i] - cur.end) * 1000 > 30) {
      cur = null;
    }
  }
  return out.map((o) => ({ ...o, ms: Math.round((o.end - o.t) * 1000) }));
}

// ---- picture: mean brightness per frame ----
const vlog = run(
  [
    '-hide_banner',
    '-loglevel',
    'info',
    ...limit,
    '-i',
    file,
    '-map',
    '0:v:0',
    '-an',
    '-vf',
    'scale=64:36,signalstats,metadata=print:key=lavfi.signalstats.YAVG',
    '-f',
    'null',
    '-',
  ],
  'utf8',
).stderr;
const ft = [];
const fy = [];
let pts = null;
for (const line of vlog.split(/\r?\n/)) {
  const a = /pts_time:([\d.]+)/.exec(line);
  if (a) pts = Number(a[1]);
  const b = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line);
  if (b && pts !== null) {
    ft.push(pts);
    fy.push(Number(b[1]));
    pts = null;
  }
}
if (!ft.length) throw new Error('no video frames read');
const yLow = percentile(fy, 0.1);
const yHigh = percentile(fy, 0.995);
const flashes = onsets(ft, fy, (yLow + yHigh) / 2);
const fps = (ft.length - 1) / (ft[ft.length - 1] - ft[0]);

// ---- sound: power at each track's pitch (Goertzel), 10 ms windows every 5 ms ----
const pcm = run(
  [
    '-hide_banner',
    '-loglevel',
    'error',
    ...limit,
    '-i',
    file,
    '-map',
    `0:a:${opt('audio') || 0}`,
    '-vn',
    '-ac',
    '1',
    '-ar',
    String(RATE),
    '-f',
    's16le',
    'pipe:1',
  ],
  'buffer',
).stdout;
const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
const nWin = Math.max(0, Math.floor((samples.length - WIN) / HOP));
const at = new Float64Array(nWin);
const band = TRACKS.map(() => new Float64Array(nWin));
const coef = TRACKS.map((tr) => 2 * Math.cos((2 * Math.PI * tr.freq) / RATE));
for (let w = 0; w < nWin; w++) {
  const off = w * HOP;
  at[w] = (off + WIN / 2) / RATE;
  for (let k = 0; k < TRACKS.length; k++) {
    let s1 = 0;
    let s2 = 0;
    const c = coef[k];
    for (let n = 0; n < WIN; n++) {
      const s0 = samples[off + n] / 32768 + c * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    band[k][w] = s1 * s1 + s2 * s2 - c * s1 * s2;
  }
}
// A beep is wherever the strongest pitch rises well above its own background.
const thr = band.map((b) => Math.max(percentile(b, 0.5) * 10, percentile(b, 0.99) * 0.1));
const level = new Float64Array(nWin);
for (let w = 0; w < nWin; w++) level[w] = Math.max(...band.map((b, k) => b[w] / thr[k]));
const beeps = onsets(at, level, 1).map((o) => {
  const sum = band.map((b) => b.slice(o.i0, o.i1 + 1).reduce((x, y) => x + y, 0));
  return { ...o, track: sum.indexOf(Math.max(...sum)) };
});

// ---- pair every flash with the nearest beep within half a period ----
const rows = flashes.map((f) => {
  let best = null;
  for (const b of beeps) if (!best || Math.abs(b.t - f.t) < Math.abs(best.t - f.t)) best = b;
  if (!best || Math.abs(best.t - f.t) > PERIOD / 2) return { t: f.t, long: f.ms > 200, beep: null };
  const mismatch = f.ms > 200 !== best.ms > 200;
  return { t: f.t, long: f.ms > 200, beep: best, offset: Math.round((best.t - f.t) * 1000), mismatch };
});
const unpaired = beeps.filter((b) => !rows.some((r) => r.beep === b));

const fmt = (s) => s.toFixed(2).padStart(7);
const trackName = (k) => `track ${k + 1} (${TRACKS[k].codec.toUpperCase()}, ${TRACKS[k].freq} Hz)`;
console.log(`${file}: ${ft.length} frames (~${fps.toFixed(1)} fps), ${flashes.length} flashes, ${beeps.length} beeps`);
console.log('\n   time  offset  track');
for (const r of rows) {
  const flag = r.long ? ' long' : '';
  if (!r.beep) console.log(`${fmt(r.t)}       -  no beep${flag}`);
  else
    console.log(
      `${fmt(r.t)} ${String(r.offset).padStart(5)} ms  ${trackName(r.beep.track)}${flag}` +
        (r.mismatch ? '  !! flash and beep length differ: offset may be off by a whole period' : ''),
    );
}
for (const b of unpaired) console.log(`${fmt(b.t)}  beep without a flash, ${trackName(b.track)}`);

// Runs: consecutive paired flashes on the same track, broken by a gap (freeze, reload) or a track change.
console.log('\nRuns (positive = sound late):');
let run0 = null;
const runs = [];
for (const r of rows) {
  const gap = run0 && r.t - run0.last > PERIOD * 1.5;
  if (!r.beep || !run0 || gap || r.beep.track !== run0.track) {
    if (run0 && gap) runs.push({ gap: r.t - run0.last, at: run0.last });
    run0 = r.beep ? { track: r.beep.track, from: r.t, last: r.t, offs: [] } : null;
    if (run0) runs.push(run0);
  }
  if (run0) {
    run0.last = r.t;
    run0.offs.push(r.offset);
  }
}
for (const x of runs) {
  if (x.gap) {
    console.log(`  ${fmt(x.at)}  gap of ${x.gap.toFixed(1)} s without a paired flash`);
    continue;
  }
  const o = x.offs.slice().sort((a, b) => a - b);
  const mean = Math.round(o.reduce((a, b) => a + b, 0) / o.length);
  console.log(
    `  ${fmt(x.from)} - ${fmt(x.last).trim()} s  ${trackName(x.track)}: ${o.length} flashes, mean ${mean} ms, ` +
      `median ${o[o.length >> 1]} ms, range ${o[0]} .. ${o[o.length - 1]} ms`,
  );
}
