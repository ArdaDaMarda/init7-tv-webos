// Native webOS media pipeline. The streams are DVB passthrough (MPEG-2/H.264 video,
// MP2/AC-3 audio), which only the TV's hardware player decodes - not hls.js/MSE.
// It plays both HLS and the relay's plain MPEG-TS over HTTP.
import { lunaCall } from './luna.js';
import { relay } from './relay.js';
import { settings } from './settings.js';
import { cachedTrackInfo, fetchTrackInfo, labelText, matchesPlayer, trackLabel } from './tracks.js';
import { isRealLanguage } from './util.js';

const video = document.getElementById('video');
let channel = null;
let retries = 0;
let retryTimer = 0;
let lastTime = -1;
let stuckTicks = 0;
let audioApplied = false;
// Audio track handling: switching tracks in the webOS pipeline (audioTracks or LG's selectTrack,
// during playback or right after the start) leads to silence and lost A/V sync. So a non-default
// track is never switched to: the relay delivers the channel's multicast stream with only that
// audio track (?audio=<pid>), which the player then plays as its default. LG's selectTrack remains
// only as a fallback when the track PIDs are unknown. The active index is tracked here because
// webOS does not reflect either approach in video.audioTracks.
let audioIndex = 0;
let pendingAudio = null;
let filteredIndex = null; // track delivered alone by the relay in the current stream, if any
let trackLangs = []; // languages of the current channel's audio tracks, kept across reloads
let trackInfo = null; // broadcaster descriptions (incl. PIDs) from the multicast PMT, if they match trackLangs
let onState = () => {};
let onTracks = () => {};

function attach(url, type) {
  clearTimeout(retryTimer);
  retryTimer = 0;
  stuckTicks = 0;
  audioApplied = false;
  audioIndex = 0;
  video.pause();
  while (video.firstChild) video.removeChild(video.firstChild);
  video.removeAttribute('src');
  if (url) {
    const source = document.createElement('source');
    source.src = url;
    source.type = type;
    video.appendChild(source);
  }
  video.load();
  if (url) video.play().catch(() => {});
}

// HLS where Init7 offers it (fastest start), otherwise multicast through the relay service.
// A non-default audio track always comes from the relay as the stream's only audio track.
function load() {
  const ch = channel;
  const want = pendingAudio !== null ? pendingAudio : 0;
  const pid = want > 0 && trackInfo && trackInfo[want] ? trackInfo[want].pid : null;
  filteredIndex = pid ? want : null;
  if (ch.hls && !pid) {
    attach(ch.hls, 'application/vnd.apple.mpegurl');
    return;
  }
  attach(null);
  relay.ready().then(
    () => {
      if (channel === ch) attach(relay.url(ch.id, pid), 'video/mp2t');
    },
    (e) => {
      console.warn('[init7tv] ' + e.message);
      if (channel === ch) scheduleRetry('relay unavailable');
    },
  );
}

function play(ch) {
  if (ch !== channel) {
    pendingAudio = null; // a menu choice only applies to the channel it was made on
    trackLangs = [];
    trackInfo = null;
  }
  channel = ch;
  retries = 0;
  onState('loading');
  load();
}

function scheduleRetry(reason) {
  if (!channel || retryTimer) return;
  const delay = Math.min(1000 * 2 ** retries, 15000);
  retries++;
  console.warn('[init7tv] playback ' + reason + ', retry in ' + delay + ' ms');
  if (pendingAudio === null && audioIndex) pendingAudio = audioIndex; // keep the chosen track
  onState('retry');
  retryTimer = setTimeout(load, delay);
}

function tracks() {
  const at = video.audioTracks;
  return at && at.length ? at : null;
}

// Selects a track of the freshly started stream. Track 0 is the stream's default and needs no call.
function selectTrack(i) {
  audioIndex = i;
  if (i === 0) return;
  if (window.PalmServiceBridge && video.mediaId) {
    lunaCall('luna://com.webos.media/selectTrack', { mediaId: video.mediaId, type: 'audio', index: i }).catch((e) =>
      console.warn('[init7tv] selectTrack failed', e),
    );
  } else {
    const at = tracks(); // desktop browsers: standard API
    for (let j = 0; j < at.length; j++) at[j].enabled = j === i;
  }
}

const activeIndex = () => Math.min(pendingAudio !== null ? pendingAudio : audioIndex, trackLangs.length - 1);
const labelOf = (i) => trackLabel(trackLangs[i], trackInfo && trackInfo[i]);

function audioInfo() {
  if (!trackLangs.length) return null;
  const i = activeIndex();
  return { index: i + 1, total: trackLangs.length, lang: trackLangs[i], label: labelOf(i) };
}

// Track to start with: an explicit choice from the menu, else a track in the preferred language,
// preferring the main mix over audio description / clean audio when the descriptions are known.
function initialTrack() {
  if (pendingAudio !== null) return Math.min(pendingAudio, trackLangs.length - 1);
  const pref = settings.get('audioLang');
  if (!pref) return 0;
  const candidates = trackLangs.map((l, i) => i).filter((i) => trackLangs[i] === pref);
  const main = candidates.find((i) => !trackInfo || !trackInfo[i].purpose);
  return main !== undefined ? main : candidates.length ? candidates[0] : 0;
}

// Plays track `i` (> 0) of the running channel without a pipeline switch: reload via the relay.
function reloadWithTrack(i) {
  pendingAudio = i;
  onState('loading');
  load();
}

// Fetches the track descriptions; if track `want` (> 0) is waiting for them, switches to it.
function loadTrackInfo(ch, want) {
  fetchTrackInfo(ch.id).then(
    (info) => {
      if (channel !== ch) return;
      if (matchesPlayer(info, trackLangs)) {
        trackInfo = info;
        onTracks();
        if (want > 0 && audioIndex === 0 && pendingAudio === null) reloadWithTrack(want);
      } else if (want > 0) {
        selectTrack(want); // descriptions don't line up: fall back to LG's (imperfect) selectTrack
      }
    },
    (e) => {
      console.warn('[init7tv] track info unavailable', e);
      if (channel === ch && want > 0) selectTrack(want);
    },
  );
}

video.addEventListener('playing', () => {
  retries = 0;
  stuckTicks = 0;
  onState('playing');
  if (audioApplied) return;
  audioApplied = true;
  if (filteredIndex !== null) {
    // The relay delivers only the chosen track; trackLangs/trackInfo describe the full stream.
    audioIndex = filteredIndex;
    pendingAudio = null;
    return;
  }
  const at = tracks();
  trackLangs = at ? Array.from({ length: at.length }, (_, i) => at[i].language) : [];
  if (!trackInfo && matchesPlayer(cachedTrackInfo(channel.id), trackLangs)) trackInfo = cachedTrackInfo(channel.id);
  const i = initialTrack();
  pendingAudio = null;
  if (i > 0 && trackInfo) {
    reloadWithTrack(i);
  } else if (i > 0 && !window.PalmServiceBridge) {
    selectTrack(i); // desktop browser: no relay, standard audioTracks API
  } else if (!trackInfo && trackLangs.length > 1) {
    loadTrackInfo(channel, i); // labels for the menu; switches to track i once its PID is known
  }
});

// Plays the given audio track by reloading the stream with it (see the note on audioIndex).
function selectAudio(i) {
  if (!channel || i < 0 || i >= trackLangs.length || i === activeIndex()) return;
  // Audio description or multilingual tracks must not become the default language for other channels.
  if (isRealLanguage(trackLangs[i])) settings.set('audioLang', trackLangs[i]);
  reloadWithTrack(i);
}
// Capture phase also catches errors from the <source> child, which do not bubble.
video.addEventListener('error', () => scheduleRetry('error'), true);
video.addEventListener('ended', () => scheduleRetry('ended'));

// Stall watchdog: a live stream whose clock stops advancing gets reloaded.
setInterval(() => {
  if (!channel || retryTimer || document.hidden) return;
  if (video.currentTime !== lastTime) {
    lastTime = video.currentTime;
    stuckTicks = 0;
  } else if (++stuckTicks >= 4) {
    scheduleRetry('stalled');
  }
}, 3000);

export const player = {
  play,
  current: () => channel,
  stop() {
    channel = null;
    attach(null);
  },
  suspend() {
    if (pendingAudio === null && audioIndex) pendingAudio = audioIndex; // restored on resume
    attach(null);
  },
  resume() {
    if (channel) play(channel);
  },
  set onState(fn) {
    onState = fn;
  },
  set onTracks(fn) {
    onTracks = fn;
  },
  // Current audio track as { index, total, lang, label }, or null if the stream reports none.
  audioInfo,
  // All audio tracks of the current channel: [{ index, current, label: { name, purpose, codec } }].
  audioTracks: () => trackLangs.map((_, i) => ({ index: i, current: i === activeIndex(), label: labelOf(i) })),
  selectAudio,
  // Switches to the next audio track (colour-key shortcut); returns the new track's info for a toast.
  cycleAudio() {
    if (trackLangs.length < 2 || !channel) return null;
    selectAudio((activeIndex() + 1) % trackLangs.length);
    return { ...audioInfo(), text: labelText(audioInfo().label) };
  },
};
