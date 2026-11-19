// ============================================================================
//  Детерминированная симуляция боя.
//  Один и тот же код крутится в браузере (живой показ) и на сервере (проверка
//  результата по журналу команд) — подделать итог атаки с клиента нельзя.
//  Никакого Math.random: только арифметика и порядок массивов.
// ============================================================================
import {
  GRID, BATTLE, BUILDINGS, TROOPS, HEROES, SPELLS, RACES,
  buildingHp, troopLevelMul, heroLevelMul,
} from './config.js';

const DT = 1 / BATTLE.tickRate;
const SQ2 = Math.SQRT2;

const RES_CATS = new Set(['resource', 'storage']);

export function createBattle({ base, defRace, attacker }) {
  const S = {
    tick: 0,
    maxTick: BATTLE.duration * BATTLE.tickRate,
    over: false,
    bld: [],
    units: [],
    proj: [],
    spells: [],
    fx: [],                 // события для отрисовки (клиент очищает сам)
    nextId: 1,
    wallAt: new Int32Array(GRID * GRID).fill(-1),
    blocked: new Uint8Array(GRID * GRID),
    forbid: new Uint8Array(GRID * GRID),
    total: 0, destroyed: 0, castleDown: false,
    loot: { gold: 0, food: 0 },
    left: {
      troops: { ...(attacker.army || {}) },
      heroes: Object.fromEntries(Object.keys(attacker.heroes || {}).map((k) => [k, true])),
      spells: { ...(attacker.spells || {}) },
    },
    used: { troops: {}, spells: {}, heroes: {} },
    att: attacker,
    deployedAny: false,
  };

  for (const b of base.buildings) {
    const def = BUILDINGS[b.type];
    if (!def || b.level < 1) continue;
    const size = def.size;
    const o = {
      i: S.bld.length, id: b.id, type: b.type, level: b.level, x: b.x, y: b.y, size,
      cx: b.x + size / 2, cy: b.y + size / 2, cat: def.cat,
      hp: buildingHp(b.type, b.level, defRace), maxHp: buildingHp(b.type, b.level, defRace),
      dead: false, cool: 0, target: -1, frozen: 0, loot: b.loot || null,
      def: def.def ? scaleDef(def.def, b.level) : null,
      trap: def.trap ? { ...def.trap, dmg: Math.round(def.trap.dmg * (1 + 0.25 * (b.level - 1))) } : null,
    };
    S.bld.push(o);
    if (o.cat === 'trap') continue;
    if (o.cat === 'wall') S.wallAt[b.y * GRID + b.x] = o.i;
    else {
      S.total++;
      for (let yy = b.y; yy < b.y + size; yy++) for (let xx = b.x; xx < b.x + size; xx++) S.blocked[yy * GRID + xx] = 1;
    }
    for (let yy = b.y - 1; yy < b.y + size + 1; yy++)
      for (let xx = b.x - 1; xx < b.x + size + 1; xx++)
        if (xx >= 0 && yy >= 0 && xx < GRID && yy < GRID) S.forbid[yy * GRID + xx] = 1;
  }
  return S;
}

function scaleDef(d, level) {
  return { ...d, dmg: d.dmg * (1 + 0.2 * (level - 1)) };
}

export function canDeployAt(S, x, y) {
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return false;
  return !S.forbid[(y | 0) * GRID + (x | 0)];
}

// --- Команды игрока ---------------------------------------------------------
export function applyCommand(S, cmd) {
  if (S.over) return false;
  const { c, k } = cmd;
  const x = Math.round(cmd.x * 10) / 10, y = Math.round(cmd.y * 10) / 10;
  if (c === 'end') { S.over = true; return true; }
  if (c === 'troop') {
    if (!TROOPS[k] || !(S.left.troops[k] > 0) || !canDeployAt(S, x, y)) return false;
    S.left.troops[k]--;
    S.used.troops[k] = (S.used.troops[k] || 0) + 1;
    spawnUnit(S, k, false, x, y);
    return true;
  }
  if (c === 'hero') {
    if (!HEROES[k] || !S.left.heroes[k] || !canDeployAt(S, x, y)) return false;
    S.left.heroes[k] = false;
    S.used.heroes[k] = true;
    spawnUnit(S, k, true, x, y);
    return true;
  }
  if (c === 'spell') {
    if (!SPELLS[k] || !(S.left.spells[k] > 0) || x < 0 || y < 0 || x >= GRID || y >= GRID) return false;
    S.left.spells[k]--;
    S.used.spells[k] = (S.used.spells[k] || 0) + 1;
    castSpell(S, k, x, y);
    S.deployedAny = true;
    return true;
  }
  if (c === 'ability') {
    const u = S.units.find((v) => v.isHero && v.kind === k && v.hp > 0);
    if (!u || u.abilityUsed) return false;
    u.abilityUsed = true;
    heroAbility(S, u);
    return true;
  }
  return false;
}

function spawnUnit(S, kind, isHero, x, y) {
  const base = isHero ? HEROES[kind] : TROOPS[kind];
  const lvl = isHero ? (S.att.heroes[kind]?.level || 1) : (S.att.troopLevels?.[kind] || 1);
  const mul = isHero ? heroLevelMul(lvl) : troopLevelMul(lvl);
  const race = RACES[S.att.race]?.bonus || {};
  let dmgMul = mul;
  if (base.ranged && race.rangedDmg) dmgMul *= 1 + race.rangedDmg;
  if (base.melee && race.meleeDmg) dmgMul *= 1 + race.meleeDmg;
  const u = {
    id: S.nextId++, kind, isHero, x, y,
    hp: Math.round(base.hp * mul * (1 + (race.troopHp || 0))), maxHp: Math.round(base.hp * mul * (1 + (race.troopHp || 0))),
    dmg: (base.dmg || 0) * dmgMul, heal: (base.heal || 0) * mul,
    interval: base.interval, range: base.range, speed: base.speed,
    pref: base.target, air: !!base.air, splash: base.splash || 0,
    resMul: base.resMul || 1, wallMul: base.wallMul || 1, suicide: !!base.suicide,
    cool: 0, tb: -1, tu: -1, path: null, pi: 0, stun: 0, stealth: 0, rate: 1, rateT: 0,
    aura: 0, buffD: 1, buffS: 1, abilityUsed: false, dir: 1, state: 'walk',
  };
  S.units.push(u);
  S.deployedAny = true;
  S.fx.push({ k: 'deploy', x, y, kind });
  return u;
}

// --- Геометрия -------------------------------------------------------------
function distRect(px, py, b) {
  const dx = Math.max(b.x - px, 0, px - (b.x + b.size));
  const dy = Math.max(b.y - py, 0, py - (b.y + b.size));
  return Math.sqrt(dx * dx + dy * dy);
}
const dist = (ax, ay, bx, by) => Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);

// --- Выбор цели ------------------------------------------------------------
function pickTarget(S, u) {
  const alive = (b) => !b.dead && b.cat !== 'trap';
  let filter;
  switch (u.pref) {
    case 'defense': filter = (b) => b.cat === 'defense'; break;
    case 'resource': filter = (b) => RES_CATS.has(b.cat); break;
    case 'wall': filter = (b) => b.cat === 'wall'; break;
    case 'castle': filter = (b) => b.cat === 'castle'; break;
    default: filter = null;
  }
  let best = -1, bd = 1e9;
  const scan = (f) => {
    for (const b of S.bld) {
      if (!alive(b) || b.cat === 'wall' && u.pref !== 'wall') continue;
      if (f && !f(b)) continue;
      const d = distRect(u.x, u.y, b);
      if (d < bd - 1e-9) { bd = d; best = b.i; }
    }
  };
  if (filter) scan(filter);
  if (best < 0 && u.pref === 'castle') scan((b) => b.cat === 'defense');
  if (best < 0) scan(null);
  return best;
}

// --- Поиск пути (A*) ---------------------------------------------------------
// Здания непроходимы, стены — проходимы с высокой ценой (их придётся ломать).
const WALL_COST = 9;
function findPath(S, u, b) {
  const sx = Math.min(GRID - 1, Math.max(0, u.x | 0)), sy = Math.min(GRID - 1, Math.max(0, u.y | 0));
  const reach = Math.max(u.range, 0.6) + 0.35;
  const N = GRID * GRID;
  const g = new Float32Array(N).fill(1e9);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = [];
  const push = (n, f) => {
    heap.push([f, n]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] < heap[i][0] || (heap[p][0] === heap[i][0] && heap[p][1] <= heap[i][1])) break;
      [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        const less = (a, c) => heap[a][0] < heap[c][0] || (heap[a][0] === heap[c][0] && heap[a][1] < heap[c][1]);
        if (l < heap.length && less(l, m)) m = l;
        if (r < heap.length && less(r, m)) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  const h = (x, y) => Math.max(0, distRect(x + 0.5, y + 0.5, b) - reach);
  const s = sy * GRID + sx;
  g[s] = 0;
  push(s, h(sx, sy));
  let goal = -1, iter = 0;
  while (heap.length && iter++ < 4000) {
    const [, n] = pop();
    if (closed[n]) continue;
    closed[n] = 1;
    const x = n % GRID, y = (n / GRID) | 0;
    if (distRect(x + 0.5, y + 0.5, b) <= reach) { goal = n; break; }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
      const m = ny * GRID + nx;
      if (closed[m] || S.blocked[m]) continue;
      if (dx && dy && (S.blocked[y * GRID + nx] || S.blocked[ny * GRID + x] || S.wallAt[y * GRID + nx] >= 0 || S.wallAt[ny * GRID + x] >= 0)) continue;
      let cost = dx && dy ? SQ2 : 1;
      if (S.wallAt[m] >= 0) cost += WALL_COST;
      const ng = g[n] + cost;
      if (ng < g[m]) { g[m] = ng; from[m] = n; push(m, ng + h(nx, ny)); }
    }
  }
  if (goal < 0) return null;
  const path = [];
  for (let n = goal; n !== s && n >= 0; n = from[n]) path.push(n);
  path.reverse();
  return path;
}

// --- Урон -----------------------------------------------------------------
function damageBuilding(S, b, dmg) {
  if (b.dead) return;
  if (dmg >= 8 && b.cat !== 'wall') S.fx.push({ k: 'num', x: b.cx, y: b.cy, v: Math.round(Math.min(dmg, b.hp)), b: true });
  b.hp -= dmg;
  if (b.hp <= 0) destroyBuilding(S, b);
}

function destroyBuilding(S, b) {
  b.dead = true; b.hp = 0;
  if (b.cat === 'wall') S.wallAt[b.y * GRID + b.x] = -1;
  else if (b.cat !== 'trap') {
    for (let yy = b.y; yy < b.y + b.size; yy++) for (let xx = b.x; xx < b.x + b.size; xx++) S.blocked[yy * GRID + xx] = 0;
    S.destroyed++;
    if (b.cat === 'castle') S.castleDown = true;
    if (b.loot) { S.loot.gold += b.loot.gold || 0; S.loot.food += b.loot.food || 0; }
  }
  S.fx.push({ k: 'destroy', i: b.i, x: b.cx, y: b.cy, size: b.size, wall: b.cat === 'wall' });
}

function damageUnit(S, u, dmg) {
  if (u.hp <= 0) return;
  if (dmg >= 8) S.fx.push({ k: 'num', x: u.x, y: u.y, v: Math.round(Math.min(dmg, u.hp)), u: true });
  u.hp -= dmg;
  if (u.hp <= 0) { u.hp = 0; S.fx.push({ k: 'die', x: u.x, y: u.y, kind: u.kind }); }
}

function buildingsInRadius(S, x, y, r, fn) {
  for (const b of S.bld) if (!b.dead && b.cat !== 'trap' && distRect(x, y, b) <= r) fn(b);
}

// --- Заклинания и способности ------------------------------------------------
function castSpell(S, k, x, y) {
  const sp = SPELLS[k];
  S.fx.push({ k: 'spell', spell: k, x, y, r: sp.radius });
  if (k === 'fireball') {
    buildingsInRadius(S, x, y, sp.radius, (b) => damageBuilding(S, b, b.cat === 'wall' ? sp.dmg * 0.3 : sp.dmg));
  } else {
    const ticks = Math.round((sp.duration || 1) * BATTLE.tickRate);
    S.spells.push({ k, x, y, r: sp.radius, t: ticks, age: 0 });
  }
}

function heroAbility(S, u) {
  const a = HEROES[u.kind].ability;
  S.fx.push({ k: 'ability', hero: u.kind, x: u.x, y: u.y });
  if (u.kind === 'knight') {
    u.hp = Math.min(u.maxHp, u.hp + u.maxHp * a.heal);
    u.aura = a.duration * BATTLE.tickRate;
  } else if (u.kind === 'huntress') {
    u.rate = a.rateMul; u.rateT = a.duration * BATTLE.tickRate; u.stealth = u.rateT;
  } else if (u.kind === 'runesmith') {
    const dmg = a.dmg * heroLevelMul(S.att.heroes.runesmith?.level || 1);
    buildingsInRadius(S, u.x, u.y, a.radius, (b) => damageBuilding(S, b, b.cat === 'wall' ? dmg * a.wallMul : dmg));
  } else if (u.kind === 'sorceress') {
    const t = u.tb >= 0 ? S.bld[u.tb] : null;
    const cx = t ? t.cx : u.x, cy = t ? t.cy : u.y;
    const dmg = a.dmg * heroLevelMul(S.att.heroes.sorceress?.level || 1);
    for (let i = 0; i < a.count; i++) {
      const ang = i * 2.399963; // золотой угол — равномерный разброс без случайности
      const rr = a.radius * Math.sqrt((i + 0.5) / a.count);
      S.spells.push({ k: 'meteor', x: cx + Math.cos(ang) * rr, y: cy + Math.sin(ang) * rr, r: 1.2, t: 1, age: -i * 5, dmg });
    }
  }
}

function updateSpells(S) {
  for (const s of S.spells) {
    s.age++;
    if (s.age <= 0) continue;
    if (s.k === 'meteor') {
      S.fx.push({ k: 'meteor', x: s.x, y: s.y });
      buildingsInRadius(S, s.x, s.y, s.r, (b) => damageBuilding(S, b, s.dmg));
      s.t = 0;
      continue;
    }
    const sp = SPELLS[s.k];
    if (s.k === 'lightning') {
      if (s.age % 3 === 1 && (s.age - 1) / 3 < sp.strikes) {
        S.fx.push({ k: 'bolt', x: s.x, y: s.y });
        buildingsInRadius(S, s.x, s.y, s.r, (b) => damageBuilding(S, b, sp.dmg));
      }
    } else if (s.k === 'heal') {
      if (s.age % 5 === 0) for (const u of S.units) if (u.hp > 0 && dist(u.x, u.y, s.x, s.y) <= s.r) u.hp = Math.min(u.maxHp, u.hp + sp.heal);
    } else if (s.k === 'freeze') {
      buildingsInRadius(S, s.x, s.y, s.r, (b) => { if (b.def) b.frozen = 2; });
      for (const b of S.bld) if (b.trap && !b.dead && dist(b.cx, b.cy, s.x, s.y) <= s.r) b.frozen = 2;
    }
    s.t--;
  }
  S.spells = S.spells.filter((s) => s.t > 0);
}

// --- Обновление юнитов --------------------------------------------------------
function unitBuffs(S, u) {
  let d = 1, sp = 1;
  for (const s of S.spells) if (s.k === 'rage' && s.age > 0 && dist(u.x, u.y, s.x, s.y) <= s.r) {
    d = Math.max(d, SPELLS.rage.dmgMul); sp = Math.max(sp, SPELLS.rage.speedMul);
  }
  for (const h of S.units) if (h.aura > 0 && h.hp > 0 && dist(u.x, u.y, h.x, h.y) <= HEROES.knight.ability.radius) {
    d = Math.max(d, HEROES.knight.ability.dmgMul); sp = Math.max(sp, HEROES.knight.ability.speedMul);
  }
  u.buffD = d; u.buffS = sp;
}

function attackBuilding(S, u, b) {
  if (u.cool > 0) return;
  u.cool = u.interval / u.rate;
  u.state = 'attack';
  u.dir = b.cx >= u.x ? 1 : -1;
  if (u.suicide) {
    S.fx.push({ k: 'boom', x: u.x, y: u.y, r: u.splash });
    buildingsInRadius(S, u.x, u.y, u.splash, (o) => damageBuilding(S, o, o.cat === 'wall' ? u.dmg * u.wallMul : u.dmg));
    u.hp = 0;
    return;
  }
  let dmg = u.dmg * u.buffD;
  if (RES_CATS.has(b.cat)) dmg *= u.resMul;
  if (u.range > 1.5) {
    const travel = Math.max(1, Math.ceil(distRect(u.x, u.y, b) / 1.4));
    S.proj.push({ k: u.splash ? 'magic' : 'bolt', x: u.x, y: u.y, tx: b.cx, ty: b.cy, t: travel, t0: travel, dmg, splash: u.splash, tb: b.i, from: 'unit' });
  } else {
    S.fx.push({ k: 'hit', x: b.cx, y: b.cy, small: true });
    if (u.splash) buildingsInRadius(S, b.cx, b.cy, u.splash, (o) => damageBuilding(S, o, dmg));
    else damageBuilding(S, b, dmg);
  }
}

function updateHealer(S, u) {
  let best = null, bd = 1e9;
  for (const o of S.units) {
    if (o === u || o.hp <= 0 || o.kind === 'priest') continue;
    const need = o.hp < o.maxHp ? 0 : 3;
    const d = dist(u.x, u.y, o.x, o.y) + need;
    if (d < bd) { bd = d; best = o; }
  }
  if (!best) return;
  const d = dist(u.x, u.y, best.x, best.y);
  if (d > u.range) moveToward(S, u, best.x, best.y, true);
  if (u.cool <= 0) {
    let healed = false;
    for (const o of S.units) if (o.hp > 0 && o.hp < o.maxHp && dist(u.x, u.y, o.x, o.y) <= TROOPS.priest.healRadius) {
      o.hp = Math.min(o.maxHp, o.hp + u.heal); healed = true;
    }
    if (healed) { u.cool = u.interval; S.fx.push({ k: 'healpulse', x: u.x, y: u.y }); }
  }
}

function moveToward(S, u, tx, ty, free) {
  const sp = u.speed * u.buffS * DT;
  const dx = tx - u.x, dy = ty - u.y, d = Math.sqrt(dx * dx + dy * dy);
  u.state = 'walk';
  if (d < 1e-6) return true;
  if (Math.abs(dx - dy) > 0.01) u.dir = dx - dy > 0 ? 1 : -1;
  if (d <= sp) { u.x = tx; u.y = ty; return true; }
  u.x += dx / d * sp; u.y += dy / d * sp;
  return false;
}

function updateUnit(S, u) {
  if (u.cool > 0) u.cool -= DT;
  if (u.aura > 0) u.aura--;
  if (u.rateT > 0 && --u.rateT === 0) u.rate = 1;
  if (u.stealth > 0) u.stealth--;
  unitBuffs(S, u);
  if (u.stun > 0) { u.stun--; return; }
  if (u.pref === 'heal') return updateHealer(S, u);

  if (u.tb < 0 || S.bld[u.tb].dead) {
    u.tb = pickTarget(S, u);
    u.path = null; u.pi = 0;
    if (u.tb < 0) { u.state = 'idle'; return; }
    if (!u.air) u.path = findPath(S, u, S.bld[u.tb]);
  }
  const b = S.bld[u.tb];
  if (distRect(u.x, u.y, b) <= u.range + 0.05) return attackBuilding(S, u, b);

  if (u.air || !u.path) {
    // по прямой (летающие или если путь не найден)
    moveToward(S, u, b.cx, b.cy);
    return;
  }
  if (u.pi >= u.path.length) { u.path = findPath(S, u, b); u.pi = 0; if (!u.path) { moveToward(S, u, b.cx, b.cy); return; } }
  const n = u.path[u.pi];
  const wi = S.wallAt[n];
  if (wi >= 0) { // стена на пути — ломаем
    const w = S.bld[wi];
    if (distRect(u.x, u.y, w) <= Math.max(u.range, 0.6) + 0.05) return attackBuilding(S, u, w);
  }
  const tx = (n % GRID) + 0.5, ty = ((n / GRID) | 0) + 0.5;
  if (moveToward(S, u, tx, ty)) u.pi++;
}

// --- Оборона ---------------------------------------------------------------
function updateDefense(S, b) {
  if (b.frozen > 0) { b.frozen--; return; }
  if (b.cool > 0) b.cool -= DT;
  const d = b.def;
  const ok = (u) => u.hp > 0 && u.stealth <= 0 && (u.air ? d.air : d.ground);
  const inRange = (u) => { const r = dist(u.x, u.y, b.cx, b.cy); return r <= d.range + b.size / 2 && r >= (d.minRange || 0); };
  let t = b.target >= 0 ? S.units.find((u) => u.id === b.target) : null;
  if (!t || !ok(t) || !inRange(t)) {
    t = null; let bd = 1e9;
    for (const u of S.units) {
      if (!ok(u) || !inRange(u)) continue;
      const r = dist(u.x, u.y, b.cx, b.cy);
      if (r < bd) { bd = r; t = u; }
    }
    b.target = t ? t.id : -1;
  }
  if (!t || b.cool > 0) return;
  b.cool = d.interval;
  const r = dist(t.x, t.y, b.cx, b.cy);
  const speed = b.type === 'trebuchet' ? 0.7 : b.type === 'magetower' ? 1.1 : 1.6;
  const travel = Math.max(1, Math.ceil(r / speed));
  S.proj.push({ k: b.type, x: b.cx, y: b.cy, tx: t.x, ty: t.y, t: travel, t0: travel, dmg: d.dmg, splash: d.splash || 0, tu: t.id, air: d.air, ground: d.ground, from: 'def' });
  S.fx.push({ k: 'fire', i: b.i, tx: t.x, ty: t.y });
}

function updateProjectiles(S) {
  for (const p of S.proj) {
    if (p.from === 'def' && !p.splash) {
      const u = S.units.find((v) => v.id === p.tu);
      if (u && u.hp > 0) { p.tx = u.x; p.ty = u.y; }
    }
    if (--p.t > 0) continue;
    if (p.from === 'unit') {
      const b = S.bld[p.tb];
      if (p.splash) buildingsInRadius(S, p.tx, p.ty, p.splash, (o) => damageBuilding(S, o, p.dmg));
      else damageBuilding(S, b, p.dmg);
      S.fx.push({ k: 'hit', x: p.tx, y: p.ty, small: !p.splash });
    } else if (p.splash) {
      for (const u of S.units) if (u.hp > 0 && (u.air ? p.air : p.ground) && dist(u.x, u.y, p.tx, p.ty) <= p.splash) damageUnit(S, u, p.dmg);
      S.fx.push({ k: 'impact', x: p.tx, y: p.ty, r: p.splash, type: p.k });
    } else {
      const u = S.units.find((v) => v.id === p.tu);
      if (u) damageUnit(S, u, p.dmg);
    }
  }
  S.proj = S.proj.filter((p) => p.t > 0);
}

function updateTraps(S) {
  for (const b of S.bld) {
    if (!b.trap || b.dead) continue;
    if (b.frozen > 0) { b.frozen--; continue; }
    const tr = b.trap;
    let hit = null, hd = 1e9;
    for (const u of S.units) {
      if (u.hp <= 0 || (u.air ? !tr.air : !tr.ground)) continue;
      const d = dist(u.x, u.y, b.cx, b.cy);
      if (d <= Math.max(0.7, tr.radius * 0.6) && d < hd) { hd = d; hit = u; }
    }
    if (!hit) continue;
    b.dead = true;
    S.fx.push({ k: 'trap', type: b.type, x: b.cx, y: b.cy, r: tr.radius, i: b.i });
    if (tr.stun) { damageUnit(S, hit, tr.dmg); hit.stun = tr.stun * BATTLE.tickRate; continue; }
    for (const u of S.units) if (u.hp > 0 && (u.air ? tr.air : tr.ground) && dist(u.x, u.y, b.cx, b.cy) <= tr.radius) damageUnit(S, u, tr.dmg);
  }
}

// --- Шаг симуляции ---------------------------------------------------------
export function step(S, commands) {
  if (S.over) return;
  if (commands) for (const c of commands) applyCommand(S, c);
  if (S.over) return finish(S);
  updateSpells(S);
  for (const u of S.units) if (u.hp > 0) updateUnit(S, u);
  for (const b of S.bld) if (b.def && !b.dead) updateDefense(S, b);
  updateProjectiles(S);
  updateTraps(S);
  S.units = S.units.filter((u) => u.hp > 0);
  S.tick++;
  const noneLeft = !Object.values(S.left.troops).some((n) => n > 0) && !Object.values(S.left.heroes).some(Boolean);
  if (S.tick >= S.maxTick || S.destroyed >= S.total || (S.deployedAny && noneLeft && S.units.length === 0)) finish(S);
}

function finish(S) {
  S.over = true;
  const pct = S.total ? Math.floor(S.destroyed / S.total * 100) : 0;
  let stars = 0;
  if (pct >= 50) stars++;
  if (S.castleDown) stars++;
  if (pct >= 100) stars++;
  S.result = { pct, stars, destroyed: S.destroyed, loot: { gold: Math.floor(S.loot.gold), food: Math.floor(S.loot.food) }, used: S.used, ticks: S.tick };
}

// Прогон целиком по журналу команд (сервер).
export function runBattle(init, log) {
  const S = createBattle(init);
  const byTick = new Map();
  for (const c of log) {
    const t = c.t | 0;
    if (!byTick.has(t)) byTick.set(t, []);
    byTick.get(t).push(c);
  }
  let guard = 0;
  while (!S.over && guard++ < S.maxTick + 10) {
    step(S, byTick.get(S.tick));
    S.fx.length = 0;
  }
  if (!S.result) finish(S);
  return S.result;
}

export function percent(S) {
  return S.total ? Math.floor(S.destroyed / S.total * 100) : 0;
}
