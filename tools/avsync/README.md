# A/V sync test

Measures whether sound and picture stay in sync when the audio track is switched, and how long a switch takes. It
compares LG's own track switch (`luna://com.webos.media/selectTrack`) with the relay reload the app uses today.

## Parts

| File | Runs on | Does |
|---|---|---|
| `stream.mjs` | PC | Generates `dist/avsync/avsync-test.ts` once, then sends it as multicast on the LAN (`239.255.77.1:5000`). The TV's relay joins it like any Init7 channel. |
| `run.js` | TV app (DevTools) | Plays the stream in its own `<video>` and runs 7 labelled steps of ~20 s, then restores the previous channel. Returns a log. |
| `analyse.mjs` | PC | Reads a phone video of the TV and prints the A/V offset of every flash, and a summary per run. |

The test picture is black with a white flash every 2 s (100 ms; 300 ms on every 10th second). All three audio tracks
beep at the flashes, each at its own pitch, so the recording shows which track plays:

| Track | PID | Codec | Language | Pitch |
|---|---|---|---|---|
| 1 | 257 | MP2 | deu | 700 Hz |
| 2 | 258 | MP2 | fra | 1300 Hz |
| 3 | 259 | AC-3 | eng | 2300 Hz |

## Steps

1. Reference: track 1 (the stream's default).
2. LG switch → track 2 (same codec).
3. LG switch → track 3 (MP2 → AC-3).
4. LG switch + resync (pause 300 ms, play) → track 1 (AC-3 → MP2).
5. LG switch + resync → track 3 (MP2 → AC-3).
6. Relay reload → track 2 (`?audio=258`, today's method).
7. Relay reload → track 3 (`?audio=259`).

The LG switches follow what other webOS players do to avoid known bugs: a valid `mediaId`, at least 3 s of running
playback, and one awaited call at a time.

## Running it

1. On the PC: `node tools/avsync/stream.mjs` (needs ffmpeg on PATH or `FFMPEG_DIR`). If it picks the wrong network
   interface, pass `--iface <PC's LAN address>`.
2. Start the app on the TV and play any multicast channel once, so the relay runs.
3. `npm run inspect -- --device <device>` and take the `ws://` address it prints (DevTools page list).
4. Start filming the TV with a phone (60 fps if possible; keep the room quiet).
5. `node tools/cdp.mjs <ws-url> "eval:$(cat tools/avsync/run.js)"` (Git Bash). It takes ~2.5 minutes and prints the
   log at the end.
6. Stop filming, stop `stream.mjs` (Ctrl+C), then `node tools/avsync/analyse.mjs <video file>`.

## Result (2026-11-14, LG G5, webOS 25)

The median offsets of all steps were within ±20 ms of the reference. AC-3 runs ~20 ms later than MP2 with either
method. LG's switch was seamless for MP2 → MP2. For MP2 ↔ AC-3 it lost under 2 s of sound, while the picture kept
running. Pause/play after the switch made no difference.

This holds only for relay streams. The same switch on Init7's HLS froze the picture for 8 – 12 s, see
[decision 10](../../docs/DECISIONS.md).

## Reading the result

- The offset of step 1 is the baseline: it includes the TV's and the phone's own delays. Compare the other steps with
  it, not with zero.
- The resolution is about one frame of the phone video (±17 ms at 60 fps, ±33 ms at 30 fps). The median of a run is
  more precise than a single flash.
- The time between a step's label appearing and the new pitch is how long the switch takes.
- "gap" lines are times with no paired flash: a frozen or black picture, or silence.
- A 300 ms flash paired with a 100 ms beep (flagged with `!!`) means the offset is a whole period off.
