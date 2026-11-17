// Серверная игровая логика: состояние игрока, экономика, стройка, армия.
// Сервер — единственный источник правды: клиент лишь присылает намерения.
import {
  BUILDINGS, TROOPS, SPELLS, HEROES, RACES, START, DECOR, DECOR_REMOVE_COST,
  BUILD_MIN, BUILD_MAX, BUILDER_GEM_COST, MAX_BUILDERS, GEMS_FREE, BATTLE,
  upgradeCost, upgradeTime, gemsForTime, gemsForResources, castleLevelOf, countOf,
  storageCap, armyCapacity, armyUsed, spellCapacity, barracksLevel, collectorCap,
  heroMaxLevel, heroUpgradeCost, heroUpgradeTime, forgeCost, forgeTime,
} from '../shared/config.js';
import { achievementStatus } from '../shared/achievements.js';
import { chapterById } from '../shared/story.js';

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
    buildings: [], decor: [], nextId: 1,
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
  };
  migrate(s);
  const add = (type, x, y, level = 1) => {
    const b = { id: s.nextId++, type, level, x, y, up: null };
    if (BUILDINGS[type].produces) { b.store = 0; b.last = now; }
    s.buildings.push(b);
    return b;
  };
  add('castle', 20, 20);
  add('builderhut', 16, 17);
  add('builderhut', 26, 17);
  add('goldmine', 15, 21);
  add('farm', 26, 21);
  add('treasury', 18, 25);
  add('granary', 22, 25);
  add('barracks', 20, 16);
  add('armycamp', 27, 26);
  add('archertower', 14, 25);
  s.army = { swordsman: 10, crossbowman: 6 };
  // Декор (деревья, камни) — расчищается за золото, приносит кристаллы
  const r = rng(seed);
  let tries = 0;
  while (s.decor.length < 22 && tries++ < 500) {
    const x = BUILD_MIN + Math.floor(r() * (BUILD_MAX - BUILD_MIN - 1));
    const y = BUILD_MIN + Math.floor(r() * (BUILD_MAX - BUILD_MIN - 1));
    if (Math.abs(x - 21) < 9 && Math.abs(y - 21) < 9) continue;
    if (!areaFree(s, x, y, 1)) continue;
    s.decor.push({ id: s.nextId++, kind: DECOR[Math.floor(r() * DECOR.length)], x, y });
  }
  return s;
}

// Старые сохранения дополняются новыми полями
const STAT_KEYS = ['attacks', 'wins', 'defenses', 'defWins', 'starsTotal', 'goldLooted', 'foodLooted', 'destroyed', 'npcWins', 'trained', 'cleared', 'trophiesMax'];
export function migrate(s) {
  s.stats = s.stats || {};
  for (const k of STAT_KEYS) s.stats[k] = s.stats[k] || 0;
  s.achievements = s.achievements || {};
  s.story = s.story || {};
  s.npc = s.npc || {};
  return s;
}

// --- Течение времени ------------------------------------------------------------
export function tick(s, now = Date.now()) {
  migrate(s);
  const raceGold = RACES[s.race]?.bonus.goldRate || 0;
  for (const b of s.buildings) {
    const def = BUILDINGS[b.type];
    if (def.produces && b.level > 0) {
      // во время улучшения рудник не работает (как и положено стройке)
      if (!b.up) {
        const rate = def.rate[b.level - 1] * (def.produces === 'gold' ? 1 + raceGold : 1);
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
  clampRes(s);
  return s;
}

function clampRes(s) {
  for (const r of ['gold', 'food']) s.res[r] = Math.max(0, Math.min(s.res[r], storageCap(s, r)));
}

const builders = (s) => s.buildings.filter((b) => b.type === 'builderhut' && b.level > 0).length;
const busy = (s) => s.buildings.filter((b) => b.up).length;
const freeBuilder = (s) => busy(s) < builders(s);

function pay(s, res, amount) {
  if (amount <= 0) return;
  if ((s.res[res] || 0) < amount) fail(`Не хватает: ${res === 'gold' ? 'золота' : res === 'food' ? 'зерна' : 'кристаллов'}`);
  s.res[res] -= amount;
}
function addRes(s, res, amount) {
  if (res === 'gems') { s.res.gems += amount; return amount; }
  const cap = storageCap(s, res);
  const before = s.res[res];
  s.res[res] = Math.min(cap, s.res[res] + amount);
  return s.res[res] - before;
}

export function areaFree(s, x, y, size, ignoreId = null) {
  if (x < BUILD_MIN || y < BUILD_MIN || x + size > BUILD_MAX || y + size > BUILD_MAX) return false;
  for (const b of s.buildings) {
    if (b.id === ignoreId) continue;
    const bs = BUILDINGS[b.type].size;
    if (x < b.x + bs && x + size > b.x && y < b.y + bs && y + size > b.y) return false;
  }
  for (const d of s.decor) if (d.x >= x && d.x < x + size && d.y >= y && d.y < y + size) return false;
  return true;
}

// --- Действия игрока ------------------------------------------------------------
export const actions = {
  place(s, { type, x, y }) {
    const def = BUILDINGS[type];
    if (!def || type === 'castle') fail('Нельзя построить');
    x |= 0; y |= 0;
    const cl = castleLevelOf(s);
    const limit = def.countByCastle[cl - 1];
    if (countOf(s, type) >= limit) fail('Достигнут лимит. Улучшите Цитадель');
    if (!areaFree(s, x, y, def.size)) fail('Место занято');
    if (type === 'builderhut') {
      const n = countOf(s, 'builderhut');
      if (n >= MAX_BUILDERS) fail('Максимум строителей');
      pay(s, 'gems', BUILDER_GEM_COST[n]);
      s.buildings.push({ id: s.nextId++, type, level: 1, x, y, up: null });
      return;
    }
    const time = upgradeTime(type, 1);
    if (time > 0 && !freeBuilder(s)) fail('Все строители заняты');
    pay(s, def.res, upgradeCost(type, 1));
    const b = { id: s.nextId++, type, level: time > 0 ? 0 : 1, x, y, up: time > 0 ? { to: 1, end: Date.now() + time * 1000, total: time } : null };
    if (def.produces) { b.store = 0; b.last = Date.now(); }
    s.buildings.push(b);
  },

  upgrade(s, { id }) {
    const b = s.buildings.find((v) => v.id === id) || fail('Здание не найдено');
    if (b.up) fail('Уже улучшается');
    const def = BUILDINGS[b.type];
    const cl = castleLevelOf(s);
    const max = b.type === 'castle' ? 6 : def.maxByCastle[cl - 1];
    if (b.level >= max) fail(b.type === 'castle' ? 'Максимальный уровень' : 'Сначала улучшите Цитадель');
    const to = b.level + 1;
    const time = upgradeTime(b.type, to);
    if (time > 0 && !freeBuilder(s)) fail('Все строители заняты');
    pay(s, def.res, upgradeCost(b.type, to));
    if (time <= 0) b.level = to;
    else b.up = { to, end: Date.now() + time * 1000, total: time };
  },

  // Улучшить сразу ряд стен (выделение линии)
  upgradeWalls(s, { ids }) {
    if (!Array.isArray(ids) || ids.length > 60) fail('Неверный запрос');
    for (const id of ids) actions.upgrade(s, { id });
  },

  speedup(s, { id }) {
    const b = s.buildings.find((v) => v.id === id) || fail('Здание не найдено');
    if (!b.up) fail('Нечего ускорять');
    pay(s, 'gems', gemsForTime((b.up.end - Date.now()) / 1000));
    b.up.end = Date.now();
    tick(s);
  },

  move(s, { id, x, y }) {
    const b = s.buildings.find((v) => v.id === id) || fail('Здание не найдено');
    x |= 0; y |= 0;
    if (!areaFree(s, x, y, BUILDINGS[b.type].size, b.id)) fail('Место занято');
    b.x = x; b.y = y;
  },

  collect(s, { id }) {
    const list = id ? s.buildings.filter((b) => b.id === id) : s.buildings;
    const got = { gold: 0, food: 0 };
    for (const b of list) {
      const def = BUILDINGS[b.type];
      if (!def.produces || !b.store) continue;
      const added = addRes(s, def.produces, Math.floor(b.store));
      b.store -= added;
      got[def.produces] += added;
    }
    return { collected: got };
  },

  removeDecor(s, { id }) {
    const i = s.decor.findIndex((d) => d.id === id);
    if (i < 0) fail('Не найдено');
    pay(s, 'gold', DECOR_REMOVE_COST);
    const d = s.decor[i];
    s.decor.splice(i, 1);
    s.stats.cleared++;
    const r = rng(d.id * 7919 + d.x * 31 + d.y);
    const gems = GEMS_FREE.obstacleMin + Math.floor(r() * (GEMS_FREE.obstacleMax - GEMS_FREE.obstacleMin + 1));
    s.res.gems += gems;
    return { gems };
  },

  train(s, { k, n = 1 }) {
    const t = TROOPS[k] || fail('Неизвестный отряд');
    n = Math.max(1, Math.min(50, n | 0));
    if (barracksLevel(s) < t.barracks) fail(`Нужны Казармы ${t.barracks} ур.`);
    const queued = s.training.reduce((a, q) => a + TROOPS[q.k].space, 0);
    if (armyUsed(s.army) + queued + t.space * n > armyCapacity(s)) fail('Лагерь переполнен');
    pay(s, 'food', t.cost * n);
    s.stats.trained += n;
    const nb = Math.max(1, s.buildings.filter((b) => b.type === 'barracks' && b.level > 0).length);
    let end = Math.max(Date.now(), s.training.length ? s.training[s.training.length - 1].end : 0);
    for (let i = 0; i < n; i++) {
      end += t.time * 1000 / nb;
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
    tick(s);
  },

  brew(s, { k }) {
    const sp = SPELLS[k] || fail('Неизвестное заклинание');
    const tower = s.buildings.find((b) => b.type === 'spelltower' && b.level > 0);
    if (!tower || tower.level < sp.tower) fail(`Нужна Башня алхимика ${sp.tower} ур.`);
    const have = Object.values(s.spells).reduce((a, v) => a + v, 0) + s.brewing.length;
    if (have >= spellCapacity(s)) fail('Запас зелий полон');
    pay(s, 'food', sp.cost);
    const end = Math.max(Date.now(), s.brewing.at(-1)?.end || 0) + sp.time * 1000;
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
    if (!s.buildings.some((b) => b.type === 'heroaltar' && b.level > 0)) fail('Постройте Алтарь героев');
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
    if (res !== 'gold' && res !== 'food') fail('Неверный ресурс');
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
    for (const k of ['gold', 'food']) if (r[k]) addRes(s, k, r[k]);
    return { reward: r };
  },

  daily(s) {
    const day = Math.floor(Date.now() / 86400e3);
    if (s.lastDaily === day) fail('Награда уже получена сегодня');
    s.lastDaily = day;
    s.res.gems += GEMS_FREE.dailyBonus;
    const g = addRes(s, 'gold', 500 * castleLevelOf(s));
    const f = addRes(s, 'food', 500 * castleLevelOf(s));
    return { gems: GEMS_FREE.dailyBonus, gold: g, food: f };
  },
};

// --- Добыча для атакующего ------------------------------------------------------
// Возвращает здания базы с полем loot (сколько можно унести, разрушив его).
export function lootableBase(s) {
  const out = [];
  const caps = { gold: storageCap(s, 'gold'), food: storageCap(s, 'food') };
  for (const b of s.buildings) {
    if (b.level < 1) continue;
    const def = BUILDINGS[b.type];
    const loot = { gold: 0, food: 0 };
    for (const r of ['gold', 'food']) {
      let share = 0;
      if (b.type === 'castle') share = def.storage[b.level - 1];
      else if (def.stores === r) share = def.capacity[b.level - 1];
      if (share && caps[r]) loot[r] += Math.floor(s.res[r] * BATTLE.lootStoragePct * share / caps[r]);
    }
    let collector = 0;
    if (def.produces) {
      collector = Math.floor((b.store || 0) * BATTLE.lootCollectorPct);
      loot[def.produces] += collector;
    }
    out.push({ id: b.id, type: b.type, level: b.level, x: b.x, y: b.y, loot, collector });
  }
  return out;
}

// Публичный вид состояния для клиента (+вычисляемые поля).
export function view(p) {
  const s = p.state;
  return {
    id: p.id, name: p.castle_name, username: p.username, race: s.race,
    realm: p.realm, plot: p.plot,
    res: s.res,
    caps: { gold: storageCap(s, 'gold'), food: storageCap(s, 'food') },
    buildings: s.buildings, decor: s.decor,
    builders: { total: builders(s), busy: busy(s) },
    army: s.army, training: s.training, armyCap: armyCapacity(s),
    spells: s.spells, brewing: s.brewing, spellCap: spellCapacity(s),
    troopLevels: s.troopLevels, forge: s.forge,
    heroes: s.heroes,
    trophies: s.trophies, shieldUntil: s.shieldUntil,
    dailyReady: s.lastDaily !== Math.floor(Date.now() / 86400e3),
    reports: s.reports.slice(0, 20),
    stats: s.stats,
    story: s.story,
    npc: s.npc,
    achievements: achievementStatus(s).map((a) => ({ id: a.id, value: a.value, reached: a.reached, claimed: a.claimed })),
    x: p.wx, y: p.wy, motto: p.motto, avatar: p.avatar, title: p.title,
    now: Date.now(),
  };
}
