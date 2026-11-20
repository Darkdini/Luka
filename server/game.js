// Серверная игровая логика: состояние игрока, экономика, стройка, армия.
// Сервер — единственный источник правды: клиент лишь присылает намерения.
import {
  BUILDINGS, TROOPS, SPELLS, HEROES, RACES, START, RES_LIST, RES_GEN, LEGACY_TYPES, RUIN_REWARD,
  BUILDER_GEM_COST, MAX_BUILDERS, BATTLE,
  buildCost, upgradeTime, wallCost, gemsForTime, gemsForResources, castleLevelOf, countOf, maxLevelOf,
  storageCap, armyCapacity, armyUsed, spellCapacity, barracksLevel, collectorCap, rateOf, buildingPower,
  heroMaxLevel, heroUpgradeCost, heroUpgradeTime, forgeCost, forgeTime,
} from '../shared/config.js';
import { achievementStatus } from '../shared/achievements.js';
import { migrateHeroes, heroActions, heroView, HeroError, teamOf } from './heroes.js';
import { migrateTroops, tickTroops, troopActions, troopView, TroopError } from './troops.js';
import { migrateMeta, tickMeta, metaActions, metaView, MetaError, passXp } from './meta.js';
import { mods } from '../shared/meta.js';
import { migrateEvent, eventPts, eventActions, eventView, EventError } from './events.js';
import { CASTLE_POS, CAPTURED, STARTER, wallTiles, cityRect, fits, blockedBy, autoPlace, genRuins, inCity, RUIN_SIZE } from '../shared/city.js';
import { stageEnemies, HERO } from '../shared/heroes.js';
import { simulate } from '../shared/herobattle.js';
import { chapterById } from '../shared/story.js';
import { TUTORIAL, STREAK, DAILY_BONUS_GEMS, questCtx, dailyQuests, today } from '../shared/quests.js';

export class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

// --- Детерминированный ГСЧ (для раскладки декора, NPC и т.п.) ---------------
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Новый игрок --------------------------------------------------------------
export function newPlayerState(race, seed) {
  const now = Date.now();
  const s = {
    v: 1, race,
    res: { ...START },
    buildings: [], decor: [], nextId: 1, builders: 2,
    army: {}, training: [], spells: {}, brewing: [],
    troopLevels: {}, forge: null,
    heroes: {},
    trophies: 0,
    shieldUntil: now + BATTLE.newPlayerShieldH * 3600e3,
    lockUntil: 0,
    lastDaily: 0,
    npc: {},
    reports: [],
    stats: {},
    achievements: {},
    story: {},
    city: 3, seed,
  };
  for (const st of STARTER) {
    const b = { id: s.nextId++, type: st.type, level: 1, x: st.x, y: st.y, up: null };
    // стартовые постройки наполовину полны — первый сбор сразу радует
    if (BUILDINGS[st.type].produces) { b.store = collectorCap(b) * 0.5; b.last = now; }
    s.buildings.push(b);
  }
  for (const c of CAPTURED) s.buildings.push({ id: s.nextId++, type: c.type, level: 0, x: c.x, y: c.y, up: null, captured: true, enemy: c.enemy });
  s.army = { swordsman: 10, crossbowman: 6 };
  s.wallLevel = 1;
  const g = genRuins(seed, s, s.nextId);
  s.decor = g.decor; s.nextId = g.nextId;
  migrate(s);
  return s;
}

// Перевод старых сохранений (ячейки, оборона, хижины строителей) на свободную сетку
export function migrateCity(s) {
  if (s.city >= 3) return;
  const now = Date.now();
  for (const r of RES_LIST) s.res[r] = Math.max(s.res[r] || 0, START[r] || 0);
  s.builders = Math.max(2, Math.min(MAX_BUILDERS, s.buildings.filter((b) => b.type === 'builderhut').length));
  const old = s.buildings;
  const castle = old.find((b) => b.type === 'castle') || { id: s.nextId++, type: 'castle', level: 1 };
  s.buildings = [{ ...castle, x: CASTLE_POS.x, y: CASTLE_POS.y, up: castle.up || null }];
  s.decor = [];
  const cl = castleLevelOf(s);
  const counts = {};
  for (const b0 of old) {
    const type = LEGACY_TYPES[b0.type] || b0.type;
    const def = BUILDINGS[type];
    if (!def || type === 'castle' || def.cat === 'wall') continue;
    counts[type] = (counts[type] || 0) + 1;
    if (counts[type] > def.countByCastle[cl - 1]) continue;
    const at = autoPlace(s, def.size, cl);
    if (!at) continue;
    const b = { id: b0.id, type, level: Math.min(b0.level, maxLevelOf(type, cl)), x: at.x, y: at.y, up: b0.up || null };
    if (def.produces) { b.store = 0; b.last = now; }
    s.buildings.push(b);
  }
  // недостающие сюжетные здания — захвачены врагом
  for (const c of CAPTURED) {
    if (s.buildings.some((b) => b.type === c.type)) continue;
    const at = fits(s, c.x, c.y, 3, cl) ? c : autoPlace(s, 3, cl);
    if (at) s.buildings.push({ id: s.nextId++, type: c.type, level: 0, x: at.x, y: at.y, up: null, captured: true, enemy: c.enemy });
  }
  const g = genRuins(s.seed || s.nextId * 31, s, s.nextId);
  s.decor = g.decor; s.nextId = g.nextId;
  s.city = 3;
}

// Старые сохранения дополняются новыми полями
const STAT_KEYS = ['liberated', 'ruinsCleared', 'attacks', 'wins', 'defenses', 'defWins', 'starsTotal', 'goldLooted', 'foodLooted', 'destroyed', 'npcWins', 'trained', 'cleared', 'trophiesMax', 'collectedGold', 'collectedFood', 'upgrades', 'speedups', 'mottoSet'];
export function migrate(s) {
  migrateHeroes(s);
  migrateTroops(s);
  migrateMeta(s);
  migrateEvent(s);
  s.stats = s.stats || {};
  for (const k of STAT_KEYS) s.stats[k] = s.stats[k] || 0;
  s.achievements = s.achievements || {};
  s.story = s.story || {};
  s.npc = s.npc || {};
  s.tutorial = s.tutorial || 0;
  s.wallLevel = Math.max(1, s.wallLevel || 0);
  migrateCity(s);
  s.builders = s.builders || 2;
  for (const r of RES_LIST) s.res[r] = s.res[r] || 0;
  s.streak = s.streak || { count: 0, last: 0 };
  ensureDaily(s);
  return s;
}

// --- Ежедневные задания ----------------------------------------------------------
export function ensureDaily(s) {
  const d = today();
  if (!s.daily || s.daily.day !== d) s.daily = { day: d, c: {}, claimed: [false, false, false], bonus: false };
  return s.daily;
}
export function bumpDaily(s, key, n = 1) {
  const d = ensureDaily(s);
  d.c[key] = (d.c[key] || 0) + n;
  passXp(s, key, n);
  eventPts(s, key, n);
}
function questContext(s) {
  return questCtx({ buildings: s.buildings, stats: s.stats, story: s.story, achClaimed: Object.values(s.achievements).reduce((a, v) => a + v, 0), wallLevel: s.wallLevel, summon: s.summon, campaign: s.campaign, ally: s._ally, tech: s.tech });
}
export function grant(s, r) {
  if (r.gems) s.res.gems += r.gems;
  const got = { gems: r.gems || 0 };
  for (const k of RES_LIST) if (r[k]) got[k] = addRes(s, k, r[k]);
  if (r.book) { s.items.book += r.book; got.book = r.book; }
  if (r.ticket) { s.items.ticket += r.ticket; got.ticket = r.ticket; }
  return got;
}

// --- Течение времени ------------------------------------------------------------
export function tick(s, now = Date.now()) {
  migrate(s);
  const raceBonus = RACES[s.race]?.bonus.goldRate || 0;
  const md = mods(s);
  for (const b of s.buildings) {
    const def = BUILDINGS[b.type];
    if (def.produces && b.level > 0) {
      // во время улучшения здание не работает (как и положено стройке)
      if (!b.up) {
        const rate = rateOf(b.type, b.level) * (1 + raceBonus + (md[def.produces] || 0));
        b.store = Math.min(collectorCap(b), (b.store || 0) + rate * Math.max(0, now - b.last) / 3600e3);
      }
      b.last = now;
    }
    if (b.up && b.up.end <= now) {
      b.level = b.up.to;
      b.up = null;
      if (def.produces) { b.last = now; b.store = b.store || 0; }
    }
  }
  // Обучение войск: очередь последовательная (параллелизм — через число казарм)
  while (s.training.length && s.training[0].end <= now) {
    const t = s.training.shift();
    s.army[t.k] = (s.army[t.k] || 0) + 1;
  }
  while (s.brewing.length && s.brewing[0].end <= now) {
    const t = s.brewing.shift();
    s.spells[t.k] = (s.spells[t.k] || 0) + 1;
  }
  if (s.forge && s.forge.end <= now) {
    s.troopLevels[s.forge.k] = s.forge.to;
    s.forge = null;
  }
  for (const h of Object.values(s.heroes)) if (h.up && h.up.end <= now) { h.level = h.up.to; h.up = null; }
  tickTroops(s, now);
  tickMeta(s, now);
  clampRes(s);
  return s;
}

function clampRes(s) {
  for (const r of RES_LIST) s.res[r] = Math.max(0, Math.min(s.res[r] || 0, Math.max(storageCap(s, r), START[r] || 0)));
}

const builders = (s) => s.builders || 2;
const busy = (s) => s.buildings.filter((b) => b.up).length;
const freeBuilder = (s) => busy(s) < builders(s);

function pay(s, res, amount) {
  if (amount <= 0) return;
  if ((s.res[res] || 0) < amount) fail(`Не хватает ${RES_GEN[res] || res}`);
  s.res[res] -= amount;
}
function payCost(s, cost) {
  for (const [r, v] of Object.entries(cost)) if ((s.res[r] || 0) < v) fail(`Не хватает ${RES_GEN[r] || r}: нужно ещё ${Math.ceil(v - (s.res[r] || 0)).toLocaleString('ru-RU')}`);
  for (const [r, v] of Object.entries(cost)) s.res[r] -= v;
}
// Сила королевства: здания + герои отряда
export function cityPower(s) {
  return s.buildings.reduce((t, b) => t + (b.captured ? 0 : buildingPower(b.type, b.level)), 0);
}
function addRes(s, res, amount) {
  if (res === 'gems') { s.res.gems += amount; return amount; }
  const cap = storageCap(s, res);
  const before = s.res[res];
  s.res[res] = Math.min(cap, s.res[res] + amount);
  return s.res[res] - before;
}

// --- Действия игрока ------------------------------------------------------------
const buildTime = (s, type, to) => Math.round(upgradeTime(type, to) * Math.max(0.3, 1 - (RACES[s.race]?.bonus.buildSpeed || 0) - (mods(s).build || 0)));

export const actions = {
  // Новое здание в свободном месте сетки
  place(s, { type, x, y }) {
    const def = BUILDINGS[type];
    if (!def || type === 'castle' || def.cat === 'wall') fail('Нельзя построить');
    x |= 0; y |= 0;
    const cl = castleLevelOf(s);
    const limit = def.countByCastle[cl - 1];
    if (!limit) fail(`Откроется на Цитадели ${def.countByCastle.findIndex((v) => v > 0) + 1} ур.`);
    if (countOf(s, type) >= limit) fail('Достигнут лимит. Улучшите Цитадель');
    if (!fits(s, x, y, def.size, cl)) {
      const bl = inCity(x, y, def.size, cl) && blockedBy(s, x, y, def.size);
      fail(bl?.ruin ? 'Сначала расчистите руины' : inCity(x, y, def.size, cl) ? 'Место занято' : 'Эта земля ещё не расчищена');
    }
    const time = buildTime(s, type, 1);
    if (time > 0 && !freeBuilder(s)) fail('Все строители заняты');
    payCost(s, buildCost(type, 1));
    if (time > 0) { s.stats.upgrades++; bumpDaily(s, 'upgrades'); }
    const b = { id: s.nextId++, type, level: time > 0 ? 0 : 1, x, y, up: time > 0 ? { to: 1, end: Date.now() + time * 1000, total: time } : null };
    if (def.produces) { b.store = 0; b.last = Date.now(); }
    s.buildings.push(b);
    return { id: b.id };
  },

  upgrade(s, { id }) {
    const b = s.buildings.find((v) => v.id === id) || fail('Здание не найдено');
    if (b.captured) fail('Здание захвачено врагом — сначала отвоюйте его');
    if (b.up) fail('Уже улучшается');
    const cl = castleLevelOf(s);
    if (b.level >= maxLevelOf(b.type, cl)) fail(b.type === 'castle' ? 'Максимальный уровень' : 'Сначала улучшите Цитадель');
    const to = b.level + 1;
    const time = buildTime(s, b.type, to);
    if (time > 0 && !freeBuilder(s)) fail('Все строители заняты');
    payCost(s, buildCost(b.type, to));
    if (time > 0) { s.stats.upgrades++; bumpDaily(s, 'upgrades'); }
    if (time <= 0) b.level = to;
    else b.up = { to, end: Date.now() + time * 1000, total: time };
  },

  // «Сейчас»: самоцветы за недостающие ресурсы и за время — без строителя, мгновенно
  upgradeNow(s, { id }) {
    const b = s.buildings.find((v) => v.id === id) || fail('Здание не найдено');
    if (b.captured) fail('Здание захвачено врагом — сначала отвоюйте его');
    if (b.up) fail('Уже улучшается');
    const cl = castleLevelOf(s);
    if (b.level >= maxLevelOf(b.type, cl)) fail(b.type === 'castle' ? 'Максимальный уровень' : 'Сначала улучшите Цитадель');
    const to = b.level + 1;
    const cost = buildCost(b.type, to);
    let missing = 0;
    for (const [r, v] of Object.entries(cost)) missing += Math.max(0, v - (s.res[r] || 0));
    pay(s, 'gems', gemsForTime(buildTime(s, b.type, to)) + gemsForResources(missing));
    for (const [r, v] of Object.entries(cost)) s.res[r] = Math.max(0, (s.res[r] || 0) - v);
    b.level = to;
    if (BUILDINGS[b.type].produces) { b.last = Date.now(); b.store = b.store || 0; }
    s.stats.upgrades++; s.stats.speedups++;
    bumpDaily(s, 'upgrades');
    return { level: b.level };
  },

  // Крепостная стена: строится и улучшается целиком, мгновенно
  wallUpgrade(s) {
    if (s.wallLevel >= castleLevelOf(s)) fail('Сначала улучшите Цитадель');
    payCost(s, { stone: wallCost(s.wallLevel + 1) });
    s.wallLevel++;
    s.stats.upgrades++;
    return { wallLevel: s.wallLevel };
  },

  speedup(s, { id }) {
    const b = s.buildings.find((v) => v.id === id) || fail('Здание не найдено');
    if (!b.up) fail('Нечего ускорять');
    pay(s, 'gems', gemsForTime((b.up.end - Date.now()) / 1000));
    b.up.end = Date.now();
    s.stats.speedups++;
    tick(s);
  },

  // Переставить здание на свободное место
  move(s, { id, x, y }) {
    const b = s.buildings.find((v) => v.id === id) || fail('Здание не найдено');
    if (b.captured) fail('Захваченное здание не переносится');
    x |= 0; y |= 0;
    const size = BUILDINGS[b.type].size;
    if (!fits(s, x, y, size, castleLevelOf(s), b.id)) fail('Место занято или закрыто');
    b.x = x; b.y = y;
  },

  collect(s, { id }) {
    const list = id ? s.buildings.filter((b) => b.id === id) : s.buildings;
    const got = {};
    for (const b of list) {
      const def = BUILDINGS[b.type];
      if (!def.produces || !b.store) continue;
      const added = addRes(s, def.produces, Math.floor(b.store));
      b.store -= added;
      got[def.produces] = (got[def.produces] || 0) + added;
    }
    if (got.gold) { s.stats.collectedGold += got.gold; bumpDaily(s, 'gold', got.gold); }
    if (got.food) { s.stats.collectedFood += got.food; bumpDaily(s, 'food', got.food); }
    return { collected: got };
  },

  // Расчистка руин: бесплатно и мгновенно, награда — ресурс
  removeDecor(s, { id }) {
    const i = s.decor.findIndex((d) => d.id === id);
    if (i < 0) fail('Не найдено');
    const d = s.decor[i];
    if (!inCity(d.x, d.y, RUIN_SIZE, castleLevelOf(s))) fail('Эта земля ещё не открыта');
    s.decor.splice(i, 1);
    s.stats.cleared++;
    s.stats.ruinsCleared++;
    const got = grant(s, RUIN_REWARD[d.kind] || { wood: 200 });
    return { got };
  },

  // Захваченное здание: бой героями (сервер считает, клиент проигрывает журнал)
  liberate(s, { id }) {
    const b = s.buildings.find((v) => v.id === id) || fail('Здание не найдено');
    if (!b.captured) fail('Здание уже наше');
    const team = teamOf(s);
    if (!team.some(Boolean)) fail('Поставьте героев в отряд');
    const enemies = stageEnemies(b.enemy || 1);
    const battle = simulate(team, enemies);
    let reward = null;
    if (battle.winner === 'a') {
      b.captured = false;
      s.stats.liberated++;
      reward = grant(s, { wood: 600 * (b.enemy || 1), stone: 300 * (b.enemy || 1), gems: 20, book: 2 });
    }
    return { battle, reward, enemies, stage: b.enemy || 1, building: b.type };
  },

  // Ещё один строитель за самоцветы
  buyBuilder(s) {
    const n = builders(s);
    if (n >= MAX_BUILDERS) fail('Максимум строителей');
    pay(s, 'gems', BUILDER_GEM_COST[n]);
    s.builders = n + 1;
    return { builders: s.builders };
  },

  train(s, { k, n = 1 }) {
    const t = TROOPS[k] || fail('Неизвестный отряд');
    n = Math.max(1, Math.min(50, n | 0));
    if (barracksLevel(s) < t.barracks) fail(`Нужны Казармы ${t.barracks} ур.`);
    const queued = s.training.reduce((a, q) => a + TROOPS[q.k].space, 0);
    if (armyUsed(s.army) + queued + t.space * n > armyCapacity(s)) fail('Лагерь переполнен');
    pay(s, 'food', t.cost * n);
    s.stats.trained += n;
    bumpDaily(s, 'trained', n);
    const nb = Math.max(1, s.buildings.filter((b) => b.type === 'barracks' && b.level > 0).length);
    let end = Math.max(Date.now(), s.training.length ? s.training[s.training.length - 1].end : 0);
    for (let i = 0; i < n; i++) {
      end += t.time * 1000 / nb * (1 - (RACES[s.race]?.bonus.trainSpeed || 0));
      s.training.push({ k, end });
    }
  },

  untrain(s, { index }) {
    const q = s.training[index] || fail('Нет в очереди');
    const t = TROOPS[q.k];
    const dur = (index === 0 ? q.end - Date.now() : q.end - s.training[index - 1].end);
    s.training.splice(index, 1);
    for (let i = index; i < s.training.length; i++) s.training[i].end -= Math.max(0, dur);
    addRes(s, 'food', t.cost);
  },

  speedupTraining(s) {
    if (!s.training.length && !s.brewing.length) fail('Очередь пуста');
    const last = Math.max(s.training.at(-1)?.end || 0, s.brewing.at(-1)?.end || 0);
    pay(s, 'gems', gemsForTime((last - Date.now()) / 1000));
    for (const q of s.training) q.end = Date.now();
    for (const q of s.brewing) q.end = Date.now();
    s.stats.speedups++;
    tick(s);
  },

  brew(s, { k }) {
    const sp = SPELLS[k] || fail('Неизвестное заклинание');
    const tower = s.buildings.find((b) => b.type === 'academy' && b.level > 0);
    if (!tower || tower.level < sp.tower) fail(`Нужна Академия ${sp.tower} ур.`);
    const have = Object.values(s.spells).reduce((a, v) => a + v, 0) + s.brewing.length;
    if (have >= spellCapacity(s)) fail('Запас зелий полон');
    pay(s, 'food', sp.cost);
    const end = Math.max(Date.now(), s.brewing.at(-1)?.end || 0) + sp.time * 1000 * (1 - (RACES[s.race]?.bonus.brewSpeed || 0));
    s.brewing.push({ k, end });
  },

  forge(s, { k }) {
    const t = TROOPS[k] || fail('Неизвестный отряд');
    const f = s.buildings.find((b) => b.type === 'forge' && b.level > 0) || fail('Постройте Кузницу');
    if (s.forge) fail('Кузница занята');
    if (barracksLevel(s) < t.barracks) fail('Сначала откройте этот отряд');
    const cur = s.troopLevels[k] || 1;
    if (cur >= f.level + 1) fail('Улучшите Кузницу');
    const to = cur + 1;
    pay(s, 'food', forgeCost(to));
    s.forge = { k, to, end: Date.now() + forgeTime(to) * 1000, total: forgeTime(to) };
  },

  speedupForge(s) {
    if (!s.forge) fail('Нечего ускорять');
    pay(s, 'gems', gemsForTime((s.forge.end - Date.now()) / 1000));
    s.forge.end = Date.now();
    tick(s);
  },

  heroUnlock(s, { k }) {
    const h = HEROES[k] || fail('Неизвестный герой');
    if (s.heroes[k]) fail('Уже призван');
    if (!s.buildings.some((b) => b.type === 'altar' && b.level > 0)) fail('Постройте Алтарь героев');
    if (castleLevelOf(s) < h.castle) fail(`Нужна Цитадель ${h.castle} ур.`);
    pay(s, h.res, h.unlock);
    s.heroes[k] = { level: 1, up: null };
  },

  heroUpgrade(s, { k }) {
    const h = s.heroes[k] || fail('Герой не призван');
    if (h.up) fail('Уже тренируется');
    if (h.level >= heroMaxLevel(castleLevelOf(s))) fail('Улучшите Цитадель');
    const to = h.level + 1;
    pay(s, HEROES[k].res, heroUpgradeCost(k, to));
    const time = heroUpgradeTime(to);
    h.up = { to, end: Date.now() + time * 1000, total: time };
  },

  heroSpeedup(s, { k }) {
    const h = s.heroes[k];
    if (!h?.up) fail('Нечего ускорять');
    pay(s, 'gems', gemsForTime((h.up.end - Date.now()) / 1000));
    h.up.end = Date.now();
    tick(s);
  },

  buyResources(s, { res, amount }) {
    if (!RES_LIST.includes(res)) fail('Неверный ресурс');
    const space = storageCap(s, res) - s.res[res];
    amount = Math.min(Math.max(0, amount | 0), space);
    if (amount <= 0) fail('Хранилище заполнено');
    pay(s, 'gems', gemsForResources(amount));
    s.res[res] += amount;
  },

  claimAchievement(s, { id }) {
    const a = achievementStatus(s).find((v) => v.id === id) || fail('Достижение не найдено');
    if (a.claimed >= a.reached) fail('Награда пока недоступна');
    const gems = a.gems[a.claimed];
    s.achievements[id] = a.claimed + 1;
    s.res.gems += gems;
    return { gems, tier: a.claimed + 1 };
  },

  storyChoice(s, { id, option }) {
    const ch = chapterById(id) || fail('Глава не найдена');
    const st = s.story[ch.id];
    if (!ch.choice || !st?.stars) fail('Выбор недоступен');
    if (st.choice != null) fail('Выбор уже сделан');
    const opt = ch.choice.options[option | 0] || fail('Неверный вариант');
    st.choice = option | 0;
    const r = opt.reward || {};
    s.res.gems += r.gems || 0;
    for (const k of RES_LIST) if (r[k]) addRes(s, k, r[k]);
    return { reward: r };
  },

  // Календарь входа: серия дней подряд, 7-й день — королевский сундук
  daily(s) {
    const d = today();
    if (s.streak.last === d) fail('Награда уже получена сегодня');
    s.streak.count = s.streak.last === d - 1 ? s.streak.count % 7 + 1 : 1;
    s.streak.last = d;
    const r = STREAK[s.streak.count - 1];
    const cl = castleLevelOf(s);
    const got = grant(s, { gems: r.gems, gold: (r.gold || 0) * cl, food: (r.food || 0) * cl });
    return { day: s.streak.count, got };
  },

  claimQuest(s) {
    const q = TUTORIAL[s.tutorial] || fail('Обучение пройдено');
    if (!q.done(questContext(s))) fail('Задание ещё не выполнено');
    s.tutorial++;
    return { got: grant(s, q.reward), next: s.tutorial };
  },

  claimDaily(s, { i }) {
    const d = ensureDaily(s);
    const q = dailyQuests(d.day, castleLevelOf(s))[i | 0] || fail('Задание не найдено');
    if (d.claimed[i | 0]) fail('Уже получено');
    if ((d.c[q.counter] || 0) < q.goal) fail('Задание ещё не выполнено');
    d.claimed[i | 0] = true;
    return { got: grant(s, q.reward) };
  },

  claimDailyBonus(s) {
    const d = ensureDaily(s);
    if (d.bonus) fail('Уже получено');
    if (!d.claimed.every(Boolean)) fail('Выполните все три задания');
    d.bonus = true;
    return { got: grant(s, { gems: DAILY_BONUS_GEMS }) };
  },
};

// --- Добыча для атакующего ------------------------------------------------------
// Возвращает здания базы с полем loot (сколько можно унести, разрушив его).
export function lootableBase(s) {
  const out = [];
  const caps = { gold: storageCap(s, 'gold'), food: storageCap(s, 'food') };
  for (const b of s.buildings) {
    if (b.level < 1 || b.captured) continue;
    const def = BUILDINGS[b.type];
    const loot = { gold: 0, food: 0 };
    for (const r of ['gold', 'food']) {
      let share = 0;
      if (def.storage) share = def.storage[b.level - 1];
      else if (def.capacity) share = def.capacity[b.level - 1];
      if (share && caps[r]) loot[r] += Math.floor(s.res[r] * BATTLE.lootStoragePct * share / caps[r]);
    }
    let collector = 0;
    if (def.produces === 'gold' || def.produces === 'food') {
      collector = Math.floor((b.store || 0) * BATTLE.lootCollectorPct);
      loot[def.produces] += collector;
    }
    out.push({ id: b.id, type: b.type, level: b.level, x: b.x, y: b.y, loot, collector });
  }
  out.push(...wallBuildings(s.wallLevel, castleLevelOf(s)));
  return out;
}

export function wallBuildings(level, castleLevel) {
  if (!level) return [];
  return wallTiles(castleLevel).map(([x, y], i) => ({ id: 100000 + i, type: 'wall', level, x, y }));
}

// Публичный вид состояния для клиента (+вычисляемые поля).
export function view(p) {
  const s = p.state;
  return {
    id: p.id, name: p.castle_name, username: p.username, race: s.race,
    realm: p.realm, plot: p.plot,
    res: s.res,
    caps: Object.fromEntries(RES_LIST.map((r) => [r, storageCap(s, r)])),
    power: cityPower(s),
    buildings: s.buildings, decor: s.decor, wallLevel: s.wallLevel,
    builders: { total: builders(s), busy: busy(s) },
    army: s.army, training: s.training, armyCap: armyCapacity(s),
    spells: s.spells, brewing: s.brewing, spellCap: spellCapacity(s),
    troopLevels: s.troopLevels, forge: s.forge,
    heroes: s.heroes,
    trophies: s.trophies, shieldUntil: s.shieldUntil,
    dailyReady: s.streak.last !== today(),
    streak: s.streak,
    tutorial: s.tutorial,
    ...heroView(s),
    ...troopView(s),
    ...metaView(s),
    ...eventView(s),
    daily: { ...ensureDaily(s), quests: dailyQuests(s.daily.day, castleLevelOf(s)) },
    reports: s.reports.slice(0, 20),
    stats: s.stats,
    story: s.story,
    npc: s.npc,
    achievements: achievementStatus(s).map((a) => ({ id: a.id, value: a.value, reached: a.reached, claimed: a.claimed })),
    x: p.wx, y: p.wy, motto: p.motto, avatar: p.avatar, title: p.title,
    now: Date.now(),
  };
}

// Герои: действия подключаются к общему списку; их ошибки — игровые
Object.assign(actions, Object.fromEntries(Object.entries(heroActions({ pay, addRes })).map(([k, fn]) => [k, (s, a) => {
  try { return fn(s, a); } catch (e) { if (e instanceof HeroError) throw new GameError(e.message); throw e; }
}])));

// Войска: действия и ошибки — игровые
Object.assign(actions, Object.fromEntries(Object.entries(troopActions({ pay, payCost, bumpDaily })).map(([k, fn]) => [k, (s, a) => {
  try { return fn(s, a); } catch (e) { if (e instanceof TroopError) throw new GameError(e.message); throw e; }
}])));

// Академия, VIP, пропуск: действия и ошибки — игровые
Object.assign(actions, Object.fromEntries(Object.entries(metaActions({ pay, payCost, grant })).map(([k, fn]) => [k, (s, a) => {
  try { return fn(s, a); } catch (e) { if (e instanceof MetaError) throw new GameError(e.message); throw e; }
}])));

// Событие недели
Object.assign(actions, Object.fromEntries(Object.entries(eventActions({ grant })).map(([k, fn]) => [k, (s, a) => {
  try { return fn(s, a); } catch (e) { if (e instanceof EventError) throw new GameError(e.message); throw e; }
}])));
