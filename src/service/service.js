// Multicast -> HTTP relay (a tiny udpxy) running on the TV as a webOS JS service.
// The web app cannot open udp:// URLs, so it plays http://127.0.0.1:PORT/udp/<group>:<port> instead.
const Service = require('webos-service');
const dgram = require('dgram');
const http = require('http');
const { backlog, payload, parseUdpPath, parsePmt, createAudioFilter, createStreamBuffer } = require('./relay-core');
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
