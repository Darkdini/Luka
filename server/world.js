// Общий мир: королевства (realms) с участками, NPC-лагеря, проведение атак.
import crypto from 'node:crypto';
import {
  BUILDINGS, WORLD_PLOTS, WORLD_NPC, PLOTS_PER_REALM, NPC_RESPAWN_SEC, BATTLE, RACES,
  castleLevelOf, trophyOffer, storageCap,
} from '../shared/config.js';
import { runBattle } from '../shared/sim.js';
import { db, getPlayer, savePlayer } from './db.js';
import { rng, tick, lootableBase, GameError } from './game.js';

const fail = (m) => { throw new GameError(m); };

// --- Участки ---------------------------------------------------------------
export function freePlot() {
  const rows = db.prepare('SELECT realm, plot FROM players').all();
  const taken = new Set(rows.map((r) => `${r.realm}:${r.plot}`));
  for (let realm = 1; ; realm++) {
    for (let plot = 0; plot < PLOTS_PER_REALM; plot++) if (!taken.has(`${realm}:${plot}`)) return { realm, plot };
  }
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
  // Кольцо стен вокруг ядра
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
  // Добыча NPC: фиксированная по уровню, делится между хранилищами
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

function npcList(realm) {
  const occupied = new Map(db.prepare('SELECT id, plot, castle_name, username, race, trophies, castle_level, state FROM players WHERE realm = ?').all(realm).map((r) => [r.plot, r]));
  const now = Date.now();
  const plots = WORLD_PLOTS.map((pos, plot) => {
    const p = occupied.get(plot);
    if (p) {
      const st = JSON.parse(p.state);
      return {
        kind: 'player', plot, pos, id: p.id, name: p.castle_name, owner: p.username, race: p.race,
        trophies: p.trophies, level: p.castle_level,
        shield: st.shieldUntil > now ? st.shieldUntil : 0,
      };
    }
    return { kind: 'npc', id: `plot${plot}`, plot, pos, name: 'Захваченный замок', owner: 'Разбойники', level: 1 + (plot * 5) % 7, bandit: true };
  });
  const npc = WORLD_NPC.map((n) => ({ kind: 'npc', id: n.id, pos: n.pos, name: n.name, owner: 'NPC', level: n.level }));
  return [...plots, ...npc];
}

export function worldView(realm, me) {
  const list = npcList(realm).map((e) => {
    if (e.kind === 'npc') e.respawn = me.state.npc[e.id] && me.state.npc[e.id] > Date.now() ? me.state.npc[e.id] : 0;
    return e;
  });
  const realms = db.prepare('SELECT MAX(realm) AS m FROM players').get().m || 1;
  return { realm, realms, entries: list };
}

function findNpc(id) {
  const n = WORLD_NPC.find((v) => v.id === id);
  if (n) return { id, name: n.name, level: n.level };
  const m = /^plot(\d+)$/.exec(id);
  if (m) { const plot = +m[1]; return { id, name: 'Захваченный замок', level: 1 + (plot * 5) % 7 }; }
  return null;
}

// --- Атаки -------------------------------------------------------------------
const pending = new Map(); // battleId -> данные атаки

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
  let base, defRace = null, name, info = {};
  if (target.kind === 'npc') {
    const n = findNpc(target.id) || fail('Цель не найдена');
    if (s.npc[n.id] > now) fail('Лагерь ещё восстанавливается');
    const seed = [...n.id].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
    base = npcBase(n.level, seed);
    battle.npc = n.id;
    name = n.name;
    info = { level: n.level };
  } else {
    const d = getPlayer(target.id) || fail('Игрок не найден');
    if (d.id === me.id) fail('Нельзя атаковать себя');
    tick(d.state, now);
    if (d.state.shieldUntil > now) fail('Замок под защитным щитом');
    if (d.state.lockUntil > now) fail('Этот замок уже атакуют');
    d.state.lockUntil = now + (BATTLE.duration + BATTLE.scoutTime + 30) * 1000;
    savePlayer(d, false);
    base = lootableBase(d.state);
    defRace = d.state.race;
    battle.defender = d.id;
    name = d.castle_name;
    const offer = trophyOffer(s.trophies, d.state.trophies);
    info = { level: castleLevelOf(d.state), trophies: d.state.trophies, offer, owner: d.username, race: d.state.race };
    // атака снимает собственный щит
    s.shieldUntil = 0;
  }
  battle.base = base;
  battle.defRace = defRace;
  battle.name = name;
  pending.set(battle.id, battle);
  const decor = target.kind === 'npc' ? [] : (getPlayer(target.id)?.state.decor || []);
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
  const now = Date.now();
  tick(s, now);
  // Потраченные войска и зелья
  for (const [k, n] of Object.entries(result.used.troops)) s.army[k] = Math.max(0, (s.army[k] || 0) - n);
  for (const [k, n] of Object.entries(result.used.spells)) s.spells[k] = Math.max(0, (s.spells[k] || 0) - n);
  // Добыча — в пределах свободного места
  const got = {};
  for (const r of ['gold', 'food']) {
    const space = storageCap(s, r) - s.res[r];
    got[r] = Math.max(0, Math.min(space, result.loot[r]));
    s.res[r] += got[r];
  }
  let trophies = 0;
  const report = { ts: now, type: 'attack', target: battle.name, stars: result.stars, pct: result.pct, loot: got };
  s.stats.attacks++;
  if (result.stars > 0) { s.stats.wins++; s.stats.starsTotal += result.stars; }

  if (battle.npc) {
    if (result.stars > 0) s.npc[battle.npc] = now + NPC_RESPAWN_SEC * 1000;
  } else {
    const d = getPlayer(battle.defender);
    if (d) {
      const ds = d.state;
      tick(ds, now);
      const offer = trophyOffer(s.trophies, ds.trophies);
      trophies = result.stars > 0 ? Math.max(1, Math.round(offer * result.stars / 3)) : -Math.round(offer * 0.6);
      s.trophies = Math.max(0, s.trophies + trophies);
      ds.trophies = Math.max(0, ds.trophies - trophies);
      // Списание у защитника: из разрушенных рудников и из хранилищ
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
  report.trophies = trophies;
  s.reports.unshift(report);
  s.reports = s.reports.slice(0, 30);
  db.prepare('INSERT INTO battles (id, attacker, defender, npc, result, log, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(battle.id, me.id, battle.defender || null, battle.npc || null, JSON.stringify(result), JSON.stringify(clean), now);
  return { ...result, got, trophies };
}

export function leaderboard() {
  return db.prepare('SELECT id, username, castle_name AS name, race, trophies, castle_level AS level FROM players ORDER BY trophies DESC, id ASC LIMIT 50').all();
}

export { RACES };
