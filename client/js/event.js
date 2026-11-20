// Экран события недели: тема и задания, личные рубежи, таблица лидеров, награды по местам.
import { fmt, fmtTime, RACES } from '/shared/config.js';
import { EVENT_THEMES, MILESTONES, RANK_REWARDS, rankMedal } from '/shared/events.js';
import { resIcon, short } from './cityui.js';

const A = '/assets/realm/';
const M = (n) => `${A}meta/${n}.png`;
// баннеры темы (заменятся на арт события)
const BANNER = { hunt: 'e_hunt', build: 'e_build', gather: 'e_gather', muster: 'e_muster' };
const MEDAL = { gold: 'e_gold', silver: 'e_silver', bronze: 'e_bronze' };
const KEY_TEXT = { npc: 'победа над врагом на карте', wins: 'победа в налёте или сборе', help: 'помощь союзнику', upgrades: 'начатая стройка', research: 'изученная технология',
  gather: 'возвращение отряда со сбора', food: 'единица собранной еды', gold: 'единица собранного золота', trained: 'обученный воин' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const chips = (r) => Object.entries(r).filter(([k, v]) => v && !['frag', 'fragN'].includes(k)).map(([k, v]) => `<span class="ms-chip"><img src="${k === 'book' ? A + 'kit/book.png' : k === 'ticket' ? A + 'kit/ticket.png' : resIcon(k)}" alt="">${short(v)}</span>`).join('')
  + (r.frag ? `<span class="ms-chip"><img src="${A}kit/frag.png" alt="">${r.fragN} ${r.frag === 'legendary' ? 'легенды' : 'эпика'}</span>` : '');

export class WeekEvent {
  constructor(app) {
    this.app = app;
    this.root = document.createElement('div');
    this.root.id = 'event';
    this.root.className = 'meta-screen';
    this.root.innerHTML = `<div class="hs-top"><button class="hs-back" aria-label="Назад"><img src="${A}kit/back.png" alt=""></button><b class="hs-title">Событие недели</b><div class="hs-res"></div></div><div class="hs-body"></div><nav class="hs-tabs"></nav>`;
    document.body.appendChild(this.root);
    this.root.querySelector('.hs-back').onclick = () => this.root.classList.remove('show');
    this.tab = 'tasks';
  }
  get me() { return this.app.me; }
  async open(tab) { this.root.classList.add('show'); this.app.sfx('click'); await this.load(); this.show(tab || this.tab); }
  async load() { try { this.board = await this.app.api.event(); } catch { this.board = null; } }
  refresh() { if (this.root.classList.contains('show')) this.show(this.tab); this.badge(); }
  claimable() {
    const e = this.me?.event;
    if (!e) return false;
    return MILESTONES.some((m, i) => e.pts >= m.pts && !e.claimed.includes(i)) || (e.prev && !e.prev.rewarded);
  }
  badge() { setDot(document.querySelector('#btn-event'), this.claimable()); }

  show(tab) {
    this.tab = tab;
    const e = this.me.event;
    const nav = this.root.querySelector('.hs-tabs');
    const list = [['tasks', M('p_scroll'), 'Задания', this.claimable()], ['board', M('p_podium'), 'Таблица'], ['rewards', M('p_trophy'), 'Награды', e.prev && !e.prev.rewarded]];
    nav.innerHTML = list.map(([id, icon, name, dot]) => `<button data-t="${id}" class="${id === tab ? 'on' : ''}"><img src="${icon}" alt=""><span>${name}</span>${dot ? '<span class="rdot"></span>' : ''}</button>`).join('');
    nav.querySelectorAll('button').forEach((b) => { b.onclick = () => this.show(b.dataset.t); });
    ({ tasks: () => this.renderTasks(), board: () => this.renderBoard(), rewards: () => this.renderRewards() })[tab]();
  }
  body() { return this.root.querySelector('.hs-body'); }
  head() {
    const e = this.me.event, th = EVENT_THEMES.find((t) => t.id === e.theme);
    const left = Math.max(0, (e.ends - this.me.now) / 1000);
    const rank = this.board?.me?.rank;
    return `<div class="ev-banner"><img src="${M(BANNER[th.id])}" alt=""><i class="ev-timer">⏳ ${fmtTime(left)}</i><div class="ev-cap"><b>${th.name}</b><span>${th.text}</span></div></div>
      <div class="ev-me"><div><img src="${M('e_points')}" alt=""><span>Мои очки</span><b>${fmt(e.pts)}</b></div><div><img src="${M(rank && rank <= 10 ? MEDAL[rankMedal(rank)] : 'e_plate')}" alt=""><span>Место</span><b>${rank ? rank : '—'}</b></div><div><img src="${M('ai_members')}" alt=""><span>Участников</span><b>${fmt(this.board?.total || 0)}</b></div></div>`;
  }

  renderTasks() {
    const e = this.me.event, th = EVENT_THEMES.find((t) => t.id === e.theme);
    const ways = Object.entries(th.pts).map(([k, v]) => `<div class="ms-row"><span>✦ ${KEY_TEXT[k] || k}</span><b>+${v < 1 ? v : fmt(v)}</b></div>`).join('');
    const max = MILESTONES[MILESTONES.length - 1].pts;
    const ms = MILESTONES.map((m, i) => {
      const got = e.claimed.includes(i), ready = e.pts >= m.pts && !got;
      return `<div class="ev-ms ${ready ? 'ready' : ''} ${got ? 'got' : ''}"><div class="ev-post"><img src="${M(i === MILESTONES.length - 1 ? 'e_chest' : 'e_post')}" alt=""><b>${fmt(m.pts)}</b></div><div class="ms-chips">${chips(m.reward)}</div>
        <button class="nbtn xs" data-ms="${i}" ${ready ? '' : 'disabled'}>${got ? 'Получено' : ready ? 'Забрать' : 'Рубеж'}</button></div>`;
    }).join('');
    this.body().innerHTML = `${this.head()}
      <div class="tr-box"><div class="hd-sub">Как получить очки</div>${ways}</div>
      <div class="ev-bar"><div class="hd-bar"><i style="width:${Math.min(100, e.pts / max * 100)}%"></i><span>${fmt(e.pts)} / ${fmt(max)}</span></div></div>
      <div class="ev-list">${ms}</div>`;
    this.body().querySelectorAll('[data-ms]').forEach((b) => {
      b.onclick = async () => { try { const r = await this.app.act('eventClaim', { i: +b.dataset.ms }); this.app.engage.rewardFx(r.got); this.show('tasks'); } catch { /* тост */ } };
    });
  }

  renderBoard() {
    const b = this.board;
    const rows = (b?.top || []).map((r, i) => {
      const medal = rankMedal(i + 1);
      return `<div class="al-row ${r.player === this.me.id ? 'me' : ''}">${medal ? `<img class="ev-medal" src="${M(MEDAL[medal])}" alt="${i + 1}">` : `<b class="ev-rank">${i + 1}</b>`}
        <img class="al-race" src="${A}races/crest_${RACES[r.race] ? r.race : 'humans'}.png" alt=""><div><b>${r.tag ? `[${esc(r.tag)}] ` : ''}${esc(r.name)}</b></div><span class="ev-pts">${fmt(r.pts)}</span></div>`;
    }).join('');
    this.body().innerHTML = `${this.head()}${rows ? `<div class="al-list">${rows}</div>` : '<p class="muted">Пока никто не набрал очков — станьте первым!</p>'}`;
  }

  renderRewards() {
    const e = this.me.event;
    let prev = '';
    if (e.prev) {
      prev = e.prev.rewarded ? `<div class="tr-box tr-note">Прошлая неделя: ${fmt(e.prev.pts)} очков, место ${e.prev.rank || '—'}. Награда получена.</div>`
        : `<div class="tr-box ev-prev"><img src="${M('e_chest')}" alt=""><div><b>Неделя завершена!</b><span>Ваши очки: ${fmt(e.prev.pts)}</span></div><button class="nbtn sm" data-rank>Забрать награду</button></div>`;
    }
    let lo = 1;
    const rows = RANK_REWARDS.map(([to, r]) => {
      const label = to === Infinity ? `${lo}+` : lo === to ? `${to}` : `${lo}–${to}`;
      lo = to + 1;
      const md = rankMedal(to === Infinity ? 999 : to);
      return `<div class="al-row">${md ? `<img class="ev-medal" src="${M(MEDAL[md])}" alt="">` : ''}<b class="ev-rank">${label}</b><div><div class="ms-chips">${chips(r)}</div></div></div>`;
    }).join('');
    this.body().innerHTML = `${prev}<div class="hd-sub">Награды по месту в конце недели</div><div class="al-list">${rows}</div>`;
    const b = this.body().querySelector('[data-rank]');
    if (b) b.onclick = async () => { try { const r = await this.app.act('eventRankClaim'); this.app.engage.rewardFx(r.got); this.app.ui.toast(`Место ${r.rank} — награда получена!`, 'good'); this.show('rewards'); } catch { /* тост */ } };
  }
}

function setDot(el, on) {
  if (!el) return;
  let d = el.querySelector('.rdot');
  if (on && !d) { d = document.createElement('span'); d.className = 'rdot'; el.appendChild(d); }
  if (!on && d) d.remove();
}
