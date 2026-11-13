# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/),
and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Full HD (1080p) for SRF 1, SRF zwei, SRF info, RTS 1, RTS 2, RSI LA 1 and RSI LA 2: the app plays Init7's Full HD
  versions of these channels instead of the 720p ones. Number, name, guide and favourites stay the same.
- "Reload stream" in the options menu (▶), for a stream that hangs. The chosen audio track is kept.

### Changed

- Reloading a multicast channel and switching its audio track take ~0.5 s instead of ~5 s. The relay keeps the
  last 6 s of the current channel and sends them to a new connection at once; the TV's player waits for about 5 s
  of video before it starts. Only the current channel is kept, for 10 s after it was last played. Starting a channel
  still takes ~5 s, and so does the first audio switch on an HLS channel (the relay has to join it first).
- The audio track list of the running multicast channel is read from the relay's buffer instead of joining the
  channel a second time.
- The relay accepts only multicast group addresses (224.0.0.0 – 239.255.255.255).
- The relay's `/stats` lists the last 30 requests with the player's headers, the time to the first byte and the
  bytes sent after 0.5 – 5 s, to find out where a slow start loses its time.
- Docs: multicast channels take ~5 s to start, not ~1.4 s as stated before (HLS is ~0.6 s as stated).
- `npm run dev` works on a rooted TV: if `ares-install` fails, the package is copied over SSH and installed through
  the TV's installer service.

### Fixed

- The key hints under the channel list fit on one line again ("BACK Close" had wrapped onto a second line).

## [1.1.0] - 2026-11-13

### Added

- Richer programme details in the guide and in the expanded banner: duration, season and episode, country, age
  rating, a "Subtitles" note, and host, cast, guests and director where the EPG provides them.

### Changed

- Fast zapping: while channel-switch presses keep coming, only the banner follows; the stream starts once they
  pause, so the channels in between are never loaded. A single press still switches at once.
- Faster start: the programme guide, the channel list and the authorization check load side by side.

### Fixed

- The guide no longer goes stale while the app stays open for days: programme data is reloaded every 3 hours and
  picks up changed, added and cancelled programmes.
- The relay drops a client that stops reading the stream (32 MB backlog) instead of buffering without limit. The
  app reconnects by itself. `/stats` counts these as `dropped`.

## [1.0.0] - 2026-10-21

First public version.

### Channels and playback
- All 242 Init7 channels: HLS where Init7 offers it (102, ~0.6 s switching), the 140 multicast-only channels through a
  small relay service that runs on the TV (~1.4 s). No extra device or router changes needed.
- Native webOS playback of the broadcast codecs (MPEG-2/H.264 video, MP2/AC-3 audio) that browser-based IPTV players
  can't decode
- Stall watchdog with automatic reload; playback resumes after leaving and reopening the app

### Programme guide
- EPG for all channels: info banner with now/next and progress, programme details, and a guide grid with live
  picture-in-picture

### Audio
- Audio track list (▶ → Audio) with the broadcaster's descriptions: language, audio description / clean audio, codec
  (MP2, Dolby Digital, 5.1). The relay reads them from the channel's multicast stream, because Init7's HLS drops them.
  Unknown language codes are shown as the code (e.g. "MIS"); no language is guessed.
- Audio switching stays in A/V sync: a non-default track is delivered by the relay as the stream's only audio track,
  because switching tracks inside the webOS player loses sync. A switch takes ~1.5 s.
- The preferred language is remembered across channels; the main mix is preferred over audio description or clean
  audio, and those tracks never become the default language.

### Navigation (LG AI Magic Remote)
- Channel list with logos, what's on now, filters (All / ★ / DE / FR / IT / EN / World), "CH ∧∨" page, hold OK for
  favourites
- Live TV: OK = channel list, ◀ = programme guide (the GUIDE button is caught by webOS 25), ▶ = options menu, wheel
  or ▲▼ = switch channel, 123 keypad for channel numbers (OK on the keypad switches immediately)
- Colour and INFO keys work on remotes that have them; pointer support

### Project
- Build pipeline: esbuild bundle, ESLint, Prettier, unit tests (`npm run check`), `npm run dev` to build and install on
  a TV
- GitHub Actions: CI on every push and pull request, and a release workflow that builds the `.ipk` for version tags
- Diagnostic tools: DevTools driver (`tools/cdp.mjs`), stream/audio analysis (`tools/ts-audio.mjs`,
  `tools/audio-compare.mjs`, `tools/tsprobe.ps1`), diagnostic test app (`tools/probe/`)
