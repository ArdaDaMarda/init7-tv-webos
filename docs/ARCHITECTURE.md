# Architecture

```
                    ┌────────────────────────── LG TV (webOS) ──────────────────────────┐
 api.tv.init7.net ──┤ web app (src/app, bundled)                                        │
  channels, EPG,    │   ├─ HLS channel, default audio ─► <video> (native media pipeline)│
  HLS playlists     │   ├─ multicast channel ─► http://127.0.0.1:8077/udp/<group>:<port>│
                    │   ├─ other audio track ─► …/udp/<group>:<port>?audio=<pid>        │
                    │   └─ track labels ──────► …/info/<group>:<port>                   │
                    │                                   │                               │
 api.init7.net ─────┤                     relay service (src/service, Node.js)          │
  tvchannels.m3u    │                joins the multicast group, serves/filters MPEG-TS  │
                    └───────────────────────────────────┬───────────────────────────────┘
                                                        │ IGMP join / UDP multicast
                                                  Init7 multicast 233.50.230.x:5000
```

## Data flow

1. **Startup** (`main.js`): the cached lineup is started immediately with the last channel. In parallel the app checks
   access (`/api/v4/allowed/`) and reloads the lineup.
2. **Lineup** (`channels.js` → `buildLineup`): the Init7 M3U provides all 242 channels in official order with logos and
   language groups. The channel API provides HLS URLs for 102 of them. They are joined by **multicast address**, which
   is also the channel id everywhere in the app (favourites, last channel, EPG).
3. **EPG** (`epg.js`): programmes for *all* channels are loaded in 6-hour blocks (`/api/epg/?stop__gte&start__lte`,
   about 3 pages of 500 entries per block). Blocks load on demand around "now" and wherever the guide scrolls. The EPG
   references channels by their `src` (multicast address), so it maps directly onto the lineup.
4. **Playback** (`player.js`): an HLS channel is given straight to the native `<video>` element. A multicast-only
   channel gets the relay URL (`video/mp2t`). A watchdog reloads the stream if playback time stops advancing, with
   exponential backoff on errors.
5. **Relay** (`relay.js` ↔ `src/service/service.js`): the app opens a Luna subscription to `<appId>.relay/start`,
   which starts the HTTP server and keeps the service alive while the app runs. Each HTTP request joins one multicast
   group and streams its UDP payload (raw MPEG-TS; RTP headers would be stripped) to the player. Closing the request
   leaves the group. Endpoints:
   - `/udp/<group>:<port>`: the stream as is
   - `/udp/<group>:<port>?audio=<pid>`: the stream with **only this audio track**. The PMT is rewritten with a new
     CRC and the other audio PIDs are dropped (`createAudioFilter` in `relay-core.js`).
   - `/info/<group>:<port>`: the audio tracks from the PMT, as JSON (see 6)
   - `/stats`: counters for debugging
6. **Audio track labels** (`tracks.js` ↔ relay `/info/<group>:<port>`): after a channel starts, the relay joins its
   multicast group for a moment and parses the PMT: language, purpose (audio description, clean audio) and codec of
   each audio stream. The labels are used if they line up with the tracks the player reports. HLS is a remux of the
   same stream with relabelled languages, so special codes like `mis`/`qks` are treated as wildcards. Results are cached
   for 30 minutes per channel.
7. **Audio track switching** (`player.js` → `reloadWithTrack`): any track switch inside the webOS pipeline loses A/V
   sync, so a non-default track is never switched to. The channel is reloaded from the relay with `?audio=<pid>`, so
   the player sees a single audio track and plays it as its default. This applies to HLS channels too. Track 1 uses the
   normal path again. LG's `selectTrack` remains only as a fallback when the PIDs are unknown.

## Why the native player

Init7 passes DVB broadcasts through unchanged: **MPEG-2 or H.264 video with MP2 or AC-3 audio**. Browser players
(hls.js/MSE) cannot decode MPEG-2 video or MP2 audio, which is why generic webOS IPTV apps fail on many channels. The
TV's hardware pipeline decodes all of these, so the app never touches the media data itself.

## UI

Plain DOM, no framework. Each overlay (`banner`, `chlist`, `guide`, `menu`) is a module with
`show/hide/visible/onKey`. `main.js` routes keys to whichever overlay is visible, otherwise to live-TV handling.
Overlays that need to tune or show a toast call `actions.tune` / `actions.toast`, which `main.js` fills in, so the
module graph has no cycles.

The guide shows the live picture as picture-in-picture. The `<video>` element is resized via `body.guide-open`, and the
guide backdrop sits *below* the video in z-order while its content sits above.

## Build

`scripts/build.mjs` bundles `src/app/js/main.js` with esbuild into a single IIFE, because webOS loads apps from
`file://`, where ES modules are unreliable. The syntax target is Chrome 68 (webOS 5). The build copies the static
files and writes `appinfo.json` and the service manifests from `package.json` (`webos.appId`, `webos.title`,
`version`). `ares-package` turns `build/app` + `build/service` into the `.ipk`.
