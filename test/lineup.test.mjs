import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLineup, idFromSrc } from '../src/app/js/channels.js';

const M3U = `#EXTM3U
#EXTINF:0 tvg-logo="https://logos/srf1.png" tvg-name="SRF1.ch" group-title="de", SRF 1
udp://@233.50.230.80:5000
#EXTINF:0 tvg-logo="https://logos/neo.png" tvg-name="ZDFneo" group-title="de", ZDFneo
udp://@233.50.230.26:5000
#EXTINF:0 tvg-logo="" tvg-name="x" group-title="fr", Télé, avec virgule
udp://@233.50.230.108:5000
#EXTINF:0 tvg-logo="" tvg-name="dup" group-title="de", SRF 1 duplicate
udp://@233.50.230.80:5000
`;

const api = (src, extra) => ({
  src,
  name: 'API ' + src,
  logo: 'https://logos/api.png',
  language: 'de',
  hls_src: 'https://api/live/?channel=' + src,
  has_hls: true,
  visible: true,
  langordernum: 1,
  ordernum: 1,
  ...extra,
});

test('idFromSrc strips scheme and @', () => {
  assert.equal(idFromSrc('udp://@233.50.230.80:5000'), '233.50.230.80:5000');
  assert.equal(idFromSrc('rtp://233.50.230.80:5000'), '233.50.230.80:5000');
  assert.equal(idFromSrc(undefined), '');
});

test('M3U order, names, groups and numbering', () => {
  const list = buildLineup(M3U, []);
  assert.deepEqual(
    list.map((c) => [c.num, c.id, c.name, c.group]),
    [
      [1, '233.50.230.80:5000', 'SRF 1', 'de'],
      [2, '233.50.230.26:5000', 'ZDFneo', 'de'],
      [3, '233.50.230.108:5000', 'Télé, avec virgule', 'fr'],
    ],
  );
  assert.equal(list[0].logo, 'https://logos/srf1.png');
});

test('HLS URLs are joined by multicast address; others stay multicast-only', () => {
  const list = buildLineup(M3U, [api('udp://@233.50.230.80:5000')]);
  assert.equal(list[0].hls, 'https://api/live/?channel=udp://@233.50.230.80:5000');
  assert.equal(list[1].hls, null);
});

test('channels without usable HLS are ignored from the API side', () => {
  const list = buildLineup(M3U, [
    api('udp://@233.50.230.26:5000', { has_hls: false }),
    api('udp://@233.50.230.108:5000', { visible: false }),
  ]);
  assert.ok(list.every((c) => c.hls === null));
});

test('API channels missing from the M3U are appended', () => {
  const list = buildLineup(M3U, [api('udp://@233.50.230.99:5000', { name: 'Only API', language: 'it' })]);
  assert.equal(list.length, 4);
  assert.deepEqual([list[3].num, list[3].name, list[3].group], [4, 'Only API', 'it']);
});

test('without an M3U the lineup falls back to the API channels, sorted', () => {
  const list = buildLineup('', [
    api('udp://@1.1.1.2:5000', { name: 'B', langordernum: 2 }),
    api('udp://@1.1.1.1:5000', { name: 'A', langordernum: 1 }),
  ]);
  assert.deepEqual(
    list.map((c) => c.name),
    ['A', 'B'],
  );
});
