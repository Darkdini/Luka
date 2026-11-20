// Серверная логика войск: обучение в трёх лагерях, госпиталь.
import { BUILDINGS, gemsForTime, gemsForResources } from '../shared/config.js';
import {
  TROOP_KINDS, KIND_ORDER, TIER_CAMP, TIER_MAX, troopKey, parseKey, troopCost, troopTime, batchMax, maxTierOf,
  hospitalCapOf, healCost, healTime, troopPowerOf, troopName,
} from '../shared/troops.js';

export class TroopError extends Error {}
const fail = (m) => { throw new TroopError(m); };

export function migrateTroops(s) {
  if (s.troops) return;
  s.troops = { infantry1: 60, archer1: 40 };     // городское ополчение
  s.trainQ = { infantry: null, archer: null, cavalry: null };
  s.wounded = {};
  s.healQ = null;
}

// Лагерь рода войск: лучший по уровню, отвоёванный и не на стройке
export function campOf(s, kind) {
  const type = TROOP_KINDS[kind].camp;
  return s.buildings.filter((b) => b.type === type && !b.captured && b.level > 0).sort((a, b) => b.level - a.level)[0] || null;
}
const hospitalCap = (s) => hospitalCapOf(s.buildings.filter((b) => b.type === 'hospital' && !b.captured && b.level > 0).map((b) => b.level));
const woundedTotal = (s) => Object.values(s.wounded || {}).reduce((a, v) => a + v, 0);
export const troopPower = (s) => Object.entries(s.troops || {}).reduce((t, [k, n]) => t + troopPowerOf(parseKey(k).tier) * n, 0);

export function tickTroops(s, now = Date.now()) {
  migrateTroops(s);
  for (const kind of KIND_ORDER) {
    const q = s.trainQ[kind];
    if (q && q.end <= now) {
      const k = troopKey(kind, q.tier);
      s.troops[k] = (s.troops[k] || 0) + q.n;
      s.trainQ[kind] = null;
    }
  }
  if (s.healQ && s.healQ.end <= now) {
    for (const [k, n] of Object.entries(s.healQ.list)) s.troops[k] = (s.troops[k] || 0) + n;
    s.healQ = null;
  }
}

function checkTrain(s, kind, tier, n) {
  if (!TROOP_KINDS[kind]) fail('Неизвестный род войск');
  tier |= 0; n |= 0;
  if (tier < 1 || tier > TIER_MAX) fail('Неверная ступень');
  const camp = campOf(s, kind);
  const campName = BUILDINGS[TROOP_KINDS[kind].camp].name;
  if (!camp) fail(`Нужно здание «${campName}»`);
  if (camp.up) fail(`${campName} на стройке`);
  if (tier > maxTierOf(camp.level)) fail(`Ступень ${tier} откроется на ${campName} ${TIER_CAMP[tier - 1]} ур.`);
  if (s.trainQ[kind]) fail('Лагерь уже обучает отряд');
  if (n < 1) fail('Сколько воинов обучить?');
  if (n > batchMax(camp.level)) fail(`За раз не больше ${batchMax(camp.level)}`);
  return { tier, n, time: Math.max(1, Math.round(troopTime(tier, s.race) * n)) };
}

export function troopActions({ pay, payCost, bumpDaily }) {
  return {
    trainTroops(s, { kind, tier, n }) {
      migrateTroops(s);
      const c = checkTrain(s, kind, tier, n);
      payCost(s, troopCost(kind, c.tier, c.n));
      s.trainQ[kind] = { tier: c.tier, n: c.n, end: Date.now() + c.time * 1000, total: c.time };
      s.stats.trained = (s.stats.trained || 0) + c.n;
      bumpDaily(s, 'trained', c.n);
      return { time: c.time };
    },

    // Сразу: самоцветы за время и за недостающие ресурсы
    trainNow(s, { kind, tier, n }) {
      migrateTroops(s);
      const c = checkTrain(s, kind, tier, n);
      const cost = troopCost(kind, c.tier, c.n);
      let missing = 0;
      for (const [r, v] of Object.entries(cost)) missing += Math.max(0, v - (s.res[r] || 0));
      pay(s, 'gems', gemsForTime(c.time) + gemsForResources(missing));
      for (const [r, v] of Object.entries(cost)) s.res[r] = Math.max(0, (s.res[r] || 0) - v);
      const k = troopKey(kind, c.tier);
      s.troops[k] = (s.troops[k] || 0) + c.n;
      s.stats.trained = (s.stats.trained || 0) + c.n;
      bumpDaily(s, 'trained', c.n);
      return { n: c.n };
    },

    speedupTrain(s, { kind }) {
      migrateTroops(s);
      const q = s.trainQ[kind] || fail('Лагерь свободен');
      pay(s, 'gems', gemsForTime((q.end - Date.now()) / 1000));
      q.end = Date.now();
      tickTroops(s);
    },

    // Отмена: половина ресурсов возвращается
    cancelTrain(s, { kind }) {
      migrateTroops(s);
      const q = s.trainQ[kind] || fail('Лагерь свободен');
      const cost = troopCost(kind, q.tier, q.n);
      for (const [r, v] of Object.entries(cost)) s.res[r] = (s.res[r] || 0) + Math.floor(v / 2);
      s.trainQ[kind] = null;
    },

    healAll(s) {
      migrateTroops(s);
      if (s.healQ) fail('Госпиталь уже лечит');
      const list = { ...s.wounded };
      const n = Object.values(list).reduce((a, v) => a + v, 0);
      if (!n) fail('Раненых нет');
      if (!hospitalCap(s)) fail('Постройте Госпиталь');
      const cost = {};
      let time = 0;
      for (const [k, cnt] of Object.entries(list)) {
        const { kind, tier } = parseKey(k);
        for (const [r, v] of Object.entries(healCost(kind, tier, cnt))) cost[r] = (cost[r] || 0) + v;
        time += healTime(tier, cnt);
      }
      payCost(s, cost);
      s.wounded = {};
      time = Math.max(1, Math.round(time));
      s.healQ = { list, end: Date.now() + time * 1000, total: time };
      return { n, time };
    },

    speedupHeal(s) {
      migrateTroops(s);
      if (!s.healQ) fail('Лечить некого');
      pay(s, 'gems', gemsForTime((s.healQ.end - Date.now()) / 1000));
      s.healQ.end = Date.now();
      tickTroops(s);
    },
  };
}

// Раненые (после боёв на карте): сверх вместимости госпиталя — погибают
export function addWounded(s, list) {
  migrateTroops(s);
  let free = Math.max(0, hospitalCap(s) - woundedTotal(s));
  const died = {};
  for (const [k, n] of Object.entries(list)) {
    const take = Math.min(free, n);
    if (take) s.wounded[k] = (s.wounded[k] || 0) + take;
    if (n - take) died[k] = n - take;
    free -= take;
  }
  return died;
}

export function troopView(s) {
  migrateTroops(s);
  return {
    troops: s.troops, trainQ: s.trainQ, wounded: s.wounded, healQ: s.healQ,
    hospitalCap: hospitalCap(s), troopPower: troopPower(s),
  };
}

export { troopName };
