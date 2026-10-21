# Contributing

Thanks for helping! Bug reports, compatibility reports for other TVs, and pull requests are all welcome.

## Development setup

Requirements: [Node.js](https://nodejs.org) 20+ (24 LTS recommended, see `.nvmrc`), an LG webOS TV in
Developer Mode (see the [README](README.md#install)), and an Init7 connection for anything that talks to the API.

```sh
npm install          # installs esbuild, ESLint, Prettier and the webOS CLI locally (no global installs)
```

### Register your TV once

```sh
npx ares-setup-device -a tv -i "host=<TV-IP>" -i "port=9922" -i "username=prisoner" -i "default=true"
npx ares-novacom -d tv --getkey      # enter the passphrase from the Developer Mode app
npx ares-device -i -d tv             # should print model, SDK and firmware version
```

If `--getkey` downloads the key (`~/.ssh/tv_webos`) but the connection still fails, set the reference explicitly:

```sh
npx ares-setup-device -m tv -i "privatekey=tv_webos" -i "passphrase=<PASSPHRASE>"
```

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Build with source maps, package and install on the default TV, then launch |
| `npm run dev -- --device tv` | Same for a specific registered device (or set `TV_DEVICE=tv`) |
| `npm run build` | Bundle into `build/` (app + service with generated manifests) |
| `npm run package` | Build and create `dist/<appId>_<version>_all.ipk` |
| `npm run deploy` | Install the existing package on the TV and launch it |
| `npm run inspect` | Open the web inspector for the running app (prints a DevTools URL) |
| `npm test` | Unit tests (Node's built-in test runner, no TV needed) |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run check` | Lint + format check + tests, the same as CI |

The app id and the launcher title live in `package.json` → `webos`. The version is `package.json` → `version`.
The build writes both into `appinfo.json` and the service manifests.

## Project layout

```
src/app/        web UI: plain ES modules, bundled by esbuild into one classic script (build/app/app.js)
  js/main.js    entry point: startup, key routing
  js/*.js       one module per concern (api, channels, epg, player, relay client, UI parts)
src/service/    webOS JS service (CommonJS, runs on the TV's Node.js): multicast -> HTTP relay
assets/         icons
scripts/        build.mjs, deploy.mjs
test/           unit tests (lineup building, EPG store, relay helpers, PMT parsing/audio filter, track labels, utils)
tools/          debugging helpers (see tools/README.md)
docs/           architecture, decisions, API notes, roadmap
```

There is deliberately **no UI framework**. The app is small, and plain DOM keeps it fast on TV hardware.

## Debugging on the TV

```sh
npm run inspect
```

Open the printed `http://localhost:<port>/devtools/...` URL in Chrome, or script it with
`node tools/cdp.mjs <ws-url> key:13 wait:500 shot:list.png "eval:App.player.current().name"`.

The app exposes a debug handle `window.App`: `player` (incl. `audioTracks()`), `channels`, `epg`, `settings`,
`keyLog` (the last 40 key codes, handy for unknown remote buttons) and `tune(channel)`. The relay on the TV can be
queried with `fetch()` from the app's DevTools console:

| Relay URL (on the TV) | Returns |
|---|---|
| `http://127.0.0.1:8077/stats` | Counters: clients, requests, packets, bytes, last error |
| `http://127.0.0.1:8077/info/<group>:<port>` | The channel's audio tracks from the multicast PMT (PID, codec, language, purpose) |
| `http://127.0.0.1:8077/udp/<group>:<port>[?audio=<pid>]` | The stream, optionally with only one audio track |

`<group>:<port>` is the channel id, e.g. `233.50.230.6:5000` for Das Erste.

To check what a channel's audio tracks really contain (e.g. whether "English" is English right now), use
`tools/audio-compare.mjs`; see [tools/README.md](tools/README.md).

DevTools screenshots show the UI only. The video plane appears as a blank area.

## Testing without a TV

`npm run build`, then open `build/app/index.html` in Chrome started with `--disable-web-security` and a separate
`--user-data-dir`. The TV ignores CORS for packaged apps; desktop Chrome needs the flag. From an Init7 connection
the channel list, guide and banner work fully. Video playback and the multicast relay need the TV.

## Dependencies and `npm audit`

The app has **no runtime dependencies**. Everything in `package.json` is a dev tool, and nothing from `node_modules`
ends up in the `.ipk`. `npm audit` currently reports findings that are all transitive dependencies of LG's
`@webos-tools/cli`, which only runs on the developer machine or in CI. `npm audit --omit=dev` is clean.

Install scripts are restricted via `allowScripts` in `package.json`: only esbuild and the webOS CLI may run them.

## Pull requests

- Run `npm run check` before pushing; CI runs the same checks and builds the `.ipk`.
- Keep pure logic in modules without DOM access, so it can be unit-tested (see `test/`).
- Never commit decompiled code from the official Init7 apps, stream captures or screenshots containing broadcast
  content.
- Say which TV, webOS version and remote you tested on.

## Releasing

1. Bump `version` in `package.json` and add an entry to `CHANGELOG.md`.
2. Commit, then tag: `git tag v1.2.3 && git push --tags`.
3. The release workflow builds the `.ipk` and attaches it to a GitHub Release.
