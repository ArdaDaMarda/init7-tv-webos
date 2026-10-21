import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEpgStore } from '../src/app/js/epg.js';

const H = 3600000;
const T0 = Date.UTC(2026, 9, 19, 0, 0); // block-aligned (6 h blocks)
const CH = { src: 'udp://@233.50.230.80:5000' };
const ID = '233.50.230.80:5000';

const prog = (pk, startH, stopH, title = pk) => ({
  pk,
  channel: CH,
  timeslot: { lower: new Date(T0 + startH * H).toISOString(), upper: new Date(T0 + stopH * H).toISOString() },
  title,
  sub_title: '',
  desc: '',
  categories: [],
});

function storeWith(programmes) {
  const calls = [];
  const store = createEpgStore(async (from, to) => {
    calls.push([from, to]);
    return programmes.filter((p) => Date.parse(p.timeslot.upper) >= from && Date.parse(p.timeslot.lower) <= to);
  });
  return { store, calls };
}

test('loads 6 h blocks once and dedupes programmes spanning block borders', async () => {
  const { store, calls } = storeWith([prog('a', 1, 2), prog('b', 5, 7), prog('c', 7, 8)]);
  await store.ensure(T0, T0 + 12 * H);
  await store.ensure(T0 + H, T0 + 2 * H); // already loaded
  assert.equal(calls.length, 2);
  assert.deepEqual(
    store.range(ID, T0, T0 + 12 * H).map((p) => p.id),
    ['a', 'b', 'c'],
  );
});

test('at / nowNext / range', async () => {
  const { store } = storeWith([prog('a', 1, 2), prog('b', 2, 3), prog('c', 4, 5)]);
  await store.ensure(T0, T0 + 6 * H);
  assert.equal(store.at(ID, T0 + 1.5 * H).id, 'a');
  assert.equal(store.at(ID, T0 + 3.5 * H), null);
  const nn = store.nowNext(ID, T0 + 1.5 * H);
  assert.deepEqual([nn.now.id, nn.next.id], ['a', 'b']);
  const gap = store.nowNext(ID, T0 + 3.5 * H);
  assert.deepEqual([gap.now, gap.next.id], [null, 'c']);
  assert.deepEqual(store.nowNext('unknown'), {});
  assert.deepEqual(
    store.range(ID, T0 + 1.5 * H, T0 + 4.5 * H).map((p) => p.id),
    ['a', 'b', 'c'],
  );
});

test('a failed block is retried on the next ensure()', async () => {
  let fail = true;
  const store = createEpgStore(async () => {
    if (fail) throw new Error('offline');
    return [prog('a', 1, 2)];
  });
  await store.ensure(T0, T0 + H);
  assert.equal(store.at(ID, T0 + 1.5 * H), null);
  fail = false;
  await store.ensure(T0, T0 + H);
  assert.equal(store.at(ID, T0 + 1.5 * H).id, 'a');
});

test('prune drops programmes older than 12 h and notifies listeners on load', async () => {
  const { store } = storeWith([prog('old', 0, 1), prog('new', 20, 21)]);
  let changes = 0;
  store.onChange(() => changes++);
  await store.ensure(T0, T0 + 24 * H);
  assert.ok(changes > 0);
  store.prune(T0 + 22 * H);
  assert.deepEqual(
    store.range(ID, T0, T0 + 24 * H).map((p) => p.id),
    ['new'],
  );
});
