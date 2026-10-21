// Lists the audio tracks of a live channel and checks whether they carry different audio.
// Usage: node tools/ts-audio.mjs <channel-pk>   (pk from /api/tvchannel/; needs an Init7 connection)
// Downloads one HLS segment, parses the PMT and compares the audio PES payloads per PID.
import { createHash } from 'node:crypto';

const pk = process.argv[2];
if (!pk) {
  console.error('usage: node tools/ts-audio.mjs <channel-pk>');
  process.exit(1);
}
const playlist = await (await fetch(`https://api.tv.init7.net/api/live/?channel=${pk}`)).text();
const segUrl = playlist
  .split('\n')
  .filter((l) => l.startsWith('http'))
  .pop();
const ts = Buffer.from(await (await fetch(segUrl)).arrayBuffer());

const STREAM_TYPES = { 0x03: 'MP2', 0x04: 'MP2', 0x0f: 'AAC', 0x11: 'AAC-LATM', 0x81: 'AC-3', 0x87: 'E-AC-3' };
let pmtPid = -1;
const audio = new Map(); // pid -> { codec, lang, chunks }

for (let i = 0; i + 188 <= ts.length; i += 188) {
  if (ts[i] !== 0x47) continue;
  const pusi = (ts[i + 1] & 0x40) !== 0;
  const pid = ((ts[i + 1] & 0x1f) << 8) | ts[i + 2];
  let p = i + 4;
  if (ts[i + 3] & 0x20) p += 1 + ts[p];
  if (pid === 0 && pusi && pmtPid < 0) {
    p += 1 + ts[p];
    pmtPid = ((ts[p + 10] & 0x1f) << 8) | ts[p + 11];
  } else if (pid === pmtPid && pusi && !audio.size) {
    p += 1 + ts[p];
    const end = p + 3 + (((ts[p + 1] & 0x0f) << 8) | ts[p + 2]) - 4;
    let q = p + 12 + (((ts[p + 10] & 0x0f) << 8) | ts[p + 11]);
    while (q < end) {
      const type = ts[q];
      const epid = ((ts[q + 1] & 0x1f) << 8) | ts[q + 2];
      const esl = ((ts[q + 3] & 0x0f) << 8) | ts[q + 4];
      let lang = '?';
      let codec = STREAM_TYPES[type];
      for (let d = q + 5; d < q + 5 + esl; d += 2 + ts[d + 1]) {
        if (ts[d] === 0x0a) lang = ts.toString('latin1', d + 2, d + 5);
        if (ts[d] === 0x6a) codec = 'AC-3';
        if (ts[d] === 0x7a) codec = 'E-AC-3';
      }
      if (codec) audio.set(epid, { codec, lang, chunks: [] });
      q += 5 + esl;
    }
  } else if (audio.has(pid)) {
    let payload = ts.subarray(p, i + 188);
    if (pusi) payload = payload.subarray(9 + payload[8]); // skip the PES header
    audio.get(pid).chunks.push(payload);
  }
}

const tracks = [...audio.entries()].map(([pid, a], n) => {
  const data = Buffer.concat(a.chunks);
  return {
    n: n + 1,
    pid,
    codec: a.codec,
    lang: a.lang,
    bytes: data.length,
    md5: createHash('md5').update(data).digest('hex'),
  };
});
console.table(tracks);
for (const t of tracks) {
  const same = tracks.filter((o) => o !== t && o.md5 === t.md5).map((o) => o.n);
  if (same.length) console.log(`track ${t.n} (${t.lang}) is byte-identical to track(s) ${same.join(', ')}`);
}
