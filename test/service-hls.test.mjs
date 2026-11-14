// The relay's /hls route, run on the PC: webos-service and the HTTPS requests to Init7 are replaced by stubs.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';

const require = createRequire(import.meta.url);
const Module = require('module');
const https = require('https');
const { parsePmt } = require('../src/service/relay-core.js');

const handlers = {};
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request !== 'webos-service') return realLoad.call(this, request, ...rest);
  return class {
    constructor() {
      this.activityManager = { create: (name, cb) => cb({}), complete() {} };
    }
    register(name, start, cancel) {
      handlers[name] = { start, cancel };
    }
  };
};

// "Init7": URL -> function returning the body; a function that throws makes the request fail.
const remote = new Map();
const requests = [];
https.get = (options, cb) => {
  const url = 'https://' + options.hostname + options.path;
  requests.push(url);
  const req = new EventEmitter();
  req.destroy = (e) => e && req.emit('error', e);
  setImmediate(() => {
    let body;
    try {
      body = remote.get(url)();
    } catch (e) {
      req.emit('error', e);
      return;
    }
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    res.resume = () => {};
    cb(res);
    res.emit('data', Buffer.from(body));
    res.emit('end');
  });
  return req;
};

// --- tiny MPEG-TS builder ------------------------------------------------------------------

const PMT_PID = 0x100;
const VIDEO = 272;
const AUDIO = [273, 274];

function psi(pid, tableId, body) {
  const len = body.length + 4; // + CRC (not checked)
  const p = Buffer.alloc(188, 0xff);
  Buffer.from([0x47, 0x40 | (pid >> 8), pid & 0xff, 0x10, 0, tableId, 0xb0 | (len >> 8), len & 0xff]).copy(p);
  body.copy(p, 8);
  p.fill(0, 8 + body.length, 12 + body.length);
  return p;
}
const es = (type, pid) => Buffer.from([type, 0xe0 | (pid >> 8), pid & 0xff, 0xf0, 0]);
const pat = psi(0, 0x00, Buffer.from([0, 1, 0xc1, 0, 0, 0, 1, 0xe0 | (PMT_PID >> 8), PMT_PID & 0xff]));
const pmt = psi(
  PMT_PID,
  0x02,
  Buffer.concat([
    Buffer.from([0, 1, 0xc1, 0, 0, 0xe1, 0x10, 0xf0, 0]),
    es(0x1b, VIDEO),
    ...AUDIO.map((a) => es(0x03, a)),
  ]),
);
// One data packet; its payload is filled with `tag`, so the output shows which segment it came from.
function data(pid, tag) {
  const p = Buffer.alloc(188, tag);
  Buffer.from([0x47, pid >> 8, pid & 0xff, 0x10]).copy(p);
  return p;
}
const segment = (tag) => Buffer.concat([pat, pmt, data(VIDEO, tag), ...AUDIO.map((a) => data(a, tag))]);
const packets = (ts) => {
  const out = [];
  for (let i = 0; i + 188 <= ts.length; i += 188)
    out.push({ pid: ((ts[i + 1] & 0x1f) << 8) | ts[i + 2], tag: ts[i + 187] });
  return out;
};
const playlist = (names) => '#EXTM3U\n' + names.map((n) => '#EXTINF:6.0,\n' + n + '.ts\n').join('');

// --- client ---------------------------------------------------------------------------------

let port = 0;

function open(path) {
  const client = { status: 0, body: Buffer.alloc(0), ended: false };
  client.req = http.get({ host: '127.0.0.1', port, path }, (res) => {
    client.status = res.statusCode;
    res.on('data', (d) => (client.body = Buffer.concat([client.body, d])));
    res.on('end', () => (client.ended = true));
    res.on('error', () => {});
  });
  client.req.on('error', () => {});
  return client;
}

async function until(cond, what) {
  for (let i = 0; i < 300; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail('timed out waiting for ' + what);
}

const hlsPath = (track, url) => '/hls?track=' + track + '&url=' + encodeURIComponent(url);
const count = (url) => requests.filter((r) => r === url).length;

before(async () => {
  require('../src/service/service.js');
  const answer = await new Promise((respond) => handlers.start.start({ isSubscription: true, respond }));
  assert.equal(answer.returnValue, true, answer.errorText);
  port = answer.port;
});

after(() => handlers.start.cancel());

test('/hls joins the newest two segments with only the chosen track and follows the playlist', async () => {
  const base = 'https://one.init7.net/ch/';
  let names = ['s1', 's2', 's3'];
  remote.set(base + 'index.m3u8', () => playlist(names));
  for (let n = 1; n <= 4; n++) remote.set(base + 's' + n + '.ts', () => segment(n));

  // The player opens every stream twice (the second connection is its probe).
  const a = open(hlsPath(1, base + 'index.m3u8'));
  const b = open(hlsPath(1, base + 'index.m3u8'));
  const perSegment = [0, PMT_PID, VIDEO, AUDIO[1]];
  await until(() => a.body.length >= 8 * 188 && b.body.length >= 8 * 188, 'the first two segments');
  assert.equal(a.status, 200);
  assert.deepEqual(
    packets(a.body).map((p) => p.pid),
    perSegment.concat(perSegment),
  );
  assert.deepEqual(
    packets(a.body)
      .filter((p) => p.pid === VIDEO)
      .map((p) => p.tag),
    [2, 3],
  );
  assert.deepEqual(
    parsePmt(a.body).map((t) => t.pid),
    [AUDIO[1]],
  );
  assert.deepEqual(b.body, a.body);
  assert.equal(count(base + 's1.ts'), 0, 'the oldest segment is not fetched');
  assert.equal(count(base + 's2.ts'), 1, 'both connections share one download');

  names = ['s2', 's3', 's4'];
  await until(() => a.body.length >= 12 * 188, 'the next segment');
  assert.deepEqual(
    packets(a.body)
      .filter((p) => p.pid === VIDEO)
      .map((p) => p.tag),
    [2, 3, 4],
  );
  a.req.destroy();
  b.req.destroy();
});

test('/hls tries a failed segment once more', async () => {
  const base = 'https://two.init7.net/ch/';
  let failures = 1;
  remote.set(base + 'index.m3u8', () => playlist(['s1', 's2']));
  remote.set(base + 's1.ts', () => segment(1));
  remote.set(base + 's2.ts', () => {
    if (failures-- > 0) throw new Error('connection reset');
    return segment(2);
  });
  const c = open(hlsPath(1, base + 'index.m3u8'));
  await until(() => c.body.length >= 8 * 188, 'both segments');
  assert.deepEqual(
    packets(c.body)
      .filter((p) => p.pid === VIDEO)
      .map((p) => p.tag),
    [1, 2],
  );
  assert.equal(count(base + 's2.ts'), 2);
  c.req.destroy();
});

test('/hls answers 502 when the stream has no such audio track', async () => {
  const base = 'https://three.init7.net/ch/';
  remote.set(base + 'index.m3u8', () => playlist(['s1']));
  remote.set(base + 's1.ts', () => segment(1));
  const c = open(hlsPath(5, base + 'index.m3u8'));
  await until(() => c.ended, 'the answer');
  assert.equal(c.status, 502);
});
