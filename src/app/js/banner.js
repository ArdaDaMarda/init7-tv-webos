// Channel info banner: logo, now/next, progress. Expanded mode adds the description.
import { channels } from './channels.js';
import { epg } from './epg.js';
import { esc, hhmm, progress } from './util.js';

const root = document.getElementById('banner');
let channel = null;
let expanded = false;
let timer = 0;

function render() {
  if (!channel) return;
  const { now, next } = epg.nowNext(channel.id);
  const fav = channels.isFav(channel.id) ? '<span class="fav">★</span>' : '';
  const nowHtml = now
    ? `<div class="b-now">
        <div class="b-time">${hhmm(now.start)} – ${hhmm(now.stop)}</div>
        <div class="b-title">${esc(now.title)}</div>
        ${now.sub ? `<div class="b-sub">${esc(now.sub)}</div>` : ''}
        <div class="progress"><div style="width:${progress(now).toFixed(1)}%"></div></div>
        ${expanded && now.desc ? `<div class="b-desc">${esc(now.desc)}</div>` : ''}
      </div>`
    : '<div class="b-now"><div class="b-title dim">No programme information</div></div>';

  root.innerHTML = `
    <div class="b-head">
      <div class="logo"><img src="${esc(channel.logo)}" alt=""></div>
      <div class="b-chan"><span class="b-num">${channel.num}</span><span class="b-name">${esc(channel.name)}</span>${fav}</div>
      <div class="b-clock">${hhmm(Date.now())}</div>
    </div>
    ${nowHtml}
    ${next ? `<div class="b-next">Next <b>${hhmm(next.start)}</b> ${esc(next.title)}</div>` : ''}
    <div class="hints">
      <span><i class="key">OK</i>Channels</span>
      <span><i class="key">▲▼</i>Switch</span>
      <span><i class="key">◀</i>TV guide</span>
      <span><i class="key">▶</i>Audio · Favourite · Details</span>
    </div>`;
}

function hide() {
  clearTimeout(timer);
  root.classList.add('hidden');
  expanded = false;
}

function show(ch, opts = {}) {
  channel = ch || channel;
  expanded = !!opts.expanded;
  render();
  root.classList.remove('hidden');
  clearTimeout(timer);
  timer = setTimeout(hide, expanded ? 15000 : 6000);
}

const visible = () => !root.classList.contains('hidden');

export const banner = {
  show,
  hide,
  visible,
  refresh() {
    if (visible()) render();
  },
  toggleDetails() {
    if (visible() && expanded) hide();
    else show(channel, { expanded: true });
  },
};
