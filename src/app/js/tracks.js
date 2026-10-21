// Audio track descriptions. webOS only reports a language code per track and Init7's HLS drops the
// broadcasters' descriptors, so the relay reads them from the channel's multicast PMT (/info/<group>).
import { relay } from './relay.js';
import { langName } from './util.js';

const TTL = 30 * 60000;
const cache = new Map(); // channel id -> { audio, time }

// Track info for a channel from the relay, or null (no relay, timeout, no PMT).
export async function fetchTrackInfo(channelId) {
  const hit = cache.get(channelId);
  if (hit && Date.now() - hit.time < TTL) return hit.audio;
  await relay.ready();
  const r = await fetch(relay.infoUrl(channelId));
  const { audio } = await r.json();
  if (audio) cache.set(channelId, { audio, time: Date.now() });
  return audio || null;
}

export const cachedTrackInfo = (channelId) => {
  const hit = cache.get(channelId);
  return hit && Date.now() - hit.time < TTL ? hit.audio : null;
};

// Codes that don't name a real language: miscellaneous, multiple, undetermined and the ISO 639
// local-use range qaa–qtz (e.g. "qks" for clear speech). Broadcasters use them for special tracks,
// while Init7's HLS remux relabels the same tracks as "de".
const isSpecial = (code) => /^(mis|mul|und|zxx|nar|q[a-t][a-z])$/i.test(code || '');

const sameLang = (a, b) =>
  !a || !b || isSpecial(a) || isSpecial(b) || a === b || langName(a) === langName(b) || a.slice(0, 2) === b.slice(0, 2);

// The multicast description only applies if it lines up with what the player reports
// (HLS is a remux of the multicast stream; same tracks in the same order expected).
export function matchesPlayer(info, playerLangs) {
  return !!info && info.length === playerLangs.length && info.every((t, i) => sameLang(t.lang, playerLangs[i]));
}

const PURPOSE = {
  description: 'Audio description',
  clear: 'Clean audio',
  'spoken-subtitles': 'Spoken subtitles',
  'music-effects': 'Music & effects',
};

function codecLabel(t) {
  const multi = t.channels === '5.1' ? ' 5.1' : '';
  if (t.codec === 'AC-3') return 'Dolby Digital' + multi;
  if (t.codec === 'E-AC-3') return 'Dolby Digital Plus' + multi;
  return t.codec || '';
}

// { name, purpose, codec } for display; `info` may be missing (then only the language is known).
// The name prefers a real language code from either source; special codes are shown only if
// nothing better is known.
export function trackLabel(playerLang, info) {
  const pmtLang = info && info.lang;
  const lang = [pmtLang, playerLang].find((c) => c && !isSpecial(c)) || pmtLang || playerLang;
  return {
    name: langName(lang),
    purpose: (info && PURPOSE[info.purpose]) || '',
    codec: info ? codecLabel(info) : '',
  };
}

export const labelText = (l) => [l.name, l.purpose].filter(Boolean).join(' · ');
