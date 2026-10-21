// Init7 TV7 REST API (the endpoints the official Android TV app uses).
// Access is granted by the client's Init7 IP address; no login is involved.
import { API_BASE, M3U_URL } from './config.js';

async function getJson(url, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (attempt >= retries) throw e;
      await new Promise((res) => setTimeout(res, 1000 * (attempt + 1)));
    }
  }
}

// Django REST pagination: the first page reports the total count, the rest is fetched in parallel.
async function getAll(path, params, pageSize) {
  const url = (offset) => API_BASE + path + '?' + new URLSearchParams({ ...params, limit: pageSize, offset });
  const first = await getJson(url(0));
  const offsets = [];
  for (let o = pageSize; o < first.count; o += pageSize) offsets.push(o);
  const rest = await Promise.all(offsets.map((o) => getJson(url(o))));
  return first.results.concat(...rest.map((p) => p.results));
}

const iso = (ms) => new Date(ms).toISOString();

export const api = {
  allowed: () => getJson(API_BASE + 'v4/allowed/'),
  // Channels Init7 offers as HLS (102); the full lineup comes from the M3U.
  channels: (lang) => getAll('tvchannel/', { lang_order: lang }, 200),
  // All programmes overlapping [from, to] across every channel.
  epg: (from, to) => getAll('epg/', { stop__gte: iso(from), start__lte: iso(to) }, 500),
  // Complete lineup incl. multicast-only channels, in Init7's channel order.
  async m3u() {
    const r = await fetch(M3U_URL);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  },
};
