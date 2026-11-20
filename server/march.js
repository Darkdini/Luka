// Походы по карте мира: атака объектов и замков, сбор ресурсов, отзыв, ускорение.
// Состояние похода хранится у игрока; разрешение — «лениво», при любом запросе игрока.
import { castleLevelOf, gemsForTime, BATTLE, trophyOffer, RES_LIST, RES_GEN } from '../shared/config.js';
import { campById, SITE_TYPES } from '../shared/worldgen.js';
import { HERO, stageEnemies } from '../shared/heroes.js';
import { simulate } from '../shared/herobattle.js';
import { TROOP_KINDS } from '../shared/troops.js';
import {
  marchSlots, marchCap, MAX_HEROES, troopMight, troopLoad, troopCount, siteMight, siteStage, mightMul, travelSec,
  siteAmount, gatherRate, siteReward, siteExp, SITE_COOLDOWN_MIN,
} from '../shared/march.js';
import { getPlayer, savePlayer } from './db.js';
import { actions, GameError, grant, tick, bumpDaily } from './game.js';
import { addWounded, migrateTroops } from './troops.js';
import { gainExp } from './heroes.js';
import { mods } from '../shared/meta.js';
import { allyGift } from './alliance.js';

const fail = (m) => { throw new GameError(m); };
const busyHeroes = (s) => new Set((s.marches || []).flatMap((m) => m.heroes));

function heroTeam(s, ids, mul) {
  return ids.map((id) => ({ id, level: s.roster[id].level, stars: s.roster[id].stars, skills: s.roster[id].skills, mul }));
}
// Строй: танки вперёд, остальные назад (5 мест: 0–1 передний ряд)
function arrange(team) {
  const front = team.filter((u) => HERO[u.id].role === 'tank'), back = team.filter((u) => HERO[u.id].role !== 'tank');
  const slots = [null, null, null, null, null];
  const put = (u) => { const i = slots.findIndex((v, k) => v === null && (front.includes(u) ? k < 2 : k >= 2)); const j = i >= 0 ? i : slots.indexOf(null); if (j >= 0) slots[j] = u; };
  [...front, ...back].forEach(put);
  return slots;
}
// Раненые: доля от каждого вида войск
function hurt(troops, frac) {
  const w = {};
  for (const [k, n] of Object.entries(troops)) { const v = Math.round(n * frac); if (v) w[k] = v; }
  return w;
}
const minus = (a, b) => Object.fromEntries(Object.entries(a).map(([k, n]) => [k, n - (b[k] || 0)]).filter(([, n]) => n > 0));

// --- Разрешение событий похода ------------------------------------------------------
export function processMarches(p, now = Date.now()) {
  const s = p.state;
  if (!s.marches?.length) return;
  let changed = false;
  for (const m of [...s.marches]) {
    if (m.phase === 'go' && now >= m.arrive) { arrive(p, m); changed = true; }
    if (m.phase === 'work' && now >= m.workEnd) {
      m.loot = { [m.res]: m.take };
      m.phase = 'back'; m.backStart = m.workEnd; m.backAt = m.workEnd + m.travel * 1000; changed = true;
    }
    if (m.phase === 'back' && now >= m.backAt) { home(s, m); changed = true; }
  }
  if (changed) tick(s, now);
}

function arrive(p, m) {
  const s = p.state;
  if (m.kind === 'gather') {
    const site = campById(m.siteId);
    const take = Math.min(siteAmount(site.type, site.level), troopLoad(m.troops, s.race, mods(s)));
    m.take = take;
    m.phase = 'work';
    m.workEnd = m.arrive + Math.round(take / gatherRate(site.level, mods(s))) * 1000;
    s.npc[m.siteId] = m.workEnd + SITE_COOLDOWN_MIN * 60e3;
    return;
  }
  if (m.target === 'player') return raid(p, m);
  const site = campById(m.siteId);
  const enemy = siteMight(site.level);
  const mine = troopMight(m.troops, s.race, SITE_TYPES[site.type].enemy, mods(s));
  const battle = simulate(arrange(heroTeam(s, m.heroes, mightMul(mine, enemy))), stageEnemies(siteStage(site.level)));
  const win = battle.winner === 'a';
  const ratio = enemy / Math.max(1, mine);
  const wounded = hurt(m.troops, win ? Math.max(0.02, Math.min(0.5, 0.25 * ratio)) : Math.max(0.3, Math.min(0.8, 0.5 * ratio)));
  m.wounded = wounded;
  m.troops = minus(m.troops, wounded);
  let reward = null;
  if (win) {
    reward = siteReward(site.level, site.type);
    m.loot = reward;
    for (const id of m.heroes) gainExp(s, id, Math.round(siteExp(site.level) * (1 + (mods(s).exp || 0))));
    s.npc[m.siteId] = Date.now() + SITE_COOLDOWN_MIN * 60e3;
    s.stats.npcWins = (s.stats.npcWins || 0) + 1;
    bumpDaily(s, 'npc');
    if (site.level >= 3) allyGift(p.id, s._name || p.castle_name, site.level);
  }
  m.result = { win, battle, enemies: stageEnemies(siteStage(site.level)), mine, enemy, wounded, reward, title: `${site.name} · ур. ${site.level}` };
  m.phase = 'back'; m.backStart = m.arrive; m.backAt = m.arrive + m.travel * 1000;
}

// Налёт на замок игрока: его отряд героев и вся армия против нашего похода
function raid(p, m) {
  const s = p.state;
  const d = getPlayer(m.defId);
  m.phase = 'back'; m.backStart = m.arrive; m.backAt = m.arrive + m.travel * 1000;
  if (!d) { m.result = { win: false, note: 'Замок исчез с карты' }; return; }
  const ds = d.state;
  tick(ds);
  migrateTroops(ds);
  if (ds.shieldUntil > m.arrive) { m.result = { win: false, note: 'Замок под защитным щитом — отряд вернулся' }; return; }
  const mine = troopMight(m.troops, s.race, null, mods(s)), theirs = Math.max(200, troopMight(ds.troops, ds.race, null, mods(ds)));
  const defTeam = (ds.formation || []).map((id) => (id && ds.roster?.[id] ? { id, level: ds.roster[id].level, stars: ds.roster[id].stars, skills: ds.roster[id].skills, mul: mightMul(theirs, mine) } : null));
  const battle = simulate(arrange(heroTeam(s, m.heroes, mightMul(mine, theirs))), defTeam.some(Boolean) ? defTeam : stageEnemies(1));
  const win = battle.winner === 'a';
  const myW = hurt(m.troops, win ? Math.min(0.5, 0.2 * theirs / mine) : Math.min(0.8, 0.45 * theirs / mine + 0.1));
  const theirW = hurt(ds.troops, win ? Math.min(0.6, 0.3 * mine / theirs) : Math.min(0.4, 0.12 * mine / theirs));
  m.wounded = myW; m.troops = minus(m.troops, myW);
  ds.troops = minus(ds.troops, theirW);
  addWounded(ds, theirW);
  let loot = null;
  if (win) {
    // добыча: до 20% ресурсов сверх защищённых, но не больше груза отряда
    const prot = 2000 * castleLevelOf(ds);
    const avail = Object.fromEntries(['food', 'wood', 'stone', 'iron', 'gold'].map((r) => [r, Math.max(0, Math.floor(((ds.res[r] || 0) - prot) * 0.2))]));
    const sum = Object.values(avail).reduce((a, v) => a + v, 0), cap = troopLoad(m.troops, s.race, mods(s));
    const k = sum > cap ? cap / sum : 1;
    loot = Object.fromEntries(Object.entries(avail).map(([r, v]) => [r, Math.floor(v * k)]).filter(([, v]) => v > 0));
    for (const [r, v] of Object.entries(loot)) ds.res[r] -= v;
    ds.shieldUntil = Date.now() + 4 * 3600e3;
  }
  const offer = trophyOffer(s.trophies, ds.trophies);
  const tro = win ? Math.max(1, offer) : -Math.round(offer * 0.6);
  s.trophies = Math.max(0, s.trophies + tro); ds.trophies = Math.max(0, ds.trophies - tro);
  ds.reports = [{ ts: Date.now(), type: 'defense', attacker: m.byName, attackerId: p.id, win: !win, loot: loot || {}, trophies: -tro, wounded: theirW }, ...(ds.reports || [])].slice(0, 30);
  ds.stats.defenses = (ds.stats.defenses || 0) + 1;
  if (!win) ds.stats.defWins = (ds.stats.defWins || 0) + 1;
  savePlayer(d, false);
  s.stats.attacks = (s.stats.attacks || 0) + 1;
  if (win) { s.stats.wins = (s.stats.wins || 0) + 1; bumpDaily(s, 'wins'); }
  m.loot = loot;
  m.result = { win, battle, enemies: defTeam, mine, enemy: theirs, wounded: myW, reward: loot, trophies: tro, title: `Налёт: ${m.targetName}` };
}

function home(s, m) {
  for (const [k, n] of Object.entries(m.troops)) s.troops[k] = (s.troops[k] || 0) + n;
  let died = {};
  if (m.wounded) died = addWounded(s, m.wounded);
  const got = m.loot ? grant(s, m.loot) : {};
  if (m.kind === 'gather' && got[m.res]) { s.stats.gathered = (s.stats.gathered || 0) + got[m.res]; bumpDaily(s, 'gather'); }
  const rep = { ts: Date.now(), type: m.kind === 'gather' ? 'gather' : 'march', target: m.targetName, win: m.result?.win, got, wounded: m.wounded || {}, died, note: m.result?.note };
  s.reports = [rep, ...(s.reports || [])].slice(0, 30);
  if (m.result?.battle) {
    s.battleLogs = [{ id: m.id, ts: rep.ts, ...m.result }, ...(s.battleLogs || [])].slice(0, 3);
  }
  s.marches = s.marches.filter((x) => x !== m);
}

// --- Действия -----------------------------------------------------------------------
Object.assign(actions, {
  // { kind: 'attack'|'gather', siteId | playerId, x, y, heroes: [], troops: {} }
  march(s, a) {
    migrateTroops(s);
    s.marches ||= [];
    const cl = castleLevelOf(s);
    if (s.marches.length >= marchSlots(cl, mods(s))) fail(`Все отряды в походе (${s.marches.length}/${marchSlots(cl, mods(s))})`);
    const kind = a.kind === 'gather' ? 'gather' : 'attack';
    const heroes = [...new Set((a.heroes || []).filter((id) => s.roster?.[id]))].slice(0, MAX_HEROES);
    if (!heroes.length && kind === 'attack') fail('Нужен хотя бы один герой — он поведёт отряд');
    const busy = busyHeroes(s);
    if (heroes.some((id) => busy.has(id))) fail('Герой уже в другом походе');
    const troops = {};
    for (const [k, n0] of Object.entries(a.troops || {})) {
      const n = Math.floor(+n0 || 0);
      if (n <= 0) continue;
      if (!(k in s.troops) || s.troops[k] < n) fail('Столько воинов нет');
      troops[k] = n;
    }
    if (!troopCount(troops)) fail('Возьмите в поход войска');
    if (troopCount(troops) > marchCap(cl, mods(s))) fail(`В поход — не больше ${marchCap(cl, mods(s))} воинов`);
    let tx, ty, target, siteId = null, defId = null, targetName, res = null;
    const myX = s._x, myY = s._y;
    if (a.playerId) {
      const d = getPlayer(Number(a.playerId)) || fail('Замок не найден');
      if (d.id === s._pid) fail('Это ваш замок');
      if (kind !== 'attack') fail('Собирать можно только на ресурсах');
      if (d.state.shieldUntil > Date.now()) fail('Замок под защитным щитом');
      tx = d.wx; ty = d.wy; target = 'player'; defId = d.id; targetName = d.castle_name;
      s.shieldUntil = 0;
    } else {
      const site = campById(String(a.siteId)) || fail('Цель не найдена');
      if ((s.npc[site.id] || 0) > Date.now()) fail('Объект ещё восстанавливается');
      if (s.marches.some((m) => m.siteId === site.id)) fail('Туда уже идёт ваш отряд');
      if (site.fort) fail('Крепость берут только сбором союза');
      const isRes = !!SITE_TYPES[site.type].res;
      if (kind === 'gather' && !isRes) fail('Здесь нечего собирать');
      if (kind === 'attack' && isRes) fail('Ресурсы не атакуют — отправьте отряд на сбор');
      tx = site.x; ty = site.y; target = 'site'; siteId = site.id; targetName = `${site.name} · ур. ${site.level}`; res = SITE_TYPES[site.type].res || null;
    }
    const travel = travelSec(Math.hypot(tx - myX, ty - myY), troops, mods(s));
    for (const [k, n] of Object.entries(troops)) s.troops[k] -= n;
    const now = Date.now();
    const m = { id: `${now.toString(36)}${Math.floor(Math.random() * 1e4)}`, kind, target, siteId, defId, targetName, res, heroes, troops,
      fx: myX, fy: myY, tx, ty, start: now, arrive: now + travel * 1000, travel, phase: 'go', byName: s._name };
    s.marches.push(m);
    return { march: m.id, travel };
  },

  // Отзыв: в пути — разворот, на сборе — с тем, что успели собрать
  recall(s, { id }) {
    const m = (s.marches || []).find((v) => v.id === id) || fail('Поход не найден');
    const now = Date.now();
    if (m.phase === 'go') { m.backFrom = Math.min(1, (now - m.start) / Math.max(1, m.arrive - m.start)); m.phase = 'back'; m.backStart = now; m.backAt = now + (now - m.start); m.recalled = true; }
    else if (m.phase === 'work') {
      const done = Math.max(0, Math.min(1, (now - m.arrive) / Math.max(1, m.workEnd - m.arrive)));
      m.loot = { [m.res]: Math.floor(m.take * done) };
      m.phase = 'back'; m.backStart = now; m.backAt = now + m.travel * 1000;
    } else fail('Отряд уже возвращается');
  },

  // Ускорить текущий участок похода
  speedupMarch(s, { id }) {
    const m = (s.marches || []).find((v) => v.id === id) || fail('Поход не найден');
    const now = Date.now();
    const end = m.phase === 'go' ? m.arrive : m.phase === 'work' ? m.workEnd : m.backAt;
    const left = (end - now) / 1000;
    if (left <= 0) return;
    const cost = Math.max(1, Math.ceil(gemsForTime(left) / 2));
    if (s.res.gems < cost) fail('Не хватает самоцветов');
    s.res.gems -= cost;
    const shift = end - now;
    if (m.phase === 'go') { m.arrive = now; m.start -= shift; }
    else if (m.phase === 'work') m.workEnd = now;
    else { m.backAt = now; m.backStart = now - 1; }
  },
});

export function marchView(s) {
  return {
    marches: (s.marches || []).map((m) => ({ ...m, result: m.result ? { win: m.result.win, note: m.result.note, title: m.result.title, hasBattle: !!m.result.battle } : null })),
    marchSlots: marchSlots(castleLevelOf(s), mods(s)), marchCap: marchCap(castleLevelOf(s), mods(s)),
    battleLogs: (s.battleLogs || []).map((b) => ({ id: b.id, ts: b.ts, title: b.title, win: b.win })),
  };
}
export function battleLog(s, id) {
  const m = (s.marches || []).find((v) => v.id === id && v.result?.battle);
  if (m) return { id: m.id, ...m.result };
  return (s.battleLogs || []).find((b) => b.id === id) || null;
}
void TROOP_KINDS; void RES_LIST; void RES_GEN;
