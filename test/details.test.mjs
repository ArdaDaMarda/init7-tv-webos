import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creditsText, episodeText, metaParts, parseEpisode } from '../src/app/js/details.js';

test('parseEpisode reads zero-based xmltv_ns numbers', () => {
  assert.deepEqual(parseEpisode('6.0.'), { season: 7, episode: 1, total: 0 });
  assert.deepEqual(parseEpisode('3.4/5.'), { season: 4, episode: 5, total: 5 });
  assert.deepEqual(parseEpisode('7..'), { season: 8, episode: 0, total: 0 });
  assert.deepEqual(parseEpisode('.12.'), { season: 0, episode: 13, total: 0 });
  assert.deepEqual(parseEpisode('8.224.0/1'), { season: 9, episode: 225, total: 0 });
});

test('parseEpisode drops years in the season slot and rejects junk', () => {
  assert.equal(parseEpisode('2025..'), null);
  assert.deepEqual(parseEpisode('2025.3.'), { season: 0, episode: 4, total: 0 });
  assert.equal(parseEpisode('..'), null);
  assert.equal(parseEpisode(null), null);
  assert.equal(parseEpisode('S01E02'), null);
});

test('episodeText', () => {
  assert.equal(episodeText({ season: 4, episode: 5, total: 5 }), 'S4 E5/5');
  assert.equal(episodeText({ season: 8, episode: 0, total: 0 }), 'S8');
  assert.equal(episodeText({ season: 0, episode: 13, total: 0 }), 'E13');
  assert.equal(episodeText(null), '');
});

test('metaParts lists only the facts that exist', () => {
  const base = { start: 0, stop: 90 * 60000, cats: [], country: '', episode: null, age: 0, subtitles: false };
  assert.deepEqual(metaParts(base), ['90 min']);
  assert.deepEqual(
    metaParts({
      ...base,
      cats: ['Series', 'Crime'],
      country: 'Deutschland',
      episode: { season: 2, episode: 3, total: 0 },
      age: 12,
      subtitles: true,
    }),
    ['90 min', 'Series, Crime', 'S2 E3', 'Deutschland', '12+', 'Subtitles'],
  );
});

test('creditsText groups by role and caps long casts', () => {
  const credits = [
    { position: 'actor', name: 'A' },
    { position: 'writer', name: 'W' },
    { position: 'director', name: 'D' },
    { position: 'actor', name: 'B' },
    { position: 'actor', name: 'C' },
  ];
  assert.equal(creditsText(credits), 'With A, B, C · Director: D');
  assert.equal(creditsText(credits, 2), 'With A, B +1 · Director: D');
  assert.equal(creditsText([{ position: 'host', name: 'H' }]), 'Host: H');
  assert.equal(creditsText([{ position: 'writer', name: 'W' }]), '');
  assert.equal(creditsText(null), '');
});
