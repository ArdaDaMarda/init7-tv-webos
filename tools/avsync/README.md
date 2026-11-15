# A/V sync test

Checks whether sound and picture stay in sync when the audio track is switched, comparing LG's own switch
(`luna://com.webos.media/selectTrack`) with the relay reload the app uses.

| File | Runs on | Does |
|---|---|---|
| `stream.mjs` | PC | Generates a test stream and sends it as multicast (`239.255.77.1:5000`); the relay joins it like a channel |
| `run.js` | TV app (DevTools) | Runs 7 labelled steps of ~20 s, then restores the previous channel |
| `analyse.mjs` | PC | Reads a phone video of the TV and prints the A/V offset per flash and per step |

The picture flashes white every 2 s (longer every 10 s). Three audio tracks beep at each flash at their own pitch:
1 = MP2 700 Hz, 2 = MP2 1300 Hz, 3 = AC-3 2300 Hz. Steps: reference on track 1; LG switch to 2 and to 3; LG switch +
pause/play to 1 and to 3; relay reload to 2 and to 3.

## Running it

1. PC: `node tools/avsync/stream.mjs` (needs ffmpeg; `--iface <LAN address>` if it picks the wrong interface).
2. Play any multicast channel in the app once, so the relay runs.
3. `npm run inspect -- --device <device>`, take the `ws://` address.
4. Film the TV with a phone (60 fps, quiet room).
5. `node tools/cdp.mjs <ws-url> "eval:$(cat tools/avsync/run.js)"` (~2.5 min).
6. Stop filming and `stream.mjs`, then `node tools/avsync/analyse.mjs <video file>`.

Compare each step with step 1, not with zero (it includes the TV's and phone's delays). Resolution is about one
frame of the video. "gap" lines mean a frozen picture or silence; `!!` marks an offset a whole period off.

## Result (2026-11-14, LG G5)

On this relay stream all steps were within ±20 ms of the reference; AC-3 runs ~20 ms later than MP2 with either
method. LG's switch was seamless for MP2 → MP2 and lost < 2 s of sound for MP2 ↔ AC-3. On Init7's HLS the same
switch froze the picture for 8 – 12 s, see [audio switching](../../docs/DECISIONS.md#audio-switching).
