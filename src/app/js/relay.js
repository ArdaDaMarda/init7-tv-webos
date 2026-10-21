// Client for the bundled relay service (src/service), which turns multicast into HTTP on
// 127.0.0.1 - the TV's web engine cannot open udp:// URLs itself.
import { RELAY_SERVICE } from './config.js';

let port = 0;
let bridge = null;
let waiters = [];

function start() {
  if (bridge || !window.PalmServiceBridge) return;
  bridge = new PalmServiceBridge(); // must stay referenced: it holds the keep-alive subscription
  bridge.onservicecallback = (msg) => {
    let r = {};
    try {
      r = JSON.parse(msg);
    } catch (e) {
      // ignore malformed callbacks
    }
    if (r.returnValue && r.port) {
      port = r.port;
      waiters.forEach((w) => w.resolve());
      waiters = [];
    } else {
      console.warn('[init7tv] relay service failed', msg);
      bridge = null; // allow a new attempt
    }
  };
  bridge.call('luna://' + RELAY_SERVICE + '/start', JSON.stringify({ subscribe: true }));
}

function ready() {
  start();
  if (port) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const w = { resolve };
    waiters.push(w);
    setTimeout(() => {
      waiters = waiters.filter((x) => x !== w);
      reject(new Error('relay service not available'));
    }, 8000);
  });
}

export const relay = {
  start,
  ready,
  // With `audioPid`, the relay delivers only that audio track (no track switching in the player).
  url: (group, audioPid) => 'http://127.0.0.1:' + port + '/udp/' + group + (audioPid ? '?audio=' + audioPid : ''),
  infoUrl: (group) => 'http://127.0.0.1:' + port + '/info/' + group,
};
