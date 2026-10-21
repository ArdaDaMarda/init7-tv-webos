// Tiny CDP driver for a webOS app via ares-inspect tunnel.
// usage: node cdp.mjs <ws-url> step...
// steps: key:<keyCode> (press+release) | down:<keyCode> | up:<keyCode> | wait:<ms> | eval:<js>
//        | shot:<file.png> | viewport:<w>x<h> | log
const [, , wsUrl, ...steps] = process.argv;
const ws = new WebSocket(wsUrl.startsWith('ws') ? wsUrl : 'ws://' + wsUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    console.log('[console]', msg.params.args.map((a) => a.value ?? a.description).join(' '));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    console.log('[exception]', JSON.stringify(msg.params.exceptionDetails).slice(0, 400));
  }
};
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value ?? JSON.stringify(r.result ?? r.error);
};
ws.onopen = async () => {
  await send('Runtime.enable');
  for (const s of steps) {
    const [cmd, ...rest] = s.split(':');
    const arg = rest.join(':');
    if (cmd === 'key') {
      const code = Number(arg);
      for (const type of ['rawKeyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
      }
      console.log(`>> key ${code}`);
    } else if (cmd === 'down' || cmd === 'up') {
      const code = Number(arg);
      await send('Input.dispatchKeyEvent', {
        type: cmd === 'down' ? 'rawKeyDown' : 'keyUp',
        windowsVirtualKeyCode: code,
        nativeVirtualKeyCode: code,
      });
      console.log(`>> ${cmd} ${code}`);
    } else if (cmd === 'wait') {
      await new Promise((r) => setTimeout(r, Number(arg)));
    } else if (cmd === 'eval') {
      console.log('>> eval', arg, '\n', await evaluate(arg));
    } else if (cmd === 'viewport') {
      const [width, height] = arg.split('x').map(Number);
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      console.log(`>> viewport ${width}x${height}`);
    } else if (cmd === 'shot') {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      (await import('node:fs')).writeFileSync(arg, Buffer.from(r.result.data, 'base64'));
      console.log('>> screenshot', arg);
    } else if (cmd === 'log') {
      console.log(
        '---- on-screen log (newest first) ----\n' + (await evaluate("document.getElementById('log').innerText")),
      );
    }
  }
  ws.close();
  process.exit(0);
};
ws.onerror = (e) => {
  console.error('ws error', e.message ?? e);
  process.exit(1);
};
