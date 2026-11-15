# Roadmap

## Status (v1.2.0)

Tested on an LG G5 (webOS 25), in Developer Mode and rooted.

| Area | State |
|---|---|
| 102 HLS channels, all codec mixes | ✅ Start in ~0.6 s |
| 140 multicast channels via the on-TV relay | ✅ Start in ~5 s; reload and audio switch ~0.5 s |
| Audio switch on HLS channels (`/hls`) | ✅ 1.3 – 1.8 s, Full HD 2 – 3 s, in sync |
| Full HD SRG channels | ✅ 1080p, start in ~0.7 s |
| Guide, banner, channel list, options menu, favourites, programme details | ✅ |
| Audio fallback to the default track, segment retry, 15 s API timeout | ⚠️ Unit tests only, not provoked on a TV |
| Guide reload every 3 h | ⚠️ Unit tests only, not watched over days |
| Older webOS versions / other models | ❓ Untested |

## Open tests on a TV

- [ ] A different language really plays: **13 arte D** → ▶ → Audio → "Français", in sync? (SRF 1 is a poor test:
      its `eng` track often carries German.)
- [ ] No screensaver after ~15 min; a multicast channel stays stable for 30+ min.
- [ ] Guide follows schedule changes over a day.
- [ ] Does any channel's PMT span two UDP datagrams? The audio filter would pass the original PMT for that moment.
- [ ] Provoke the audio fallback and the segment retry.

## Ideas

- [ ] **Seamless audio switch (PID remapping):** keep the relay connection open and forward the new track's
      packets under the same PID. No reload, expected < 0.5 s; same codec only. LG's own switch was seamless on a
      relay stream, so the decoder should cope.
- [ ] **Fast channel change:** join the neighbours (▲/▼) and the previous channel in advance. Costs each channel's
      bitrate (~11 Mbit/s in HD) the whole time.
- [ ] **Faster later HLS audio switches** (~0.6 s instead of ~1.5 s): join the multicast stream after the first
      switch.
- [ ] **Start a remembered language straight through `/hls`** by remembering each channel's track list, instead of
      starting with the default track and reloading.
- [ ] **Subtitles:** the multicast streams carry DVB teletext; check whether the player exposes it, or decode it in
      the relay.
- [ ] Channel list: render only the visible rows (matters on older TVs).
- [ ] Clean-ups: pause the housekeeping timer in the background; retry after "not authorised"; follow the HLS
      playlist by media sequence number.
- [ ] Relay hardening: limit clients, fall back to another port; debug features (`keyLog`, `/stats`) behind a flag.
- [ ] Debug overlay with codec and stream info; mock mode with recorded API responses for CI.
- [ ] UI languages DE / FR / IT; settings screen (language order, hidden groups, default audio language).
- [ ] Map ♡ to favourite on remotes where it reaches the app.
- [ ] Replay, for accounts with a replay entitlement ([API notes](API.md#replay)).
- [ ] Publish to the Homebrew Channel repository; turn this roadmap into GitHub issues; let Init7 know.
