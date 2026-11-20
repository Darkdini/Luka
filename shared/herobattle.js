// ============================================================================
//  Автобой героев 5×5 по раундам. Полностью детерминирован: сервер считает
//  результат, клиент проигрывает тот же журнал событий. Без Math.random.
//  Слоты: 0–1 передний ряд, 2–4 задний.
// ============================================================================
import { HERO, heroStats, raceSynergy, skillNumbers, defaultSkills } from './heroes.js';

export const MAX_ROUNDS = 15;
const ENERGY_ACT = 30, ENERGY_HIT = 12;

function makeSide(team, side) {
  const ids = team.map((u) => u && u.id);
  const syn = raceSynergy(ids);
  // поддержка: лучший бонус к атаке среди героев-поддержки отряда
  const supportBonus = Math.max(0, ...team.filter((u) => u && HERO[u.id]?.role === 'support').map((u) => skillNumbers('support', u.skills || defaultSkills()).passive));
  return team.map((u, slot) => {
    if (!u || !HERO[u.id]) return null;
    const sk = u.skills || defaultSkills();
    const st = heroStats(u.id, u.level || 1, u.stars || 0, sk);
    const k = 1 + syn.bonus;
    return {
      sk: skillNumbers(HERO[u.id].role, sk, HERO[u.id].assassin),
      uid: `${side}${slot}`, id: u.id, side, slot, front: slot < 2,
      role: HERO[u.id].role, assassin: !!HERO[u.id].assassin,
      maxHp: Math.round(st.hp * k), hp: Math.round(st.hp * k),
      atk: Math.round(st.atk * k * (1 + supportBonus)), def: st.def, spd: st.spd,
      energy: 0, guard: 0, buff: 0, dmgDone: 0, healDone: 0,
    };
  }).filter(Boolean);
}

const alive = (arr) => arr.filter((u) => u.hp > 0);
// «Случайность» как хэш раунда и бойца — одинаково везде
const jitter = (round, uid, k) => {
  let h = (round * 374761393 + uid.charCodeAt(0) * 668265263 + uid.charCodeAt(1) * 2246822519 + k * 3266489917) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return 0.92 + (((h ^ (h >>> 16)) >>> 0) % 1000) / 1000 * 0.16; // 0.92–1.08
};

function pickTarget(actor, enemies) {
  const live = alive(enemies);
  if (!live.length) return null;
  if (actor.assassin) {
    const back = live.filter((u) => !u.front);
    if (back.length) return back.reduce((a, b) => (b.hp < a.hp ? b : a));
  }
  const front = live.filter((u) => u.front);
  const pool = front.length ? front : live;
  return pool.reduce((a, b) => (b.slot < a.slot ? b : a));
}

function damage(S, actor, target, mult, round, k) {
  let atk = actor.atk * (actor.buff > 0 ? 1.3 : 1);
  if (actor.role === 'dmg' && target.hp > target.maxHp / 2) atk *= 1 + actor.sk.passive;
  // «ярость»: с 6-го раунда урон растёт, чтобы бой не затягивался
  const rage = 1 + Math.max(0, round - 5) * 0.2;
  let d = atk * mult * rage * (100 / (100 + target.def)) * jitter(round, actor.uid, k);
  if (target.role === 'tank') d *= 1 - target.sk.passive;
  if (target.guard > 0) d *= 0.6;
  d = Math.max(1, Math.round(d));
  const real = Math.min(d, target.hp);
  target.hp -= real;
  actor.dmgDone += real;
  target.energy = Math.min(100, target.energy + ENERGY_HIT);
  return { to: target.uid, v: d, kill: target.hp <= 0 };
}

function heal(actor, target, amount) {
  const v = Math.min(Math.round(amount), target.maxHp - target.hp);
  target.hp += v;
  actor.healDone += v;
  return { to: target.uid, v, heal: true };
}

export function simulate(teamA, teamB) {
  const A = makeSide(teamA, 'a'), B = makeSide(teamB, 'b');
  const all = [...A, ...B];
  const log = [];
  let round = 0, winner = null;
  while (round < MAX_ROUNDS && !winner) {
    round++;
    log.push({ k: 'round', r: round });
    const order = alive(all).sort((x, y) => y.spd - x.spd || (x.side === 'a' ? -1 : 1) || x.slot - y.slot);
    for (const actor of order) {
      if (actor.hp <= 0) continue;
      const mine = actor.side === 'a' ? A : B, foes = actor.side === 'a' ? B : A;
      if (!alive(foes).length) break;
      const ev = { k: 'act', a: actor.uid, hits: [] };
      if (actor.energy >= 100) {
        actor.energy = 0;
        ev.ult = true;
        ev.name = HERO[actor.id].ult;
        if (actor.role === 'tank') {
          actor.guard = 2;
          for (const t of alive(foes).filter((u) => u.front)) ev.hits.push(damage(null, actor, t, actor.sk.ult, round, 1));
          if (!ev.hits.length) ev.hits.push(damage(null, actor, pickTarget(actor, foes), actor.sk.ult, round, 1));
        } else if (actor.role === 'dmg') {
          ev.hits.push(damage(null, actor, pickTarget(actor, foes), actor.sk.ult, round, 2));
        } else if (actor.role === 'aoe') {
          alive(foes).forEach((t, i) => ev.hits.push(damage(null, actor, t, actor.sk.ult, round, 3 + i)));
        } else if (actor.role === 'heal') {
          for (const t of alive(mine)) ev.hits.push(heal(actor, t, actor.atk * actor.sk.ult));
        } else if (actor.role === 'support') {
          for (const t of alive(mine)) t.buff = 2;
          ev.buff = true;
          ev.hits.push(damage(null, actor, pickTarget(actor, foes), actor.sk.ult, round, 4));
        }
      } else {
        const t = pickTarget(actor, foes);
        ev.hits.push(damage(null, actor, t, actor.sk.basic, round, 0));
        if (actor.role === 'heal') {
          const low = alive(mine).reduce((a, b) => (b.hp / b.maxHp < a.hp / a.maxHp ? b : a));
          ev.hits.push(heal(actor, low, actor.atk * actor.sk.passive));
        }
        actor.energy = Math.min(100, actor.energy + ENERGY_ACT + (actor.role === 'aoe' ? actor.sk.passive : 0));
      }
      ev.e = actor.energy;
      log.push(ev);
      if (!alive(B).length) { winner = 'a'; break; }
      if (!alive(A).length) { winner = 'b'; break; }
    }
    for (const u of all) { if (u.guard > 0) u.guard--; if (u.buff > 0) u.buff--; }
  }
  if (!winner) { // время вышло — по доле оставшегося здоровья
    const share = (arr) => arr.reduce((t, u) => t + Math.max(0, u.hp) / u.maxHp, 0) / arr.length;
    winner = share(A) > share(B) ? 'a' : 'b';
  }
  const mvpPool = (winner === 'a' ? A : B);
  const mvp = mvpPool.reduce((x, y) => (y.dmgDone + y.healDone > x.dmgDone + x.healDone ? y : x));
  const totalDmg = mvpPool.reduce((s, u) => s + u.dmgDone + u.healDone, 0) || 1;
  const aliveA = alive(A).length;
  const stars = winner === 'a' ? (aliveA === A.length ? 3 : aliveA >= Math.ceil(A.length / 2) ? 2 : 1) : 0;
  return {
    winner, rounds: round, stars, log,
    units: all.map((u) => ({ uid: u.uid, id: u.id, side: u.side, slot: u.slot, maxHp: u.maxHp, hp: u.hp, dmg: u.dmgDone, heal: u.healDone })),
    mvp: { uid: mvp.uid, id: mvp.id, v: mvp.dmgDone + mvp.healDone, pct: Math.round((mvp.dmgDone + mvp.healDone) / totalDmg * 1000) / 10 },
  };
}
