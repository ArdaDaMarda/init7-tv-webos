// Native webOS media pipeline. The streams are DVB passthrough (MPEG-2/H.264 video,
// MP2/AC-3 audio), which only the TV's hardware player decodes - not hls.js/MSE.
// It plays both HLS and the relay's plain MPEG-TS over HTTP.
import { actions } from './actions.js';
import { streamId } from './channels.js';
import { lunaCall } from './luna.js';
import { relay } from './relay.js';
import { settings } from './settings.js';
import { cachedTrackInfo, fetchTrackInfo, labelText, matchesPlayer, trackLabel } from './tracks.js';
import { isRealLanguage } from './util.js';

const video = document.getElementById('video');
// The relay can deliver an HLS channel with a single audio track (only on the TV, where the relay runs).
const hlsFilter = (ch) => !!ch.hls && !!window.PalmServiceBridge;
let channel = null;
let retries = 0;
let retryTimer = 0;
let lastTime = -1;
let stuckTicks = 0;
let audioApplied = false;
// Audio track handling: switching tracks in the webOS pipeline (audioTracks or LG's selectTrack,
// during playback or right after the start) leads to silence, lost A/V sync or a frozen picture. So a
// non-default track is never switched to: the relay delivers the channel with only that audio track,
// which the player then plays as its default. For an HLS channel the relay fetches Init7's HLS segments
// and keeps the track by its index (/hls?track=<n>); for a multicast-only channel it filters the
// multicast stream by PID (?audio=<pid>). LG's selectTrack remains only as a fallback when a
// multicast-only channel's track PIDs are unknown. The active index is tracked here because
// webOS does not reflect either approach in video.audioTracks.
let audioIndex = 0;
let pendingAudio = null;
let filteredIndex = null; // track delivered alone by the relay in the current stream, if any
let trackLangs = []; // languages of the current channel's audio tracks, kept across reloads
let trackInfo = null; // broadcaster descriptions (incl. PIDs) from the multicast PMT, if they match trackLangs
// A single-track stream from the relay that fails to start twice in a row is given up: the channel plays
// its default track instead of retrying a stream that may never come (track gone, relay can't fetch).
const FILTER_ATTEMPTS = 2;
let filterFails = 0;
let filterGaveUp = false; // until the channel changes or a track is chosen by hand
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
  const viaHls = want > 0 && hlsFilter(ch);
  const pid = !viaHls && want > 0 && trackInfo && trackInfo[want] ? trackInfo[want].pid : null;
  filteredIndex = viaHls || pid ? want : null;
  if (ch.hls && !viaHls && !pid) {
    attach(ch.hls, 'application/vnd.apple.mpegurl');
    return;
  }
  attach(null);
  relay.ready().then(
    () => {
      if (channel !== ch) return;
      attach(viaHls ? relay.hlsUrl(ch.hls, want) : relay.url(streamId(ch), pid), 'video/mp2t');
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
    filterFails = 0;
    filterGaveUp = false;
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
  if (filteredIndex !== null && !audioApplied && ++filterFails >= FILTER_ATTEMPTS) {
    filterFails = 0;
    filterGaveUp = true;
    pendingAudio = 0;
    actions.toast('Audio track not available, playing the default track');
    onTracks();
  }
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
    const at = tracks() || []; // desktop browsers: standard API
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
  if (filterGaveUp) return 0;
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
  fetchTrackInfo(streamId(ch)).then(
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
    filterFails = 0;
    audioIndex = filteredIndex;
    pendingAudio = null;
    return;
  }
  const at = tracks();
  trackLangs = at ? Array.from({ length: at.length }, (_, i) => at[i].language) : [];
  if (!trackInfo && matchesPlayer(cachedTrackInfo(streamId(channel)), trackLangs))
    trackInfo = cachedTrackInfo(streamId(channel));
  const i = initialTrack();
  pendingAudio = null;
  if (i > 0 && (trackInfo || hlsFilter(channel))) {
    reloadWithTrack(i);
    if (!trackInfo) loadTrackInfo(channel, 0); // labels for the menu
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
  filterFails = 0;
  filterGaveUp = false;
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
    filterGaveUp = false; // the app was away for a while: try the remembered track again
    if (channel) play(channel);
  },
  // Restarts the current stream by hand (menu entry), keeping the chosen audio track.
  reload() {
    if (!channel) return;
    if (pendingAudio === null && audioIndex) pendingAudio = audioIndex;
    play(channel);
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
