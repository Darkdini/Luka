// Окна города: «Построить» (лента карточек по категориям), окно здания
// («Следующий уровень» было → +прибавка, требования, «Сейчас за 💎» / «Улучшить»),
// информация и захваченные здания (бой героями).
import {
  BUILDINGS, RES_LIST, RES_NAMES, buildCost, upgradeTime, levelEffects, maxLevelOf, castleLevelOf, countOf,
  canAfford, missingOf, gemsForTime, gemsForResources, fmt, fmtTime, CASTLE_MAX,
} from '/shared/config.js';
import { CAPTURED, nextZone, ZONES } from '/shared/city.js';
import { HERO, RARITY, heroPower, stageEnemies } from '/shared/heroes.js';

const A = '/assets/realm/';
const RI = { food: `${A}city/food.png`, wood: `${A}city/wood.png`, stone: `${A}city/stone.png`, iron: `${A}city/iron.png`, mana: `${A}city/mana.png`, gold: `${A}kit/gold.png`, gems: `${A}kit/gems.png` };
export const resIcon = (r) => RI[r] || RI.gold;
const ico = (r) => `<img class="ic" src="${resIcon(r)}" alt="">`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const short = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e4 ? Math.floor(n / 1e3) + 'K' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + 'K' : String(Math.floor(n)));

const TABS = [
  { id: 'eco', name: 'Экономика', types: ['farm', 'sawmill', 'quarry', 'mine', 'manaspring', 'market', 'warehouse'] },
  { id: 'army', name: 'Военные', types: ['barracks', 'range', 'stables', 'hospital', 'forge', 'academy'] },
  { id: 'special', name: 'Особые', types: ['tavern', 'statue', 'altar', 'advisor', 'embassy'] },
];

export class CityUI {
  constructor(app) { this.app = app; }
  get me() { return this.app.me; }
  sprite(type) { return type === 'castle' ? `${A}city/castle_${this.me.race}_${castleLevelOf(this.me) >= 6 ? 2 : 1}.png` : `${A}city/${type}.png`; }

  // --- Построить -----------------------------------------------------------------
  openBuild(tab = this.lastTab || 'eco') {
    this.lastTab = tab;
    const me = this.me, cl = castleLevelOf(me);
    const t = TABS.find((x) => x.id === tab);
    const cards = t.types.map((type) => {
      const d = BUILDINGS[type];
      const n = countOf(me, type), lim = d.countByCastle[cl - 1];
      const nextAt = d.countByCastle.findIndex((v) => v > n) + 1;
      const cost = buildCost(type, 1);
      const locked = n >= lim;
      const captured = me.buildings.some((b) => b.type === type && b.captured);
      return `<button class="bc ${locked ? 'locked' : ''}" data-type="${type}">
        <div class="bc-img"><img src="${this.sprite(type)}" alt="" loading="lazy"></div>
        <b>${d.name}</b><span class="bc-n">Построено ${n}/${lim}</span>
        ${locked ? `<span class="bc-lock"><img class="ic" src="${A}kit/padlock.png" alt="">${captured ? 'Захвачено врагом' : nextAt ? `Цитадель ${nextAt} ур.` : 'Максимум'}</span>`
          : `<span class="bc-cost">${Object.entries(cost).map(([r, v]) => `<i class="${(me.res[r] || 0) >= v ? '' : 'bad'}">${ico(r)}${short(v)}</i>`).join('')}</span><span class="bc-t">⏱ ${fmtTime(upgradeTime(type, 1))}</span>`}
      </button>`;
    }).join('');
    const box = this.app.ui.modal('Построить', `
      <div class="bt-tabs">${TABS.map((x) => `<button class="${x.id === tab ? 'on' : ''}" data-tab="${x.id}">${x.name}</button>`).join('')}</div>
      <div class="bc-row">${cards}</div>`, [], 'build-sheet');
    box.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => this.openBuild(b.dataset.tab); });
    box.querySelectorAll('.bc').forEach((c) => {
      c.onclick = () => {
        const type = c.dataset.type;
        if (c.classList.contains('locked')) {
          const cap = me.buildings.find((b) => b.type === type && b.captured);
          if (cap) { this.app.ui.closeModal(); this.captured(cap); }
          return;
        }
        this.app.ui.closeModal();
        this.app.village.startPlacing(type);
      };
    });
  }

  // --- Окно здания: улучшение / починка ---------------------------------------
  openBuilding(b) {
    const me = this.me, d = BUILDINGS[b.type], cl = castleLevelOf(me);
    const repair = b.level === 0 && !b.up;
    if (b.level >= maxLevelOf(b.type, cl)) {
      return this.openInfo(b, b.type === 'castle' ? 'Цитадель достигла предела.' : `Предел уровня — уровень Цитадели (${cl}). Улучшите Цитадель.`);
    }
    const to = b.level + 1;
    const cost = buildCost(b.type, to), time = Math.round(upgradeTime(b.type, to));
    const cur = b.level ? levelEffects(b.type, b.level) : levelEffects(b.type, to).map(([k]) => [k, 0]);
    const nxt = levelEffects(b.type, to);
    const rows = nxt.map(([k, v], i) => {
      const was = cur[i]?.[1] || 0;
      return `<div class="bw-row"><span>${k}</span><b>${fmt(was)}</b><em>+${fmt(v - was)}</em></div>`;
    }).join('');
    const req = [];
    if (b.type !== 'castle') req.push({ ok: to <= cl, html: `<img class="ic" src="${this.sprite('castle')}" alt="">Цитадель ур. ${to}` });
    for (const [r, v] of Object.entries(cost)) req.push({ ok: (me.res[r] || 0) >= v, html: `${ico(r)}${RES_NAMES[r]} <span class="${(me.res[r] || 0) >= v ? '' : 'bad'}">${short(me.res[r] || 0)}</span> / ${short(v)}` });
    const freeB = me.builders.total - me.builders.busy;
    req.push({ ok: freeB > 0, html: `<img class="ic" src="${A}city/builder.png" alt="">Свободный строитель ${freeB}/${me.builders.total}` });
    const allOk = req.every((r) => r.ok);
    const miss = missingOf(me.res, cost);
    const missSum = Object.values(miss).reduce((a, v) => a + v, 0);
    const gems = gemsForTime(time) + gemsForResources(missSum);
    let unlocks = '';
    if (b.type === 'castle') {
      const items = Object.values(BUILDINGS).filter((x) => x.countByCastle[to - 1] > x.countByCastle[to - 2]).map((x) => x.name);
      const zone = ZONES.find((z) => z.castle === to);
      unlocks = `<div class="bw-unl"><b>Откроется:</b> ${[zone ? 'новые земли за стеной' : null, ...items, 'новые уровни всех зданий'].filter(Boolean).join(', ')}</div>`;
    }
    const box = this.app.ui.modal(`${repair ? 'Починка' : 'Улучшение'}: ${d.name}`, `
      <div class="bw-head"><img src="${this.sprite(b.type)}" alt="" class="${repair ? 'ruined' : ''}"><div>
        <div class="bw-lv">${repair ? 'Разрушено' : `Уровень ${b.level}`} <span>→</span> <b>${to}</b></div><p>${esc(d.desc)}</p></div></div>
      <div class="bw-box"><div class="hd-sub">Следующий уровень: ${to}</div>${rows}</div>${unlocks}
      <div class="bw-box"><div class="hd-sub">Требования</div>${req.map((r) => `<div class="bw-req ${r.ok ? 'ok' : 'no'}"><span>${r.html}</span><i>${r.ok ? '✔' : '✖'}</i></div>`).join('')}</div>`,
    [
      { label: `Сейчас <img class="ic" src="${A}kit/gems.png" alt=""> ${gems}`, cls: 'gem', disabled: (b.type !== 'castle' && to > cl), onClick: () => this.app.ui.confirmGems(gems, () => this.act('upgradeNow', { id: b.id })) },
      { label: `${repair ? 'Починить' : 'Улучшить'} ⏱ ${time ? fmtTime(time) : 'сразу'}`, cls: 'green', disabled: !allOk, onClick: () => this.act('upgrade', { id: b.id }) },
    ], 'bw');
    void box;
  }

  async act(type, args) {
    try {
      await this.app.act(type, args);
      this.app.ui.closeModal();
      this.app.sfx('build');
      this.app.village.select(null);
    } catch { /* тост показан */ }
  }

  speedup(b) {
    const left = (b.up.end - this.me.now) / 1000;
    const g = gemsForTime(left);
    this.app.ui.confirmGems(g, () => this.app.act('speedup', { id: b.id }).then(() => this.app.village.select(null)).catch(() => {}));
  }

  openInfo(b, note = '') {
    const d = BUILDINGS[b.type];
    const lv = Math.max(1, b.level);
    const eff = levelEffects(b.type, lv).map(([k, v]) => `<div class="bw-row"><span>${k}</span><b>${fmt(v)}</b></div>`).join('');
    this.app.ui.modal(`${d.name} · ур. ${b.level}`, `
      <div class="bw-head"><img src="${this.sprite(b.type)}" alt=""><div><p>${esc(d.desc)}</p>${note ? `<p class="muted">${esc(note)}</p>` : ''}</div></div>
      <div class="bw-box"><div class="hd-sub">Сейчас</div>${eff}</div>`, [], 'bw');
  }

  // --- Захваченное здание -------------------------------------------------------
  captured(b) {
    const me = this.me, d = BUILDINGS[b.type];
    const info = CAPTURED.find((c) => c.type === b.type) || { story: 'Здание захвачено врагом.' };
    const en = stageEnemies(b.enemy || 1).filter(Boolean);
    const ep = en.reduce((t, u) => t + heroPower(u.id, u.level, u.stars), 0);
    const tp = me.teamPower || 0;
    const box = this.app.ui.modal(`Захвачено: ${d.name}`, `
      <div class="bw-head"><img src="${A}city/captured.png" alt=""><div><p>${esc(info.story)}</p>
        <p class="muted">Отвоюйте здание отрядом героев. После победы его нужно будет починить.</p></div></div>
      <div class="bw-box"><div class="hd-sub">Враг · сила ${fmt(ep)} <em class="${tp >= ep ? 'ok' : 'bad'}">ваш отряд ${fmt(tp)}</em></div>
        <div class="cp-enemies">${en.map((u) => `<div class="cp-e r-${HERO[u.id].rarity}" style="--rc:${RARITY[HERO[u.id].rarity].color}"><img src="${A}heroes/${u.id}_p.png" alt=""><span>Ур. ${u.level}</span></div>`).join('')}</div></div>`,
    [
      { label: 'Отряд', cls: 'steel', onClick: () => { this.app.ui.closeModal(); this.app.heroes.open('team'); } },
      { label: '⚔ В бой', cls: 'green', onClick: () => this.fight(b) },
    ], 'bw');
    void box;
  }

  async fight(b) {
    this.app.ui.closeModal();
    let r;
    try { r = await this.app.act('liberate', { id: b.id }); } catch { return; }
    const d = BUILDINGS[b.type];
    const rw = r.reward || {};
    const rewardHtml = Object.entries(rw).filter(([k, v]) => v && k !== 'book').map(([k, v]) => `<span><img src="${resIcon(k)}" alt="">${short(v)}</span>`).join('')
      + (rw.book ? `<span><img src="${A}kit/book.png" alt="">×${rw.book}</span>` : '');
    this.app.heroes.battle.play({ ...r, title: `Освобождение: ${d.name}`, rewardHtml }, () => {
      if (r.battle.winner === 'a') {
        this.app.ui.toast(`${d.name} отвоёвана! Почините здание.`, 'good');
        const nb = this.me.buildings.find((v) => v.id === b.id);
        if (nb) setTimeout(() => this.openBuilding(nb), 400);
      }
    });
  }
}
