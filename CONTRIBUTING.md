# Contributing

Bug reports, compatibility reports for other TVs and pull requests are welcome.

## Setup

Requirements: [Node.js](https://nodejs.org) 20+ (24 LTS, see `.nvmrc`), an LG webOS TV in Developer Mode (see the
[README](README.md#install)), and an Init7 connection for anything that talks to the API.

```sh
npm install                                    # esbuild, ESLint, Prettier and the webOS CLI, all local
npx ares-setup-device -a tv -i "host=<TV-IP>" -i "port=9922" -i "username=prisoner" -i "default=true"
npx ares-novacom -d tv --getkey                # enter the passphrase from the Developer Mode app
npx ares-device -i -d tv                       # should print model and firmware
```

If the key is downloaded but the connection still fails:
`npx ares-setup-device -m tv -i "privatekey=tv_webos" -i "passphrase=<PASSPHRASE>"`.

### Rooted TVs

On a rooted TV (Homebrew Channel) port 9922 may be closed. Register the root SSH login instead:

```sh
npx ares-setup-device -a tvroot -i "host=<TV-IP>" -i "port=22" -i "username=root" -i "password=<ROOT-PASSWORD>"
```

`ares-install` fails over this login ("Unable to exec": after an SFTP upload the same SSH session can't start
another command). `npm run dev` and `npm run deploy` then fall back by themselves to:

1. copy the `.ipk` to `/media/developer/temp/` over SSH;
2. in a second session, run `luna-send -i -f luna://com.webos.appInstallService/dev/install
   '{"id":"<app id>","ipkUrl":"/media/developer/temp/<file>.ipk","subscribe":true}' < /dev/null`. Stop it once it
   reports `installed`; the closing "install has been disconnected" is harmless.

**Give `luna-send` `< /dev/null`** over non-interactive SSH; without it, it exits silently and installs nothing.
Change the root password of a rooted TV, or switch to key-based login.

## Commands

| Command | What it does |
|---|---|
| `npm run dev [-- --device tv]` | Build with source maps, package, install and launch (or set `TV_DEVICE`) |
| `npm run build` / `npm run package` | Bundle into `build/` / create `dist/<appId>_<version>_all.ipk` |
| `npm run deploy` | Install the existing package and launch it |
| `npm run inspect` | Web inspector for the running app (prints a DevTools URL) |
| `npm test` / `npm run check` | Unit tests / lint + format check + tests, same as CI |

App id and title live in `package.json` → `webos`, the version in `version`. There is deliberately **no UI
framework**; the layout is described in [Architecture](docs/ARCHITECTURE.md).

## Debugging on the TV

`npm run inspect`, then open the printed URL in Chrome, or script it:
`node tools/cdp.mjs <ws-url> key:13 wait:500 shot:list.png "eval:App.player.current().name"`.
DevTools screenshots show the UI only; the video plane is blank.

`window.App` exposes `player`, `channels`, `epg`, `settings`, `keyLog` (last 40 key codes) and `tune(channel)`. The
relay can be queried with `fetch()` from the app's console (`<group>:<port>` is the channel id, e.g.
`233.50.230.6:5000` for Das Erste):

| Relay URL (on the TV) | Returns |
|---|---|
| `http://127.0.0.1:8077/stats` | Counters, joined channels, the last 30 requests |
| `http://127.0.0.1:8077/info/<group>:<port>` | The channel's audio tracks from the multicast PMT |
| `http://127.0.0.1:8077/udp/<group>:<port>[?audio=<pid>]` | The stream, optionally with one audio track |
| `http://127.0.0.1:8077/hls?track=<n>&url=<encoded playlist URL>` | An HLS channel with only audio track n |

`tools/audio-compare.mjs` shows what a track really contains (e.g. whether "English" is English right now).

## Testing without a TV

`npm run build`, then open `build/app/index.html` in Chrome started with `--disable-web-security` and a separate
`--user-data-dir` (the TV ignores CORS for packaged apps). On an Init7 connection the channel list, guide and banner
work; video and the relay need the TV. For scripted checks add `--headless=new --remote-debugging-port=9333` and
drive the page from `http://127.0.0.1:9333/json` with `tools/cdp.mjs`.

## Dependencies

The app has **no runtime dependencies**; nothing from `node_modules` ends up in the `.ipk`. `npm audit` findings
all come from LG's `@webos-tools/cli`, which pins its tree with a shrinkwrap, so they can't be fixed here
(`npm audit --omit=dev` is clean). Install scripts are limited to esbuild and the webOS CLI (`allowScripts`).

## Pull requests

- Run `npm run check`; CI runs the same and builds the `.ipk`.
- Keep pure logic out of DOM modules so it can be unit-tested.
- Never commit decompiled code from the official Init7 apps, stream captures or broadcast screenshots.
- Say which TV, webOS version and remote you tested on.

## Releasing

Bump `version` in `package.json`, add a `CHANGELOG.md` entry, commit, then `git tag v1.2.3 && git push --tags`.
The release workflow attaches the `.ipk` to a GitHub Release.
