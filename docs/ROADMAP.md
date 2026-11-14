# Roadmap

Status of the project and open items.

## Status (v1.1.0)

| Area | State |
|---|---|
| HLS channels (102), native playback of all codec mixes | ✅ Verified on the TV (LG G5, webOS 25) |
| Multicast channels (140) via the on-TV relay | ✅ Verified on the TV (short tests: ZDFneo, Phoenix, DMAX, Servus TV, France 5) |
| EPG, banner, channel list, guide, options menu, hold-OK favourites | ✅ Verified on the TV with simulated key presses |
| Restructured code (ES modules + esbuild), app id `io.github.ardadamarda.init7tv` | ✅ The v1.0.0 release `.ipk` from GitHub is installed on the TV; lineup, EPG, HLS and multicast via the relay verified |
| Audio track list with broadcaster labels (relay `/info`) | ✅ Verified on the TV: Das Erste, arte D, SRF 1, ZDFneo |
| Audio switching via the relay filter (`?audio=<pid>`) | ✅ In sync, verified by ear on Das Erste. Since the stream buffer: ~0.5 s on multicast channels. HLS channels go through the relay's `/hls` route since 2026-11-14: ~1.5 – 2 s (Full HD 2 – 3 s), measured on the TV |
| CI / release workflows | ✅ Running on GitHub; v1.0.0 and v1.1.0 released with the `.ipk` built by the release workflow |
| v1.1.0: richer programme details in the guide and banner | ✅ Verified on the TV (2026-11-13) |
| v1.1.0: fast zapping (only the channel you stop on is loaded) | ✅ Verified on the TV by hand (2026-11-13) |
| v1.1.0: relay drops a client that stops reading (32 MB backlog) | ✅ Verified on the TV with a deliberately slow client: `/stats` → `dropped: 1` |
| v1.1.0: guide data reloaded every 3 h; parallel start | ✅ Unit tests and desktop Chrome; not observed over days on the TV yet |
| Rooted TV (Homebrew Channel) | ✅ The app runs on the rooted test TV; v1.1.0 installed through the TV's installer service over SSH, see [Contributing](../CONTRIBUTING.md#rooted-tvs) |

## Verification on a real TV

- [x] **Remote buttons** (AI Magic Remote, webOS 25, tested 2026-10-20):
      **GUIDE** never reaches the app; the TV opens its own guide → the app's guide moved to ◀.
      **123** opens a system keypad whose digits (and a final OK) reach the app → OK now switches immediately.
      **AI** opens LG's AI menu (system, keycodes 1536/1537 seen around system overlays). There is no ♡ button on this
      remote variant.
- [x] Guide picture-in-picture shows live video
- [x] Home → reopen resumes playback (picture back after ~0.6 s)
- [x] Audio switching bug (language unchanged, ~4 s silence, lost A/V sync). First fix, reloading plus LG
      `selectTrack` at the start (2026-10-20), had no stalls in automated tests but was still out of sync by ear.
      Final fix (2026-10-21): the relay delivers the chosen track alone (`?audio=<pid>`), verified in sync by ear on
      Das Erste. A faster switch is under "Improvements". The preference carries over to other channels (SRF 1 → SRF
      zwei, automated test).
- [ ] **By ear:** a different *language* really plays. Use **13 arte D** → ▶ → Audio → "Français": French, in sync?
      (arte always broadcasts German + French.) SRF 1 is *not* a good test: its `eng` track carries the German sound
      during domestic programmes; `tools/audio-compare.mjs` showed a correlation of 0.97 with German. Das Erste has no
      English track at all.
- [ ] No screensaver after ~15 min of playback
- [ ] A multicast channel stays stable for 30+ min (e.g. 26 ZDFneo)
- [x] **Switching speed** measured on the TV over DevTools (2026-11-13, about 15 min after the TV was switched on,
      time from the switch to the `playing` event):
      - HLS: 0.54 – 0.69 s in 8 switches, whether coming from HLS or multicast. Unchanged.
      - Multicast: 4.8 – 5.6 s in 7 of 8 switches (ZDFneo, NITRO, ONE); one start of ONE played after 2.1 s, then
        stalled until 5.1 s. **This is far above the ~1.4 s documented so far**, and it explains the report of
        slower switching.
      - Where the time goes: the app hands the relay URL to the player within 0.07 s, and the relay delivers the
        first data within 0.02 – 0.12 s at full rate. The rest is the TV's player, which opens the relay stream twice
        per start and reports `stalled` at 3.3 s before it plays.
- [ ] **Multicast start takes ~5 s:** find out why. It was always like this; the ~1.4 s in earlier docs was wrong
      (corrected in the README and decisions; the v1.0.0 changelog entry still says ~1.4 s).
      Relay connection log (`/stats` → `connections`), 8 multicast starts on 2026-11-13:
      - The "second open" is harmless: about 0.2 – 1 s after the player's stream connection, a request without a
        user agent opens the stream and closes it after 1 – 14 ms (at most 20 KB). The player keeps playing from
        the first connection.
      - The player plays **~4.5 s after the first byte, whatever the bitrate**: ZDFneo (~1.4 MB/s) after ~6 MB,
        NITRO (~0.3 MB/s) after ~1.5 MB. ONE gets `loadedmetadata` after ~1 s, then waits until ~4.5 s. So the
        player seems to wait for a fixed amount of media time (or a fixed timeout), not for a byte count or a
        keyframe. HLS fits this: a segment brings several seconds of media at once, and it starts in 0.6 s.
      - The multicast join itself takes 0.15 s on ZDFneo but 0.8 – 1.0 s on NITRO and ONE (time to the first
        byte).
      - **Burst test (2026-11-13): the player waits for ~4.5 – 5 s of video, and starts ~0.5 s after it has
        them.** With a temporary relay option, the first part of the stream was held back and then sent in one
        burst. After 5 s of data in one burst, ZDFneo, NITRO and ONE played 0.3 – 0.5 s later. After 8 s,
        ZDFneo played 0.6 s later. After only 2.5 s, the player still waited another 2.2 – 3.0 s. The burst
        began at a random point in the stream, not at a keyframe.
      - The probe must be answered at once: it comes right after the first data on the stream connection, and
        the player doesn't start until it is answered.
      - **Consequence:** a relay that already holds the last ~5 s of a channel can start it in ~0.5 s, like
        HLS. Done for the current channel (see "Stream buffer" under Improvements); a fresh channel start still
        takes ~5 s.
- [x] **Full HD SRG channels** (HEVC 1080p50, ~27 Mbit/s), verified on the TV (2026-11-13): SRF 1, SRF zwei and
      RTS 1 play in 1920×1080 and start in 0.6 – 0.7 s over HLS, like the 720p versions. Audio switch on SRF 1:
      first 4.5 s (the relay joins the FHD group), then 0.65 s with a 20 MB burst; nothing dropped.
- [x] **A/V sync test for LG's `selectTrack`** (2026-11-14, `tools/avsync/`, filmed with a phone and analysed
      per flash). On a relay stream: in sync (MP2 → MP2 seamless; MP2 ↔ AC-3 in sync with under 2 s of silence).
      On HLS (SRF 1, Das Erste): 3 of 3 switches froze the picture for 8 – 12 s. Details in [decision 10](DECISIONS.md).
- [ ] Guide refresh over a long session: leave the app open for a day and check that the guide follows schedule
      changes (the 3-hour reload is only covered by unit tests so far)
- [ ] Does any channel's PMT span two UDP datagrams? In that case the audio filter passes the original PMT through
      for that moment (see `createAudioFilter`). Check a few channels with many tracks before deciding on a fix.
- [ ] Older webOS versions / other models (compatibility reports)

## Before publishing

- [x] GitHub account (`ArdaDaMarda`) and final app id `io.github.ardadamarda.init7tv` (`package.json` →
      `webos.appId`; webOS ids are lower case). On the test TV it installs as a new app, so remove the
      `local.init7tv.app` build afterwards.
- [x] Copyright holder in `LICENSE`: "ArdaDaMarda"
- [x] Remote picture `docs/images/lg-ai-magic-remote-mr25.png`: decided to keep it (2026-10-21). If LG objects,
      replace it with a link to LG's product page.
- [x] First release: all changes so far combined into v1.0.0 (see CHANGELOG)
- [ ] Optional: let Init7 know about the project (they publish the multicast M3U openly)
- [x] Repository published (2026-10-21): <https://github.com/ArdaDaMarda/init7-tv-webos>. CI green on the first push;
      `v1.0.0` released with `io.github.ardadamarda.init7tv_1.0.0_all.ipk`.
- [ ] Turn this roadmap into GitHub issues; label the TV tests "help wanted"

## Improvements

- [x] **Faster first audio switch on HLS channels** (2026-11-14: option 3 built, see [decision 21](DECISIONS.md)). It took ~5 s, because the relay first has to join the
      channel's multicast stream and collect the ~5 s of video the player waits for. Later switches on the same
      channel take ~0.5 s. Switching inside LG's player is ruled out (it freezes HLS for 8 – 12 s, see
      [decision 10](DECISIONS.md)), so the fix has to be in the relay. Options, cheapest first:
      1. **Join when the audio menu opens** (~10 lines in the app): when ▶ → Audio opens on an HLS channel, the relay
         joins the channel in the background. By the time a track is picked the buffer is mostly full, so expect
         ~0.5 – 2 s. Network cost only after the menu was opened. **Recommended first step.**
      2. **Keep the relay on the current HLS channel all the time:** every switch and "Reload stream" ~0.5 s, but the
         channel's bitrate (~10 – 15 Mbit/s in HD) flows to the TV over multicast the whole time, on top of HLS.
      3. **Fill the relay from Init7's HLS** (~100 – 150 lines in the relay): fetch the latest segment as the
         burst, filter the audio, then continue. No multicast join and no extra network load. To check first:
         whether the HLS segments are MPEG-TS the audio filter can handle.
      4. Seamless switching (PID remapping, next item) only helps once the stream runs through the relay, so it
         would only add to 2 or 3.

      **Result (option 3, measured on the TV 2026-11-14):** every switch takes 1.3 – 1.8 s on Das Erste and
      2.1 – 3 s on the Full HD SRF channels. The first switch got faster (from ~5 s), later switches on the same
      channel got slower (from ~0.6 s). To get those back to ~0.6 s, option 3 would have to be combined with a
      multicast join after the first switch. Downloading the two start segments side by side was tried and was
      slower.

- [ ] **Seamless audio switching (PID remapping in the relay).** Since 2026-10-21 a non-default audio track is
      delivered alone by the relay (`?audio=<pid>`). That stays in sync but needs a reload: ~0.5 s with the stream buffer on a multicast channel,
      ~1.5 – 2 s on an HLS channel (`/hls?track=<n>`).
      Idea: keep the player's relay connection open. The output always carries one audio stream under a fixed PID, and
      on a switch the relay starts forwarding the chosen source track's packets under that PID, beginning at a PES
      start. No reload, no pipeline track switch; all tracks share the PCR/PTS clock, so sync should hold. Expected
      switch time < 0.5 s.
      - Only between tracks with the same codec (e.g. Das Erste tracks 1–3, all MP2); MP2 ↔ AC-3 keeps the reload.
      - Needs playback through the relay (multicast), plus a control call to the relay to change the PID of a running
        stream (per connection id).
      - To verify: the decoder accepts the switch (bitrate change e.g. 256 → 192 kbit/s), and A/V sync by ear.
      - Hint from the A/V sync test (2026-11-14): on a relay stream, LG's own `selectTrack` switched MP2 → MP2
        seamlessly and in sync, and MP2 ↔ AC-3 in sync with under 2 s of silence. The TV's decoder therefore copes
        with a track change in a running relay stream, which makes PID remapping look feasible.
- [x] **Stream buffer in the relay, current channel** (2026-11-13). The burst test (see "Multicast start" under
      Verification) showed that the player starts ~0.5 s after it has ~5 s of video. The relay now joins each
      channel once for all its connections, keeps the last 6 s (at most 24 MB; ~11 MB for ZDFneo in HD, ~20 MB for the Full HD SRG channels) and sends
      them to a new connection in one burst. A channel stays joined for 10 s after its last connection, unless
      another channel is already playing. Playback runs ~6 s behind live, like with HLS. Measured on the TV:
      reload ZDFneo 0.52 / 0.54 s, NITRO 0.33 s; audio switch ZDFneo 0.66 / 0.55 s, Das Erste 0.63 s (its first
      switch 5.3 s, because the HLS channel is not joined yet). Only one channel was joined at a time.
      - [x] A/V sync after an audio switch with the buffer: in sync, checked by ear (2026-11-13).
- [ ] **Stream buffer for channel switches ("fast channel change").** A channel switch is fast only if the relay
      is already on the target channel: join the neighbours (▲/▼) and the previous channel in advance. Each joined
      channel costs its bitrate on the network the whole time (an HD channel ~11 Mbit/s) and up to 24 MB of memory.
      This works on the TV; a relay on the router would not be faster.
- [x] **Audio track labels** (2026-10-21): the relay reads the multicast PMT (`/info/<group>:<port>`), the menu shows
      an audio track list with language, purpose and codec. Verified on Das Erste, arte, SRF 1, ZDFneo.
- [ ] **Subtitles:** the multicast streams carry DVB teletext and teletext subtitles (e.g. Das Erste); HLS probably
      not. Check whether the webOS player exposes them as text tracks, or decode teletext page 150/777 in the relay.
      The official Android app offers a subtitle track list next to audio (its player decodes them itself). The EPG
      has a `subtitles` flag per programme, which the app already shows as a "Subtitles" note.
- [x] **Richer programme details** (2026-11-13): duration, season/episode, country, age rating, "Subtitles" note and
      credits in the guide and the expanded banner. The EPG never fills year, star rating, pictures or "premiere",
      so those are left out.
- [x] **Fast zapping** (2026-11-13): while presses keep coming within 400 ms only the banner follows; the stream
      starts 250 ms after the last press.
- [x] **Guide refresh** (2026-11-13): a 6-hour block is reloaded after 3 hours unless it lies in the past.
- [ ] Channel list: render only the visible rows. It builds all 242 rows and logos at once and rebuilds them when
      EPG data arrives. Fine on a G5; likely to matter on older TVs.
- [x] "Reload stream" entry in the options menu, for a stream that hangs (the official app has this on the red key).
      Added after v1.1.0; verified on the TV on a multicast channel (2026-11-13).
- [ ] **Start a remembered audio language straight through the relay.** Today an HLS channel starts normally
      and is reloaded with the remembered track once the player has reported its tracks (3.0 s on SRF zwei, with
      a moment of the default language). Remembering each channel's track list would skip the first start. The
      fallback to the default track (2026-11-14) covers a list that has changed.
- [ ] Small clean-ups from a code review (2026-11-14): pause the 30 s housekeeping timer while the app is in
      the background; check again by itself after "not authorised"; follow the HLS playlist by its media sequence
      number instead of segment addresses (a playlist that steps back would repeat a segment; not observed).
- [ ] Provoke the audio fallback and the segment retry on a real TV. Both are covered by unit tests only.
- [ ] Debug overlay with codec and stream info (the official app has a "Show debug information" setting)
- [ ] Mock mode for development: recorded API responses, so the UI can be worked on and tested in CI off the Init7
      network. The LG webOS simulator was considered and rejected, see [decisions](DECISIONS.md).
- [ ] Map ♡ to "favourite" on remote variants that have it, if the button reaches the app
- [ ] UI languages DE / FR / IT / EN (currently English, dates de-CH)
- [ ] Settings screen: language order, hide channel groups from zapping, default audio language
- [ ] Relay hardening: limit concurrent clients, fall back to another port if 8077 is busy. Done so far
      (2026-11-13): a client that stops reading is dropped at a 32 MB backlog, and only multicast group addresses
      are accepted (verified on the TV: unicast, loopback and broadcast targets get a 404).
- [ ] Debug features (`keyLog`, `/stats`) only behind a debug flag
- [ ] Automate or document the Developer Mode session renewal (not needed on a rooted TV)
- [ ] Publish to the webOS Homebrew Channel repository (for rooted TVs). The app already runs on a rooted G5.
- [x] Make `npm run dev` work on a rooted TV (2026-11-13): `ares-install` over the root SSH login fails there
      ("Unable to exec"), so `scripts/deploy.mjs` falls back to copying the `.ipk` over SSH and calling the installer
      service (`luna-send … < /dev/null`). Verified on the rooted G5 with `npm run dev` and `npm run deploy`.
- [ ] Replay, for accounts with a replay entitlement (`replay_grant`); not testable with the current account. How
      the official app does it is written down in [API notes](API.md#replay).

## Done

- [x] Reverse-engineer the Init7 API (no DRM, IP-based access)
- [x] Native playback of DVB codecs (MPEG-2/H.264, MP2/AC-3) where generic webOS IPTV apps fail
- [x] Direct multicast in the web engine: 8 variants tested and confirmed visually → not possible, so the relay is needed
- [x] Relay service on the TV; all 242 channels
- [x] Controls for the LG AI Magic Remote (options menu, hold-OK, wheel)
- [x] Persistence: Developer Mode + regular "Extend" is the documented way; a rooted TV also works (since 2026-11).
      The LG Content Store is not an option.
- [x] Open-source preparation: neutral name and id, MIT license, docs, build pipeline, tests, CI/release workflows
- [x] Restructured version deployed to the test TV; the old pre-restructure app removed
