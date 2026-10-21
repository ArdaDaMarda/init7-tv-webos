# Init7 TV7 API notes

These are the public endpoints the app uses, as observed while building it. They are **undocumented and may change**.
Access is granted by the client's IP address: the client must be on an Init7 connection (IPv4 or IPv6). There is
no login, no API key and no DRM.

Base URL: `https://api.tv.init7.net/api/`. Lists use Django REST pagination
(`?limit=&offset=` → `{ count, next, previous, results }`).

| Endpoint | Used for | Notes |
|---|---|---|
| `GET v4/allowed/` | Access check | `{ ip, allowed, authenticated, replay_grant, feature_flags }` |
| `GET tvchannel/?lang_order=de&limit=200` | Channels with HLS (102) | `pk`, `name`, `src` (`udp://@233.50.230.x:5000`), `hls_src`, `has_hls`, `logo`, `ordernum`, `langordernum`, `language`, `has_replay` |
| `GET epg/?stop__gte=<iso>&start__lte=<iso>&limit=500` | Programme guide, all channels | Optional `channel=<pk>`. Each entry: `pk`, `timeslot {lower, upper}`, `title`, `sub_title`, `desc`, `categories`, and a nested `channel` object (including its `src`) |
| `GET live/?channel=<pk>` | HLS playlist | MPEG-TS segments of ~6 s. Returns **HTTP 410** for multicast-only channels |
| `https://api.init7.net/tvchannels.m3u` | Full lineup (242) | `tvg-logo`, `tvg-name`, `group-title` (language), multicast URL |

Not used: `replay/` (needs a replay entitlement), `chunk/`, `credit/`.

## Streams

- HLS: `#EXT-X-VERSION:6` with 6 s TS segments from `*.cache.tv.init7.net`
- Multicast: raw MPEG-TS over UDP, `233.50.230.0/24`, port 5000
- Codecs are broadcast originals (see [decisions](DECISIONS.md#codecs))
- HLS is a remux with renumbered PIDs (audio from 257) and without the audio purpose descriptors. Multicast keeps the
  original PIDs and descriptors (e.g. Das Erste: "Audio description for the visually impaired", "Clean audio for
  the hearing impaired") plus DVB teletext.
