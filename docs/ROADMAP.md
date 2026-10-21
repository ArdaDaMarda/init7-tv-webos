# Roadmap

Status of the project and open items. Once the repository is on GitHub, the open items should become issues.

## Status (v1.0.0)

| Area | State |
|---|---|
| HLS channels (102), native playback of all codec mixes | ✅ Verified on the TV (LG G5, webOS 25) |
| Multicast channels (140) via the on-TV relay | ✅ Verified on the TV (short tests: ZDFneo, Phoenix, DMAX, Servus TV, France 5) |
| EPG, banner, channel list, guide, options menu, hold-OK favourites | ✅ Verified on the TV with simulated key presses |
| Restructured code (ES modules + esbuild), new app id `local.init7tv.app` | ✅ Installed on the TV with `npm run dev`; lineup, EPG, HLS (SRF 1, ZDF) and multicast via the relay (ZDFneo, Phoenix) verified |
| Audio track list with broadcaster labels (relay `/info`) | ✅ Verified on the TV: Das Erste, arte D, SRF 1, ZDFneo |
| Audio switching via the relay filter (`?audio=<pid>`) | ✅ In sync, verified by ear on Das Erste; switch ~1.5 s with a black screen |
| CI / release workflows | ⚠️ Written, not yet run (needs the GitHub repository) |

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
- [ ] **Switching speed:** measure HLS vs multicast on the current version (automated over DevTools, ~30 s). A user
      reported slower switching after multicast was added. The expected cause is that ▲▼ now also passes multicast
      channels (~1.4 s vs ~0.6 s), plus the relay service start for the first multicast channel. HLS-to-HLS switching
      should be unchanged; confirm it.
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
- [ ] `git init`, first commit, create the repository, push. Then check that CI runs green and create the first release
      with `git tag v1.0.0`.
- [ ] Turn this roadmap into GitHub issues; label the TV tests "help wanted"

## Improvements

- [ ] **Seamless audio switching (PID remapping in the relay).** Since 2026-10-21 a non-default audio track is
      delivered alone by the relay (`?audio=<pid>`). That stays in sync but needs a reload: a black screen of ~1.5 s.
      Idea: keep the player's relay connection open. The output always carries one audio stream under a fixed PID, and
      on a switch the relay starts forwarding the chosen source track's packets under that PID, beginning at a PES
      start. No reload, no pipeline track switch; all tracks share the PCR/PTS clock, so sync should hold. Expected
      switch time < 0.5 s.
      - Only between tracks with the same codec (e.g. Das Erste tracks 1–3, all MP2); MP2 ↔ AC-3 keeps the reload.
      - Needs playback through the relay (multicast), plus a control call to the relay to change the PID of a running
        stream (per connection id).
      - To verify: the decoder accepts the switch (bitrate change e.g. 256 → 192 kbit/s), and A/V sync by ear.
- [ ] **Keyframe (GOP) cache in the relay ("fast channel change").** The relay keeps the running channel's multicast
      group joined and buffers from the last keyframe. A new request first gets PAT/PMT and the cached data, so the
      player doesn't wait 1–2 s for the next keyframe. This shortens audio-track reloads and multicast channel switches.
      Extension: pre-join the neighbouring channels (▲/▼) for near-instant zapping. This works on the TV; a relay on
      the router would not be faster.
- [x] **Audio track labels** (2026-10-21): the relay reads the multicast PMT (`/info/<group>:<port>`), the menu shows
      an audio track list with language, purpose and codec. Verified on Das Erste, arte, SRF 1, ZDFneo.
- [ ] **Subtitles:** the multicast streams carry DVB teletext and teletext subtitles (e.g. Das Erste); HLS probably
      not. Check whether the webOS player exposes them as text tracks, or decode teletext page 150/777 in the relay.
- [ ] Map ♡ to "favourite" on remote variants that have it, if the button reaches the app
- [ ] UI languages DE / FR / IT / EN (currently English, dates de-CH)
- [ ] Settings screen: language order, hide channel groups from zapping, default audio language
- [ ] Relay hardening: accept only multicast addresses, limit concurrent clients, fall back to another port if 8077 is
      busy
- [ ] Debug features (`keyLog`, `/stats`) only behind a debug flag
- [ ] Automate or document the Developer Mode session renewal
- [ ] Publish to the webOS Homebrew Channel repository (for rooted TVs)
- [ ] Replay, for accounts with a replay entitlement (`replay_grant`); not testable with the current account

## Done

- [x] Reverse-engineer the Init7 API (no DRM, IP-based access)
- [x] Native playback of DVB codecs (MPEG-2/H.264, MP2/AC-3) where generic webOS IPTV apps fail
- [x] Direct multicast in the web engine: 8 variants tested and confirmed visually → not possible, so the relay is needed
- [x] Relay service on the TV; all 242 channels
- [x] Controls for the LG AI Magic Remote (options menu, hold-OK, wheel)
- [x] Persistence decided: Developer Mode + regular "Extend" (rooting and the LG Content Store rejected)
- [x] Open-source preparation: neutral name and id, MIT license, docs, build pipeline, tests, CI/release workflows
- [x] Restructured version deployed to the test TV; the old pre-restructure app removed
