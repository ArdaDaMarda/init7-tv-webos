# Decisions & findings

How the app came to be, and why it is built the way it is. Each finding was verified on a real TV
(LG G5, webOS 25) unless noted otherwise.

1. **Reverse engineering, not porting.** An Android APK cannot run on webOS, which has no Android runtime. The
   official Android TV app was inspected only to learn which public API endpoints it calls. The result: a small REST
   API at `api.tv.init7.net/api/` with IP-based access, no login and **no DRM**. IPv6 works as well as IPv4, and the
   User-Agent is not checked. No code from the official app is used or included.

2. <a name="codecs"></a>**Why generic webOS IPTV apps fail.** The streams are **DVB pass-through**: MPEG-2 or H.264
   video with MP2 or AC-3 audio (e.g. ProSieben and BBC One are MPEG-2 + MP2, SRF 1 is H.264 + 3× AC-3). Browser
   players (hls.js/MSE) can't decode MPEG-2 or MP2. The TV's **native media pipeline** can, so the app gives the stream
   URL straight to `<video>`. Every codec mix plays.

3. **No UI framework.** A small app with plain DOM modules stays fast on TV hardware and is easy to read.
   esbuild only bundles; there is no transpiling beyond the syntax target.

4. **CORS is not an issue.** The API sends no CORS headers, but packaged webOS apps can call it directly, so no proxy
   is needed.

5. **Multicast needs a relay.** 140 of the 242 channels are multicast-only; their HLS URLs return HTTP 410. The TV's
   web engine **cannot open `udp://` or `rtp://`**. Eight variants were tested and confirmed visually: plain,
   `video/mp2t`, `rtp://`, the `video.src` attribute, and webOS `mediaOption` UDP/URI/DLNA. None produced picture or
   sound.

6. **The relay runs on the TV, not on the router.** A webOS JS service joins the multicast group and serves MPEG-TS
   over HTTP on localhost, so no extra hardware or router changes are needed. Moving it to the router would not make
   switching faster: the delay comes from the IGMP join, waiting for a keyframe and the player's buffer, and those are
   the same on either device.

7. **HLS where available.** It starts in ~0.6 s versus ~1.4 s for multicast (about 2.5–5 s for the first multicast
   channel after app start, while the relay service starts).

8. **Lineup from the M3U, ids = multicast addresses.** That address is the only key shared by the M3U, the channel API
   and the EPG. Channel numbers follow Init7's M3U order (e.g. 26 = ZDFneo, 58 = Phoenix).

9. **AI Magic Remote first** ([picture](images/lg-ai-magic-remote-mr25.png)). The 2025 remote (MR25) has no colour
   or INFO keys, so: ▶ opens an options menu (with the audio track list), ◀ opens the guide, holding OK toggles a
   favourite, and the wheel switches channels. The GUIDE button is caught by the TV (it opens LG's own guide), and the
   AI button opens LG's AI menu; neither reaches the app. Audio description or multilingual tracks (`nar`, `qad`,
   `mul`, `qaa`) are never stored as the preferred language.

10. **Audio tracks are never switched inside the player.** Any track switch in the webOS pipeline, whether via
    `video.audioTracks` or LG's `luna://com.webos.media/selectTrack`, during playback or right after the start, led
    to silence and lost A/V sync. Instead, the relay delivers the multicast stream with only the chosen audio track
    (PMT rewritten, other audio PIDs dropped), and the player plays it as its default. This is in sync but costs a
    reload (~1.5 s); see the roadmap for faster options. LG's `selectTrack` remains only as a fallback when the track
    PIDs are unknown.
    Note that the track labels are the broadcaster's: SRF's `eng` track carries English only for foreign productions
    and repeats the German sound otherwise. Das Erste and ZDF only have German variants (stereo, audio description,
    clean audio, Dolby), while arte has German and French. Init7's HLS strips the descriptors that name these
    purposes; the multicast stream keeps them (visible in VLC). `tools/audio-compare.mjs` shows what a track really
    contains. **Labels show only what the stream says:** a track without a real language code is shown with its code
    (e.g. arte's audio description as "MIS · Audio description"), not with a language guessed from the main track.
    Accuracy wins over readability.

11. **Replay is not implemented.** The test account has no replay entitlement (`replay_grant: null`).

12. **Distribution through Developer Mode.** Sideloading needs an active Developer Mode session, which has to be
    extended regularly. Rooting (Homebrew Channel) depends on firmware exploits, and the LG Content Store is not an
    option for an unofficial client of a third-party service.

13. **Open-source hygiene.** Neutral name ("TV for Init7") and app id (`io.github.ardadamarda.init7tv`, configurable in `package.json`). No Init7
    branding, streams or broadcast screenshots in the repo, and no telemetry.
