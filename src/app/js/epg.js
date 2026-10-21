// Programme guide store. Loads the whole lineup in 6-hour blocks on demand.
import { api } from './api.js';
import { idFromSrc } from './channels.js';

const BLOCK = 6 * 3600000;
const KEEP_PAST = 12 * 3600000;

// `load(from, to)` resolves to raw API programme objects; injectable for tests.
export function createEpgStore(load) {
  const byChannel = new Map(); // channel id -> programmes sorted by start
  const seen = new Set(); // programme ids, to drop duplicates across block boundaries
  const blocks = new Map(); // block start -> 'loading' | 'done'
  const listeners = new Set();

  function add(items) {
    const touched = new Set();
    for (const it of items) {
      if (seen.has(it.pk)) continue;
      seen.add(it.pk);
      if (!it.channel || typeof it.channel !== 'object') continue;
      const chId = idFromSrc(it.channel.src);
      let arr = byChannel.get(chId);
      if (!arr) byChannel.set(chId, (arr = []));
      arr.push({
        id: it.pk,
        start: Date.parse(it.timeslot.lower),
        stop: Date.parse(it.timeslot.upper),
        title: it.title || '',
        sub: it.sub_title || '',
        desc: it.desc || '',
        cats: it.categories || [],
      });
      touched.add(arr);
    }
    touched.forEach((arr) => arr.sort((a, b) => a.start - b.start));
  }

  function prune(now = Date.now()) {
    const cutoff = now - KEEP_PAST;
    for (const [id, arr] of byChannel) {
      arr.filter((p) => p.stop < cutoff).forEach((p) => seen.delete(p.id));
      byChannel.set(
        id,
        arr.filter((p) => p.stop >= cutoff),
      );
    }
    for (const b of [...blocks.keys()]) if (b + BLOCK < cutoff) blocks.delete(b);
  }

  function ensure(from, to) {
    const jobs = [];
    for (let b = Math.floor(from / BLOCK) * BLOCK; b < to; b += BLOCK) {
      if (blocks.has(b)) continue;
      blocks.set(b, 'loading');
      jobs.push(
        load(b, b + BLOCK).then(
          (items) => {
            add(items);
            blocks.set(b, 'done');
            listeners.forEach((fn) => fn());
          },
          (e) => {
            blocks.delete(b); // retried on the next ensure()
            console.warn('[init7tv] EPG block failed', new Date(b).toISOString(), e);
          },
        ),
      );
    }
    return Promise.all(jobs);
  }

  const list = (id) => byChannel.get(id) || [];

  return {
    ensure,
    prune,
    onChange: (fn) => listeners.add(fn),
    at: (id, t) => list(id).find((p) => p.start <= t && t < p.stop) || null,
    range: (id, from, to) => list(id).filter((p) => p.stop > from && p.start < to),
    nowNext(id, t = Date.now()) {
      const arr = list(id);
      const i = arr.findIndex((p) => p.stop > t);
      if (i < 0) return {};
      return arr[i].start <= t ? { now: arr[i], next: arr[i + 1] } : { now: null, next: arr[i] };
    },
  };
}

export const epg = createEpgStore((from, to) => api.epg(from, to));
