# Init7 TV7 API notes

These are the public endpoints the app uses, as observed while building it. They are **undocumented and may change**.
Access is granted by the client's IP address: the client must be on an Init7 connection (IPv4 or IPv6). There is
no login, no API key and no DRM.

Base URL: `https://api.tv.init7.net/api/`. Lists use Django REST pagination
(`?limit=&offset=` → `{ count, next, previous, results }`).

| Endpoint | Used for | Notes |
|---|---|---|
| `GET v4/allowed/` | Access check | `{ ip, allowed, authenticated, replay_grant, feature_flags }`. Without a replay subscription: `authenticated: false`, `replay_grant: null` |
| `GET tvchannel/?lang_order=de&limit=200` | Channels with HLS (102) | `pk`, `name`, `canonical_name`, `hd`, `src` (`udp://@233.50.230.x:5000`), `hls_src`, `has_hls`, `logo`, `visible`, `ordernum`, `langordernum`, `country`, `language`, `has_replay`, `changed` |
| `GET epg/?stop__gte=<iso>&start__lte=<iso>&limit=500` | Programme guide, all channels | Optional `channel=<pk>`. Each entry: `pk`, `timeslot {lower, upper}`, `title`, `sub_title`, `desc`, `categories`, the [optional fields](#epg-fields) below, and a nested `channel` object (including its `src`) |
| `GET live/?channel=<pk>` | HLS playlist | MPEG-TS segments of ~6 s. Returns **HTTP 410** for multicast-only channels |
| `https://api.init7.net/tvchannels.m3u` | Full lineup (242) | `tvg-logo`, `tvg-name`, `group-title` (language), multicast URL |

Not used: `replay/` (needs a replay entitlement), `chunk/`, `credit/`. `GET /api/` lists the endpoints.

## EPG fields

A 6-hour window across all channels holds about 2,650 programmes, roughly 3 MB of JSON in 6 pages of 500 (measured
2026-11-13; the response was not compressed). Much of that is the full `channel` object repeated in every entry.

How often the optional fields were filled, in a sample of 500 current programmes:

| Field | Filled | Example / notes |
|---|---|---|
| `categories` | 88% | `["Series", "Crime"]`, English names |
| `country` | 78% | `"Deutschland"`, `"Vereinigte Staaten & Deutschland"` (free text) |
| `sub_title` | 72% | Episode title |
| `episode_num` + `episode_num_system` | 45% | Always `xmltv_ns`: zero-based `season.episode/total.part`, e.g. `"6.0."`, `"3.4/5."`, `"7.."`. Some entries carry a year as the season (`"2025.."`) |
| `rating` + `rating_system` | 26% | System is always `"age"`; rating `"0"`, `"7"`, `"12"`, `"16"` … |
| `subtitles` | 25% true | Boolean: the programme is broadcast with subtitles |
| `credits` | 19% | `[{ position, name }]` with `actor`, `director`, `host`, `guest`, `writer`, `producer`, `editor` |
| `date`, `icons`, `star_rating`, `premiere` | 0% | Present but never filled |

## Replay

Not implemented and not testable without a replay subscription; noted here from the official Android app (v1.2.5).

- Replay is a paid add-on. The official app links a device by QR code and PIN and then stores a token. Channels
  report `has_replay: true` only for accounts with a grant.
- A programme is played from `GET replay/?channel=<pk>&start=<iso>&stop=<iso>`, with the programme's EPG start and
  stop times. It is an HLS playlist like `live/`.
- With a grant, the official app plays even the *current* programme through this endpoint and queues the next
  programme behind it. That is how it offers pause, seek and restart on live TV.

## Streams

- HLS: `#EXT-X-VERSION:6` with 6 s TS segments from `*.cache.tv.init7.net`
- Multicast: raw MPEG-TS over UDP, `233.50.230.0/24`, port 5000
- Codecs are broadcast originals (see [decisions](DECISIONS.md#codecs))
- HLS is a remux with renumbered PIDs (audio from 257) and without the audio purpose descriptors. Multicast keeps the
  original PIDs and descriptors (e.g. Das Erste: "Audio description for the visually impaired", "Clean audio for
  the hearing impaired") plus DVB teletext.
