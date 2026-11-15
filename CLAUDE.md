# CLAUDE.md

Unofficial LG webOS TV app for Init7 TV7: a plain-DOM web UI in `src/app` and a webOS JS service in `src/service`
that relays multicast to HTTP on the TV. Read [docs/DECISIONS.md](docs/DECISIONS.md) before changing behaviour;
[ARCHITECTURE](docs/ARCHITECTURE.md), [API](docs/API.md), [ROADMAP](docs/ROADMAP.md) and
[CONTRIBUTING](CONTRIBUTING.md) cover the rest.

## Commands

```sh
npm run check     # lint + format check + unit tests (same as CI), run before every commit
npm test          # node --test, no TV needed
npm run build     # bundle into build/
npm run package   # build + dist/<appId>_<version>_all.ipk
npm run dev       # dev build, install on the default TV and launch (falls back to SSH on a rooted TV)
npm run inspect   # DevTools tunnel to the running app (~30 s until it prints the URL)
```

Call the webOS CLI as `npx ares-*` (local dev dependency), never globally.

## Layout

- `src/app/js/`: ES modules bundled into one IIFE. `main.js` is the entry and key router; one module per concern.
- `src/service/`: CommonJS. `relay-core.js` = pure helpers (PMT, CRC-32, audio filter, buffer); `service.js` = HTTP
  server and Luna methods.
- `scripts/`: `build.mjs`, `deploy.mjs`. App id, title and version come only from `package.json`; never hard-code
  the app id (`__APP_ID__` at build time, `config.js` in the app).
- `test/`: unit tests. `service-hls.test.mjs` runs the real relay with stubs (port 8077); `player.test.mjs` runs
  `player.js` against a fake `<video>`.
- `tools/`: debugging helpers, see `tools/README.md`. `tools/probe/` is not linted.

## Hard rules

- **Native `<video>` only.** DVB codecs (MPEG-2, MP2) don't play in hls.js/MSE.
- **Target `chrome68`.** No runtime dependencies, no UI framework.
- **Multicast goes through the relay** (`/udp/<group>:<port>`); the web engine can't open `udp://`.
- **Never switch audio tracks inside the webOS player.** It desyncs, and on HLS `selectTrack` froze the picture for
  8 – 12 s. Reload through the relay with only the chosen track: `/hls?track=<n>` (HLS) or `?audio=<pid>`
  (multicast). LG `selectTrack` is only a fallback. See DECISIONS → [audio switching](docs/DECISIONS.md#audio-switching).
- **`/hls` starts with the two newest segments** (Init7 publishes unevenly; one segment froze the player) and fetches
  only from `*.init7.net`. Parallel download was measured slower. See [hls-relay](docs/DECISIONS.md#hls-relay).
- **A single-track stream that fails twice falls back to the default track** (`filterGaveUp` in `player.js`). Keep
  that path, or a missing track retries for good.
- **The player waits for ~5 s of video.** The relay keeps the current channel's last 6 s and bursts them to each new
  connection. Only the current channel: more joins cost bitrate the whole time.
- **The relay never buffers without limit:** a client is dropped at a 32 MB backlog (64 MB for `/hls`).
- **Track labels come from the multicast PMT** (`/info`). Special codes (`mis`, `mul`, `und`, `zxx`, `nar`,
  `qaa`–`qtz`) are wildcards when matching and shown as the code, never guessed.
- **The app stays open for days.** Cached data must expire (guide 3 h, lineup 6 h).
- **EPG optional fields are often empty;** show a detail only when it exists.
- **UI changes:** check in desktop Chrome with `tools/cdp.mjs`, then once on the TV. Playback, audio and relay
  changes always need the TV.
- **Remote:** LG AI Magic Remote. The TV grabs GUIDE, ♡ and AI. ◀ = guide, ▶ = menu, OK = channel list, hold OK =
  favourite.

## Never commit

- Personal setup: TV IPs, Developer Mode passphrases, MAC addresses, e-mail addresses, local paths. Those go in
  `*.local.md` (gitignored).
- Decompiled code from the official Init7 apps, stream captures, or screenshots showing broadcast content. Hide the
  video before taking README screenshots.

## Releasing

Bump `version` in `package.json`, update `CHANGELOG.md`, commit, tag `v<version>`. The release workflow checks the
tag against the version and attaches the `.ipk`. Tags are protected: a broken release needs a new version.

@CLAUDE.local.md
