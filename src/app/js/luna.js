// Minimal one-shot Luna bus call for webOS web apps, resolving with the parsed response.
const inFlight = new Set(); // keeps bridges referenced until their callback arrives

export function lunaCall(uri, params, timeout = 3000) {
  return new Promise((resolve, reject) => {
    if (!window.PalmServiceBridge) {
      reject(new Error('PalmServiceBridge not available'));
      return;
    }
    const bridge = new PalmServiceBridge();
    inFlight.add(bridge);
    const done = () => {
      clearTimeout(timer);
      inFlight.delete(bridge);
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error('timeout: ' + uri));
    }, timeout);
    bridge.onservicecallback = (msg) => {
      done();
      let r;
      try {
        r = JSON.parse(msg);
      } catch (e) {
        r = { returnValue: false, errorText: String(msg) };
      }
      if (r.returnValue) resolve(r);
      else reject(new Error(r.errorText || String(msg)));
    };
    bridge.call(uri, JSON.stringify(params));
  });
}
