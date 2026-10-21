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
    '/udp/1.2.3.4:70000',
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
