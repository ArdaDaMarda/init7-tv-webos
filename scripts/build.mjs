// Builds the installable app into build/: bundles src/app/js with esbuild, copies the static
// files and writes the webOS manifests with the id, version and title from package.json.
// Usage: node scripts/build.mjs [--dev]     --dev adds inline source maps for the TV's DevTools
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => path.join(root, ...p);
const dev = process.argv.includes('--dev');
const writeJson = (file, data) => writeFile(r(file), JSON.stringify(data, null, 2) + '\n');

const pkg = JSON.parse(await readFile(r('package.json'), 'utf8'));
const { appId, title } = pkg.webos;
const serviceId = `${appId}.relay`;

await rm(r('build'), { recursive: true, force: true });
await mkdir(r('build/app'), { recursive: true });
await mkdir(r('build/service'), { recursive: true });

// App: a single classic script - webOS loads apps from file://, where ES modules are unreliable.
await esbuild.build({
  entryPoints: [r('src/app/js/main.js')],
  bundle: true,
  format: 'iife',
  target: ['chrome68'], // syntax level of webOS 5 (2020); newer TVs run it unchanged
  outfile: r('build/app/app.js'),
  sourcemap: dev ? 'inline' : false,
  define: { __APP_ID__: JSON.stringify(appId), __APP_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'warning',
});
await cp(r('src/app/index.html'), r('build/app/index.html'));
await cp(r('src/app/css'), r('build/app/css'), { recursive: true });
await cp(r('assets/icon.png'), r('build/app/icon.png'));
await cp(r('assets/largeIcon.png'), r('build/app/largeIcon.png'));
const appinfo = JSON.parse(await readFile(r('src/app/appinfo.json'), 'utf8'));
await writeJson('build/app/appinfo.json', { ...appinfo, id: appId, version: pkg.version, title });

// Relay service: its id must start with the app id, so the manifests are generated here.
for (const f of ['service.js', 'relay-core.js']) await cp(r('src/service', f), r('build/service', f));
await writeJson('build/service/package.json', { name: serviceId, version: pkg.version, main: 'service.js' });
await writeJson('build/service/services.json', {
  id: serviceId,
  description: 'Multicast to HTTP relay',
  services: [{ name: serviceId, description: 'Serves Init7 multicast groups as MPEG-TS over HTTP on localhost' }],
});

console.log(`Built ${appId} ${pkg.version}${dev ? ' (dev)' : ''} -> build/`);
