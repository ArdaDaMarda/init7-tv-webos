// A/V sync test stream: generates a synthetic MPEG-TS and sends it as multicast on the LAN, so the TV's
// relay can join it like any Init7 channel (http://127.0.0.1:8077/udp/<group>:<port>).
//
// The picture is black with a white flash every 2 s (100 ms; 300 ms on every 10th second). Each audio
// track beeps at the same moments at its own pitch, so a phone video of the TV shows which track plays
// and how far sound and picture are apart. See tools/avsync/README.md.
//
// usage: node tools/avsync/stream.mjs [--iface <PC's LAN IPv4>] [--group 239.255.77.1:5000] [--regenerate] [--generate-only]
// needs ffmpeg on PATH or FFMPEG_DIR.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ffmpeg = process.env.FFMPEG_DIR ? path.join(process.env.FFMPEG_DIR, 'ffmpeg') : 'ffmpeg';
export const OUT = path.join(here, '..', '..', 'dist', 'avsync', 'avsync-test.ts');

// Keep in sync with run.js (PIDs) and analyse.mjs (pitches).
export const PERIOD = 2; // s between flashes
export const FLASH = 0.1; // s
export const LONG_EVERY = 10; // s; that flash and beep last LONG
export const LONG = 0.3; // s
export const VIDEO_PID = 256;
export const TRACKS = [
  { pid: 257, codec: 'mp2', bitrate: '192k', lang: 'deu', freq: 700 },
  { pid: 258, codec: 'mp2', bitrate: '192k', lang: 'fra', freq: 1300 },
  { pid: 259, codec: 'ac3', bitrate: '256k', lang: 'eng', freq: 2300 },
];
const DURATION = 600; // s; streaming loops the file

const gate = `gt(lt(mod(t,${PERIOD}),${FLASH})+lt(mod(t,${LONG_EVERY}),${LONG}),0)`;

function generate() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const font = 'C\\:/Windows/Fonts/arialbd.ttf';
  const text = fs.existsSync('C:/Windows/Fonts/arialbd.ttf')
    ? `,drawtext=fontfile='${font}':text='%{pts\\:hms}':fontsize=64:fontcolor=0x808080:x=(w-tw)/2:y=h-120`
    : '';
  const args = ['-hide_banner', '-y'];
  args.push(
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=1280x720:r=50:d=${DURATION},drawbox=c=white:t=fill:enable='${gate}'${text},format=yuv420p`,
  );
  for (const t of TRACKS) {
    args.push('-f', 'lavfi', '-i', `aevalsrc=exprs='${gate}*0.5*sin(2*PI*${t.freq}*t)':s=48000:c=stereo:d=${DURATION}`);
  }
  args.push('-map', '0:v');
  TRACKS.forEach((t, i) => args.push('-map', `${i + 1}:a`));
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-g', '50', '-keyint_min', '50');
  args.push('-sc_threshold', '0', '-b:v', '2M', '-maxrate', '2500k', '-bufsize', '2M');
  TRACKS.forEach((t, i) => {
    args.push(`-c:a:${i}`, t.codec, `-b:a:${i}`, t.bitrate, `-metadata:s:a:${i}`, `language=${t.lang}`);
  });
  args.push(...streamIds(), '-metadata', 'service_name=AV sync test', '-f', 'mpegts', OUT);
  console.log('Generating ' + OUT + ' ...');
  const r = spawnSync(ffmpeg, args, { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) throw new Error('ffmpeg failed' + (r.error ? ': ' + r.error.message : ''));
}

function streamIds() {
  return ['-streamid', `0:${VIDEO_PID}`, ...TRACKS.flatMap((t, i) => ['-streamid', `${i + 1}:${t.pid}`])];
}

// First private IPv4 address of a physical-looking interface.
function guessIface() {
  const all = Object.entries(os.networkInterfaces()).flatMap(([name, list]) =>
    (list || []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => ({ name, address: a.address })),
  );
  const ok = all.filter(
    (a) =>
      /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address) && !/vEthernet|VirtualBox|VMware|WSL/i.test(a.name),
  );
  return (ok[0] || all[0] || {}).address;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const opt = (name) => {
    const i = process.argv.indexOf('--' + name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  if (process.argv.includes('--regenerate') || !fs.existsSync(OUT)) generate();
  if (process.argv.includes('--generate-only')) process.exit(0);
  const iface = opt('iface') || guessIface();
  const target = opt('group') || '239.255.77.1:5000';
  if (!iface) throw new Error('no LAN interface found, pass --iface <IPv4>');
  const url = `udp://${target}?pkt_size=1316&ttl=4&localaddr=${iface}`;
  console.log(`Sending ${path.basename(OUT)} to ${target} from ${iface} (loops until Ctrl+C).`);
  console.log(`Relay URL on the TV: http://127.0.0.1:8077/udp/${target}`);
  const args = ['-hide_banner', '-loglevel', 'warning', '-re', '-stream_loop', '-1', '-i', OUT];
  args.push('-map', '0', '-c', 'copy', ...streamIds(), '-f', 'mpegts', url);
  const child = spawn(ffmpeg, args, { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill());
}
