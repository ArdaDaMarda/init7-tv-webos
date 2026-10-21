// Checks whether a channel's audio tracks really differ, e.g. whether the "eng" track currently carries
// English or just the German sound again. Decodes ~18 s of each track with ffmpeg and reports loudness
// and correlation with track 1 (≈1.0 = same audio, low or negative = different audio).
// Usage: node tools/audio-compare.mjs <channel-pk> [work-dir]
// Needs ffmpeg/ffprobe on PATH (or FFMPEG_DIR) and an Init7 connection.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [pk, outDir = path.join(tmpdir(), 'init7tv-audio')] = process.argv.slice(2);
if (!pk) {
  console.error('usage: node tools/audio-compare.mjs <channel-pk> [work-dir]');
  process.exit(1);
}
const bin = (name) => (process.env.FFMPEG_DIR ? path.join(process.env.FFMPEG_DIR, name) : name);
const RATE = 8000;

mkdirSync(outDir, { recursive: true });
const playlist = await (await fetch(`https://api.tv.init7.net/api/live/?channel=${pk}`)).text();
const segments = playlist
  .split('\n')
  .filter((l) => l.startsWith('http'))
  .slice(-3);
const parts = [];
for (const s of segments) parts.push(Buffer.from(await (await fetch(s)).arrayBuffer()));
const tsFile = path.join(outDir, 'sample.ts');
writeFileSync(tsFile, Buffer.concat(parts));

const probe = JSON.parse(
  execFileSync(bin('ffprobe'), [
    '-v',
    'error',
    '-select_streams',
    'a',
    '-show_entries',
    'stream=codec_name,channels:stream_tags=language',
    '-of',
    'json',
    tsFile,
  ]).toString(),
);

const tracks = probe.streams.map((s, i) => {
  const raw = path.join(outDir, `track${i + 1}.raw`);
  execFileSync(bin('ffmpeg'), [
    '-v',
    'error',
    '-y',
    '-i',
    tsFile,
    '-map',
    `0:a:${i}`,
    '-ac',
    '1',
    '-ar',
    String(RATE),
    '-f',
    's16le',
    raw,
  ]);
  const b = readFileSync(raw);
  const pcm = new Float64Array(b.length / 2);
  for (let k = 0; k < pcm.length; k++) pcm[k] = b.readInt16LE(k * 2);
  return { label: `${s.codec_name} ${s.channels}ch ${(s.tags && s.tags.language) || '?'}`, pcm };
});

const rms = (s) => Math.sqrt(s.reduce((a, x) => a + x * x, 0) / s.length);

// Best normalised correlation over ±50 ms, so small encoder delays don't matter.
function correlation(a, b) {
  let best = 0;
  for (let lag = -RATE / 20; lag <= RATE / 20; lag += 4) {
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let k = RATE; k < Math.min(a.length, b.length) - RATE; k++) {
      const x = a[k];
      const y = b[k + lag];
      ab += x * y;
      aa += x * x;
      bb += y * y;
    }
    const c = ab / Math.sqrt(aa * bb || 1);
    if (Math.abs(c) > Math.abs(best)) best = c;
  }
  return best;
}

console.log(`${segments.length} segments, ${(tracks[0].pcm.length / RATE).toFixed(1)} s decoded`);
tracks.forEach((t, i) => {
  const c = i === 0 ? 1 : correlation(tracks[0].pcm, t.pcm);
  console.log(
    `track ${i + 1} [${t.label}]  loudness=${rms(t.pcm).toFixed(0)}  correlation with track 1=${c.toFixed(3)}`,
  );
});
