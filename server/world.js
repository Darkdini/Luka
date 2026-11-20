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
import './alliance.js'; // таблица союзов нужна запросу карты
import { rng, tick, lootableBase, GameError, bumpDaily } from './game.js';
import { CASTLE_POS, wallTiles, autoPlace } from '../shared/city.js';

const fail = (m) => { throw new GameError(m); };

// --- Расселение -------------------------------------------------------------
// Новички селятся кольцом, которое расширяется с ростом числа игроков:
// рядом оказываются игроки похожего «возраста», а центр (Цитадель) — цель.
const q = {
  count: db.prepare('SELECT COUNT(*) AS n FROM players WHERE wx IS NOT NULL'),
  near: db.prepare('SELECT 1 FROM players WHERE wx BETWEEN ? AND ? AND wy BETWEEN ? AND ? LIMIT 1'),
  region: db.prepare(`SELECT p.id, p.username, p.castle_name, p.race, p.trophies, p.castle_level, p.wx, p.wy, p.seen_at, p.avatar, p.title, p.ally, a.tag
    FROM players p LEFT JOIN alliances a ON a.id = p.ally WHERE p.wx BETWEEN ? AND ? AND p.wy BETWEEN ? AND ? LIMIT 2000`),
  setPos: db.prepare('UPDATE players SET wx = ?, wy = ? WHERE id = ?'),
  unplaced: db.prepare('SELECT id FROM players WHERE wx IS NULL'),
};

export function cellFree(x, y) {
  if (!buildable(x, y) || campAt(x, y)) return false;
  if (Math.abs(x - CENTER) < 8 && Math.abs(y - CENTER) < 8) return false;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (campAt(x + dx, y + dy)) return false; // не вплотную к лагерям
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!buildable(x + dx, y + dy)) return false; // не на кромке воды/гор
  return !q.near.get(x - CASTLE_GAP, x + CASTLE_GAP, y - CASTLE_GAP, y + CASTLE_GAP);
}

export function findSpot(seed = Date.now()) {
  const n = q.count.get().n;
  const r = rng(seed >>> 0);
  const ring = Math.min(WORLD / 2 - 12, 28 + Math.sqrt(n + 1) * 3.6);
  // случайные попытки около «кольца новичков», постепенно расширяя полосу
  for (let attempt = 0; attempt < 3000; attempt++) {
    const spread = 6 + attempt / 15;
    const rad = Math.max(10, ring + (r() - 0.5) * spread * 2);
    const ang = r() * Math.PI * 2;
    const x = Math.round(CENTER + Math.cos(ang) * rad), y = Math.round(CENTER + Math.sin(ang) * rad);
    if (x < 4 || y < 4 || x >= WORLD - 4 || y >= WORLD - 4) continue;
    if (cellFree(x, y)) return { x, y };
  }
  // запасной путь: ближайшая к кольцу свободная клетка по всему миру
  let best = null, bd = 1e9;
  for (let y = 4; y < WORLD - 4; y += 2) for (let x = 4; x < WORLD - 4; x += 2) {
    const d = Math.abs(Math.hypot(x - CENTER, y - CENTER) - ring);
    if (d < bd && cellFree(x, y)) { bd = d; best = { x, y }; }
  }
  return best || fail('Мир переполнен');
}

// Перерасселение при смене правил мира (версия хранится в meta)
const WORLD_VERSION = '3';
export function placeUnplaced() {
  const v = db.prepare("SELECT v FROM meta WHERE k = 'world_v'").get()?.v;
  if (v !== WORLD_VERSION) {
    db.exec('UPDATE players SET wx = NULL, wy = NULL');
    db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('world_v', ?)").run(WORLD_VERSION);
  }
  let placed = 0;
  // старожилы расселяются первыми — ближе к центру, новички — дальше кольцом
  for (const { id } of db.prepare('SELECT id FROM players WHERE wx IS NULL ORDER BY created_at ASC').all()) {
    const s = findSpot(id * 7919);
    q.setPos.run(s.x, s.y, id);
    placed++;
  }
  if (placed) console.log(`Расселено замков: ${placed}`);
  return placed;
}

// --- Карта: участок мира -------------------------------------------------------
export function region(x0, y0, x1, y1, online) {
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0);
  x1 = Math.min(WORLD - 1, x1 | 0); y1 = Math.min(WORLD - 1, y1 | 0);
  if ((x1 - x0) * (y1 - y0) > 96 * 96) fail('Слишком большой участок');
  return q.region.all(x0, x1, y0, y1).map((p) => ({
    id: p.id, name: p.castle_name, owner: p.username, race: p.race, trophies: p.trophies,
    level: p.castle_level, x: p.wx, y: p.wy, online: online(p.id), avatar: p.avatar, title: p.title, ally: p.ally || null, tag: p.tag || '',
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
  const lv = () => Math.max(1, Math.min(cl, Math.ceil(level * 0.9)));
  const blds = [{ id: 1, type: 'castle', level: cl, x: CASTLE_POS.x, y: CASTLE_POS.y }];
  let id = 2;
  const counts = (type) => BUILDINGS[type].countByCastle[cl - 1];
  const want = [];
  for (const t of ['warehouse', 'farm', 'sawmill', 'quarry', 'market', 'mine', 'barracks', 'range', 'hospital', 'tavern', 'statue'])
    for (let i = 0; i < Math.min(2, counts(t)); i++) want.push(t);
  const st = { buildings: blds, decor: [] };
  for (const t of want) {
    const near = { x: 22 + (r() - 0.5) * 10, y: 22 + (r() - 0.5) * 10 };
    const at = autoPlace(st, BUILDINGS[t].size, cl, near);
    if (at) blds.push({ id: id++, type: t, level: lv(), x: at.x, y: at.y });
  }
  {
    const wl = Math.max(1, Math.min(cl, Math.ceil(level / 1.5)));
    for (const [x, y] of wallTiles(cl)) blds.push({ id: id++, type: 'wall', level: wl, x, y });
  }
  const lootTotal = Math.round(400 * Math.pow(level, 1.7));
  const holders = blds.filter((b) => ['castle', 'warehouse', 'market', 'farm'].includes(b.type));
  for (const b of holders) {
    const share = 1 / holders.length;
    b.loot = { gold: 0, food: 0 };
    if (b.type === 'castle' || b.type === 'warehouse') { b.loot.gold = Math.round(lootTotal * share); b.loot.food = Math.round(lootTotal * share); }
    else b.loot[BUILDINGS[b.type].produces] = Math.round(lootTotal * 2 * share);
  }
  return blds;
}

// Немного декора вокруг баз NPC, чтобы они не стояли в чистом поле
function npcDecor(seed) {
  const r = rng(seed ^ 0x5bd1e995);
  const kinds = ['oak', 'pine', 'bush', 'rock_big', 'rocks', 'stump'];
  const out = [];
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = 19 + r() * 2.5;
    out.push({ id: i, kind: kinds[Math.floor(r() * kinds.length)], x: Math.round(21.5 + Math.cos(a) * d), y: Math.round(21.5 + Math.sin(a) * d) });
  }
  return out.filter((o) => o.x >= 0 && o.y >= 0 && o.x < 44 && o.y < 44 && (o.x < 4 || o.y < 4 || o.x > 38 || o.y > 38));
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
  if (result.stars > 0) { st.wins++; st.starsTotal += result.stars; bumpDaily(s, 'wins'); bumpDaily(s, 'stars', result.stars); }

  let trophies = 0;
  const extra = {};
  if (battle.npc) {
    if (result.stars > 0) { s.npc[battle.npc] = now + NPC_RESPAWN_SEC * 1000; st.npcWins = (st.npcWins || 0) + 1; bumpDaily(s, 'npc'); }
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

// --- Рейтинги: игроки по силе / победам / Цитадели, союзы по силе / победам ---------
const RANKS = {
  power: { col: 'power' }, kills: { col: 'kills' }, castle: { col: 'castle_level' },
  ally_power: { col: 'power', ally: true }, ally_kills: { col: 'kills', ally: true },
};
export function ranking(meId, kind) {
  const r = RANKS[kind] || RANKS.power;
  if (r.ally) {
    const top = db.prepare(`SELECT a.id, a.name, a.tag, a.crest, SUM(p.${r.col}) AS value, COUNT(*) AS members FROM players p JOIN alliances a ON a.id = p.ally
      GROUP BY a.id ORDER BY value DESC, a.id ASC LIMIT 100`).all();
    const mine = db.prepare('SELECT ally FROM players WHERE id = ?').get(meId)?.ally;
    let me = null;
    if (mine) {
      const v = db.prepare(`SELECT SUM(${r.col}) AS v FROM players WHERE ally = ?`).get(mine).v || 0;
      const rank = db.prepare(`SELECT COUNT(*) AS n FROM (SELECT SUM(${r.col}) AS s FROM players WHERE ally IS NOT NULL GROUP BY ally) WHERE s > ?`).get(v).n + 1;
      me = { rank, value: v };
    }
    return { kind, ally: true, top, me };
  }
  const top = db.prepare(`SELECT p.id, p.castle_name AS name, p.username AS owner, p.race, p.${r.col} AS value, a.tag FROM players p LEFT JOIN alliances a ON a.id = p.ally
    ORDER BY p.${r.col} DESC, p.id ASC LIMIT 100`).all();
  const v = db.prepare(`SELECT ${r.col} AS v FROM players WHERE id = ?`).get(meId)?.v || 0;
  const rank = db.prepare(`SELECT COUNT(*) AS n FROM players WHERE ${r.col} > ? OR (${r.col} = ? AND id < ?)`).get(v, v, meId).n + 1;
  return { kind, top, me: { rank, value: v }, total: db.prepare('SELECT COUNT(*) AS n FROM players').get().n };
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
