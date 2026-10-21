// Installs the packaged app (dist/) on a TV registered with the webOS CLI and launches it.
// Usage: node scripts/deploy.mjs [--device <name>] [--inspect | --inspect-only]
//   --device        ares device name; default: $TV_DEVICE, else the CLI's default device
//   --inspect       after launching, open the web inspector tunnel (prints a DevTools URL)
//   --inspect-only  only open the inspector for the running app
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

// Use the CLI from node_modules; paths stay relative to the repo so spaces in it don't matter.
const env = { ...process.env, PATH: path.join(root, 'node_modules', '.bin') + path.delimiter + process.env.PATH };
function run(cmd, cmdArgs) {
  const res = spawnSync(cmd, cmdArgs, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

if (!args.includes('--inspect-only')) {
  const ipk = `dist/${appId}_${pkg.version}_all.ipk`;
  if (!existsSync(path.join(root, ipk))) {
    console.error(`${ipk} not found - run "npm run package" first.`);
    process.exit(1);
  }
  run('ares-install', [...deviceArgs, ipk]);
  run('ares-launch', [...deviceArgs, appId]);
}
if (args.includes('--inspect') || args.includes('--inspect-only')) {
  run('ares-inspect', [...deviceArgs, '-a', appId]);
}
