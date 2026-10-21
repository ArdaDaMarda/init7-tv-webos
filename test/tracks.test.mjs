import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { labelText, matchesPlayer, trackLabel } from '../src/app/js/tracks.js';

const require = createRequire(import.meta.url);
const { parsePmt, crc32, createAudioFilter } = require('../src/service/relay-core.js');

// --- tiny MPEG-TS builder ------------------------------------------------------------------

function packet(pid, section) {
  const p = Buffer.alloc(188, 0xff);
  p[0] = 0x47;
  p[1] = 0x40 | ((pid >> 8) & 0x1f); // payload_unit_start
  p[2] = pid & 0xff;
  p[3] = 0x10; // payload only
  p[4] = 0; // pointer_field
  section.copy(p, 5);
  return p;
}

function section(tableId, body) {
  const len = body.length + 4; // + CRC (not checked)
  return Buffer.concat([Buffer.from([tableId, 0xb0 | (len >> 8), len & 0xff]), body, Buffer.alloc(4)]);
}

const pat = section(0x00, Buffer.from([0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe1, 0x00])); // program 1 -> PMT 0x100

function es(type, pid, descriptors) {
  const d = Buffer.concat(descriptors);
  return Buffer.concat([
    Buffer.from([type, 0xe0 | (pid >> 8), pid & 0xff, 0xf0 | (d.length >> 8), d.length & 0xff]),
    d,
  ]);
}
const iso639 = (lang, audioType = 0) =>
  Buffer.concat([Buffer.from([0x0a, 4]), Buffer.from(lang, 'latin1'), Buffer.from([audioType])]);
const supplementary = (editorial) => Buffer.from([0x7f, 2, 0x06, 0x80 | (editorial << 2)]);
const ac3 = (componentType) => Buffer.from([0x6a, 2, 0x80, componentType]);

function pmt(streams) {
  const head = Buffer.from([0x00, 0x01, 0xc1, 0x00, 0x00, 0xe1, 0x00, 0xf0, 0x00]); // program 1, PCR pid, no program info
  return section(0x02, Buffer.concat([head, ...streams]));
}

// Das Erste as seen in VLC: main, audio description, clean audio, AC-3; plus video and teletext.
const dasErste = Buffer.concat([
  packet(0, pat),
  packet(
    0x100,
    pmt([
      es(0x1b, 272, []),
      es(0x03, 273, [iso639('deu')]),
      es(0x03, 274, [iso639('deu', 3), supplementary(1)]),
      es(0x03, 275, [iso639('deu'), supplementary(2)]),
      es(0x06, 283, [iso639('deu'), ac3(0x04)]), // AC-3 in a private stream, 5.1
      es(0x06, 302, [Buffer.from([0x56, 5, 0x64, 0x65, 0x75, 0x09, 0x00])]), // teletext
    ]),
  ),
]);

function dataPacket(pid, cc = 0) {
  const p = Buffer.alloc(188, pid & 0xff);
  p[0] = 0x47;
  p[1] = (pid >> 8) & 0x1f;
  p[2] = pid & 0xff;
  p[3] = 0x10 | (cc & 0x0f);
  return p;
}
const pidsOf = (ts) => {
  const out = [];
  for (let i = 0; i + 188 <= ts.length; i += 188) out.push(((ts[i + 1] & 0x1f) << 8) | ts[i + 2]);
  return out;
};

test('crc32 is CRC-32/MPEG-2', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0x0376e6e7);
});

test('audio filter keeps one audio track and rewrites the PMT with a valid CRC', () => {
  const stream = Buffer.concat([dasErste, ...[272, 273, 274, 275, 283, 302].map((pid) => dataPacket(pid))]);
  const filter = createAudioFilter(274);
  const out = filter(stream);
  assert.deepEqual(pidsOf(out), [0, 0x100, 272, 274, 302]); // other audio PIDs dropped
  assert.deepEqual(
    parsePmt(out).map((s) => [s.pid, s.purpose]),
    [[274, 'description']],
  );
  // a CRC over a section including its CRC is 0 for CRC-32/MPEG-2
  const pmtPayload = out.subarray(188 + 5);
  const sectionLen = 3 + (((pmtPayload[1] & 0x0f) << 8) | pmtPayload[2]);
  assert.equal(crc32(pmtPayload.subarray(0, sectionLen)), 0);
  // later chunks: the filter remembers which PIDs to drop
  assert.deepEqual(pidsOf(filter(Buffer.concat([dataPacket(273, 1), dataPacket(274, 1)]))), [274]);
});

test('audio filter passes the stream through if the PID is not an audio track', () => {
  const out = createAudioFilter(999)(dasErste);
  assert.equal(parsePmt(out).length, 4);
});

test('parsePmt returns null until PAT and PMT are seen', () => {
  assert.equal(parsePmt(packet(0, pat)), null);
  assert.equal(parsePmt(Buffer.alloc(0)), null);
});

test('parsePmt lists audio streams with purpose, codec and channels', () => {
  assert.deepEqual(parsePmt(dasErste), [
    { pid: 273, codec: 'MP2', lang: 'deu', purpose: null, channels: null },
    { pid: 274, codec: 'MP2', lang: 'deu', purpose: 'description', channels: null },
    { pid: 275, codec: 'MP2', lang: 'deu', purpose: 'clear', channels: null },
    { pid: 283, codec: 'AC-3', lang: 'deu', purpose: null, channels: '5.1' },
  ]);
});

test('trackLabel combines language, purpose and codec; unknown codes stay visible', () => {
  const [main, ad, clear, dolby] = parsePmt(dasErste);
  assert.deepEqual(trackLabel('de', main), { name: 'Deutsch', purpose: '', codec: 'MP2' });
  assert.equal(labelText(trackLabel('de', ad)), 'Deutsch · Audio description');
  assert.equal(labelText(trackLabel('de', clear)), 'Deutsch · Clean audio');
  assert.equal(trackLabel('de', dolby).codec, 'Dolby Digital 5.1');
  assert.deepEqual(trackLabel('mis', undefined), { name: 'MIS', purpose: '', codec: '' });
});

test('descriptions are only used when they line up with the player tracks', () => {
  const info = parsePmt(dasErste);
  assert.ok(matchesPlayer(info, ['de', 'de', 'de', 'de']));
  assert.ok(matchesPlayer(info, ['deu', 'deu', 'deu', 'deu']));
  assert.ok(!matchesPlayer(info, ['de', 'de', 'de'])); // different count
  assert.ok(!matchesPlayer(info, ['de', 'en', 'de', 'de'])); // different language
  assert.ok(!matchesPlayer(null, ['de']));
});

test('special codes (mis, qks, mul) match the remuxed "de" and show the real language', () => {
  // Das Erste via multicast vs. Init7 HLS (which labels every track "de")
  const multicast = [
    { lang: 'deu', purpose: null, codec: 'MP2' },
    { lang: 'mis', purpose: 'description', codec: 'MP2' },
    { lang: 'qks', purpose: 'clear', codec: 'MP2' },
    { lang: 'deu', purpose: null, codec: 'AC-3' },
  ];
  assert.ok(matchesPlayer(multicast, ['de', 'de', 'de', 'de']));
  assert.equal(labelText(trackLabel('de', multicast[1])), 'Deutsch · Audio description');
  assert.equal(labelText(trackLabel('de', multicast[2])), 'Deutsch · Clean audio');
  // arte: HLS reports "mis" itself for the description track
  assert.equal(labelText(trackLabel('mis', { lang: 'mis', purpose: 'description' })), 'MIS · Audio description');
  assert.equal(labelText(trackLabel('mul', { lang: 'mul', purpose: 'clear' })), 'Multilingual · Clean audio');
});
