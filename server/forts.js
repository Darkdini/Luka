// Битвы союзов за крепости: сбор (ожидание участников), совместный удар, владение и бонус.
import { db, getPlayer, savePlayer } from './db.js';
import { GameError, tick, grant, bumpDaily } from './game.js';
import { campById, FORT_MIGHT, FORT_BONUS } from '../shared/worldgen.js';
import { HERO, stageEnemies } from '../shared/heroes.js';
import { simulate } from '../shared/herobattle.js';
import { troopMight, troopCount, mightMul, travelSec, siteStage, marchCap, MAX_HEROES } from '../shared/march.js';
import { castleLevelOf } from '../shared/config.js';
import { mods } from '../shared/meta.js';
import { addWounded, migrateTroops } from './troops.js';
import { gainExp } from './heroes.js';

const fail = (m) => { throw new GameError(m); };
export const RALLY_WAIT = 5 * 60;   // секунд на сбор участников
export const RALLY_MAX = 15;

db.exec('CREATE TABLE IF NOT EXISTS forts (site TEXT PRIMARY KEY, ally INTEGER, since INTEGER)');
// запросы готовятся лениво: таблица союзов создаётся в alliance.js
const Q = {
  owner: () => db.prepare('SELECT f.ally, f.since, a.tag, a.name, a.crest FROM forts f LEFT JOIN alliances a ON a.id = f.ally WHERE f.site = ?'),
  set: () => db.prepare('INSERT OR REPLACE INTO forts (site, ally, since) VALUES (?, ?, ?)'),
  byAlly: () => db.prepare('SELECT site, since FROM forts WHERE ally = ?'),
  all: () => db.prepare('SELECT f.site, f.ally, a.tag FROM forts f LEFT JOIN alliances a ON a.id = f.ally'),
};
let cached = null;
const q = new Proxy({}, { get: (_, k) => { cached ||= Object.fromEntries(Object.entries(Q).map(([n, f]) => [n, f()])); return cached[k]; } });
export const fortOwner = (site) => q.owner.get(site) || null;
export const allyForts = (allyId) => (allyId ? q.byAlly.all(allyId).map((r) => ({ ...r, ...campById(r.site) })) : []);
export const fortBonus = (allyId) => Math.min(3, allyForts(allyId).length) * FORT_BONUS;
export const fortList = () => q.all.all();

const getA = (id) => { const a = id && db.prepare('SELECT * FROM alliances WHERE id = ?').get(id); if (a) a.data = JSON.parse(a.data || '{}'); return a || null; };
const saveA = (a) => db.prepare('UPDATE alliances SET data = ? WHERE id = ?').run(JSON.stringify(a.data), a.id);

function takeTroops(s, troops, cap) {
  const out = {};
  for (const [k, n0] of Object.entries(troops || {})) {
    const n = Math.floor(+n0 || 0);
    if (n <= 0) continue;
    if ((s.troops[k] || 0) < n) fail('Столько воинов нет');
    out[k] = n;
  }
  if (!troopCount(out)) fail('Отправьте войска');
  if (troopCount(out) > cap) fail(`Не больше ${cap} воинов`);
  for (const [k, n] of Object.entries(out)) s.troops[k] -= n;
  return out;
}

// Объявить сбор на крепость (любой участник союза; ведёт со своими героями)
export function rallyStart(p, { siteId, heroes, troops }) {
  const s = p.state;
  migrateTroops(s);
  const a = getA(p.ally) || fail('Вы не в союзе');
  const f = campById(String(siteId));
  if (!f?.fort) fail('Это не крепость');
  if (fortOwner(f.id)?.ally === a.id) fail('Крепость уже ваша');
  a.data.rallies ||= [];
  if (a.data.rallies.some((r) => r.siteId === f.id)) fail('Сбор на эту крепость уже идёт');
  if (a.data.rallies.length >= 3) fail('Не больше трёх сборов одновременно');
  const hs = [...new Set((heroes || []).filter((id) => s.roster?.[id]))].slice(0, MAX_HEROES);
  if (!hs.length) fail('Сбор ведёт отряд героев');
  const tr = takeTroops(s, troops, marchCap(castleLevelOf(s), mods(s)));
  const now = Date.now();
  const r = { id: `r${now.toString(36)}`, siteId: f.id, name: f.name, level: f.level, x: f.x, y: f.y, leader: p.id, leaderName: p.castle_name,
    fx: p.wx, fy: p.wy, heroes: hs.map((id) => ({ id, level: s.roster[id].level, stars: s.roster[id].stars, skills: s.roster[id].skills })),
    start: now, launch: now + RALLY_WAIT * 1000, members: [{ pid: p.id, name: p.castle_name, race: s.race, troops: tr, mods: mods(s) }] };
  a.data.rallies.push(r);
  saveA(a);
  return { rally: r.id };
}

export function rallyJoin(p, { id, troops }) {
  const s = p.state;
  migrateTroops(s);
  const a = getA(p.ally) || fail('Вы не в союзе');
  const r = (a.data.rallies || []).find((x) => x.id === id) || fail('Сбор не найден');
  if (Date.now() >= r.launch) fail('Отряд уже выступил');
  if (r.members.some((m) => m.pid === p.id)) fail('Вы уже в этом сборе');
  if (r.members.length >= RALLY_MAX) fail('Сбор заполнен');
  const tr = takeTroops(s, troops, marchCap(castleLevelOf(s), mods(s)));
  r.members.push({ pid: p.id, name: p.castle_name, race: s.race, troops: tr, mods: mods(s) });
  saveA(a);
}

const rallyMight = (r) => r.members.reduce((t, m) => t + troopMight(m.troops, m.race, 'infantry', m.mods), 0);
export const rallyTravel = (r) => travelSec(Math.hypot(r.x - r.fx, r.y - r.fy), Object.assign({}, ...r.members.map((m) => m.troops)));

// Ленивое разрешение: вызывается при запросах участников союза
export function processRallies(allyId, now = Date.now()) {
  const a = getA(allyId);
  if (!a?.data.rallies?.length) return;
  let changed = false;
  for (const r of [...a.data.rallies]) {
    if (!r.arrive && now >= r.launch) { r.arrive = r.launch + rallyTravel(r) * 1000; changed = true; }
    if (r.arrive && now >= r.arrive) { resolve(a, r); a.data.rallies = a.data.rallies.filter((x) => x !== r); changed = true; }
  }
  if (changed) saveA(a);
}

function resolve(a, r) {
  const f = campById(r.siteId);
  const enemy = FORT_MIGHT[f.level];
  const mine = rallyMight(r);
  const team = r.heroes.map((h) => ({ ...h, mul: mightMul(mine, enemy) }));
  const slots = [null, null, null, null, null];
  [...team.filter((u) => HERO[u.id].role === 'tank'), ...team.filter((u) => HERO[u.id].role !== 'tank')].forEach((u, i) => { slots[i] = u; });
  const battle = simulate(slots, stageEnemies(siteStage([0, 5, 8, 10][f.level])));
  const win = battle.winner === 'a';
  const ratio = enemy / Math.max(1, mine);
  const frac = win ? Math.max(0.05, Math.min(0.5, 0.3 * ratio)) : Math.max(0.35, Math.min(0.8, 0.5 * ratio));
  const prev = fortOwner(r.siteId);
  if (win) q.set.run(r.siteId, a.id, Date.now());
  const now = Date.now();
  for (const m of r.members) {
    const pl = getPlayer(m.pid);
    if (!pl) continue;
    const s = pl.state;
    tick(s, now);
    migrateTroops(s);
    const wounded = {};
    for (const [k, n] of Object.entries(m.troops)) {
      const w = Math.round(n * frac);
      if (w) wounded[k] = w;
      s.troops[k] = (s.troops[k] || 0) + n - w;
    }
    const died = addWounded(s, wounded);
    let got = {};
    if (win) got = grant(s, { gems: 20 * f.level, stone: 3000 * f.level, iron: 800 * f.level });
    if (m.pid === r.leader) for (const h of r.heroes) if (s.roster[h.id]) gainExp(s, h.id, 3000 * f.level);
    s.reports = [{ ts: now, type: 'rally', target: `${r.name} · ур. ${f.level}`, win, got, wounded, died }, ...(s.reports || [])].slice(0, 30);
    s.battleLogs = [{ id: r.id, ts: now, title: `Сбор: ${r.name}`, win, battle, reward: win ? got : null }, ...(s.battleLogs || [])].slice(0, 3);
    if (win) bumpDaily(s, 'wins');
    savePlayer(pl, false);
  }
  a.data.log = [{ ts: now, win, name: r.name, level: f.level, from: prev?.tag || null }, ...(a.data.log || [])].slice(0, 20);
}

export function rallyView(allyId) {
  const a = getA(allyId);
  if (!a) return { rallies: [], forts: [] };
  return {
    rallies: (a.data.rallies || []).map((r) => ({ ...r, might: rallyMight(r), enemy: FORT_MIGHT[r.level], travel: rallyTravel(r), heroes: r.heroes.map((h) => h.id), members: r.members.map((m) => ({ pid: m.pid, name: m.name, n: troopCount(m.troops) })) })),
    forts: allyForts(allyId).map((f) => ({ id: f.id, name: f.name, level: f.level, x: f.x, y: f.y, since: f.since })),
    fortBonus: fortBonus(allyId),
    warlog: a.data.log || [],
  };
}
