// Общий мир: континент на тысячи замков, лагеря NPC, сюжет, атаки, профили.
import crypto from 'node:crypto';
import {
  BUILDINGS, NPC_RESPAWN_SEC, BATTLE, castleLevelOf, trophyOffer, storageCap,
} from '../shared/config.js';
import { WORLD, CENTER, CASTLE_GAP, buildable, campAt, campById, campSeed, hash01 } from '../shared/worldgen.js';
import { chapterById, chapterOpen } from '../shared/story.js';
import { achievementStatus, leagueOf, titlesOf } from '../shared/achievements.js';
import { runBattle } from '../shared/sim.js';
import { db, getPlayer, savePlayer } from './db.js';
import { rng, tick, lootableBase, GameError } from './game.js';

const fail = (m) => { throw new GameError(m); };

// --- Расселение -------------------------------------------------------------
// Новички селятся кольцом, которое расширяется с ростом числа игроков:
// рядом оказываются игроки похожего «возраста», а центр (Цитадель) — цель.
const q = {
  count: db.prepare('SELECT COUNT(*) AS n FROM players WHERE wx IS NOT NULL'),
  near: db.prepare('SELECT 1 FROM players WHERE wx BETWEEN ? AND ? AND wy BETWEEN ? AND ? LIMIT 1'),
  region: db.prepare(`SELECT id, username, castle_name, race, trophies, castle_level, wx, wy, seen_at, avatar, title
    FROM players WHERE wx BETWEEN ? AND ? AND wy BETWEEN ? AND ? LIMIT 2000`),
  setPos: db.prepare('UPDATE players SET wx = ?, wy = ? WHERE id = ?'),
  unplaced: db.prepare('SELECT id FROM players WHERE wx IS NULL'),
};

function cellFree(x, y) {
  if (!buildable(x, y) || campAt(x, y)) return false;
  if (Math.abs(x - CENTER) < 8 && Math.abs(y - CENTER) < 8) return false;
  return !q.near.get(x - CASTLE_GAP, x + CASTLE_GAP, y - CASTLE_GAP, y + CASTLE_GAP);
}

export function findSpot(seed = Date.now()) {
  const n = q.count.get().n;
  const r = rng(seed >>> 0);
  const ring = Math.min(WORLD / 2 - 12, 28 + Math.sqrt(n + 1) * 1.6);
  for (let attempt = 0; attempt < 4000; attempt++) {
    const spread = 8 + attempt / 60;
    const rad = Math.max(10, ring + (r() - 0.5) * spread * 2);
    const ang = r() * Math.PI * 2;
    const x = Math.round(CENTER + Math.cos(ang) * rad), y = Math.round(CENTER + Math.sin(ang) * rad);
    if (x < 4 || y < 4 || x >= WORLD - 4 || y >= WORLD - 4) continue;
    if (cellFree(x, y)) return { x, y };
  }
  fail('Мир переполнен');
}

export function placeUnplaced() {
  for (const { id } of q.unplaced.all()) {
    const s = findSpot(id * 7919);
    q.setPos.run(s.x, s.y, id);
  }
}

// --- Карта: участок мира -------------------------------------------------------
export function region(x0, y0, x1, y1, online) {
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0);
  x1 = Math.min(WORLD - 1, x1 | 0); y1 = Math.min(WORLD - 1, y1 | 0);
  if ((x1 - x0) * (y1 - y0) > 96 * 96) fail('Слишком большой участок');
  return q.region.all(x0, x1, y0, y1).map((p) => ({
    id: p.id, name: p.castle_name, owner: p.username, race: p.race, trophies: p.trophies,
    level: p.castle_level, x: p.wx, y: p.wy, online: online(p.id), avatar: p.avatar, title: p.title,
  }));
}

export function findPlayer(name) {
  const like = String(name || '').trim().slice(0, 24);
  if (like.length < 2) fail('Введите хотя бы 2 символа');
  return db.prepare(`SELECT id, username, castle_name AS name, castle_level AS level, trophies, race, wx AS x, wy AS y
    FROM players WHERE username LIKE ? OR castle_name LIKE ? ORDER BY trophies DESC LIMIT 10`).all(`%${like}%`, `%${like}%`);
}

// --- Генератор баз NPC (детерминированный) ----------------------------------
export function npcBase(level, seed) {
  const r = rng(seed);
  const cl = Math.max(1, Math.min(6, Math.ceil(level * 0.65)));
  const lv = (type) => Math.max(1, Math.min(BUILDINGS[type].maxByCastle[cl - 1] || 1, Math.ceil(level * 0.9)));
  const blds = [];
  let id = 1;
  const occ = new Set();
  const free = (x, y, s) => {
    for (let yy = y - 1; yy < y + s + 1; yy++) for (let xx = x - 1; xx < x + s + 1; xx++) if (occ.has(xx * 100 + yy)) return false;
    return x >= 3 && y >= 3 && x + s <= 41 && y + s <= 41;
  };
  const put = (type, x, y) => {
    const s = BUILDINGS[type].size;
    for (let yy = y; yy < y + s; yy++) for (let xx = x; xx < x + s; xx++) occ.add(xx * 100 + yy);
    blds.push({ id: id++, type, level: type === 'castle' ? cl : lv(type), x, y });
  };
  const ring = (type, rad) => {
    for (let t = 0; t < 60; t++) {
      const a = r() * Math.PI * 2;
      const x = Math.round(20 + Math.cos(a) * rad * (0.7 + r() * 0.5));
      const y = Math.round(20 + Math.sin(a) * rad * (0.7 + r() * 0.5));
      if (free(x, y, BUILDINGS[type].size)) { put(type, x, y); return; }
    }
  };
  put('castle', 20, 20);
  const counts = (type) => BUILDINGS[type].countByCastle[cl - 1];
  for (const t of ['archertower', 'ballista', 'magetower', 'trebuchet']) for (let i = 0; i < counts(t); i++) ring(t, 5 + r() * 2);
  for (const t of ['treasury', 'granary']) for (let i = 0; i < counts(t); i++) ring(t, 6);
  for (const t of ['goldmine', 'farm']) for (let i = 0; i < Math.min(3, counts(t)); i++) ring(t, 11);
  for (const t of ['barracks', 'armycamp', 'builderhut']) ring(t, 12);
  if (cl >= 2) {
    const R = cl >= 4 ? 9 : 7;
    const wl = Math.max(1, Math.min(BUILDINGS.wall.maxByCastle[cl - 1], Math.ceil(level / 1.5)));
    for (let i = -R; i <= R; i++) for (const [x, y] of [[21 + i, 21 - R], [21 + i, 21 + R], [21 - R, 21 + i], [21 + R, 21 + i]]) {
      if (!occ.has(x * 100 + y) && !blds.some((b) => b.x === x && b.y === y)) {
        occ.add(x * 100 + y);
        blds.push({ id: id++, type: 'wall', level: wl, x, y });
      }
    }
  }
  for (const t of ['trap_spikes', 'trap_barrel', 'trap_bear']) for (let i = 0; i < counts(t); i++) ring(t, 3 + r() * 5);
  const lootTotal = Math.round(400 * Math.pow(level, 1.7));
  const holders = blds.filter((b) => ['castle', 'treasury', 'granary', 'goldmine', 'farm'].includes(b.type));
  for (const b of holders) {
    const def = BUILDINGS[b.type];
    const share = 1 / holders.length;
    b.loot = { gold: 0, food: 0 };
    if (b.type === 'castle') { b.loot.gold = Math.round(lootTotal * share); b.loot.food = Math.round(lootTotal * share); }
    else b.loot[def.stores || def.produces] = Math.round(lootTotal * 2 * share);
  }
  return blds;
}

// Немного декора вокруг баз NPC, чтобы они не стояли в чистом поле
function npcDecor(seed) {
  const r = rng(seed ^ 0x5bd1e995);
  const kinds = ['oak', 'pine', 'bush', 'rock_big', 'rocks', 'stump'];
  const out = [];
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = 15 + r() * 5;
    out.push({ id: i, kind: kinds[Math.floor(r() * kinds.length)], x: Math.round(21 + Math.cos(a) * d), y: Math.round(21 + Math.sin(a) * d) });
  }
  return out.filter((o) => o.x >= 1 && o.y >= 1 && o.x < 43 && o.y < 43);
}

// --- Атаки -------------------------------------------------------------------
const pending = new Map();

function attackerInit(s) {
  const heroes = {};
  for (const [k, h] of Object.entries(s.heroes)) if (!h.up) heroes[k] = { level: h.level };
  return { army: { ...s.army }, spells: { ...s.spells }, heroes, troopLevels: { ...s.troopLevels }, race: s.race };
}

export function startAttack(me, target) {
  const s = me.state;
  const now = Date.now();
  for (const [id, b] of pending) if (b.attacker === me.id) pending.delete(id);
  const init = attackerInit(s);
  const armyCount = Object.values(init.army).reduce((a, v) => a + v, 0) + Object.keys(init.heroes).length;
  if (!armyCount) fail('Сначала обучите войска');
  const battle = { id: crypto.randomUUID(), attacker: me.id, start: now, attackerInit: init };
  let base, defRace = null, name, info = {}, decor = [];
  if (target.kind === 'camp') {
    const c = campById(String(target.id)) || fail('Цель не найдена');
    if (s.npc[c.id] > now) fail('Лагерь ещё восстанавливается');
    base = npcBase(c.level, campSeed(c));
    decor = npcDecor(campSeed(c));
    battle.npc = c.id;
    name = c.name;
    info = { level: c.level };
  } else if (target.kind === 'story') {
    const ch = chapterById(target.id) || fail('Глава не найдена');
    if (!chapterOpen(s, ch).open) fail('Глава ещё закрыта');
    base = npcBase(ch.level, ch.seed);
    decor = npcDecor(ch.seed);
    battle.story = ch.id;
    name = `Глава ${ch.id}: ${ch.title}`;
    info = { level: ch.level, story: ch.id };
  } else {
    const d = getPlayer(Number(target.id)) || fail('Игрок не найден');
    if (d.id === me.id) fail('Нельзя атаковать себя');
    tick(d.state, now);
    if (d.state.shieldUntil > now) fail('Замок под защитным щитом');
    if (d.state.lockUntil > now) fail('Этот замок уже атакуют');
    d.state.lockUntil = now + (BATTLE.duration + BATTLE.scoutTime + 30) * 1000;
    savePlayer(d, false);
    base = lootableBase(d.state);
    decor = d.state.decor;
    defRace = d.state.race;
    battle.defender = d.id;
    name = d.castle_name;
    info = { level: castleLevelOf(d.state), trophies: d.state.trophies, offer: trophyOffer(s.trophies, d.state.trophies), owner: d.username, race: d.state.race };
    s.shieldUntil = 0;
  }
  battle.base = base;
  battle.defRace = defRace;
  battle.name = name;
  pending.set(battle.id, battle);
  return { battleId: battle.id, name, info, base: { buildings: base, decor }, defRace, attacker: init };
}

export function finishAttack(me, battleId, log, notify) {
  const battle = pending.get(battleId);
  if (!battle || battle.attacker !== me.id) fail('Бой не найден');
  pending.delete(battleId);
  if (!Array.isArray(log) || log.length > 2000) fail('Неверный журнал боя');
  const clean = log.map((c) => ({ t: c.t | 0, c: String(c.c), k: String(c.k || ''), x: +c.x || 0, y: +c.y || 0 }));
  const result = runBattle({ base: { buildings: battle.base }, defRace: battle.defRace, attacker: battle.attackerInit }, clean);
  const s = me.state;
  const st = s.stats;
  const now = Date.now();
  tick(s, now);
  for (const [k, n] of Object.entries(result.used.troops)) s.army[k] = Math.max(0, (s.army[k] || 0) - n);
  for (const [k, n] of Object.entries(result.used.spells)) s.spells[k] = Math.max(0, (s.spells[k] || 0) - n);
  const got = {};
  for (const r of ['gold', 'food']) {
    const space = storageCap(s, r) - s.res[r];
    got[r] = Math.max(0, Math.min(space, result.loot[r]));
    s.res[r] += got[r];
  }
  st.goldLooted = (st.goldLooted || 0) + got.gold;
  st.foodLooted = (st.foodLooted || 0) + got.food;
  st.destroyed = (st.destroyed || 0) + (result.destroyed || 0);
  st.attacks++;
  if (result.stars > 0) { st.wins++; st.starsTotal += result.stars; }

  let trophies = 0;
  const extra = {};
  if (battle.npc) {
    if (result.stars > 0) { s.npc[battle.npc] = now + NPC_RESPAWN_SEC * 1000; st.npcWins = (st.npcWins || 0) + 1; }
  } else if (battle.story) {
    const ch = chapterById(battle.story);
    const prev = s.story[ch.id] || { stars: 0 };
    if (result.stars > prev.stars) {
      const reward = { gems: 0, gold: 0, food: 0 };
      if (prev.stars === 0) { reward.gems += ch.reward.gems; reward.gold += ch.reward.gold; reward.food += ch.reward.food; }
      if (result.stars === 3) reward.gems += ch.starGems;
      s.res.gems += reward.gems;
      for (const r of ['gold', 'food']) s.res[r] = Math.min(storageCap(s, r), s.res[r] + reward[r]);
      extra.storyReward = reward;
      extra.firstClear = prev.stars === 0;
      s.story[ch.id] = { ...prev, stars: result.stars };
    }
  } else {
    const d = getPlayer(battle.defender);
    if (d) {
      const ds = d.state;
      tick(ds, now);
      const offer = trophyOffer(s.trophies, ds.trophies);
      trophies = result.stars > 0 ? Math.max(1, Math.round(offer * result.stars / 3)) : -Math.round(offer * 0.6);
      s.trophies = Math.max(0, s.trophies + trophies);
      ds.trophies = Math.max(0, ds.trophies - trophies);
      ds.res.gold = Math.max(0, ds.res.gold - result.loot.gold);
      ds.res.food = Math.max(0, ds.res.food - result.loot.food);
      for (const sh of BATTLE.shield) if (result.pct >= sh[0]) { ds.shieldUntil = now + sh[1] * 3600e3; break; }
      ds.lockUntil = 0;
      ds.stats.defenses++;
      if (result.stars === 0) ds.stats.defWins++;
      ds.reports.unshift({ ts: now, type: 'defense', attacker: me.castle_name, attackerId: me.id, stars: result.stars, pct: result.pct, loot: result.loot, trophies: -trophies });
      ds.reports = ds.reports.slice(0, 30);
      savePlayer(d, false);
      notify?.(d.id, { type: 'attacked', by: me.castle_name, stars: result.stars, pct: result.pct });
    }
  }
  st.trophiesMax = Math.max(st.trophiesMax || 0, s.trophies);
  s.reports.unshift({ ts: now, type: 'attack', target: battle.name, targetId: battle.defender || null, stars: result.stars, pct: result.pct, loot: got, trophies });
  s.reports = s.reports.slice(0, 30);
  db.prepare('INSERT INTO battles (id, attacker, defender, npc, result, log, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(battle.id, me.id, battle.defender || null, battle.npc || (battle.story ? 'story' + battle.story : null), JSON.stringify(result), JSON.stringify(clean), now);
  return { ...result, got, trophies, ...extra };
}

// --- Рейтинг и профиль -------------------------------------------------------------
export function leaderboard(meId) {
  const top = db.prepare('SELECT id, username, castle_name AS name, race, trophies, castle_level AS level, avatar, title FROM players ORDER BY trophies DESC, id ASC LIMIT 100').all();
  const me = db.prepare('SELECT trophies FROM players WHERE id = ?').get(meId);
  const rank = me ? db.prepare('SELECT COUNT(*) AS n FROM players WHERE trophies > ? OR (trophies = ? AND id < ?)').get(me.trophies, me.trophies, meId).n + 1 : null;
  const total = db.prepare('SELECT COUNT(*) AS n FROM players').get().n;
  return { top, rank, total };
}

export function profile(id, online) {
  const p = getPlayer(Number(id)) || fail('Игрок не найден');
  const s = p.state;
  tick(s);
  const ach = achievementStatus(s);
  const rank = db.prepare('SELECT COUNT(*) AS n FROM players WHERE trophies > ? OR (trophies = ? AND id < ?)').get(s.trophies, s.trophies, p.id).n + 1;
  return {
    id: p.id, username: p.username, name: p.castle_name, race: s.race, motto: p.motto, avatar: p.avatar, title: p.title,
    level: castleLevelOf(s), trophies: s.trophies, league: leagueOf(s.trophies), rank,
    x: p.wx, y: p.wy, created: p.created_at, seen: p.seen_at, online: online(p.id),
    shield: s.shieldUntil > Date.now() ? s.shieldUntil : 0,
    stats: s.stats,
    heroes: Object.fromEntries(Object.entries(s.heroes).map(([k, h]) => [k, h.level])),
    achievements: ach.map((a) => ({ id: a.id, name: a.name, claimed: a.claimed, reached: a.reached })),
    titles: titlesOf(s),
    story: Object.values(s.story || {}).filter((c) => c.stars > 0).length,
  };
}

export { hash01 };
