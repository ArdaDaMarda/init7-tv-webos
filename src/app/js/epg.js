// Programme guide store. Loads the whole lineup in 6-hour blocks on demand.
import { api } from './api.js';
import { idFromSrc } from './channels.js';
import { parseEpisode } from './details.js';

const BLOCK = 6 * 3600000;
const KEEP_PAST = 12 * 3600000;

const REFRESH = 3 * 3600000; // schedules change: reload a block that is still relevant after this long
const REFRESH_RETRY = 5 * 60000;

// `load(from, to)` resolves to raw API programme objects; `clock` returns the time. Both injectable for tests.
export function createEpgStore(load, clock = Date.now) {
  const byChannel = new Map(); // channel id -> programmes sorted by start
  const byId = new Map(); // programme id -> programme, to update in place and drop duplicates across blocks
  const blocks = new Map(); // block start -> { loading, at } (at = time of the last successful load, 0 if none)
  const listeners = new Set();

  function parse(it) {
    return {
      id: it.pk,
      chId: idFromSrc(it.channel.src),
      start: Date.parse(it.timeslot.lower),
      stop: Date.parse(it.timeslot.upper),
      title: it.title || '',
      sub: it.sub_title || '',
      desc: it.desc || '',
      cats: it.categories || [],
      country: it.country || '',
      episode: parseEpisode(it.episode_num),
      age: it.rating_system === 'age' ? Number(it.rating) || 0 : 0,
      subtitles: it.subtitles === true,
      credits: it.credits && it.credits.length ? it.credits : null,
    };
  }

  function remove(p) {
    byId.delete(p.id);
    const arr = byChannel.get(p.chId);
    if (arr) arr.splice(arr.indexOf(p), 1);
  }

  // Stores the result of load(from, to). Programmes the store has for that range which the API no
  // longer returns were cancelled or rescheduled, so they are dropped.
  function add(items, from, to) {
    const touched = new Set();
    const fresh = new Set();
    for (const it of items) {
      if (!it.channel || typeof it.channel !== 'object') continue;
      fresh.add(it.pk);
      const p = parse(it);
      const old = byId.get(p.id);
      if (old && old.chId === p.chId) {
        Object.assign(old, p);
        touched.add(byChannel.get(p.chId));
        continue;
      }
      if (old) remove(old);
      let arr = byChannel.get(p.chId);
      if (!arr) byChannel.set(p.chId, (arr = []));
      arr.push(p);
      byId.set(p.id, p);
      touched.add(arr);
    }
    for (const p of [...byId.values()]) {
      if (p.stop >= from && p.start <= to && !fresh.has(p.id)) remove(p);
    }
    touched.forEach((arr) => arr.sort((x, y) => x.start - y.start));
  }

  function prune(now = clock()) {
    const cutoff = now - KEEP_PAST;
    for (const p of [...byId.values()]) if (p.stop < cutoff) remove(p);
    for (const blockStart of [...blocks.keys()]) if (blockStart + BLOCK < cutoff) blocks.delete(blockStart);
  }

  function ensure(from, to) {
    const jobs = [];
    const now = clock();
    for (let b = Math.floor(from / BLOCK) * BLOCK; b < to; b += BLOCK) {
      let block = blocks.get(b);
      // Loaded blocks are reloaded once they are stale, unless they lie entirely in the past.
      if (block && (block.loading || now - block.at < REFRESH || b + BLOCK < now)) continue;
      if (!block) blocks.set(b, (block = { loading: false, at: 0 }));
      block.loading = true;
      const entry = block;
      jobs.push(
        load(b, b + BLOCK).then(
          (items) => {
            add(items, b, b + BLOCK);
            entry.loading = false;
            entry.at = clock();
            listeners.forEach((fn) => fn());
          },
          (e) => {
            entry.loading = false;
            // A failed first load is retried on the next ensure(); a failed refresh keeps the old data for a while.
            if (!entry.at) blocks.delete(b);
            else entry.at = clock() - REFRESH + REFRESH_RETRY;
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
