# CLAUDE.md

Unofficial LG webOS TV app for Init7 TV7. It has two parts:

- a plain-DOM web UI in `src/app`;
- a webOS JS service in `src/service` that relays multicast to HTTP on the TV.

Human-facing docs:

- [CONTRIBUTING.md](CONTRIBUTING.md): setup, commands, debugging
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/DECISIONS.md](docs/DECISIONS.md): why things are the way they are
- [docs/API.md](docs/API.md): Init7 endpoints
- [docs/ROADMAP.md](docs/ROADMAP.md): open ideas and TV tests

Read the relevant one before changing behaviour.

## Commands

```sh
npm run check     # lint + format check + unit tests (same as CI), run before every commit
npm test          # node --test, no TV needed
npm run build     # bundle into build/ (app + service, manifests generated)
npm run package   # build + dist/<appId>_<version>_all.ipk
npm run dev       # dev build, package, install on the default TV and launch (needs a TV in Developer Mode)
npm run inspect   # DevTools tunnel to the running app (takes ~30 s to print the URL)
```

The webOS CLI is a local dev dependency, so call it as `npx ares-*`, never as a global install.

## Layout

- `src/app/js/`: ES modules bundled by esbuild into one IIFE (`build/app/app.js`).
  - `main.js` is the entry point and does key routing.
  - The other modules each cover one concern: `player`, `tracks`, `relay`, `epg`, `chlist`, `guide`, `menu`, and so on.
- `src/service/`: CommonJS on the TV's Node.js.
  - `relay-core.js` holds the pure helpers: PMT parsing, CRC-32, the audio filter.
  - `service.js` holds the HTTP server and the Luna methods.
- `scripts/`: `build.mjs` and `deploy.mjs`.
  - The app id, title and version come from `package.json` (`webos`, `version`).
  - Nothing else hard-codes the app id. At build time it is `__APP_ID__`; in the app it comes from `config.js`.
- `test/`: unit tests for the pure logic. Keep DOM-free logic in testable modules.
- `tools/`: debugging helpers (`cdp.mjs`, `audio-compare.mjs`, …); see `tools/README.md`.
  - `tools/probe/` is a separate throwaway app and is not linted or formatted.

## Hard rules (learned the hard way, see DECISIONS.md)

- **Streams need the native `<video>`.** Streams are DVB passthrough (MPEG-2/H.264 video, MP2/AC-3 audio), which hls.js and MSE can't play.
- **The bundle targets `chrome68`.** It must keep running on older webOS. Don't add runtime dependencies or a UI framework.
- **Multicast-only channels need the relay.** About 140 of the 242 channels can't be played by the web engine (it can't open `udp://`) and go through `http://127.0.0.1:8077/udp/<group>:<port>`.
- **Never switch audio tracks inside the webOS player.** Using `audioTracks[i].enabled` or a live `selectTrack` desyncs or stalls the pipeline. Instead, reload the stream through the relay with `?audio=<pid>`, which filters the other audio PIDs and rewrites the PMT. LG `selectTrack` is only a fallback.
- **Track labels come from the multicast PMT** (`/info/<group>:<port>`). The special language codes (`mis`, `mul`, `und`, `zxx`, `nar`, `qaa`–`qtz`) are wildcards when matching, and are shown as the code rather than guessed.
- **Remote:** the target is the LG AI Magic Remote. The TV grabs GUIDE, ♡ and AI, so don't rely on them. ◀ opens the guide, ▶ the menu, OK the channel list, and hold-OK toggles a favourite.

## Never commit

- Personal setup: TV IPs, Developer Mode passphrases, MAC addresses, e-mail addresses, local paths. Put those in `*.local.md`, which is gitignored.
- Decompiled code from the official Init7 apps, stream captures, or screenshots showing broadcast content. Hide the video before taking README screenshots.

## Releasing

Bump `version` in `package.json`, update `CHANGELOG.md`, commit, then tag `v<version>`. The release workflow checks that the tag matches the version, then builds the `.ipk` and attaches it. Release tags are protected, so a broken release needs a new version rather than a moved tag.

@CLAUDE.local.md
