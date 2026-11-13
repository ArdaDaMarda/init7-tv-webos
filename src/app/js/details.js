// Programme details: turns the EPG's optional fields into short display strings. Pure, no DOM.

// xmltv_ns is "season.episode/total.part", all zero-based, any part may be empty ("7..", "3.4/5.").
// Some broadcasters put a year into the season slot ("2025.."); that is not a season number, so it is dropped.
export function parseEpisode(ns) {
  const m = /^\s*(\d+)?(?:\/\d+)?\s*\.\s*(\d+)?(?:\/(\d+))?\s*\./.exec(ns || '');
  if (!m) return null;
  const season = m[1] !== undefined && Number(m[1]) < 1900 ? Number(m[1]) + 1 : 0;
  const episode = m[2] !== undefined ? Number(m[2]) + 1 : 0;
  const total = m[3] !== undefined ? Number(m[3]) : 0;
  return season || episode ? { season, episode, total } : null;
}

export function episodeText(ep) {
  if (!ep) return '';
  const parts = [];
  if (ep.season) parts.push('S' + ep.season);
  if (ep.episode) parts.push('E' + ep.episode + (ep.total >= ep.episode ? '/' + ep.total : ''));
  return parts.join(' ');
}

// Facts for the meta line, in display order. Each entry is plain text (escape before inserting into HTML).
export function metaParts(p) {
  const parts = [];
  const mins = Math.round((p.stop - p.start) / 60000);
  if (mins > 0) parts.push(mins + ' min');
  if (p.cats && p.cats.length) parts.push(p.cats.join(', '));
  const ep = episodeText(p.episode);
  if (ep) parts.push(ep);
  if (p.country) parts.push(p.country);
  if (p.age > 0) parts.push(p.age + '+');
  if (p.subtitles) parts.push('Subtitles');
  return parts;
}

const ROLES = [
  ['host', 'Host'],
  ['actor', 'With'],
  ['guest', 'Guests'],
  ['director', 'Director'],
];

// "With A, B, C · Director: D". At most `max` names per role, the rest is summarised as "+n".
export function creditsText(credits, max = 4) {
  if (!credits || !credits.length) return '';
  const out = [];
  for (const [role, label] of ROLES) {
    const names = credits.filter((c) => c.position === role && c.name).map((c) => c.name);
    if (!names.length) continue;
    const shown = names.slice(0, max).join(', ') + (names.length > max ? ' +' + (names.length - max) : '');
    out.push(label + (label === 'With' ? ' ' : ': ') + shown);
  }
  return out.join(' · ');
}
