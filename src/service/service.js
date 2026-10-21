// Multicast -> HTTP relay (a tiny udpxy) running on the TV as a webOS JS service.
// The web app cannot open udp:// URLs, so it plays http://127.0.0.1:PORT/udp/<group>:<port> instead.
const Service = require('webos-service');
const dgram = require('dgram');
const http = require('http');
const { payload, parseUdpPath, parsePmt, createAudioFilter } = require('./relay-core');
const { name: SERVICE_ID } = require('./package.json'); // written by the build: <app id>.relay

const PORT = 8077;
const service = new Service(SERVICE_ID);
const stats = { started: Date.now(), clients: 0, requests: 0, packets: 0, bytes: 0, lastError: null };
let server = null;
let keepAlive = null;
let subscribers = 0;

function handle(req, res) {
  stats.requests++;
  if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }
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
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    stats.clients--;
    try {
      sock.dropMembership(group);
    } catch (e) {
      // socket may never have joined
    }
    sock.close();
  };

  stats.clients++;
  res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-cache', Connection: 'close' });
  sock.on('message', (buf) => {
    stats.packets++;
    stats.bytes += buf.length;
    const data = filter ? filter(payload(buf)) : payload(buf);
    if (data.length) res.write(data); // live stream: never pause the socket, a slow reader just buffers briefly
  });
  sock.on('error', (e) => {
    stats.lastError = String(e);
    res.end();
    close();
  });
  // Binding to the group address keeps other groups on the same port out of this socket.
  sock.bind({ port, address: group, exclusive: false }, () => {
    try {
      sock.addMembership(group);
    } catch (e) {
      stats.lastError = 'addMembership: ' + e;
      res.end();
      close();
    }
  });
  req.on('close', close);
}

// GET /info/<group>:<port>: joins the group briefly and returns its audio tracks as described in
// the PMT ({ audio: [{ pid, codec, lang, purpose, channels }] }). The multicast streams keep the
// broadcasters' descriptors (audio description, clean audio, ...), which Init7's HLS remux drops.
function describe({ group, port }, res) {
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
    if (server) {
      server.close();
      server = null;
    }
  },
);

service.register('stats', (message) => {
  message.respond(Object.assign({ returnValue: true, listening: !!server }, stats));
});
