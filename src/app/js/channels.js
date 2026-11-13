// Channel lineup and favourites. Channel ids are multicast addresses ("233.50.230.80:5000"),
// the one key shared by the M3U, the channel API and the EPG.
import { settings } from './settings.js';

export const idFromSrc = (src) => String(src || '').replace(/^\w+:\/\/@?/, '');

function fromApi(c) {
  return { id: idFromSrc(c.src), name: c.name, logo: c.logo, group: c.language || '', hls: c.hls_src };
}

// The multicast address the relay plays a channel from. It differs from `id` for the Full HD channels,
// whose `id` stays the regular channel's (EPG, favourites and the last channel are keyed by it).
export const streamId = (ch) => ch.stream || ch.id;

// Entries of an M3U playlist: { url, name, attr(key) } for each #EXTINF line followed by a URL.
function parseM3u(text) {
  const out = [];
  let info = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF')) {
      info = line;
    } else if (info && /^(udp|rtp|https?):\/\//.test(line)) {
      const i = info;
      out.push({
        url: line,
        name: i.slice(i.indexOf(',', i.lastIndexOf('"')) + 1).trim(),
        attr: (k) => (new RegExp(k + '="([^"]*)"').exec(i) || [])[1] || '',
      });
      info = null;
    }
  }
  return out;
}

// Init7's Full HD lists ({ mc, hls }) replace the stream of the matching channel (same `tvg-name`,
// e.g. "SRF1.ch"); name, number and id stay the same.
function applyFhd(list, fhd, tvgNames) {
  const byName = new Map();
  const entry = (name) => byName.get(name) || byName.set(name, {}).get(name);
  parseM3u(fhd.mc).forEach((e) => {
    if (/^(udp|rtp):/.test(e.url) && e.attr('tvg-name')) entry(e.attr('tvg-name')).mc = idFromSrc(e.url);
  });
  parseM3u(fhd.hls).forEach((e) => {
    if (/^https:/.test(e.url) && e.attr('tvg-name')) entry(e.attr('tvg-name')).hls = e.url;
  });
  list.forEach((c) => {
    const f = byName.get(tvgNames.get(c.id));
    if (!f) return;
    if (f.mc) c.stream = f.mc;
    if (f.hls) c.hls = f.hls;
  });
}

// Full lineup from Init7's multicast M3U; HLS URLs from the API where Init7 offers them
// (the other channels are multicast only and play through the on-TV relay).
export function buildLineup(m3u, apiChannels, fhd = {}) {
  const api = apiChannels
    .filter((c) => c.visible !== false && c.has_hls !== false && c.hls_src)
    .sort((a, b) => a.langordernum - b.langordernum || a.ordernum - b.ordernum)
    .map(fromApi);
  const hls = new Map(api.map((c) => [c.id, c.hls]));
  const list = [];
  const tvgNames = new Map();
  for (const e of parseM3u(m3u)) {
    if (!/^(udp|rtp):/.test(e.url)) continue;
    const id = idFromSrc(e.url);
    if (list.some((c) => c.id === id)) continue;
    list.push({ id, name: e.name, logo: e.attr('tvg-logo'), group: e.attr('group-title'), hls: hls.get(id) || null });
    tvgNames.set(id, e.attr('tvg-name'));
  }
  // HLS channels missing from the M3U (or no M3U at all) are appended so nothing gets lost.
  api.forEach((c) => {
    if (!list.some((x) => x.id === c.id)) list.push(c);
  });
  applyFhd(list, fhd, tvgNames);
  list.forEach((c, i) => (c.num = i + 1));
  return list;
}

let all = [];
const byId = new Map();
const favs = new Set(settings.get('favourites', []));

export const channels = {
  set(list) {
    all = list;
    byId.clear();
    list.forEach((c) => byId.set(c.id, c));
  },
  all: () => all,
  byId: (id) => byId.get(id) || null,
  favourites: () => all.filter((c) => favs.has(c.id)),
  isFav: (id) => favs.has(id),
  toggleFav(id) {
    if (favs.has(id)) favs.delete(id);
    else favs.add(id);
    settings.set('favourites', [...favs]);
    return favs.has(id);
  },
};
