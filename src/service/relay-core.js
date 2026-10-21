// Pure helpers of the relay, kept free of webOS APIs so they can be unit-tested with Node.

// Init7 sends raw MPEG-TS in UDP; strip an RTP header if a stream ever carries one.
function payload(buf) {
  if (buf[0] === 0x47) return buf;
  if ((buf[0] & 0xc0) === 0x80) return buf.subarray(12 + (buf[0] & 0x0f) * 4);
  return buf;
}

// "/udp/233.50.230.26:5000" -> { group: '233.50.230.26', port: 5000 }, otherwise null.
// The same address format is used by "/info/<group>:<port>".
function parseUdpPath(url, prefix = 'udp') {
  const m = new RegExp('^/' + prefix + '/(\\d{1,3}(?:\\.\\d{1,3}){3}):(\\d{1,5})(?:[/?]|$)').exec(url || '');
  if (!m) return null;
  const port = Number(m[2]);
  return port > 0 && port < 65536 ? { group: m[1], port } : null;
}

const AUDIO_STREAM_TYPES = { 0x03: 'MP2', 0x04: 'MP2', 0x0f: 'AAC', 0x11: 'AAC', 0x81: 'AC-3', 0x87: 'E-AC-3' };
const AC3_CHANNELS = ['mono', 'dual mono', 'stereo', 'stereo', '5.1', '5.1', null, null];
const AC3_SERVICE = [null, 'music-effects', 'description', 'clear', null, null, null, null];
const ISO639_AUDIO_TYPE = [null, null, 'clear', 'description'];
const SUPPLEMENTARY_EDITORIAL = [null, 'description', 'clear', 'spoken-subtitles'];

// Payload of the TS packet at offset i (after header and adaptation field), or null.
function packetPayload(ts, i) {
  let p = i + 4;
  if (ts[i + 3] & 0x20) p += 1 + ts[p];
  return p < i + 188 ? ts.subarray(p, i + 188) : null;
}

// Reassembles the PSI section starting in the packet at offset `start` (payload_unit_start set),
// following continuation packets of the same PID. Returns the section from table_id on, or null.
function readSection(ts, start, pid) {
  const first = packetPayload(ts, start);
  if (!first) return null;
  let sec = first.subarray(1 + first[0]); // skip pointer_field
  if (sec.length < 3) return null;
  const need = 3 + (((sec[1] & 0x0f) << 8) | sec[2]);
  for (let i = start + 188; sec.length < need && i + 188 <= ts.length; i += 188) {
    const pidHere = ((ts[i + 1] & 0x1f) << 8) | ts[i + 2];
    if (ts[i] !== 0x47 || pidHere !== pid || ts[i + 1] & 0x40) continue;
    const more = packetPayload(ts, i);
    if (more) sec = Buffer.concat([sec, more]);
  }
  return sec.length >= need ? sec.subarray(0, need) : null;
}

// PID of the first program's PMT from a PAT section, or -1.
function pmtPidFromPat(pat) {
  if (!pat || pat[0] !== 0x00) return -1;
  for (let q = 8; q + 4 <= pat.length - 4; q += 4) {
    if (((pat[q] << 8) | pat[q + 1]) !== 0) return ((pat[q + 2] & 0x1f) << 8) | pat[q + 3];
  }
  return -1;
}

// Describes the audio streams of an MPEG-TS sample from its PAT and PMT, in PMT order:
// [{ pid, codec, lang, purpose, channels }]. Returns null until both tables have been seen.
// purpose: 'description' | 'clear' | 'spoken-subtitles' | 'music-effects' | null
function parsePmt(ts) {
  let pmtPid = -1;
  for (let i = 0; i + 188 <= ts.length; i += 188) {
    if (ts[i] !== 0x47 || !(ts[i + 1] & 0x40)) continue;
    const pid = ((ts[i + 1] & 0x1f) << 8) | ts[i + 2];
    if (pid === 0 && pmtPid < 0) {
      pmtPid = pmtPidFromPat(readSection(ts, i, 0));
    } else if (pid === pmtPid) {
      const pmt = readSection(ts, i, pid);
      if (pmt && pmt[0] === 0x02) return audioStreams(pmt);
    }
  }
  return null;
}

function audioStreams(pmt) {
  const end = pmt.length - 4; // CRC
  const out = [];
  for (let q = 12 + (((pmt[10] & 0x0f) << 8) | pmt[11]); q + 5 <= end;) {
    const type = pmt[q];
    const esEnd = q + 5 + (((pmt[q + 3] & 0x0f) << 8) | pmt[q + 4]);
    const s = { pid: ((pmt[q + 1] & 0x1f) << 8) | pmt[q + 2], codec: AUDIO_STREAM_TYPES[type] || null };
    s.lang = '';
    s.purpose = null;
    s.channels = null;
    for (let d = q + 5; d + 2 <= esEnd; d += 2 + pmt[d + 1]) {
      const tag = pmt[d];
      const b = pmt.subarray(d + 2, d + 2 + pmt[d + 1]);
      if (tag === 0x0a && b.length >= 4) {
        s.lang = b.toString('latin1', 0, 3);
        s.purpose = s.purpose || ISO639_AUDIO_TYPE[b[3]] || null;
      } else if ((tag === 0x6a || tag === 0x7a) && b.length >= 2 && b[0] & 0x80) {
        s.codec = tag === 0x6a ? 'AC-3' : 'E-AC-3';
        s.channels = AC3_CHANNELS[b[1] & 0x07];
        s.purpose = s.purpose || AC3_SERVICE[(b[1] >> 3) & 0x07];
      } else if (tag === 0x6a || tag === 0x7a) {
        s.codec = tag === 0x6a ? 'AC-3' : 'E-AC-3';
      } else if (tag === 0x7c) {
        s.codec = 'AAC';
      } else if (tag === 0x7f && b[0] === 0x06 && b.length >= 2) {
        // DVB supplementary_audio_descriptor: editorial classification beats the ISO 639 audio type
        s.purpose = SUPPLEMENTARY_EDITORIAL[(b[1] >> 2) & 0x1f] || s.purpose;
        if (b[1] & 0x01 && b.length >= 5) s.lang = b.toString('latin1', 2, 5);
      }
    }
    if (s.codec) out.push(s);
    q = esEnd;
  }
  return out;
}

// CRC-32/MPEG-2 as used by PSI sections (poly 0x04C11DB7, init 0xFFFFFFFF, no reflection, no xor-out).
function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    crc ^= b << 24;
    for (let k = 0; k < 8; k++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  }
  return crc >>> 0;
}

// PMT section with every audio stream except `keepPid` removed, plus the set of removed audio PIDs.
// Returns null if `keepPid` is not an audio stream of this PMT.
function rewritePmt(pmt, keepPid) {
  const audio = audioStreams(pmt).map((s) => s.pid);
  if (!audio.includes(keepPid)) return null;
  const drop = new Set(audio.filter((pid) => pid !== keepPid));
  const end = pmt.length - 4;
  const start = 12 + (((pmt[10] & 0x0f) << 8) | pmt[11]);
  const parts = [pmt.subarray(0, start)];
  for (let q = start; q + 5 <= end;) {
    const esEnd = q + 5 + (((pmt[q + 3] & 0x0f) << 8) | pmt[q + 4]);
    if (!drop.has(((pmt[q + 1] & 0x1f) << 8) | pmt[q + 2])) parts.push(pmt.subarray(q, esEnd));
    q = esEnd;
  }
  const body = Buffer.concat(parts); // a copy, safe to modify
  const sectionLength = body.length - 3 + 4;
  body[1] = (body[1] & 0xf0) | ((sectionLength >> 8) & 0x0f);
  body[2] = sectionLength & 0xff;
  const crc = crc32(body);
  return {
    section: Buffer.concat([body, Buffer.from([crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff])]),
    drop,
  };
}

// One TS packet carrying a whole PSI section, reusing the original header (PID, continuity counter).
function psiPacket(header, section) {
  if (section.length > 183) return null;
  const p = Buffer.alloc(188, 0xff);
  header.copy(p, 0, 0, 4);
  p[1] |= 0x40; // payload_unit_start
  p[3] = (p[3] & 0xcf) | 0x10; // payload only, no adaptation field
  p[4] = 0; // pointer_field
  section.copy(p, 5);
  return p;
}

// Stateful filter for a live MPEG-TS stream that keeps only the audio stream `keepPid`: the PMT is
// rewritten to list just that audio stream and the packets of all other audio streams are dropped.
// The player then sees a single audio track and never has to switch tracks (which desyncs webOS).
function createAudioFilter(keepPid) {
  let pmtPid = -1;
  let drop = null; // audio PIDs to remove, known after the first PMT
  let skipContinuation = false; // the PMT start was replaced, so its continuation packets go too
  return (chunk) => {
    const out = [];
    for (let i = 0; i + 188 <= chunk.length; i += 188) {
      if (chunk[i] !== 0x47) continue;
      const pid = ((chunk[i + 1] & 0x1f) << 8) | chunk[i + 2];
      const pusi = (chunk[i + 1] & 0x40) !== 0;
      if (pid === 0 && pusi && pmtPid < 0) pmtPid = pmtPidFromPat(readSection(chunk, i, 0));
      if (pid === pmtPid && pmtPid >= 0) {
        if (!pusi) {
          if (!skipContinuation) out.push(chunk.subarray(i, i + 188));
          continue;
        }
        const sec = readSection(chunk, i, pid);
        const rewritten = sec && sec[0] === 0x02 ? rewritePmt(sec, keepPid) : null;
        const packet = rewritten && psiPacket(chunk.subarray(i, i + 4), rewritten.section);
        skipContinuation = !!packet;
        if (packet) {
          drop = rewritten.drop;
          out.push(packet);
        } else {
          out.push(chunk.subarray(i, i + 188)); // unexpected PMT layout: pass through unchanged
        }
        continue;
      }
      if (drop && drop.has(pid)) continue;
      out.push(chunk.subarray(i, i + 188));
    }
    return out.length === 1 ? out[0] : Buffer.concat(out);
  };
}

module.exports = { payload, parseUdpPath, parsePmt, crc32, rewritePmt, createAudioFilter };
