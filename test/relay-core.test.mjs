import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// The relay runs as a CommonJS webOS service.
const require = createRequire(import.meta.url);
const { payload, parseUdpPath } = require('../src/service/relay-core.js');

test('parseUdpPath accepts /udp/<ipv4>:<port>', () => {
  assert.deepEqual(parseUdpPath('/udp/233.50.230.26:5000'), { group: '233.50.230.26', port: 5000 });
  assert.deepEqual(parseUdpPath('/udp/233.50.230.26:5000?x=1'), { group: '233.50.230.26', port: 5000 });
});

test('parseUdpPath rejects anything else', () => {
  for (const url of [
    '/stats',
    '/udp/233.50.230.26',
    '/udp/host:5000',
    '/udp/233.50.230.26:0',
    '/udp/233.50.230.26:70000',
    '/udp/192.168.1.10:5000', // unicast
    '/udp/127.0.0.1:5000',
    '/udp/255.255.255.255:5000', // broadcast
    '/udp/240.0.0.1:5000',
    '/udp/233.50.999.26:5000',
    '',
  ]) {
    assert.equal(parseUdpPath(url), null, url);
  }
});

test('payload passes raw MPEG-TS through and strips RTP headers', () => {
  const ts = Buffer.from([0x47, 1, 2, 3]);
  assert.equal(payload(ts), ts);
  const rtp = Buffer.concat([Buffer.alloc(12, 0), ts]);
  rtp[0] = 0x80; // RTP v2, no CSRC
  assert.deepEqual(payload(rtp), ts);
  const rtpCsrc = Buffer.concat([Buffer.alloc(16, 0), ts]);
  rtpCsrc[0] = 0x81; // one CSRC entry (+4 bytes)
  assert.deepEqual(payload(rtpCsrc), ts);
});

test('backlog reads the unread bytes of a response', () => {
  const { backlog } = require('../src/service/relay-core.js');
  assert.equal(backlog({ writableLength: 1234 }), 1234);
  assert.equal(backlog({ socket: { bufferSize: 99 } }), 99); // older Node.js without writableLength
  assert.equal(backlog({}), 0);
});

test('createStreamBuffer keeps the last maxMs of the stream', () => {
  const { createStreamBuffer } = require('../src/service/relay-core.js');
  const buf = createStreamBuffer(1000, 1e6);
  assert.deepEqual(buf.chunks(), []);
  assert.equal(buf.ms(), 0);
  for (let t = 0; t <= 3000; t += 100) buf.push(Buffer.from([t / 100]), t);
  // Chunks from 2000 to 3000 ms remain.
  assert.deepEqual(
    buf.chunks().map((c) => c[0]),
    [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
  );
  assert.equal(buf.bytes(), 11);
  assert.equal(buf.ms(), 1000);
});

test('createStreamBuffer never holds more than maxBytes, but always the newest chunk', () => {
  const { createStreamBuffer } = require('../src/service/relay-core.js');
  const buf = createStreamBuffer(60000, 250);
  for (let i = 0; i < 5; i++) buf.push(Buffer.alloc(100, i), i);
  assert.deepEqual(
    buf.chunks().map((c) => c[0]),
    [3, 4],
  );
  assert.equal(buf.bytes(), 200);
  buf.push(Buffer.alloc(400, 9), 10); // larger than maxBytes on its own
  assert.deepEqual(
    buf.chunks().map((c) => c[0]),
    [9],
  );
  assert.equal(buf.bytes(), 400);
});

test('createStreamBuffer stays correct across its internal compaction', () => {
  const { createStreamBuffer } = require('../src/service/relay-core.js');
  const buf = createStreamBuffer(10, 1e9);
  for (let t = 0; t < 5000; t++) buf.push(Buffer.from([t & 0xff]), t);
  assert.equal(buf.chunks().length, 11); // 4989 .. 4999
  assert.equal(buf.chunks()[0][0], 4989 & 0xff);
  assert.equal(buf.bytes(), 11);
});

const { allowedHlsUrl, parseHlsPath, parsePlaylist, newSegments } = require('../src/service/relay-core.js');

test('allowedHlsUrl accepts only https on init7.net hosts', () => {
  assert.equal(allowedHlsUrl('https://api.tv.init7.net/api/live/?channel=abc'), true);
  assert.equal(allowedHlsUrl('https://daserste-de.cache.tv.init7.net/x/1.ts'), true);
  assert.equal(allowedHlsUrl('https://init7.net/files/x.m3u'), true);
  assert.equal(allowedHlsUrl('http://api.tv.init7.net/api/live/'), false);
  assert.equal(allowedHlsUrl('https://evilinit7.net/'), false);
  assert.equal(allowedHlsUrl('https://init7.net.example.com/'), false);
  assert.equal(allowedHlsUrl('https://user@init7.net.example.com/'), false);
  assert.equal(allowedHlsUrl('https://127.0.0.1/'), false);
  assert.equal(allowedHlsUrl(''), false);
});

test('parseHlsPath reads the playlist URL and the track index', () => {
  const url = 'https://api.tv.init7.net/api/live/?channel=17ef&x=1';
  assert.deepEqual(parseHlsPath('/hls?track=2&url=' + encodeURIComponent(url)), { url, track: 2 });
  assert.deepEqual(parseHlsPath('/hls?url=' + encodeURIComponent(url)), { url, track: 0 });
  assert.equal(parseHlsPath('/hls?track=1&url=' + encodeURIComponent('https://example.com/a.m3u8')), null);
  assert.equal(parseHlsPath('/hls?track=x&url=' + encodeURIComponent(url)), null);
  assert.equal(parseHlsPath('/hls?track=1&url=%E0%A4%A'), null);
  assert.equal(parseHlsPath('/udp/233.50.230.26:5000'), null);
});

test('parsePlaylist returns absolute segment URLs on allowed hosts', () => {
  const text = [
    '#EXTM3U',
    '#EXTINF:6.38,',
    'https://daserste-de.cache.tv.init7.net/a/1.ts',
    '#EXTINF:5.34,',
    '2.ts\r',
    'https://example.com/3.ts',
    '',
  ].join('\n');
  assert.deepEqual(parsePlaylist(text, 'https://api.tv.init7.net/api/live/?channel=x'), [
    'https://daserste-de.cache.tv.init7.net/a/1.ts',
    'https://api.tv.init7.net/api/live/2.ts',
  ]);
});

test('newSegments starts with the newest segments, then follows the playlist', () => {
  const seen = new Set();
  assert.deepEqual(newSegments(['a', 'b', 'c', 'd'], seen, 2), ['c', 'd']);
  assert.deepEqual(newSegments(['a', 'b', 'c', 'd'], seen, 2), []);
  assert.deepEqual(newSegments(['c', 'd', 'e', 'f'], seen, 2), ['e', 'f']);
  assert.deepEqual([...seen].sort(), ['c', 'd', 'e', 'f']); // a and b left the playlist
  assert.deepEqual(newSegments(['x'], new Set(), 2), ['x']);
});
