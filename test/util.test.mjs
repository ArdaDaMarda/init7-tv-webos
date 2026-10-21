import assert from 'node:assert/strict';
import { test } from 'node:test';
import { esc, isRealLanguage, langName, progress } from '../src/app/js/util.js';

test('esc escapes HTML from API text', () => {
  assert.equal(esc('<b>"Tom" & \'Jerry\'</b>'), '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
});

test('progress is clamped to 0..100', () => {
  const p = { start: 1000, stop: 2000 };
  assert.equal(progress(p, 500), 0);
  assert.equal(progress(p, 1500), 50);
  assert.equal(progress(p, 9999), 100);
});

test('langName maps DVB codes', () => {
  assert.equal(langName('deu'), 'Deutsch');
  assert.equal(langName('NAR'), 'Audio description');
  assert.equal(langName('xyz'), 'XYZ'); // unknown codes are shown as the code
  assert.equal(langName(''), 'Unknown');
});

test('audio description / multilingual tracks are not real languages', () => {
  assert.ok(isRealLanguage('deu'));
  for (const c of ['NAR', 'qad', 'mul', 'qaa', 'und', '', undefined]) assert.ok(!isRealLanguage(c), String(c));
});
