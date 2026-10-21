// App-wide constants. __APP_ID__ / __APP_VERSION__ are injected by the build (scripts/build.mjs,
// from package.json); the fallbacks apply when modules run unbundled, e.g. in unit tests.
/* global __APP_ID__, __APP_VERSION__ */
export const APP_ID = typeof __APP_ID__ !== 'undefined' ? __APP_ID__ : 'local.init7tv.dev';
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';

// The relay service is packaged with the app; webOS requires its id to start with the app id.
export const RELAY_SERVICE = APP_ID + '.relay';

export const API_BASE = 'https://api.tv.init7.net/api/';
export const M3U_URL = 'https://api.init7.net/tvchannels.m3u';
export const DEFAULT_LANG_ORDER = 'de';
