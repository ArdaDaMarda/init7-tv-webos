# Tools

Helpers used while developing and debugging. None of them are part of the app.

| Tool | Purpose |
|---|---|
| `cdp.mjs` | Drives a page over the Chrome DevTools Protocol: key presses, `eval`, screenshots, viewport. Works with `npm run inspect` (TV) and with desktop Chrome started with `--remote-debugging-port`. Usage is in the file header. |
| `tsprobe.ps1` | Prints the streams of an MPEG-TS file (codec and language per PID) by parsing the PMT. Useful to check what a channel actually sends: `powershell -File tools/tsprobe.ps1 segment.ts` |
| `probe/` | Minimal diagnostic webOS app from the start of the project. It tests API access, native playback of the different codec mixes, start-up time and audio tracks. Package and install it with `npx ares-package tools/probe -o dist && npx ares-install dist/io.github.ardadamarda.init7tvprobe_0.1.0_all.ipk`. |
| `ts-audio.mjs` | Lists a channel's audio tracks (PID, codec, language) from one live segment and flags byte-identical tracks: `node tools/ts-audio.mjs <channel-pk>`. No ffmpeg needed. |
| `audio-compare.mjs` | Decodes ~18 s of every audio track with ffmpeg and prints the correlation with track 1. It answers "is the English track really English right now?" (≈1.0 = same audio). `node tools/audio-compare.mjs <channel-pk>`; needs ffmpeg on PATH or `FFMPEG_DIR`. |
