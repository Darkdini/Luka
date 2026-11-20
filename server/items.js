// Инвентарь: применение ускорений, сундуков, щитов, телепортов, бонусов; покупка за самоцветы.
import { db } from './db.js';
import { actions, GameError, grant, tick } from './game.js';
import { findSpot, cellFree } from './world.js';
import { ITEMS } from '../shared/items.js';

const fail = (m) => { throw new GameError(m); };
const take = (s, id, n) => {
  s.bag ||= {};
  if ((s.bag[id] || 0) < n) fail('Предметов не хватает');
  s.bag[id] -= n;
  if (!s.bag[id]) delete s.bag[id];
};

// Что ускоряем: возвращает { left (сек), cut(ms) } — уменьшить ожидание
function speedTarget(s, t) {
  const now = Date.now();
  switch (t?.type) {
    case 'build': {
      const b = s.buildings.find((v) => v.id === t.id) || fail('Здание не найдено');
      if (!b.up) fail('Здание не строится');
      return { left: (b.up.end - now) / 1000, cut: (ms) => { b.up.end -= ms; } };
    }
    case 'train': {
      const q = s.trainQ?.[t.kind] || fail('Лагерь свободен');
      return { left: (q.end - now) / 1000, cut: (ms) => { q.end -= ms; } };
    }
    case 'research': {
      const r = s.research || fail('Нечего ускорять');
      return { left: (r.end - now) / 1000, cut: (ms) => { r.end -= ms; } };
    }
    case 'heal': {
      const h = s.healQ || fail('Лечить некого');
      return { left: (h.end - now) / 1000, cut: (ms) => { h.end -= ms; } };
    }
    case 'march': {
      const m = (s.marches || []).find((v) => v.id === t.id) || fail('Поход не найден');
      const key = m.phase === 'go' ? 'arrive' : m.phase === 'work' ? 'workEnd' : 'backAt';
      return { left: (m[key] - now) / 1000, cut: (ms) => { const d = Math.min(ms, m[key] - now); m[key] -= d; if (m.phase === 'go') m.start -= d; if (m.phase === 'back' && m.backStart) m.backStart -= d; } };
    }
    default: fail('Нечего ускорять');
  }
}

Object.assign(actions, {
  useSpeed(s, { item, n = 1, target }) {
    const it = ITEMS[item];
    if (!it || it.kind !== 'speed') fail('Это не ускорение');
    if (it.for && it.for !== target?.type) fail('Это ускорение здесь не подходит');
    const tg = speedTarget(s, target);
    if (tg.left <= 0) fail('Уже готово');
    n = Math.max(1, Math.min(n | 0, Math.ceil(tg.left / it.sec)));
    take(s, item, n);
    tg.cut(it.sec * n * 1000);
    tick(s);
    return { used: n };
  },

  openChest(s, { item, n = 1 }) {
    const it = ITEMS[item];
    if (!it || it.kind !== 'res') fail('Это не сундук');
    n = Math.max(1, n | 0);
    take(s, item, n);
    return { got: grant(s, { [it.res]: it.amount * n }) };
  },

  useShield(s, { item }) {
    const it = ITEMS[item];
    if (!it || it.kind !== 'shield') fail('Это не щит');
    if ((s.marches || []).some((m) => m.target === 'player')) fail('Нельзя: ваш отряд идёт в налёт');
    take(s, item, 1);
    s.shieldUntil = Math.max(Date.now(), s.shieldUntil || 0) + it.sec * 1000;
    return { until: s.shieldUntil };
  },

  useBoost(s, { item }) {
    const it = ITEMS[item];
    if (!it || it.kind !== 'boost') fail('Это не бонус');
    take(s, item, 1);
    s.boosts ||= {};
    const cur = s.boosts[it.eff];
    const now = Date.now();
    s.boosts[it.eff] = { val: Math.max(it.val, cur?.until > now ? cur.val : 0), until: Math.max(now, cur?.until || 0) + it.sec * 1000, item };
    return { until: s.boosts[it.eff].until };
  },

  teleport(s, { item, x, y }) {
    const it = ITEMS[item];
    if (!it || it.kind !== 'teleport') fail('Это не телепорт');
    if ((s.marches || []).length) fail('Сначала верните все отряды домой');
    let spot;
    if (it.rand) spot = findSpot(Date.now() ^ (s._pid * 7919));
    else {
      x |= 0; y |= 0;
      if (!cellFree(x, y)) fail('Это место занято или рядом с лагерем');
      spot = { x, y };
    }
    take(s, item, 1);
    db.prepare('UPDATE players SET wx = ?, wy = ? WHERE id = ?').run(spot.x, spot.y, s._pid);
    return { moveTo: spot };
  },

  buyItem(s, { item, n = 1 }) {
    const it = ITEMS[item];
    if (!it?.gems) fail('Этот предмет не продаётся');
    n = Math.max(1, Math.min(99, n | 0));
    const cost = it.gems * n;
    if (s.res.gems < cost) fail('Не хватает самоцветов');
    s.res.gems -= cost;
    s.bag ||= {};
    s.bag[item] = (s.bag[item] || 0) + n;
    return { bought: n };
  },
});

export function bagView(s) {
  const now = Date.now();
  return { bag: s.bag || {}, boosts: Object.fromEntries(Object.entries(s.boosts || {}).filter(([, b]) => b.until > now)) };
}
