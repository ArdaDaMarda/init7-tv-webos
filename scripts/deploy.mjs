// Installs the packaged app (dist/) on a TV registered with the webOS CLI and launches it.
// Usage: node scripts/deploy.mjs [--device <name>] [--inspect | --inspect-only]
//   --device        ares device name; default: $TV_DEVICE, else the CLI's default device
//   --inspect       after launching, open the web inspector tunnel (prints a DevTools URL)
//   --inspect-only  only open the inspector for the running app
// If ares-install fails (as it does over the root login of a rooted TV), the package is copied over
// SSH and handed to the TV's installer service instead; see CONTRIBUTING.md → Rooted TVs.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const appId = pkg.webos.appId;
const device = opt('--device') || process.env.TV_DEVICE;
const deviceArgs = device ? ['-d', device] : [];
const INSTALL_TIMEOUT = 120000;

// Use the CLI from node_modules; paths stay relative to the repo so spaces in it don't matter.
const env = { ...process.env, PATH: path.join(root, 'node_modules', '.bin') + path.delimiter + process.env.PATH };
function tryRun(cmd, cmdArgs) {
  const command = [cmd, ...cmdArgs].join(' '); // one string: no arguments here need quoting
  return spawnSync(command, { cwd: root, env, stdio: 'inherit', shell: true }).status === 0;
}
function run(cmd, cmdArgs) {
  if (!tryRun(cmd, cmdArgs)) process.exit(1);
}

// Install path for a rooted TV, using the CLI's own SSH module and the registered device's login.
// Two findings from the test TV (LG G5, webOS 25) shape it:
// - After an SFTP upload, the same SSH session can't start another command ("Unable to exec", which is
//   also how ares-install fails there). So the upload and the installer call use separate sessions.
// - luna-send needs "< /dev/null" over a non-interactive session, or it exits without doing anything.
async function installOverSsh(ipk) {
  const novacom = createRequire(import.meta.url)('@webos-tools/cli/lib/base/novacom.js');
  const open = () =>
    new Promise((resolve, reject) => {
      const session = new novacom.Session({ name: device }, false, (err) => (err ? reject(err) : resolve(session)));
    });
  const remoteDir = '/media/developer/temp';
  const remoteIpk = `${remoteDir}/${path.basename(ipk)}`;

  const upload = await open();
  try {
    await new Promise((resolve, reject) => {
      const done = (err) => (err ? reject(err) : resolve());
      upload.run(`mkdir -p ${remoteDir}`, null, null, process.stderr, (err) => {
        if (err) done(err);
        else upload.put(path.join(root, ipk), remoteIpk, done);
      });
    });
  } finally {
    upload.end();
  }

  // With "subscribe" the call keeps reporting states and never ends by itself, so the session is
  // closed from here once the result is known.
  const params = JSON.stringify({ id: appId, ipkUrl: remoteIpk, subscribe: true });
  const call = `luna-send -i -f luna://com.webos.appInstallService/dev/install '${params}' < /dev/null`;
  const install = await open();
  try {
    await new Promise((resolve, reject) => {
      let out = '';
      let last = '';
      const timer = setTimeout(
        () => reject(new Error('the installer did not report "installed" in time')),
        INSTALL_TIMEOUT,
      );
      const onData = (chunk) => {
        out += chunk;
        for (const m of String(chunk).matchAll(/"state":\s*"([^"]+)"/g)) {
          if (m[1] !== last) console.log('  ' + m[1]);
          last = m[1];
        }
        if (/"state":\s*"[^"]*fail|"returnValue":\s*false/i.test(out)) {
          const reason = /"(?:reason|errorText)":\s*"([^"]+)"/.exec(out);
          clearTimeout(timer);
          reject(new Error('installer: ' + (reason ? reason[1] : 'failed')));
        } else if (/"state":\s*"installed"/.test(out)) {
          clearTimeout(timer);
          resolve();
        }
      };
      install.run(call, null, onData, process.stderr, (err) => {
        clearTimeout(timer);
        reject(err || new Error('the installer call ended early: ' + (out.trim() || 'no output')));
      });
    });
  } finally {
    install.end();
  }
}

if (!args.includes('--inspect-only')) {
  const ipk = `dist/${appId}_${pkg.version}_all.ipk`;
  if (!existsSync(path.join(root, ipk))) {
    console.error(`${ipk} not found - run "npm run package" first.`);
    process.exit(1);
  }
  if (!tryRun('ares-install', [...deviceArgs, ipk])) {
    console.error('\nares-install failed. Trying the installer service over SSH (rooted TV) ...');
    try {
      await installOverSsh(ipk);
    } catch (e) {
      console.error('Install failed: ' + (e.message || e));
      process.exit(1);
    }
    console.log('Installed.');
  }
  run('ares-launch', [...deviceArgs, appId]);
}
if (args.includes('--inspect') || args.includes('--inspect-only')) {
  run('ares-inspect', [...deviceArgs, '-a', appId]);
}
