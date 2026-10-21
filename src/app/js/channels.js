// Channel lineup and favourites. Channel ids are multicast addresses ("233.50.230.80:5000"),
// the one key shared by the M3U, the channel API and the EPG.
import { settings } from './settings.js';

export const idFromSrc = (src) => String(src || '').replace(/^\w+:\/\/@?/, '');

function fromApi(c) {
  return { id: idFromSrc(c.src), name: c.name, logo: c.logo, group: c.language || '', hls: c.hls_src };
}

// Full lineup from Init7's multicast M3U; HLS URLs from the API where Init7 offers them
// (the other channels are multicast only and play through the on-TV relay).
export function buildLineup(m3u, apiChannels) {
  const api = apiChannels
    .filter((c) => c.visible !== false && c.has_hls !== false && c.hls_src)
    .sort((a, b) => a.langordernum - b.langordernum || a.ordernum - b.ordernum)
    .map(fromApi);
  const hls = new Map(api.map((c) => [c.id, c.hls]));
  const list = [];
  let info = null;
  for (const raw of String(m3u || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF')) {
      info = line;
    } else if (info && /^(udp|rtp):\/\//.test(line)) {
      const attr = (k) => (new RegExp(k + '="([^"]*)"').exec(info) || [])[1] || '';
      const id = idFromSrc(line);
      if (!list.some((c) => c.id === id)) {
        list.push({
          id,
          name: info.slice(info.indexOf(',', info.lastIndexOf('"')) + 1).trim(),
          logo: attr('tvg-logo'),
          group: attr('group-title'),
          hls: hls.get(id) || null,
        });
      }
      info = null;
    }
  }
  // HLS channels missing from the M3U (or no M3U at all) are appended so nothing gets lost.
  api.forEach((c) => {
    if (!list.some((x) => x.id === c.id)) list.push(c);
  });
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
