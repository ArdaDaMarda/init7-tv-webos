# Decisions & findings

Why the app is built the way it is. Everything here was measured on an LG G5 (webOS 25) unless noted.

## The Init7 service

- **Public API, no DRM.** The official Android TV app was inspected only to find its endpoints: a REST API at
  `api.tv.init7.net/api/`, access by IP address, no login. No code from it is used. It is a plain ExoPlayer app with
  no playback tricks worth copying.
- <a name="codecs"></a>**DVB pass-through codecs.** Streams carry the broadcast originals: MPEG-2 or H.264 video with
  MP2 or AC-3 audio. Browser players (hls.js/MSE) can't decode MPEG-2 or MP2, which is why generic webOS IPTV apps
  fail. The TV's native pipeline can, so the app hands every URL straight to `<video>`.
- **Lineup from the M3U.** The multicast address is the only key shared by the M3U, the channel API and the EPG, so
  it is the channel id everywhere. Init7's Full HD lists replace the stream of 7 SRG channels.
- **Replay is not built.** It is a paid add-on and the test account has no entitlement; see [API notes](API.md#replay).

## <a name="audio-switching"></a>The LG player can't switch audio tracks

Any track switch inside the webOS pipeline, via `video.audioTracks` or LG's `luna://com.webos.media/selectTrack`,
caused silence and lost A/V sync. A re-test with the precautions other webOS players use (valid `mediaId`, ≥ 3 s of
playback, one call at a time, `tools/avsync/`) showed:

- on a relay stream `selectTrack` stays in sync (MP2 → MP2 seamless, MP2 ↔ AC-3 with < 2 s of silence);
- on Init7's **HLS** every switch froze the picture for 8 – 12 s, on both HLS servers, even with the same codec.

So the app never switches tracks in the player. It reloads the stream through the relay with **only the chosen
track** in it, and the player plays that as its default. LG's `selectTrack` is kept only as a fallback when a
multicast channel's PIDs are unknown.

Track labels show only what the broadcaster sends: SRF's `eng` track repeats the German sound outside foreign
productions, and a track without a real language code is shown as its code (e.g. "MIS"), never guessed. Init7's
HLS strips the purpose descriptors (audio description, clean audio), so labels are read from the multicast PMT.

## <a name="relay"></a>Why a relay, and why on the TV

- **140 of the 242 channels are multicast-only** (their HLS URL returns 410), and the TV's web engine can't open
  `udp://` or `rtp://`; eight variants were tried. A small webOS JS service on the TV joins the multicast group and
  serves MPEG-TS on `127.0.0.1:8077`. No extra device or router change is needed, and a relay on the router would not
  be faster.
- **The relay is also the audio switch** (see above): it filters out the other audio PIDs and rewrites the PMT with
  a new CRC.

## Relay tricks

- <a name="stream-buffer"></a>**Burst of the last 6 s.** The TV's player starts only once it has ~5 s of video,
  whatever the bitrate, so a live multicast stream takes ~5 s to start, while HLS (a segment brings several seconds
  at once) takes ~0.6 s. A burst test proved it: after 5 s of data in one burst the player started 0.3 – 0.5 s later.
  The relay therefore keeps the last 6 s of the current channel (≤ 24 MB) and sends them to every new connection
  at once: a reload or audio switch on a multicast channel takes ~0.5 s. A fresh channel start still takes ~5 s.
- **One join per channel, only the current one.** All connections share a channel's join; it stays joined 10 s
  after the last connection unless another channel plays. Joining neighbours in advance would make zapping fast but
  costs each channel's bitrate (~11 Mbit/s in HD) the whole time, so it was left out.
- **Answer the probe at once.** The player opens every stream a second time as a short probe and doesn't start
  until it is answered.
- **Never buffer without limit.** The relay writes without pausing the socket and drops a client once 32 MB are
  unread (64 MB for `/hls`); the app's retry reconnects. Only multicast group addresses are accepted.

### <a name="hls-relay"></a>Audio switch on HLS channels: `/hls`

Joining an HLS channel's multicast stream for another track took ~5 s on the first switch. Instead, the relay now
fetches Init7's HLS segments (plain, unencrypted MPEG-TS that carry all tracks), filters them with the same audio
filter and writes them as one endless stream (`/hls?track=<n>&url=<playlist>`).

- **Starts with the two newest segments.** Init7 publishes segments unevenly (sometimes 10 s apart); with one
  segment the player froze for 6 s. Cost: ~12 – 18 s behind live after a switch.
- **Fetched data is shared for 3 s,** so the player's probe doesn't download the segments again (that took 2.2 – 4 s).
- **Track by PMT index, not PID:** HLS is a remux with its own PIDs, and the index matches the player's order.
- A failed segment is tried once more after 0.3 s, then skipped. If the stream fails to start twice, the app falls
  back to the default track. The relay fetches only from `https://*.init7.net`.
- Result: 1.3 – 1.8 s per switch (Full HD SRF 2 – 3 s), every time, in sync.
- **Tried and dropped:** downloading the two start segments side by side (slower: 1.7 vs 1.4 s, Full HD 3.1 vs
  2.1 s), fetching the next segment only after the player took the previous one (no gain), and keeping the multicast
  join on all the time (as fast, but costs the bitrate for as long as HLS is watched).

## App

- **Plain DOM, no framework,** bundled by esbuild for Chrome 68 (webOS 5). Packaged apps may call the API without CORS.
- **AI Magic Remote first.** The 2025 remote has no colour or INFO keys, and the TV keeps GUIDE and AI. So ▶ opens
  the options menu, ◀ the guide, holding OK toggles a favourite.
- **Fast zapping:** while presses come within 400 ms only the banner follows; the stream starts 250 ms after the last.
- **The app stays open for days** (TVs suspend apps). Guide blocks are reloaded after 3 h, the lineup every 6 h, and
  every API request gives up after 15 s.
- **EPG fields are often empty** (credits 19%, age rating 26%; year and pictures never), so details show only what
  exists.

## Project

- **Distribution:** sideloading in Developer Mode is the documented way; the app also runs on rooted TVs. The LG
  Content Store is not an option for an unofficial client.
- **Neutral name and id,** no Init7 branding, streams or broadcast screenshots, no telemetry.
- **Desktop Chrome instead of LG's simulator** for UI work; the simulator has no TV media pipeline either, so
  playback always needs the real TV.
- **Dependabot alerts from LG's `@webos-tools/cli` are dismissed:** it pins its tree with a shrinkwrap, and nothing
  from `node_modules` ships in the `.ipk`.
