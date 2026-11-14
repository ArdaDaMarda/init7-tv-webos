// Multicast -> HTTP relay (a tiny udpxy) running on the TV as a webOS JS service.
// The web app cannot open udp:// URLs, so it plays http://127.0.0.1:PORT/udp/<group>:<port> instead.
const Service = require('webos-service');
const dgram = require('dgram');
const http = require('http');
const https = require('https');
const { parse: parseUrl, resolve: resolveUrl } = require('url');
const core = require('./relay-core');
const { backlog, payload, parseUdpPath, parsePmt, createAudioFilter, createStreamBuffer } = core;
const { name: SERVICE_ID } = require('./package.json'); // written by the build: <app id>.relay

const PORT = 8077;
// A player that stops reading while keeping the connection open would make the relay buffer the live
// stream without limit. Past this backlog (about 20 s of HD) the client is dropped; the app reconnects.
const MAX_BACKLOG = 32 * 1024 * 1024;
// Each channel's last few seconds, sent to a new connection in one burst: the player starts ~0.5 s after it
// has ~5 s of video (measured on the TV), so a reload or an audio-track switch starts almost at once.
const BUFFER_MS = 6000;
// Holds 6 s even of a Full HD channel (~27 Mbit/s); stays under MAX_BACKLOG.
const BUFFER_BYTES = 24 * 1024 * 1024;
// After its last connection closes, a channel stays joined this long, so a reconnect finds the buffer. Only
// the current channel is kept: an idle channel is left as soon as another one starts.
const IDLE_MS = 10000;
// HLS channels with a single audio track (/hls): the stream starts with the newest two segments (~12 s).
// Init7 publishes segments unevenly, at times 10 s apart, and with one segment the player ran dry (TV test).
const HLS_START_SEGMENTS = 2;
const HLS_POLL_MS = 1000;
const HLS_TIMEOUT_MS = 8000;
const HLS_MAX_FAILURES = 10; // failed requests in a row before the connection is given up
const HLS_RETRY_MS = 300; // a segment that fails is tried once more after this, then skipped
const HLS_MAX_SEGMENT = 48 * 1024 * 1024; // a Full HD segment is ~20 MB
// The first two Full HD segments are ~40 MB, written at once; the player reads them within a moment.
const HLS_MAX_BACKLOG = 64 * 1024 * 1024;
// The player opens each stream a second time as a probe and doesn't start before that is answered (see the
// connection log). Responses are kept this long so the probe gets the same segments without a second download.
const HLS_SEGMENT_TTL = 3000;
const HLS_PLAYLIST_TTL = 500;
const hlsAgent = new https.Agent({ keepAlive: true });
const hlsCache = new Map(); // URL -> { waiters } while loading, then { body, finalUrl } until the TTL ends
const service = new Service(SERVICE_ID);
const stats = { started: Date.now(), clients: 0, requests: 0, packets: 0, bytes: 0, dropped: 0, lastError: null };
const feeds = new Map(); // '<group>:<port>' -> feed, see openFeed
let server = null;
let keepAlive = null;
let subscribers = 0;

// Connection log for diagnosing slow starts: the last LOG_SIZE requests (except /stats), with the player's
// headers, the time to the first byte, the bytes sent after each BYTES_AT mark, and how the connection ended.
// `t0` is the TV's clock, the same one the app sees, so the records line up with the player's events.
const LOG_SIZE = 30;
const BYTES_AT = [500, 1000, 2000, 3000, 5000];
const connections = [];
let nextId = 1;

function logRequest(req) {
  const rec = {
    id: nextId++,
    t0: Date.now(),
    url: req.url,
    headers: req.headers,
    firstByteMs: null,
    bytes: 0,
    bytesAt: [],
    durationMs: null,
    end: null,
  };
  connections.push(rec);
  if (connections.length > LOG_SIZE) connections.shift();
  return rec;
}

function logData(rec, length) {
  const ms = Date.now() - rec.t0;
  if (rec.firstByteMs === null) rec.firstByteMs = ms;
  // Record the total at each mark that has passed, before this chunk is counted.
  while (rec.bytesAt.length < BYTES_AT.length && ms >= BYTES_AT[rec.bytesAt.length]) rec.bytesAt.push(rec.bytes);
  rec.bytes += length;
}

function logEnd(rec, end) {
  if (rec.end) return;
  rec.end = end;
  rec.durationMs = Date.now() - rec.t0;
}

// One multicast membership per channel, shared by all connections to it, with the channel's recent seconds
// in `buffer`. Clients are { send(data), end(reason) }.
function openFeed(group, port) {
  const key = group + ':' + port;
  let feed = feeds.get(key);
  if (feed) {
    clearTimeout(feed.idle);
    feed.idle = null;
    return feed;
  }
  for (const other of feeds.values()) if (!other.clients.size) closeFeed(other);
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  feed = { key, group, sock, buffer: createStreamBuffer(BUFFER_MS, BUFFER_BYTES), clients: new Set(), idle: null };
  feeds.set(key, feed);
  sock.on('message', (buf) => {
    stats.packets++;
    stats.bytes += buf.length;
    const data = payload(buf);
    feed.buffer.push(data, Date.now());
    for (const client of feed.clients) client.send(data);
  });
  sock.on('error', (e) => {
    stats.lastError = String(e);
    closeFeed(feed, 'error');
  });
  // Binding to the group address keeps other groups on the same port out of this socket.
  sock.bind({ port, address: group, exclusive: false }, () => {
    try {
      sock.addMembership(group);
    } catch (e) {
      stats.lastError = 'addMembership: ' + e;
      closeFeed(feed, 'join failed');
    }
  });
  return feed;
}

function closeFeed(feed, reason) {
  if (feeds.get(feed.key) !== feed) return;
  feeds.delete(feed.key);
  clearTimeout(feed.idle);
  try {
    feed.sock.dropMembership(feed.group);
  } catch (e) {
    // socket may never have joined
  }
  feed.sock.close();
  for (const client of feed.clients) client.end(reason);
}

function leaveFeed(feed, client) {
  feed.clients.delete(client);
  if (feed.clients.size || feeds.get(feed.key) !== feed) return;
  // Another channel is already playing (a switch, whose new connection came first): leave this one now.
  const switched = Array.from(feeds.values()).some((f) => f !== feed && f.clients.size);
  if (switched) closeFeed(feed);
  else feed.idle = setTimeout(() => closeFeed(feed), IDLE_MS);
}

function handle(req, res) {
  stats.requests++;
  if (req.url === '/stats') {
    const open = Array.from(feeds.values()).map((f) => ({
      channel: f.key,
      clients: f.clients.size,
      idle: !!f.idle,
      bufferedMs: f.buffer.ms(),
      bufferedBytes: f.buffer.bytes(),
    }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(Object.assign({ now: Date.now(), feeds: open, bytesAtMs: BYTES_AT, connections }, stats)));
    return;
  }
  const rec = logRequest(req);
  res.on('finish', () => logEnd(rec, 'finished'));
  const infoTarget = parseUdpPath(req.url, 'info');
  if (infoTarget) {
    describe(infoTarget, res);
    return;
  }
  const hlsTarget = core.parseHlsPath(req.url);
  if (hlsTarget) {
    serveHls(hlsTarget, req, res, rec);
    return;
  }
  const target = parseUdpPath(req.url);
  if (!target) {
    res.writeHead(404);
    res.end();
    return;
  }
  const { group, port } = target;
  // ?audio=<pid>: deliver the stream with only this audio track (see createAudioFilter).
  const audio = /[?&]audio=(\d{1,4})(?:&|$)/.exec(req.url);
  const filter = audio ? createAudioFilter(Number(audio[1])) : null;
  const feed = openFeed(group, port);
  let closed = false;

  const close = (end) => {
    logEnd(rec, end || 'client closed');
    if (closed) return;
    closed = true;
    stats.clients--;
    leaveFeed(feed, client);
  };
  const client = {
    send(chunk) {
      if (backlog(res) > MAX_BACKLOG) {
        stats.dropped++;
        stats.lastError = 'client too slow, dropped ' + group;
        close('dropped');
        res.destroy();
        return;
      }
      const data = filter ? filter(chunk) : chunk;
      if (!data.length) return;
      logData(rec, data.length);
      res.write(data); // live stream: never pause the socket, a slow reader just buffers briefly
    },
    end(reason) {
      close(reason);
      res.end();
    },
  };

  stats.clients++;
  res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-cache', Connection: 'close' });
  // The buffered seconds first, in one write (filtered chunk by chunk, as the filter expects whole datagrams).
  const recent = feed.buffer.chunks();
  if (recent.length) {
    const burst = Buffer.concat(filter ? recent.map(filter) : recent);
    rec.burstBytes = burst.length;
    rec.burstMs = feed.buffer.ms();
    logData(rec, burst.length);
    res.write(burst);
  }
  feed.clients.add(client);
  req.on('close', () => close());
}

// GET of an Init7 URL into a Buffer: cb(err, body, finalUrl). Follows redirects within Init7's hosts.
function fetchBuffer(url, maxBytes, cb, redirects) {
  let done = false;
  const finish = (err, body) => {
    if (done) return;
    done = true;
    cb(err, body, url);
  };
  if (!core.allowedHlsUrl(url)) return finish(new Error('host not allowed'));
  const req = https.get(Object.assign(parseUrl(url), { agent: hlsAgent, timeout: HLS_TIMEOUT_MS }), (r) => {
    const left = redirects === undefined ? 3 : redirects;
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && left > 0) {
      r.resume();
      done = true;
      fetchBuffer(resolveUrl(url, r.headers.location), maxBytes, cb, left - 1);
      return;
    }
    if (r.statusCode !== 200) {
      r.resume();
      finish(new Error('HTTP ' + r.statusCode));
      return;
    }
    const parts = [];
    let size = 0;
    r.on('data', (d) => {
      size += d.length;
      if (size > maxBytes) req.destroy(new Error('response too large'));
      else parts.push(d);
    });
    r.on('end', () => finish(null, Buffer.concat(parts)));
    r.on('error', finish);
  });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', finish);
}

// fetchBuffer, shared between the connections that ask for the same URL within `ttl` ms.
function fetchShared(url, maxBytes, ttl, cb) {
  let entry = hlsCache.get(url);
  if (entry) {
    if (entry.waiters) entry.waiters.push(cb);
    else cb(null, entry.body, entry.finalUrl);
    return;
  }
  entry = { waiters: [cb] };
  hlsCache.set(url, entry);
  fetchBuffer(url, maxBytes, (err, body, finalUrl) => {
    const waiters = entry.waiters;
    entry.waiters = null;
    entry.body = body;
    entry.finalUrl = finalUrl;
    if (err) hlsCache.delete(url);
    else setTimeout(() => hlsCache.delete(url), ttl);
    waiters.forEach((w) => w(err, body, finalUrl));
  });
}

// GET /hls?track=<n>&url=<playlist>: an HLS channel as one endless MPEG-TS stream with only audio track
// <n>. Init7's HLS segments are plain MPEG-TS that carry all audio tracks, and the player can't switch
// between them (it freezes, see DECISIONS.md). The segments are fetched here, filtered like the multicast
// stream and joined. A segment brings ~6 s at once, so the player starts as fast as with HLS itself and
// no multicast join is needed. Playback runs ~12 - 18 s behind live.
function serveHls(target, req, res, rec) {
  const seen = new Set();
  let open = true;
  let started = false;
  let filter = null;
  let failures = 0;
  let timer = null;
  const stop = (end) => {
    logEnd(rec, end || 'client closed');
    if (!open) return;
    open = false;
    clearTimeout(timer);
    stats.clients--;
  };
  const fail = (text, end) => {
    stats.lastError = 'hls: ' + text;
    if (!started) res.writeHead(502);
    stop(end || 'error');
    res.end();
  };
  const failed = (err) => {
    stats.lastError = 'hls: ' + err.message;
    if (++failures >= HLS_MAX_FAILURES) fail(err.message);
    return open;
  };
  const send = (segment) => {
    if (!started) {
      if (target.track > 0) {
        const audio = parsePmt(segment);
        if (!audio || !audio[target.track]) return fail('audio track ' + target.track + ' not found');
        filter = createAudioFilter(audio[target.track].pid);
      }
      started = true;
      res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-cache', Connection: 'close' });
    }
    if (backlog(res) > HLS_MAX_BACKLOG) {
      stats.dropped++;
      stats.lastError = 'client too slow, dropped hls';
      stop('dropped');
      res.destroy();
      return;
    }
    const data = filter ? filter(segment) : segment;
    logData(rec, data.length);
    res.write(data);
  };
  const next = (todo, retry) => {
    if (!open) return;
    if (!todo.length) {
      timer = setTimeout(poll, HLS_POLL_MS);
      return;
    }
    fetchShared(todo[0], HLS_MAX_SEGMENT, HLS_SEGMENT_TTL, (err, segment) => {
      if (!open) return;
      if (err) {
        if (!failed(err)) return;
        if (!retry) {
          timer = setTimeout(() => next(todo, true), HLS_RETRY_MS);
          return;
        }
      } else {
        failures = 0;
        send(segment);
      }
      next(todo.slice(1));
    });
  };
  const poll = () => {
    fetchShared(target.url, 1024 * 1024, HLS_PLAYLIST_TTL, (err, body, finalUrl) => {
      if (!open) return;
      if (err) {
        if (failed(err)) timer = setTimeout(poll, HLS_POLL_MS);
        return;
      }
      const urls = core.parsePlaylist(body.toString('utf8'), finalUrl);
      if (!urls.length && !failed(new Error('empty playlist'))) return;
      next(core.newSegments(urls, seen, HLS_START_SEGMENTS));
    });
  };
  stats.clients++;
  req.on('close', () => stop());
  poll();
}

// GET /info/<group>:<port>: joins the group briefly and returns its audio tracks as described in
// the PMT ({ audio: [{ pid, codec, lang, purpose, channels }] }). The multicast streams keep the
// broadcasters' descriptors (audio description, clean audio, ...), which Init7's HLS remux drops.
function describe({ group, port }, res) {
  // The running channel's buffer already holds PMTs (they repeat every ~100 ms), so no second join is
  // needed. The first ~1 MB is plenty.
  const feed = feeds.get(group + ':' + port);
  const known = feed && feed.buffer.bytes() ? parsePmt(Buffer.concat(feed.buffer.chunks().slice(0, 800))) : null;
  if (known) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ audio: known }));
    return;
  }
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const chunks = [];
  let size = 0;
  let done = false;
  const finish = (result) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    try {
      sock.dropMembership(group);
    } catch (e) {
      // socket may never have joined
    }
    sock.close();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify(result));
  };
  const timer = setTimeout(() => finish({ audio: null, error: 'timeout' }), 4000);
  sock.on('message', (buf) => {
    chunks.push(payload(buf));
    size += buf.length;
    // PAT/PMT repeat every ~100 ms; check every 20 datagrams, give up after ~4 MB.
    if (chunks.length % 20 !== 0) return;
    const audio = parsePmt(Buffer.concat(chunks));
    if (audio) finish({ audio });
    else if (size > 4e6) finish({ audio: null, error: 'no PMT found' });
  });
  sock.on('error', (e) => finish({ audio: null, error: String(e) }));
  sock.bind({ port, address: group, exclusive: false }, () => {
    try {
      sock.addMembership(group);
    } catch (e) {
      finish({ audio: null, error: 'addMembership: ' + e });
    }
  });
}

function ensureServer(cb) {
  if (server) return cb(null);
  server = http.createServer(handle);
  server.on('error', (e) => {
    stats.lastError = String(e);
    server = null;
    cb(e);
  });
  server.listen(PORT, '127.0.0.1', () => cb(null));
}

// The app subscribes to "start"; the open subscription plus an activity keep the service alive
// while the app runs. When the last subscription goes away, the service is allowed to exit.
service.register(
  'start',
  (message) => {
    ensureServer((err) => {
      if (err) {
        message.respond({ returnValue: false, errorText: String(err) });
        return;
      }
      if (message.isSubscription) subscribers++;
      if (!keepAlive) {
        service.activityManager.create('relay', (activity) => {
          keepAlive = activity;
        });
      }
      message.respond({ returnValue: true, port: PORT, subscribed: !!message.isSubscription });
    });
  },
  () => {
    subscribers = Math.max(0, subscribers - 1);
    if (subscribers > 0) return;
    if (keepAlive) {
      service.activityManager.complete(keepAlive);
      keepAlive = null;
    }
    for (const feed of feeds.values()) closeFeed(feed, 'relay stopped');
    if (server) {
      server.close();
      server = null;
    }
  },
);

service.register('stats', (message) => {
  message.respond(Object.assign({ returnValue: true, listening: !!server }, stats));
});
