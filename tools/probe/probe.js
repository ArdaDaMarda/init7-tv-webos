// TV7 probe: checks API access (CORS), native HLS playback of the various
// codec mixes Init7 delivers, channel start-up time, and audio track handling.
(function () {
  'use strict';

  var API = 'https://api.tv.init7.net/api/';
  var LIVE = API + 'live/?channel=';

  // Codec mixes measured from the PC (MPEG-TS PMT).
  var TESTS = [
    { key: '1', name: 'SRF 1',     codecs: 'H.264 + 3x AC-3',          src: LIVE + 'b87abb69-d5ed-44c5-8cab-0f7be4ef51b1' },
    { key: '2', name: 'ZDF',       codecs: 'H.264 + MP2 + AC-3',       src: LIVE + '002337ea-1f64-4abf-8ce1-a0d7cb689829' },
    { key: '3', name: 'ProSieben', codecs: 'MPEG-2 + MP2 + AC-3',      src: LIVE + 'ca04b190-a8ec-4904-8ed9-0e608ed0ee85' },
    { key: '4', name: 'BBC One',   codecs: 'MPEG-2 + MP2 (+NAR track)', src: LIVE + 'ce7344c0-3647-4e9b-9f57-98783bb37081' },
    { key: '5', name: 'TeleZüri',  codecs: 'H.264 + MP2',              src: LIVE + '6b5ee3ca-91c4-416d-9c2c-c4fdf1a427bc' },
    { key: '9', name: 'SRF 1 multicast', codecs: 'raw UDP multicast',  src: 'udp://@233.50.230.80:5000' }
  ];

  var video = document.getElementById('video');
  var logEl = document.getElementById('log');
  var t0 = 0;
  var current = null;

  function log(msg, cls) {
    var line = document.createElement('div');
    line.className = cls || 'info';
    line.textContent = new Date().toLocaleTimeString() + '  ' + msg;
    logEl.insertBefore(line, logEl.firstChild);
    while (logEl.childNodes.length > 22) logEl.removeChild(logEl.lastChild);
    console.log('[TV7] ' + msg);
  }

  function elapsed() {
    return ((performance.now() - t0) / 1000).toFixed(2) + ' s';
  }

  document.getElementById('keys').textContent =
    TESTS.map(function (t) { return t.key + '  ' + t.name + '  (' + t.codecs + ')'; }).join('\n') +
    '\nUP/DOWN  cycle audio track     0  stop     6  re-run API test';

  // --- API / CORS test ---------------------------------------------------
  function apiTest() {
    t0 = performance.now();
    if (!window.fetch) log('fetch() not available on this webOS version (XHR only)', 'bad');
    else fetch(API + 'v4/allowed/', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) { log('fetch allowed/ OK in ' + elapsed() + ': ' + JSON.stringify(j), 'ok'); })
      .catch(function (e) { log('fetch allowed/ FAILED (CORS?): ' + e, 'bad'); });

    var xhr = new XMLHttpRequest();
    xhr.open('GET', API + 'epg/?limit=1&channel=b87abb69-d5ed-44c5-8cab-0f7be4ef51b1&stop__gte=' + new Date().toISOString());
    xhr.onload = function () {
      try {
        var r = JSON.parse(xhr.responseText).results[0];
        log('XHR epg/ OK: now on SRF 1 = "' + r.title + '"', 'ok');
      } catch (e) { log('XHR epg/ status ' + xhr.status + ', parse error ' + e, 'bad'); }
    };
    xhr.onerror = function () { log('XHR epg/ FAILED (CORS?)', 'bad'); };
    xhr.send();
  }

  // --- Playback test -----------------------------------------------------
  function play(test) {
    current = test;
    log('--- ' + test.name + ' [' + test.codecs + ']');
    t0 = performance.now();
    video.removeAttribute('src');
    while (video.firstChild) video.removeChild(video.firstChild);
    var source = document.createElement('source');
    source.src = test.src;
    if (test.src.indexOf('http') === 0) source.type = 'application/vnd.apple.mpegurl';
    video.appendChild(source);
    video.load();
    var p = video.play();
    if (p && p.catch) p.catch(function (e) { log('play() rejected: ' + e, 'bad'); });
  }

  function describeTracks() {
    var at = video.audioTracks;
    if (!at) { log('video.audioTracks not supported', 'bad'); return; }
    var parts = [];
    for (var i = 0; i < at.length; i++) {
      parts.push(i + ':' + (at[i].language || '?') + (at[i].label ? '/' + at[i].label : '') + (at[i].enabled ? '*' : ''));
    }
    log('audio tracks (' + at.length + '): ' + parts.join('  '));
  }

  function cycleAudio(dir) {
    var at = video.audioTracks;
    if (!at || at.length < 2) { log('no alternative audio tracks'); return; }
    var cur = 0;
    for (var i = 0; i < at.length; i++) if (at[i].enabled) cur = i;
    var next = (cur + dir + at.length) % at.length;
    for (var j = 0; j < at.length; j++) at[j].enabled = (j === next);
    describeTracks();
  }

  video.addEventListener('loadedmetadata', function () {
    log('loadedmetadata after ' + elapsed() + ' (' + video.videoWidth + 'x' + video.videoHeight + ')');
  });
  video.addEventListener('playing', function () {
    log('PLAYING after ' + elapsed() + (current ? ' - ' + current.name : ''), 'ok');
    describeTracks();
  });
  video.addEventListener('waiting', function () { log('waiting (buffering) at ' + elapsed()); });
  video.addEventListener('error', function () {
    var e = video.error;
    log('video error code ' + (e ? e.code : '?') + (e && e.message ? ': ' + e.message : ''), 'bad');
  });
  // <source> errors fire on the source element, not the video.
  video.addEventListener('error', function (ev) {
    if (ev.target && ev.target.tagName === 'SOURCE') log('source error (format/codec rejected?)', 'bad');
  }, true);

  // --- Remote control ----------------------------------------------------
  document.addEventListener('keydown', function (ev) {
    var k = ev.keyCode;
    var digit = (k >= 48 && k <= 57) ? String(k - 48) : (k >= 96 && k <= 105) ? String(k - 96) : null;
    if (digit === '0') { video.pause(); video.removeAttribute('src'); while (video.firstChild) video.removeChild(video.firstChild); video.load(); log('stopped'); return; }
    if (digit === '6') { apiTest(); return; }
    if (digit) {
      for (var i = 0; i < TESTS.length; i++) if (TESTS[i].key === digit) { play(TESTS[i]); return; }
    }
    if (k === 38) cycleAudio(-1);       // up
    else if (k === 40) cycleAudio(1);   // down
  });

  log('TV7 probe started. UA: ' + navigator.userAgent);
  apiTest();
})();
