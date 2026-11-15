# TV for Init7 (webOS)

An unofficial LG webOS TV app for **Init7 TV7**, the IPTV service included with Swiss Init7 fibre connections.
Init7 ships official apps only for Google TV and Apple TV. This app brings TV7 to LG TVs, natively and with
a programme guide.

![Info banner with programme details](docs/screenshots/banner.png)

| Channel list with filters | Programme guide |
|---|---|
| ![Channel list](docs/screenshots/channel-list.png) | ![Programme guide](docs/screenshots/guide.png) |

<img src="docs/screenshots/audio-tracks.png" alt="Audio track list on Das Erste, with audio description, clean audio and Dolby Digital" width="404">

*The audio track list on Das Erste, as shown on the TV.*

## Features

- **All 242 Init7 channels**: 102 via HLS (start in ~0.6 s) and 140 multicast-only channels through a small relay
  on the TV itself (~5 s). No extra device or router changes. When you zap quickly, only the channel you stop on loads.
- **Full HD** for SRF 1, SRF zwei, SRF info, RTS 1, RTS 2, RSI LA 1 and RSI LA 2
- **Programme guide** with now/next banner, programme details and live picture-in-picture
- **Channel list** with logos, what's on now, favourites and filters (All / ★ / DE / FR / IT / EN / World)
- **Audio track list** with the broadcaster's labels ("Deutsch · Audio description", "Dolby Digital 5.1"). Switching
  stays in A/V sync and takes ~0.5 s on multicast and ~1.5 – 2 s on HLS channels (after a switch on HLS, playback
  runs ~15 s behind live). The language is remembered across channels.
- Channel number entry; resumes the last channel on start
- Controls designed for the **LG AI Magic Remote** (no colour buttons needed); classic remotes work too

> **Not affiliated with Init7 or LG.** It works only on an Init7 internet connection, because Init7 grants stream
> access by your connection's IP address. No streams, logos or Init7 branding are bundled. Channel data and logos
> are loaded at runtime from Init7's public endpoints. The app collects **no telemetry**.

## How it works

Init7 passes DVB broadcasts through unchanged (MPEG-2/H.264, MP2/AC-3), which browser players can't decode, so the
app uses the TV's native player. That player has two limits, which a small relay service on the TV works around:

- It can't open multicast (`udp://`). The relay joins the multicast group and serves the stream over HTTP.
- Switching audio tracks inside it loses A/V sync or freezes the picture. The relay delivers a stream with only the
  chosen track instead, for HLS channels by fetching and filtering Init7's segments itself.

The player also waits for ~5 s of video before it starts, so the relay keeps the last 6 s of the channel and sends
them at once: a reload or an audio switch on a multicast channel takes ~0.5 s. Details: [Decisions & findings](docs/DECISIONS.md).

## Install

You need an LG webOS TV with **Developer Mode** enabled. This is free: you need an LG account and LG's
"Developer Mode" app from the LG Content Store.

1. **Enable Developer Mode**
   1. Sign in at <https://webostv.developer.lge.com> with your LG account. On the first sign-in, accept the developer
      terms.
   2. On the TV, install **Developer Mode** from the LG Content Store, sign in, switch **Dev Mode Status → ON**
      (the TV restarts), then switch **Key Server → ON**.
2. **Get the app:** download the latest `.ipk` from the
   [Releases](../../releases) page, or [build it yourself](CONTRIBUTING.md).
3. **Install it** with one of these:
   - **webOS Dev Manager**, a community desktop tool with a GUI: add the TV, then install the `.ipk`.
   - **The webOS CLI** ([Node.js](https://nodejs.org) required):
     ```sh
     npx -p @webos-tools/cli ares-setup-device   # add your TV interactively (user "prisoner", port 9922)
     npx -p @webos-tools/cli ares-novacom --device <name> --getkey   # enter the passphrase shown on the TV
     npx -p @webos-tools/cli ares-install --device <name> io.github.ardadamarda.init7tv_<version>_all.ipk
     ```

### Keep Developer Mode alive

Sideloaded apps stay installed only while the Developer Mode **session** is active. The Developer Mode app on the TV
shows the remaining time. **Press "Extend" there before it runs out.** A calendar reminder helps. If the session
expires, the TV removes the app and its favourites; re-enable Developer Mode and install again.

### Rooted TVs

On a rooted TV (Homebrew Channel) the app stays installed without a Developer Mode session. The app is not in the
Homebrew Channel repository yet, so install the `.ipk` yourself; see
[Contributing](CONTRIBUTING.md#rooted-tvs) for what worked on the test TV.

## Remote control

<img src="docs/images/lg-ai-magic-remote-mr25.png" alt="LG AI Magic Remote (MR25)" width="110" align="right">

This version is tailored to the **LG AI Magic Remote (MR25)** shipped with 2025 LG TVs (pictured). It has no colour
or INFO buttons, so every function is reachable with the arrows, OK, CH, 123 and the wheel. The **GUIDE** button cannot
be used: on webOS 25 the TV catches it and opens its own guide, so the app's guide is on **◀**.

| Button | Live TV | Channel list | Programme guide |
|---|---|---|---|
| ▲ ▼ · CH ∧∨ · wheel | Switch channel | Move (CH = page) | Channel (CH = page) |
| OK | Channel list | Watch · **hold = favourite** | Watch (if on now) |
| ◀ | Programme guide | Previous filter | Earlier programme |
| ▶ | Options: audio track list · favourite · details · guide · reload stream | Next filter | Later programme |
| 123 → digits (→ OK) | Channel by number; OK on the keypad switches immediately | | |
| BACK | Hide banner · press twice to exit | Close | Close |

Remotes with colour buttons: red = favourite, green = audio, blue = guide; INFO = programme details.
The pointer works as well: click rows, guide cells, or the picture.

## Compatibility

| TV | webOS | Status |
|---|---|---|
| LG OLED65G59LS (G5, 2025), firmware 43.21.77 | webOS 25 | ✅ Tested in Developer Mode and rooted ([details](docs/ROADMAP.md#status-v120)) |
| Older models | webOS 5 – 24 | ❓ Untested. The code targets webOS 5 syntax, but codec and multicast support may differ |

Please report your TV in a [compatibility issue](../../issues/new/choose).

## Documentation

- [Decisions & findings](docs/DECISIONS.md): the LG player's limits, the relay and its tricks
- [Architecture](docs/ARCHITECTURE.md): modules and relay endpoints
- [Init7 API notes](docs/API.md): the endpoints the app uses
- [Roadmap](docs/ROADMAP.md): status, open tests, ideas
- [Contributing](CONTRIBUTING.md): building, deploying, debugging

## Review

On 2026-11-13 and 14 the codebase was reviewed with Anthropic's Claude Fable 5.2 model. The resulting fixes are in
versions 1.1.0 and 1.2.0 of the [changelog](CHANGELOG.md).

## License

[MIT](LICENSE)
