# Architecture

```
                    ┌────────────────────────── LG TV (webOS) ──────────────────────────┐
 api.tv.init7.net ──┤ web app (src/app, bundled)                                        │
  channels, EPG,    │   ├─ HLS channel, default audio ─► <video> (native media pipeline)│
  HLS playlists     │   ├─ multicast channel ─► http://127.0.0.1:8077/udp/<group>:<port>│
                    │   ├─ other audio track ─► …/hls?track=<n>&url=<playlist>  (HLS)   │
                    │   │                        …/udp/<group>:<port>?audio=<pid>       │
                    │   └─ track labels ──────► …/info/<group>:<port>                   │
                    │                                   │                               │
 api.init7.net ─────┤                     relay service (src/service, Node.js)          │
  tvchannels.m3u    │                joins the multicast group, serves/filters MPEG-TS; │
                    │                fetches HLS segments for a single audio track      │
                    └───────────────────────────────────┬───────────────────────────────┘
                                                        │ IGMP join / UDP multicast
                                                  Init7 multicast 233.50.230.x:5000
```

The reasons behind each part are in [Decisions & findings](DECISIONS.md).

## App (`src/app/js`)

- **Startup** (`main.js`): plays the cached lineup's last channel at once; the access check, lineup reload and
  guide load run side by side.
- **Lineup** (`channels.js`): the M3U gives all 242 channels in order; the channel API adds HLS URLs for 102. They
  are joined by multicast address, which is the channel id everywhere.
- **EPG** (`epg.js`): all channels in 6-hour blocks, loaded around "now" and wherever the guide scrolls, reloaded
  after 3 h.
- **Playback** (`player.js`): HLS goes straight to `<video>`, multicast through the relay. A watchdog reloads a
  stalled stream with backoff.
- **Audio** (`player.js`, `tracks.js`): another track means a reload through the relay with only that track
  (`/hls?track=<n>` or `?audio=<pid>`). After two failed starts the player falls back to the default track. Labels
  come from the relay's `/info`, matched to the player's tracks and cached for 30 min.
- **UI:** each overlay (`banner`, `chlist`, `guide`, `menu`) has `show/hide/visible/onKey`; `main.js` routes keys.
  Overlays call `actions.tune` / `actions.toast`, so modules have no cycles. The guide shows the video as
  picture-in-picture by resizing `<video>` (`body.guide-open`).

## Relay (`src/service`)

The app keeps a Luna subscription to `<appId>.relay/start` open, which starts the HTTP server and keeps the service
alive. Pure helpers (PMT parsing, CRC-32, audio filter, stream buffer) are in `relay-core.js`.

| Endpoint | Returns |
|---|---|
| `/udp/<group>:<port>` | The multicast stream, starting with a burst of the last 6 s |
| `/udp/<group>:<port>?audio=<pid>` | The same with only this audio track (PMT rewritten) |
| `/hls?track=<n>&url=<playlist>` | An HLS channel as one endless MPEG-TS stream with only track n |
| `/info/<group>:<port>` | The audio tracks from the multicast PMT, as JSON |
| `/stats` | Counters, joined channels and the last 30 requests |

## Build

`scripts/build.mjs` bundles `main.js` with esbuild into one IIFE (webOS loads apps from `file://`, where ES modules
are unreliable), copies the static files and writes `appinfo.json` and the service manifests from `package.json`.
`ares-package` turns `build/` into the `.ipk`.
