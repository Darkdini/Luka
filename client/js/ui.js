// DOM-интерфейс поверх канваса: HUD, панели, модальные окна.
import {
  BUILDINGS, TROOPS, SPELLS, HEROES, RACES, DONATE_PACKS, BUILDER_GEM_COST, DECOR_REMOVE_COST,
  upgradeCost, upgradeTime, wallCost, gemsForTime, gemsForResources, spriteFor, fmt, fmtTime, buildingHp,
  armyUsed, heroMaxLevel, heroUpgradeCost, heroUpgradeTime, heroLevelMul, troopLevelMul, forgeCost, forgeTime,
} from '/shared/config.js';
import { url } from './assets.js';
import { short } from './cityui.js';
import { RES_LIST, RES_NAMES } from '/shared/config.js';
import { esc, avatarUrl } from './world.js';
import { ACHIEVEMENTS, AVATARS, leagueOf, avatarUnlocked, titlesOf } from '/shared/achievements.js';

const $ = (s) => document.querySelector(s);
const RES_ICON = { gold: 'realm/kit/gold', food: 'realm/city/food', wood: 'realm/city/wood', stone: 'realm/city/stone', iron: 'realm/city/iron', mana: 'realm/city/mana', gems: 'realm/kit/gems' };
const ico = (r, cls = 'ri') => `<img class="${cls}" src="${url(RES_ICON[r])}" alt="">`;
const castleLevel = (me) => me.buildings.find((b) => b.type === 'castle')?.level || 1;
const countOf = (me, t) => me.buildings.filter((b) => b.type === t).length;

const SHOP_TABS = [
  { id: 'eco', name: 'Экономика', types: ['goldmine', 'farm', 'treasury', 'granary', 'builderhut'] },
  { id: 'army', name: 'Армия', types: ['barracks', 'armycamp', 'heroaltar', 'spelltower', 'forge'] },
  { id: 'def', name: 'Оборона', types: ['archertower', 'ballista', 'magetower', 'trebuchet'] },
  { id: 'walls', name: 'Стена и ловушки', types: ['wall', 'trap_spikes', 'trap_barrel', 'trap_bear', 'trap_rune'] },
  { id: 'gems', name: '💎 Сокровищница', types: [] },
];

export class UI {
  constructor(app) {
    this.app = app;
    this.lastTick = 0;
    $('#modal-bg').addEventListener('click', (e) => { if (e.target.id === 'modal-bg') this.closeModal(); });
    $('#btn-shop').onclick = () => this.app.store.open('offers');
    $('#btn-army').onclick = () => this.openArmy('troops');
    $('#btn-attack').onclick = () => app.openWorld();
    $('#btn-more').onclick = (e) => { e.stopPropagation(); $('#side-more').classList.toggle('show'); };
    document.querySelectorAll('#side-more button').forEach((b) => b.addEventListener('click', () => $('#side-more').classList.remove('show')));
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#side-more, #btn-more')) $('#side-more').classList.remove('show'); });
    $('#btn-top').onclick = () => this.openTop();
    $('#btn-reports').onclick = () => this.openReports();
    $('#btn-chat').onclick = () => this.toggleChat();
    $('#btn-gems').onclick = () => this.openShop('gems');
    $('#btn-settings').onclick = () => this.openSettings();
    $('#hud-player').onclick = () => this.openProfile(app.me.id);
    $('#btn-ach').onclick = () => this.openAchievements();
    $('#btn-story').onclick = () => app.story.open();
    $('#w-story')?.addEventListener('click', () => app.story.open());
    $('#visit-back').onclick = () => app.goHome();
    $('#chat-log').addEventListener('click', (e) => { const n = e.target.closest('[data-pid]'); if (n) this.openProfile(+n.dataset.pid); });
    $('#place-cancel').onclick = () => app.village.cancelPlacing();
    $('#world-back').onclick = () => app.goHome();
    $('#chat-close').onclick = () => this.toggleChat(false);
    $('#chat-form').onsubmit = (e) => {
      e.preventDefault();
      const inp = $('#chat-input');
      app.sendChat(inp.value);
      inp.value = '';
    };
  }

  // --- Базовое ------------------------------------------------------------------
  toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 2200);
    setTimeout(() => t.remove(), 2700);
  }

  modal(title, html, buttons = [], cls = '') {
    // каждое окно само решает, обновляться ли ему при изменении состояния
    this.modalKind = this.pendingKind || null;
    this.modalRefresh = this.pendingRefresh || null;
    this.pendingKind = this.pendingRefresh = null;
    const bg = $('#modal-bg');
    bg.className = 'show';
    const box = $('#modal');
    box.className = 'modal ' + cls;
    box.innerHTML = `<div class="m-head"><h2>${title}</h2><button class="x" aria-label="Закрыть"></button></div><div class="m-body">${html}</div><div class="m-foot"></div>`;
    box.querySelector('.x').onclick = () => this.closeModal();
    const foot = box.querySelector('.m-foot');
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.cls || '');
      el.innerHTML = b.label;
      el.disabled = !!b.disabled;
      el.onclick = () => b.onClick();
      foot.appendChild(el);
    }
    if (!buttons.length) foot.remove();
    return box;
  }
  closeModal() { $('#modal-bg').className = ''; this.modalKind = null; this.modalRefresh = null; }

  // --- HUD --------------------------------------------------------------------------
  updateHud(me) {
    $('#p-name').textContent = me.name;
    $('#p-level').textContent = castleLevel(me);
    this.app.engage.count($('#p-trophies'), me.trophies);
    $('#p-ava').src = avatarUrl(me.avatar);
    const lg = leagueOf(me.trophies);
    $('#p-league').textContent = lg.icon;
    $('#p-league').title = lg.name;
    const claim = (me.achievements || []).reduce((a, x) => a + Math.max(0, x.reached - x.claimed), 0);
    $('#btn-ach .badge').textContent = claim || '';
    $('#btn-ach .badge').classList.toggle('hidden', !claim);
    const nextCh = (this.app.storyNext?.() || null);
    $('#btn-story').classList.toggle('glow', !!nextCh);
    $('#p-race').textContent = RACES[me.race]?.name || '';
    $('#p-race').style.setProperty('--c', RACES[me.race]?.color || '#888');
    for (const r of RES_LIST) {
      this.app.engage.count($(`#r-${r} .v`), Math.floor(me.res[r] || 0), short);
      $(`#r-${r}`).title = `${RES_NAMES[r]}: ${fmt(me.res[r] || 0)} из ${fmt(me.caps[r] || 0)}`;
      $(`#r-${r} .fill`).style.width = Math.min(100, (me.res[r] || 0) / Math.max(1, me.caps[r] || 1) * 100) + '%';
    }
    this.app.engage.count($('#r-gems .v'), me.res.gems, short);
    $('#builders').innerHTML = `<img src="/assets/realm/city/builder.png" alt="">${me.builders.total - me.builders.busy}/${me.builders.total}`;
    $('#builders').onclick = () => this.buyBuilder();
    $('#power').innerHTML = `<img src="/assets/realm/kit/power_ic.png" alt="">${fmt((me.power || 0) + (me.teamPower || 0) + (me.troopPower || 0))}`;
    $('#army-count').textContent = `${armyUsed(me.army)}/${me.armyCap}`;
    const unread = (me.reports || []).filter((r) => r.type === 'defense' && r.ts > (this.app.seenReports || 0)).length;
    $('#btn-reports .badge').textContent = unread || '';
    $('#btn-reports .badge').classList.toggle('hidden', !unread);
    this.moreDot();
    const sh = me.shieldUntil - me.now;
    $('#shield').classList.toggle('hidden', sh <= 0);
    $('#shield').dataset.until = me.shieldUntil - me.now + Date.now();
    if (this.selObj) this.select(this.app.village.findSel(), this.selKind, true);
    if (this.modalKind) this.modalRefresh?.();
  }

  moreDot() {
    const any = [...document.querySelectorAll('#side-more .badge')].some((b) => !b.classList.contains('hidden')) || $('#btn-story').classList.contains('glow');
    let d = $('#btn-more .rdot');
    if (any && !d) { d = document.createElement('span'); d.className = 'rdot'; $('#btn-more').appendChild(d); }
    if (!any && d) d.remove();
  }

  tick() {
    const t = performance.now();
    if (t - this.lastTick < 250) return;
    this.lastTick = t;
    const me = this.app.me;
    if (!me) return;
    const sh = $('#shield');
    if (!sh.classList.contains('hidden')) sh.querySelector('span').textContent = fmtTime((+sh.dataset.until - Date.now()) / 1000);
    const tr = me.training.length ? me.training[me.training.length - 1] : null;
    $('#army-timer').textContent = tr ? fmtTime((tr.end - me.now - (Date.now() - this.app.fetchedAt)) / 1000) : '';
    if (tr && tr.end - me.now - (Date.now() - this.app.fetchedAt) < -500 && !this.app.busy) this.app.refresh();
    document.querySelectorAll('[data-end]').forEach((el) => {
      const left = (+el.dataset.end - me.now - (Date.now() - this.app.fetchedAt)) / 1000;
      el.textContent = left > 0 ? fmtTime(left) : 'готово';
    });
  }

  // --- Выбор здания: нижняя панель действий ---------------------------------------
  select(obj, kind, refresh) {
    const bar = $('#selbar');
    this.selObj = obj; this.selKind = kind;
    if (!obj) { bar.classList.remove('show'); return; }
    const me = this.app.me;
    const acts = [];
    let title, sub = '';
    if (kind === 'd') {
      title = 'Заросли';
      sub = 'Расчистка приносит кристаллы';
      acts.push({ label: `Расчистить<small>${ico('gold')} ${DECOR_REMOVE_COST}</small>`, cls: 'green', fn: () => this.app.act('removeDecor', { id: obj.id }).then((r) => r.gems && this.toast(`Найдено кристаллов: ${r.gems} 💎`, 'good')) });
    } else {
      const def = BUILDINGS[obj.type];
      title = def.name;
      sub = obj.level ? `Уровень ${obj.level}` : 'Строится';
      acts.push({ label: 'Инфо', fn: () => this.openInfo(obj) });
      if (obj.up) {
        const left = (obj.up.end - me.now) / 1000;
        acts.push({ label: `Ускорить<small>${ico('gems')} ${gemsForTime(left)}</small>`, cls: 'gem', fn: () => this.confirmGems(gemsForTime(left), () => this.app.act('speedup', { id: obj.id })) });
      } else if (obj.type === 'wall') {
        const max = def.maxByCastle[castleLevel(me) - 1];
        if (obj.level < max) acts.push({ label: `Улучшить всю стену<small>${ico('gold')} ${fmt(wallCost(obj.level + 1))}</small>`, cls: 'green', fn: () => this.app.act('wallUpgrade').then(() => this.toast(`🧱 Стена укреплена до ${this.app.me.wallLevel} ур.!`, 'good')) });
        else acts.push({ label: 'Максимум', disabled: true, fn: () => {} });
      } else if (obj.type !== 'builderhut') {
        const max = obj.type === 'castle' ? 6 : def.maxByCastle[castleLevel(me) - 1];
        if (obj.level < max) {
          const cost = upgradeCost(obj.type, obj.level + 1);
          acts.push({ label: `Улучшить<small>${ico(def.res)} ${fmt(cost)}</small>`, cls: 'green', fn: () => this.openUpgrade(obj) });
        } else acts.push({ label: 'Максимум', disabled: true, fn: () => {} });
      }
      if (obj.type !== 'castle' && obj.type !== 'wall') acts.push({ label: 'Переместить<small>↔</small>', fn: () => this.app.village.startMove(obj) });
      if (def.produces && obj.level) acts.push({ label: `Собрать<small>${ico(def.produces)}</small>`, fn: () => this.app.collect(obj.id) });
      if (obj.type === 'barracks' || obj.type === 'armycamp') acts.push({ label: 'Обучить', cls: 'blue', fn: () => this.openArmy('troops') });
      if (obj.type === 'spelltower') acts.push({ label: 'Зелья', cls: 'blue', fn: () => this.openArmy('spells') });
      if (obj.type === 'forge') acts.push({ label: 'Кузница', cls: 'blue', fn: () => this.openArmy('forge') });
      if (obj.type === 'heroaltar') acts.push({ label: 'Герои', cls: 'blue', fn: () => this.openHeroes() });
    }
    bar.innerHTML = `<div class="sb-title"><b>${title}</b><span>${sub}</span></div><div class="sb-acts"></div>`;
    const wrap = bar.querySelector('.sb-acts');
    for (const a of acts) {
      const b = document.createElement('button');
      b.className = 'btn sm ' + (a.cls || '');
      b.innerHTML = a.label; b.disabled = !!a.disabled;
      b.onclick = a.fn;
      wrap.appendChild(b);
    }
    bar.classList.add('show');
  }

  wallRow(w) {
    const walls = this.app.me.buildings.filter((b) => b.type === 'wall' && b.level === w.level && !b.up);
    const at = new Map(walls.map((b) => [b.x * 100 + b.y, b]));
    let best = [w];
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const row = [w];
      for (const s of [1, -1]) for (let i = 1; ; i++) { const b = at.get((w.x + dx * i * s) * 100 + w.y + dy * i * s); if (!b) break; row.push(b); }
      if (row.length > best.length) best = row;
    }
    return best;
  }

  placing(on, hint = '') {
    $('#placebar').classList.toggle('show', on);
    $('#place-hint').textContent = hint;
    $('#selbar').classList.remove('show');
  }

  canBuildMore(type) {
    const me = this.app.me;
    return countOf(me, type) < BUILDINGS[type].countByCastle[castleLevel(me) - 1];
  }

  confirmGems(n, fn) {
    if (n > this.app.me.res.gems) { this.toast('Не хватает самоцветов'); this.openShop('gems'); return; }
    if (n < 10) return fn();
    this.modal('Потратить кристаллы?', `<p class="center big">${ico('gems', 'ri big')} ${n}</p>`, [
      { label: 'Подтвердить', cls: 'green', onClick: () => { this.closeModal(); fn(); } },
    ]);
  }

  // --- Информация и улучшение -------------------------------------------------------
  statsOf(type, level) {
    const def = BUILDINGS[type];
    const out = [['Прочность', fmt(buildingHp(type, level, this.app.me.race))]];
    if (def.def) {
      out.push(['Урон/сек', (def.def.dmg * (1 + 0.2 * (level - 1)) / def.def.interval).toFixed(1)]);
      out.push(['Дальность', def.def.range + (def.def.minRange ? ` (мин. ${def.def.minRange})` : '')]);
      out.push(['Цели', [def.def.ground && 'наземные', def.def.air && 'воздушные'].filter(Boolean).join(', ')]);
    }
    if (def.produces) out.push(['Добыча в час', fmt(def.rate[level - 1])]);
    if (def.stores) out.push(['Вместимость', fmt(def.capacity[level - 1])]);
    if (def.storage) out.push(['Хранилище', fmt(def.storage[level - 1]) + ' ×2']);
    if (def.housing) out.push(['Мест в лагере', def.housing[level - 1]]);
    if (def.trap) out.push(['Урон', fmt(def.trap.dmg * (1 + 0.25 * (level - 1)))]);
    return out;
  }

  openInfo(b) {
    const def = BUILDINGS[b.type];
    const lvl = Math.max(1, b.level);
    const rows = this.statsOf(b.type, lvl).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    this.modal(`${def.name} — ур. ${b.level}`, `
      <div class="info">
        <img class="info-img" src="${url('buildings/' + spriteFor(b.type, lvl))}" alt="">
        <div><p>${def.desc}</p><table class="stats">${rows}</table></div>
      </div>`);
  }

  openUpgrade(b) {
    const def = BUILDINGS[b.type];
    const to = b.level + 1;
    const cur = this.statsOf(b.type, Math.max(1, b.level));
    const nxt = this.statsOf(b.type, to);
    const rows = nxt.map(([k, v], i) => `<tr><td>${k}</td><td>${cur[i]?.[1] ?? '—'}</td><td class="up">→ ${v}</td></tr>`).join('');
    const cost = upgradeCost(b.type, to), time = upgradeTime(b.type, to);
    const lack = Math.max(0, cost - this.app.me.res[def.res]);
    let unlocks = '';
    if (b.type === 'castle') {
      const items = Object.entries(BUILDINGS).filter(([, d]) => d.countByCastle[to - 1] > d.countByCastle[to - 2]).map(([, d]) => d.name);
      const heroes = Object.values(HEROES).filter((h) => h.castle === to).map((h) => '⭐ ' + h.name);
      unlocks = `<p class="unlocks"><b>Откроется:</b> ${[...heroes, ...items].join(', ') || 'новые уровни зданий'}</p>`;
    }
    const btns = [{ label: `Улучшить ${ico(def.res)} ${fmt(cost)}`, cls: 'green', onClick: () => { this.closeModal(); this.app.act('upgrade', { id: b.id }); } }];
    if (lack > 0) btns.unshift({ label: `Докупить ${ico('gems')} ${gemsForResources(lack)}`, cls: 'gem', onClick: () => this.confirmGems(gemsForResources(lack), () => this.app.act('buyResources', { res: def.res, amount: lack })) });
    this.modal(`Улучшить: ${def.name} до ур. ${to}`, `
      <div class="info">
        <img class="info-img" src="${url('buildings/' + spriteFor(b.type, to))}" alt="">
        <div><table class="stats"><tr><th></th><th>Сейчас</th><th>Будет</th></tr>${rows}</table>
        <p>⏱ Время: <b>${time ? fmtTime(time) : 'мгновенно'}</b></p>${unlocks}</div>
      </div>`, btns);
  }

  // Строители: 2 бесплатно, дальше — за самоцветы
  buyBuilder() {
    const me = this.app.me, n = me.builders.total;
    if (n >= 5) { this.toast('У вас максимум строителей'); return; }
    const cost = BUILDER_GEM_COST[n];
    this.modal('Новый строитель', `<div class="bw-head"><img src="/assets/realm/city/builder.png" alt=""><div><p>Строители ведут стройку. Сейчас: <b>${me.builders.busy}/${n}</b> заняты.</p><p>Ещё один строитель — ещё одна стройка одновременно.</p></div></div>`,
      [{ label: `Нанять <img class="ic" src="/assets/realm/kit/gems.png" alt=""> ${cost}`, cls: 'gem', onClick: () => this.confirmGems(cost, () => this.app.act('buyBuilder').then(() => { this.closeModal(); this.toast('Новый строитель в деле!', 'good'); }).catch(() => {})) }], 'bw');
  }

  // --- Магазин --------------------------------------------------------------------
  openShop(tab, plot) {
    if (tab !== 'gems') { this.app.cityUi.openBuild(); return; }
    this.app.store.open('gems'); return;
    // eslint-disable-next-line no-unreachable
    const me = this.app.me;
    this.shopPlot = plot || null;
    this.pendingKind = 'shop';
    const cl = castleLevel(me);
    // с выбранной ячейкой показываем только то, что на неё ставится
    const tabList = plot ? SHOP_TABS.filter((t) => t.id !== 'walls' && t.id !== 'gems') : SHOP_TABS;
    const tabs = tabList.map((t) => `<button class="tab ${t.id === tab ? 'on' : ''}" data-tab="${t.id}">${t.name}</button>`).join('');
    let body;
    if (tab === 'gems') body = this.gemShop();
    else {
      const cards = SHOP_TABS.find((t) => t.id === tab).types.map((type) => {
        const def = BUILDINGS[type];
        if (type === 'wall') {
          const lvl = me.wallLevel || 0, max = def.maxByCastle[cl - 1];
          const lockedW = !max || lvl >= max;
          return `<div class="card ${lockedW ? 'locked' : ''}" data-wall="1">
            <div class="c-img"><img src="${url('buildings/' + spriteFor('wall', Math.max(1, lvl + (lockedW ? 0 : 1))))}" alt=""></div>
            <div class="c-name">${def.name}</div><div class="c-count">ур. ${lvl}</div>
            ${lockedW ? `<div class="c-lock">${max ? 'Улучшите Цитадель' : 'Цитадель 2 ур.'}</div>` : `<div class="c-cost">${ico('gold')} ${fmt(wallCost(lvl + 1))}</div><div class="c-time">${lvl ? 'улучшить' : 'возвести'} вокруг города</div>`}
          </div>`;
        }
        const n = countOf(me, type), lim = def.countByCastle[cl - 1];
        const next = def.countByCastle.findIndex((c) => c > n) + 1;
        const isHut = type === 'builderhut';
        const cost = isHut ? BUILDER_GEM_COST[n] : upgradeCost(type, 1);
        const res = isHut ? 'gems' : def.res;
        const locked = n >= lim;
        const time = isHut ? 0 : upgradeTime(type, 1);
        return `<div class="card ${locked ? 'locked' : ''}" data-type="${type}">
          <div class="c-img"><img src="${url('buildings/' + spriteFor(type, 1))}" alt=""></div>
          <div class="c-name">${def.name}</div>
          <div class="c-count">${n}/${lim}</div>
          ${locked ? `<div class="c-lock">${next ? `Цитадель ${next} ур.` : 'Максимум'}</div>`
            : `<div class="c-cost">${ico(res)} ${fmt(cost)}</div><div class="c-time">⏱ ${time ? fmtTime(time) : 'сразу'}</div>`}
        </div>`;
      }).join('');
      const hint = plot && !SHOP_TABS.filter((t) => !['walls', 'gems'].includes(t.id)).some((t) => t.types.some((type) => type !== 'builderhut' && countOf(me, type) < BUILDINGS[type].countByCastle[cl - 1]))
        ? `<div class="shop-hint">Все доступные здания уже построены. Улучшите Цитадель — откроются новые!<button class="btn sm green" id="go-castle">⬆ Цитадель</button></div>` : '';
      body = `${hint}<div class="cards">${cards}</div>`;
    }
    const box = this.modal(plot ? 'Построить на ячейке' : 'Магазин', `<div class="tabs">${tabs}</div>${body}`, [], 'wide');
    box.querySelectorAll('.tab').forEach((b) => { b.onclick = () => this.openShop(b.dataset.tab, this.shopPlot); });
    box.querySelectorAll('.card[data-type]').forEach((c) => {
      c.onclick = () => {
        if (c.classList.contains('locked')) return;
        this.closeModal();
        this.app.village.startPlacing(c.dataset.type, this.shopPlot);
      };
    });
    box.querySelectorAll('.card[data-wall]').forEach((c) => {
      c.onclick = () => {
        if (c.classList.contains('locked')) return;
        this.closeModal();
        this.app.act('wallUpgrade').then((r) => { this.toast(r.wallLevel === 1 ? '🧱 Крепостная стена возведена!' : `🧱 Стена укреплена до ${r.wallLevel} ур.!`, 'good'); this.app.sfx('levelup'); });
      };
    });
    const gc = box.querySelector('#go-castle');
    if (gc) gc.onclick = () => { const c = me.buildings.find((b) => b.type === 'castle'); this.openUpgrade(c); };
    box.querySelectorAll('[data-pack]').forEach((b) => { b.onclick = () => this.app.buyPack(b.dataset.pack); });
    box.querySelectorAll('[data-buyres]').forEach((b) => {
      b.onclick = () => {
        const [res, pct] = b.dataset.buyres.split(':');
        const amount = Math.floor((me.caps[res] - me.res[res]) * pct);
        if (amount <= 0) return this.toast('Хранилище заполнено');
        this.confirmGems(gemsForResources(amount), () => this.app.act('buyResources', { res, amount }));
      };
    });
  }

  gemShop() {
    const me = this.app.me;
    const packs = DONATE_PACKS.map((p) => `
      <div class="card pack">
        ${p.tag ? `<div class="c-tag">${p.tag}</div>` : ''}
        <div class="c-img gem-pile">${ico('gems', 'ri huge')}</div>
        <div class="c-name">${p.label}</div>
        <div class="c-cost">${ico('gems')} ${fmt(p.gems)}${p.bonus ? ' + бонусы' : ''}</div>
        <button class="btn sm green" data-pack="${p.id}">${p.price} ₽</button>
      </div>`).join('');
    const res = ['gold', 'food'].flatMap((r) => [0.1, 0.5, 1].map((k) => {
      const amount = Math.max(0, Math.floor((me.caps[r] - me.res[r]) * k));
      return `<div class="card res"><div class="c-img">${ico(r, 'ri huge')}</div><div class="c-name">${k === 1 ? 'Заполнить' : `${k * 100}% места`}</div>
        <div class="c-cost">${fmt(amount)}</div><button class="btn sm gem" data-buyres="${r}:${k}" ${amount ? '' : 'disabled'}>${ico('gems')} ${gemsForResources(amount)}</button></div>`;
    })).join('');
    return `<h3>Кристаллы</h3><div class="cards">${packs}</div><h3>Ресурсы за кристаллы</h3><div class="cards">${res}</div>
      <p class="note">Кристаллы также можно бесплатно найти при расчистке территории и в ежедневной награде.</p>`;
  }

  // --- Армия: войска, зелья, кузница -----------------------------------------------
  openArmy(tab) {
    const me = this.app.me;
    this.pendingKind = 'army';
    this.pendingRefresh = () => this.openArmy(tab);
    const tabs = [['troops', 'Войска'], ['spells', 'Зелья'], ['forge', 'Кузница']]
      .map(([id, n]) => `<button class="tab ${id === tab ? 'on' : ''}" data-tab="${id}">${n}</button>`).join('');
    const barracks = Math.max(0, ...me.buildings.filter((b) => b.type === 'barracks').map((b) => b.level));
    let body = '';
    if (tab === 'troops') {
      const used = armyUsed(me.army), queued = me.training.reduce((a, q) => a + TROOPS[q.k].space, 0);
      const army = Object.entries(me.army).filter(([, n]) => n > 0).map(([k, n]) => `<div class="chip"><img src="${url('troops/' + k)}" alt=""><b>×${n}</b></div>`).join('') || '<span class="muted">Армия пуста</span>';
      const q = me.training.map((t, i) => `<div class="chip q" data-untrain="${i}" title="Отменить"><img src="${url('troops/' + t.k)}" alt=""></div>`).join('');
      const last = me.training.at(-1);
      body = `<div class="army-top"><div>⚔ Армия: <b>${used}</b> / ${me.armyCap} ${queued ? `<span class="muted">(+${queued} в обучении)</span>` : ''}</div>
        ${last ? `<div>⏱ <span data-end="${last.end}"></span> <button class="btn xs gem" id="speed-train">${ico('gems')} ${gemsForTime((last.end - me.now) / 1000)}</button></div>` : ''}</div>
        <div class="chips">${army}</div>${q ? `<div class="chips queue">${q}</div>` : ''}
        <div class="cards troops">${Object.entries(TROOPS).map(([k, t]) => {
          const lock = barracks < t.barracks;
          const lvl = me.troopLevels[k] || 1;
          return `<div class="card troop ${lock ? 'locked' : ''}" data-train="${k}">
            <div class="c-img"><img src="${url('troops/' + k)}" alt=""></div>
            <div class="c-name">${t.name}${lvl > 1 ? ` <span class="lv">ур.${lvl}</span>` : ''}</div>
            ${lock ? `<div class="c-lock">Казармы ${t.barracks} ур.</div>` : `<div class="c-cost">${ico('food')} ${fmt(t.cost)}</div>
            <div class="c-time">👤 ${t.space} · ⏱ ${fmtTime(t.time)}</div>`}
            <div class="c-desc">${t.desc}</div>
          </div>`;
        }).join('')}</div>`;
    } else if (tab === 'spells') {
      const tower = me.buildings.find((b) => b.type === 'academy' && b.level > 0);
      const have = Object.values(me.spells).reduce((a, v) => a + v, 0);
      const sp = Object.entries(me.spells).filter(([, n]) => n > 0).map(([k, n]) => `<div class="chip"><img src="${url(spellIcon(k))}" alt=""><b>×${n}</b></div>`).join('') || '<span class="muted">Зелий нет</span>';
      body = tower ? `<div class="army-top"><div>🧪 Зелья: <b>${have}</b>${me.brewing.length ? ` (+${me.brewing.length})` : ''} / ${me.spellCap}</div></div><div class="chips">${sp}</div>
        <div class="cards troops">${Object.entries(SPELLS).map(([k, s]) => {
          const lock = tower.level < s.tower;
          return `<div class="card troop ${lock ? 'locked' : ''}" data-brew="${k}">
            <div class="c-img"><img src="${url(spellIcon(k))}" alt=""></div><div class="c-name">${s.name}</div>
            ${lock ? `<div class="c-lock">Башня ${s.tower} ур.</div>` : `<div class="c-cost">${ico('food')} ${fmt(s.cost)}</div><div class="c-time">⏱ ${fmtTime(s.time)}</div>`}
            <div class="c-desc">${s.desc}</div></div>`;
        }).join('')}</div>` : '<p class="center">Постройте <b>Башню алхимика</b> (Цитадель 3 ур.), чтобы варить боевые зелья.</p>';
    } else {
      const forge = me.buildings.find((b) => b.type === 'forge' && b.level > 0);
      body = forge ? `${me.forge ? `<div class="army-top"><div>🔨 Куётся: <b>${TROOPS[me.forge.k].name}</b> → ур. ${me.forge.to} · <span data-end="${me.forge.end}"></span></div>
        <button class="btn xs gem" id="speed-forge">${ico('gems')} ${gemsForTime((me.forge.end - me.now) / 1000)}</button></div>` : ''}
        <div class="cards troops">${Object.entries(TROOPS).map(([k, t]) => {
          const lvl = me.troopLevels[k] || 1;
          const lock = barracks < t.barracks;
          const max = lvl >= forge.level + 1;
          return `<div class="card troop ${lock || max ? 'locked' : ''}" data-forge="${k}">
            <div class="c-img"><img src="${url('troops/' + k)}" alt=""></div><div class="c-name">${t.name} <span class="lv">ур.${lvl}</span></div>
            ${lock ? '<div class="c-lock">Не открыт</div>' : max ? '<div class="c-lock">Улучшите Кузницу</div>'
              : `<div class="c-cost">${ico('food')} ${fmt(forgeCost(lvl + 1))}</div><div class="c-time">⏱ ${fmtTime(forgeTime(lvl + 1))}</div>`}
            <div class="c-desc">Здоровье и урон: ×${troopLevelMul(lvl).toFixed(2)} → ×${troopLevelMul(lvl + 1).toFixed(2)}</div></div>`;
        }).join('')}</div>` : '<p class="center">Постройте <b>Кузницу</b> (Цитадель 3 ур.), чтобы усиливать войска.</p>';
    }
    const box = this.modal('Армия', `<div class="tabs">${tabs}</div>${body}`, [], 'wide');
    box.querySelectorAll('.tab').forEach((b) => { b.onclick = () => this.openArmy(b.dataset.tab); });
    box.querySelectorAll('[data-train]').forEach((c) => { c.onclick = () => !c.classList.contains('locked') && this.app.act('train', { k: c.dataset.train, n: 1 }); });
    box.querySelectorAll('[data-untrain]').forEach((c) => { c.onclick = () => this.app.act('untrain', { index: +c.dataset.untrain }); });
    box.querySelectorAll('[data-brew]').forEach((c) => { c.onclick = () => !c.classList.contains('locked') && this.app.act('brew', { k: c.dataset.brew }); });
    box.querySelectorAll('[data-forge]').forEach((c) => { c.onclick = () => !c.classList.contains('locked') && this.app.act('forge', { k: c.dataset.forge }); });
    const st = box.querySelector('#speed-train');
    if (st) st.onclick = () => this.confirmGems(gemsForTime((me.training.at(-1).end - me.now) / 1000), () => this.app.act('speedupTraining'));
    const sf = box.querySelector('#speed-forge');
    if (sf) sf.onclick = () => this.confirmGems(gemsForTime((me.forge.end - me.now) / 1000), () => this.app.act('speedupForge'));
  }

  // --- Герои ---------------------------------------------------------------------------
  openHeroes() {
    const me = this.app.me;
    this.pendingKind = 'heroes';
    this.pendingRefresh = () => this.openHeroes();
    const cl = castleLevel(me);
    const altar = me.buildings.some((b) => b.type === 'altar' && b.level > 0);
    const cards = Object.entries(HEROES).map(([k, h]) => {
      const st = me.heroes[k];
      let action;
      if (!st) {
        action = cl < h.castle ? `<div class="c-lock">Цитадель ${h.castle} ур.</div>`
          : `<button class="btn sm green" data-unlock="${k}" ${altar ? '' : 'disabled'}>Призвать ${ico(h.res)} ${fmt(h.unlock)}</button>`;
      } else if (st.up) {
        action = `<div class="c-time">⏱ <span data-end="${st.up.end}"></span></div><button class="btn sm gem" data-hspeed="${k}">${ico('gems')} ${gemsForTime((st.up.end - me.now) / 1000)}</button>`;
      } else if (st.level >= heroMaxLevel(cl)) {
        action = '<div class="c-lock">Улучшите Цитадель</div>';
      } else {
        action = `<button class="btn sm green" data-hup="${k}">Ур. ${st.level + 1} ${ico(h.res)} ${fmt(heroUpgradeCost(k, st.level + 1))}</button><div class="c-time">⏱ ${fmtTime(heroUpgradeTime(st.level + 1))}</div>`;
      }
      const lvl = st?.level || 1, m = heroLevelMul(lvl);
      return `<div class="hero-card ${st ? '' : 'locked'}">
        <img class="hero-portrait" src="${url('heroes/' + k + '_portrait')}" alt="">
        <div class="hero-info"><h3>${h.name} ${st ? `<span class="lv">ур.${st.level}</span>` : ''}</h3>
          <p>${h.desc}</p>
          <p class="muted">❤ ${fmt(h.hp * m)} · ⚔ ${fmt(h.dmg * m / h.interval)}/с · ✨ ${h.ability.name}</p>
          <div class="hero-act">${action}</div></div></div>`;
    }).join('');
    const box = this.modal('Алтарь героев', `${altar ? '' : '<p class="tc-warn">Постройте Алтарь героев: Магазин → Армия → Алтарь героев (нужна Цитадель 2 ур.).</p>'}<div class="heroes">${cards}</div>`, [], 'wide');
    box.querySelectorAll('[data-unlock]').forEach((b) => { b.onclick = () => this.app.act('heroUnlock', { k: b.dataset.unlock }).then(() => this.toast('Герой призван!', 'good')); });
    box.querySelectorAll('[data-hup]').forEach((b) => { b.onclick = () => this.app.act('heroUpgrade', { k: b.dataset.hup }); });
    box.querySelectorAll('[data-hspeed]').forEach((b) => {
      b.onclick = () => this.confirmGems(gemsForTime((me.heroes[b.dataset.hspeed].up.end - me.now) / 1000), () => this.app.act('heroSpeedup', { k: b.dataset.hspeed }));
    });
  }

  // --- Рейтинг, отчёты, настройки ---------------------------------------------------
  async openTop() {
    try {
      const { top, rank, total } = await this.app.api.top();
      const rows = top.map((p, i) => {
        const lg = leagueOf(p.trophies);
        return `<tr class="${p.id === this.app.me.id ? 'me' : ''}" data-pid="${p.id}"><td>${i + 1}</td>
        <td class="pl"><img class="mini-ava" src="${avatarUrl(p.avatar)}" alt=""><div>${esc(p.name)}<div class="muted">${esc(p.username)}${p.title ? ' · ' + esc(p.title) : ''}</div></div></td>
        <td><span class="race-chip" style="--c:${RACES[p.race]?.color}">${RACES[p.race]?.name}</span></td><td title="${lg.name}">${lg.icon}</td><td>${p.level}</td><td>🏆 ${p.trophies}</td></tr>`;
      }).join('');
      const box = this.modal('Рейтинг королевств', `<p class="center">Ваше место: <b>${rank}</b> из ${fmt(total)}</p>
        <table class="top"><tr><th>#</th><th>Замок</th><th>Раса</th><th>Лига</th><th>Ур.</th><th>Кубки</th></tr>${rows}</table>`, [], 'wide');
      box.querySelectorAll('tr[data-pid]').forEach((tr) => { tr.onclick = () => this.openProfile(+tr.dataset.pid); });
    } catch (e) { this.toast(e.message); }
  }

  // --- Профиль ---------------------------------------------------------------------
  async openProfile(id) {
    let p;
    try { p = await this.app.api.profile(id); } catch (e) { this.toast(e.message); return; }
    const me = this.app.me;
    const mine = p.id === me.id;
    const race = RACES[p.race];
    const seen = p.online ? '<span class="dot-on"></span> в сети' : `был(а) ${ago(p.seen)}`;
    const s = p.stats;
    const stat = (k, v) => `<div class="pf-stat"><b>${v}</b><span>${k}</span></div>`;
    const medals = p.achievements.map((a) => {
      const def = ACHIEVEMENTS.find((x) => x.id === a.id);
      const tier = a.claimed;
      return `<div class="medal t${tier}" title="${esc(def.name)}: ${['не получено', 'бронза', 'серебро', 'золото'][tier]}">${['▫', '🥉', '🥈', '🥇'][tier]}<span>${esc(def.name)}</span></div>`;
    }).join('');
    const heroes = Object.entries(p.heroes).map(([k, l]) => `<div class="pf-hero"><img src="${url('heroes/' + k + '_portrait')}" alt=""><span>${HEROES[k].name} · ${l}</span></div>`).join('') || '<span class="muted">Герои ещё не призваны</span>';
    const box = this.modal(mine ? 'Мой профиль' : 'Профиль правителя', `
      <div class="pf-head" style="--c:${race?.color}">
        <img class="pf-ava" src="${avatarUrl(p.avatar)}" alt="">
        <div class="pf-main">
          <h3>${esc(p.name)}</h3>
          <div>${esc(p.username)}${p.title ? ` · <i class="pf-title">${esc(p.title)}</i>` : ''}</div>
          <div class="pf-chips"><span class="race-chip" style="--c:${race?.color}">${race?.name}</span>
            <span class="race-chip" style="--c:${p.league.color}">${p.league.icon} ${p.league.name}</span>
            <span>🏆 ${fmt(p.trophies)}</span><span>#${p.rank}</span></div>
          <div class="muted">${seen} · в игре с ${new Date(p.created).toLocaleDateString('ru-RU')} · ${p.x}:${p.y}</div>
          ${p.motto ? `<div class="pf-motto">«${esc(p.motto)}»</div>` : ''}
        </div>
      </div>
      <div class="pf-stats">
        ${stat('Цитадель', p.level)}${stat('Побед в атаках', fmt(s.wins))}${stat('Звёзд', fmt(s.starsTotal))}
        ${stat('Отбито атак', fmt(s.defWins))}${stat('Разрушено', fmt(s.destroyed || 0))}${stat('Лагерей NPC', fmt(s.npcWins || 0))}
        ${stat('Награблено золота', fmt(s.goldLooted || 0))}${stat('Глав сюжета', `${p.story}/10`)}
      </div>
      <h4>Герои</h4><div class="pf-heroes">${heroes}</div>
      <h4>Достижения</h4><div class="medals">${medals}</div>`, [
      ...(mine ? [
        { label: '✏ Изменить', cls: 'blue', onClick: () => this.editProfile() },
        { label: '🏅 Достижения', cls: 'green', onClick: () => this.openAchievements() },
      ] : [
        { label: '🗺 На карте', onClick: () => { this.closeModal(); this.app.openWorld(p.x, p.y); } },
        { label: '👁 Осмотреть замок', cls: 'blue', onClick: () => { this.closeModal(); this.app.visit(p.id); } },
        { label: p.shield ? '🛡 Под щитом' : '⚔ Атаковать', cls: 'red', disabled: !!p.shield, onClick: () => this.app.attack({ kind: 'player', id: p.id }) },
      ]),
    ], 'wide');
    return box;
  }

  editProfile() {
    const me = this.app.me;
    const st = { heroes: me.heroes, achievements: Object.fromEntries((me.achievements || []).map((a) => [a.id, a.claimed])) };
    const avs = AVATARS.map((a) => {
      const ok = avatarUnlocked(st, a);
      return `<button class="ava-opt ${a.id === me.avatar ? 'on' : ''} ${ok ? '' : 'locked'}" data-av="${a.id}" ${ok ? '' : 'disabled'} title="${ok ? '' : 'Откроется с героем или достижением'}"><img src="${url(a.img)}" alt=""></button>`;
    }).join('');
    const titles = titlesOf({ achievements: st.achievements });
    const box = this.modal('Изменить профиль', `
      <label class="field">Девиз<input id="pf-motto" maxlength="80" value="${esc(me.motto || '')}" placeholder="Сталь и честь!"></label>
      <div class="field">Аватар</div><div class="ava-grid">${avs}</div>
      <label class="field">Титул<select id="pf-title"><option value="">— без титула —</option>${titles.map((t) => `<option ${t === me.title ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      ${titles.length ? '' : '<p class="muted">Титулы дают золотые ступени достижений.</p>'}`, [
      { label: 'Сохранить', cls: 'green', onClick: async () => {
        try {
          const r = await this.app.api.saveProfile({ motto: $('#pf-motto').value, avatar: box.querySelector('.ava-opt.on')?.dataset.av, title: $('#pf-title').value });
          this.app.setMe(r.me);
          this.openProfile(me.id);
        } catch (e) { this.toast(e.message, 'bad'); }
      } },
    ]);
    box.querySelectorAll('.ava-opt:not(.locked)').forEach((b) => {
      b.onclick = () => { box.querySelectorAll('.ava-opt').forEach((x) => x.classList.remove('on')); b.classList.add('on'); };
    });
  }

  openAchievements() {
    const me = this.app.me;
    this.pendingKind = 'ach';
    this.pendingRefresh = () => this.openAchievements();
    const byId = Object.fromEntries((me.achievements || []).map((a) => [a.id, a]));
    const rows = ACHIEVEMENTS.map((a) => {
      const s = byId[a.id] || { value: 0, reached: 0, claimed: 0 };
      const tier = Math.min(2, s.claimed);
      const goal = a.tiers[tier];
      const done = s.claimed >= 3;
      const can = s.reached > s.claimed;
      const pct = done ? 100 : Math.min(100, s.value / goal * 100);
      return `<div class="ach ${done ? 'done' : ''}">
        <div class="ach-medal t${s.claimed}">${['🎖', '🥉', '🥈', '🥇'][s.claimed]}</div>
        <div class="ach-body"><b>${esc(a.name)}</b> <span class="muted">${'★'.repeat(s.claimed)}${'☆'.repeat(3 - s.claimed)}</span>
          <div class="muted">${done ? `Титул: «${esc(a.title)}»` : a.desc.replace('{n}', fmt(goal))}</div>
          <div class="ach-bar"><div style="width:${pct}%"></div><span>${fmt(Math.min(s.value, goal))} / ${fmt(goal)}</span></div></div>
        ${can ? `<button class="btn sm green" data-claim="${a.id}">Забрать 💎 ${a.gems[s.claimed]}</button>` : done ? '<span class="ach-ok">✔</span>' : `<span class="muted">💎 ${a.gems[tier]}</span>`}
      </div>`;
    }).join('');
    const box = this.modal('Достижения', rows, [], 'wide');
    box.querySelectorAll('[data-claim]').forEach((b) => {
      b.onclick = () => this.app.act('claimAchievement', { id: b.dataset.claim }).then((r) => { this.toast(`+${r.gems} 💎`, 'good'); this.app.sfx('coin'); });
    });
  }

  openReports() {
    const me = this.app.me;
    this.app.seenReports = Date.now();
    try { localStorage.setItem('ck_seen', String(this.app.seenReports)); } catch { /* ignore */ }
    this.updateHud(me);
    const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
    const rows = (me.reports || []).map((r) => `<div class="report ${r.type}">
      <div class="r-head">${r.type === 'defense' ? `🛡 На вас напал <b>${esc(r.attacker)}</b>` : `⚔ Атака: <b>${esc(r.target)}</b>`}
        <span class="muted">${new Date(r.ts).toLocaleString('ru-RU')}</span></div>
      <div class="r-body"><span class="stars">${stars(r.stars)}</span> ${r.pct}%
        · ${ico('gold')} ${r.type === 'defense' ? '−' : '+'}${fmt(r.loot.gold)} · ${ico('food')} ${r.type === 'defense' ? '−' : '+'}${fmt(r.loot.food)}
        ${r.trophies ? ` · 🏆 ${r.trophies > 0 ? '+' : ''}${r.trophies}` : ''}</div></div>`).join('') || '<p class="center muted">Пока сражений не было</p>';
    const s = me.stats;
    this.modal('Отчёты о сражениях', `<p class="muted">Атак: ${s.attacks} (побед ${s.wins}) · Оборон: ${s.defenses} (отбито ${s.defWins})</p>${rows}`, [], 'wide');
  }

  openSettings() {
    this.modal('Настройки', `<p>Игрок: <b>${esc(this.app.me.username)}</b></p>
      <label class="row"><input type="checkbox" id="opt-sound" ${this.app.sound ? 'checked' : ''}> Звуки</label>
      <label class="row"><input type="checkbox" id="opt-music" ${this.app.musicOn ? 'checked' : ''}> Музыка</label>`, [
      { label: 'Выйти из аккаунта', cls: 'red', onClick: () => this.app.logout() },
    ]);
    $('#opt-sound').onchange = (e) => this.app.setSound(e.target.checked);
    $('#opt-music').onchange = (e) => this.app.setMusic(e.target.checked);
  }

  // --- Чат ---------------------------------------------------------------------------
  toggleChat(force) {
    const el = $('#chat');
    const on = force ?? !el.classList.contains('show');
    el.classList.toggle('show', on);
    if (on) { $('#btn-chat .badge').classList.add('hidden'); this.unreadChat = 0; $('#chat-input').focus(); }
  }

  chatMessage(m) {
    const box = $('#chat-log');
    const d = document.createElement('div');
    d.className = 'msg' + (m.player === this.app.me?.id ? ' mine' : '');
    d.innerHTML = `<b class="link" data-pid="${m.player}">${esc(m.name)}</b> <span class="muted">${new Date(m.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span><div>${esc(m.text)}</div>`;
    box.appendChild(d);
    while (box.children.length > 80) box.firstChild.remove();
    box.scrollTop = box.scrollHeight;
    if (!$('#chat').classList.contains('show') && m.live) {
      this.unreadChat = (this.unreadChat || 0) + 1;
      const b = $('#btn-chat .badge'); b.textContent = this.unreadChat; b.classList.remove('hidden');
    }
  }

  // --- Бой ----------------------------------------------------------------------------
  // Звезда вылетает в центр экрана и улетает на своё место
  starPop(i) {
    const el = document.createElement('div');
    el.className = 'star-pop';
    el.innerHTML = `<img class="glow" src="${url('fx/fx_star')}" alt=""><img src="${url('ui/star')}" alt="">`;
    document.body.appendChild(el);
    const target = document.querySelectorAll('#bt-stars img')[i];
    const r = target?.getBoundingClientRect() || { left: innerWidth / 2, top: 40, width: 30 };
    const a = el.animate([
      { transform: `translate(${innerWidth / 2 - 60}px, ${innerHeight / 2 - 60}px) scale(.2) rotate(-90deg)`, opacity: 0 },
      { transform: `translate(${innerWidth / 2 - 60}px, ${innerHeight / 2 - 60}px) scale(1.2) rotate(0)`, opacity: 1, offset: 0.35 },
      { transform: `translate(${innerWidth / 2 - 60}px, ${innerHeight / 2 - 60}px) scale(1) rotate(0)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${r.left + r.width / 2 - 60}px, ${r.top + r.width / 2 - 60}px) scale(.25)`, opacity: 1 },
    ], { duration: 1300, easing: 'ease-in-out' });
    a.onfinish = () => el.remove();
    this.app.sfx('star');
  }

  battleHud(battle) {
    this.lastStars = 0;
    const d = battle.data;
    $('#bt-name').textContent = d.name;
    $('#bt-sub').innerHTML = d.info.owner ? `${esc(d.info.owner)} · ур. ${d.info.level} · 🏆 ${d.info.trophies}` : `Уровень ${d.info.level}`;
    $('#bt-end').onclick = () => {
      if (!battle.started) { this.app.goHome(); return; }
      this.modal('Завершить бой?', '<p>Оставшиеся войска вернутся в лагерь.</p>', [{ label: 'Завершить', cls: 'red', onClick: () => { this.closeModal(); battle.surrender(); } }]);
    };
    $('#bt-loot-max').innerHTML = `${ico('gold')} ${fmt(battle.lootMax.gold)} &nbsp; ${ico('food')} ${fmt(battle.lootMax.food)}`;
    this.battleCards(battle);
  }

  battleCards(battle) {
    const S = battle.S, wrap = $('#bt-cards');
    const cards = [];
    for (const [k, n] of Object.entries(S.left.troops)) if (n > 0 || S.used.troops[k]) cards.push({ kind: 'troop', k, n: n - battle.queued('troop', k), img: 'troops/' + k });
    for (const k of Object.keys(battle.data.attacker.heroes)) {
      const alive = S.units.find((u) => u.isHero && u.kind === k);
      if (S.left.heroes[k] && !battle.queued('hero', k)) cards.push({ kind: 'hero', k, n: 1, img: `heroes/${k}_portrait`, hero: true });
      else if (alive && !alive.abilityUsed && !battle.queued('ability', k)) cards.push({ kind: 'ability', k, n: 1, img: `heroes/${k}_portrait`, hero: true, ability: true });
      else cards.push({ kind: 'hero', k, n: 0, img: `heroes/${k}_portrait`, hero: true });
    }
    for (const [k, n] of Object.entries(S.left.spells)) if (n > 0 || S.used.spells[k]) cards.push({ kind: 'spell', k, n: n - battle.queued('spell', k), img: spellIcon(k) });
    const key = cards.map((c) => `${c.kind}${c.k}${c.n}`).join() + (battle.sel ? battle.sel.kind + battle.sel.k : '');
    if (key === this.cardsKey) return;
    this.cardsKey = key;
    wrap.innerHTML = '';
    if (battle.sel && !cards.some((c) => c.kind === battle.sel.kind && c.k === battle.sel.k && c.n > 0)) battle.sel = null;
    for (const c of cards) {
      const el = document.createElement('button');
      const on = battle.sel && battle.sel.kind === c.kind && battle.sel.k === c.k;
      el.className = `bcard ${c.kind} ${on ? 'on' : ''} ${c.n > 0 ? '' : 'empty'}`;
      el.innerHTML = `<img src="${url(c.img)}" alt=""><span class="n">${c.ability ? '✨' : c.hero ? '' : '×' + Math.max(0, c.n)}</span>`;
      el.title = (c.kind === 'hero' || c.kind === 'ability' ? HEROES[c.k].name : c.kind === 'spell' ? SPELLS[c.k].name : TROOPS[c.k].name) + (c.ability ? ': ' + HEROES[c.k].ability.name : '');
      el.onclick = () => {
        if (c.n <= 0) return;
        if (c.ability) { battle.ability(c.k); return; }
        battle.select(on ? null : { kind: c.kind, k: c.k });
      };
      wrap.appendChild(el);
    }
  }

  battleTick(battle) {
    const st = battle.liveStats();
    $('#bt-pct').textContent = st.pct + '%';
    $('#bt-bar').style.width = st.pct + '%';
    if (st.stars > (this.lastStars || 0)) this.starPop(this.lastStars || 0);
    this.lastStars = st.stars;
    $('#bt-stars').innerHTML = [0, 1, 2].map((i) => `<img src="${url(i < st.stars ? 'ui/star' : 'ui/star_empty')}" alt="">`).join('');
    $('#bt-timer').textContent = battle.started ? fmtTime(st.time) : `Разведка: ${Math.ceil(battle.scout)}с`;
    $('#bt-timer').classList.toggle('scout', !battle.started);
    $('#bt-loot').innerHTML = `${ico('gold')} ${fmt(st.loot.gold)} &nbsp; ${ico('food')} ${fmt(st.loot.food)}`;
    $('#bt-end').textContent = battle.started ? 'Завершить' : 'Отступить';
    this.battleCards(battle);
  }

  battleEnding() { $('#bt-end').disabled = true; }

  battleResult(battle, r) {
    $('#bt-end').disabled = false;
    const win = r.stars > 0;
    const stars = [0, 1, 2].map((i) => `<img class="rs ${i < r.stars ? 'on' : ''}" style="animation-delay:${0.3 + i * 0.35}s" src="${url(i < r.stars ? 'ui/star' : 'ui/star_empty')}" alt="">`).join('');
    this.modal(win ? 'Победа!' : 'Поражение', `
      <div class="result ${win ? 'win' : 'lose'}">
        <div class="r-stars">${stars}</div>
        <div class="r-pct">Разрушено: <b>${r.pct}%</b></div>
        <div class="r-loot">${ico('gold', 'ri big')} +${fmt(r.got?.gold || 0)} &nbsp; ${ico('food', 'ri big')} +${fmt(r.got?.food || 0)}</div>
        ${r.trophies ? `<div class="r-tro">🏆 ${r.trophies > 0 ? '+' : ''}${r.trophies}</div>` : ''}
        ${r.storyReward ? `<div class="r-tro">Награда главы: 💎 +${r.storyReward.gems}</div>` : ''}
      </div>`, [{ label: 'Домой', cls: 'green', onClick: () => { this.closeModal(); this.app.goHome(); this.app.story.afterBattle(r); } }], 'result-modal');
    this.app.sfx(win ? 'win' : 'lose');
  }
}

export function spellIcon(k) {
  return ['fireball', 'lightning', 'heal', 'rage'].includes(k) ? 'spells/' + k : 'spells/fx_' + k;
}

function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} мин назад`;
  if (s < 86400) return `${Math.round(s / 3600)} ч назад`;
  return `${Math.round(s / 86400)} дн назад`;
}
