# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/),
and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
