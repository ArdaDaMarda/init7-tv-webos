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

## Data flow

1. **Startup** (`main.js`): the cached lineup is started immediately with the last channel. Side by side the app
   checks access (`/api/v4/allowed/`), reloads the lineup and loads the guide data around "now"; none of the three
   waits for another. Every request to Init7's API is given up after 15 s (`api.js`).
2. **Lineup** (`channels.js` → `buildLineup`): the Init7 M3U provides all 242 channels in official order with logos and
   language groups. The channel API provides HLS URLs for 102 of them. They are joined by **multicast address**, which
   is also the channel id everywhere in the app (favourites, last channel, EPG). Init7's two Full HD lists replace
   the HLS URL and the multicast stream (`stream`, see `streamId`) of 7 SRG channels; their id stays the regular
   channel's, so the guide and favourites are unchanged.
3. **EPG** (`epg.js`): programmes for *all* channels are loaded in 6-hour blocks (`/api/epg/?stop__gte&start__lte`,
   about 6 pages of 500 entries per block). Blocks load on demand around "now" and wherever the guide scrolls, and a
   block that is not yet in the past is reloaded after 3 hours, so schedule changes arrive while the app stays open.
   The EPG references channels by their `src` (multicast address), so it maps directly onto the lineup.
4. **Playback** (`player.js`): an HLS channel is given straight to the native `<video>` element. A multicast-only
   channel gets the relay URL (`video/mp2t`). A watchdog reloads the stream if playback time stops advancing, with
   exponential backoff on errors. When channel-switch presses follow each other within 400 ms (`zap` in `main.js`),
   only the banner follows and the stream starts 250 ms after the last press.
5. **Relay** (`relay.js` ↔ `src/service/service.js`): the app opens a Luna subscription to `<appId>.relay/start`,
   which starts the HTTP server and keeps the service alive while the app runs. The relay joins a channel's
   multicast group once and streams its UDP payload (raw MPEG-TS; RTP headers would be stripped) to every request
   for it. It keeps the last 6 s (at most 24 MB, enough for a Full HD channel, `createStreamBuffer` in `relay-core.js`) and sends them to a new
   request in one burst: the player starts ~0.5 s after it has ~5 s of video, so a reload or an audio switch is
   fast. After the last request closes, the channel stays joined for 10 s, unless another channel is already
   playing. A client that stops reading is dropped once 32 MB are unread, so the relay cannot fill the TV's memory.
   Endpoints:
   - `/udp/<group>:<port>`: the stream as is
   - `/udp/<group>:<port>?audio=<pid>`: the stream with **only this audio track**. The PMT is rewritten with a new
     CRC and the other audio PIDs are dropped (`createAudioFilter` in `relay-core.js`).
   - `/hls?track=<n>&url=<playlist>`: an HLS channel as one endless MPEG-TS stream with **only audio track n**
     (index in the PMT). The relay polls Init7's playlist, fetches each new segment over HTTPS (only from
     `*.init7.net`), filters it with the same `createAudioFilter` and writes it out. It starts with the newest two
     segments (~12 s): Init7 publishes segments unevenly, sometimes 10 s apart, and with one segment the player ran
     dry. Responses are shared for 3 s, so the player's second "probe" request for the same stream needs no second
     download. No multicast join is involved. A client is dropped once 64 MB are unread. A segment
     that fails to download is tried once more, then skipped; after ten failed requests in a row the connection
     is closed.
   - `/info/<group>:<port>`: the audio tracks from the PMT, as JSON (see 6)
   - `/stats`: counters, the joined channels and a log of the last 30 requests, for debugging
6. **Audio track labels** (`tracks.js` ↔ relay `/info/<group>:<port>`): after a channel starts, the relay parses
   the PMT from its buffer (or, for an HLS channel, joins the multicast group for a moment): language, purpose (audio description, clean audio) and codec of
   each audio stream. The labels are used if they line up with the tracks the player reports. HLS is a remux of the
   same stream with relabelled languages, so special codes like `mis`/`qks` are treated as wildcards. Results are cached
   for 30 minutes per channel.
7. **Audio track switching** (`player.js` → `reloadWithTrack`): any track switch inside the webOS pipeline loses A/V
   sync or freezes the picture, so a non-default track is never switched to. The channel is reloaded from the relay
   with only that track, so the player sees a single audio track and plays it as its default: an HLS channel through
   `/hls?track=<n>` (starts in ~1.5 – 2 s, no multicast needed), a multicast-only channel through `?audio=<pid>`. Track 1
   uses the normal path again. If the single-track stream fails to start twice in a row, the player falls back to
   the default track and says so. LG's `selectTrack` remains only as a fallback when a multicast-only channel's PIDs are
   unknown.

## Why the native player

Init7 passes DVB broadcasts through unchanged: **MPEG-2 or H.264 video with MP2 or AC-3 audio**. Browser players
(hls.js/MSE) cannot decode MPEG-2 video or MP2 audio, which is why generic webOS IPTV apps fail on many channels. The
TV's hardware pipeline decodes all of these, so the app never touches the media data itself.

## UI

Plain DOM, no framework. Each overlay (`banner`, `chlist`, `guide`, `menu`) is a module with
`show/hide/visible/onKey`. `main.js` routes keys to whichever overlay is visible, otherwise to live-TV handling.
Overlays that need to tune or show a toast call `actions.tune` / `actions.toast`, which `main.js` fills in, so the
module graph has no cycles.

Programme details (`details.js`) are pure functions that turn the EPG's optional fields into the meta line
(duration, genre, season/episode, country, age rating, subtitles) and the credits line shown in the guide and the
expanded banner. Each part appears only when the EPG provides it.

The guide shows the live picture as picture-in-picture. The `<video>` element is resized via `body.guide-open`, and the
guide backdrop sits *below* the video in z-order while its content sits above.

## Build

`scripts/build.mjs` bundles `src/app/js/main.js` with esbuild into a single IIFE, because webOS loads apps from
`file://`, where ES modules are unreliable. The syntax target is Chrome 68 (webOS 5). The build copies the static
files and writes `appinfo.json` and the service manifests from `package.json` (`webos.appId`, `webos.title`,
`version`). `ares-package` turns `build/app` + `build/service` into the `.ipk`.
