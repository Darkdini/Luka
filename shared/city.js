// ============================================================================
//  Планировка города: одна площадка внутри стены, здания ставятся свободно по
//  сетке. Открытая часть растёт квадратами-«зонами» с уровнем Цитадели, за ней —
//  лес и туман. На земле лежат руины (расчистка = ресурс), часть зданий
//  захвачена врагом: бой героями → починка.
// ============================================================================
import { BUILDINGS } from './config.js';

export const C = 22;                              // центр поля (GRID 44)
export const CASTLE_POS = { x: 20, y: 20, size: 4 };
export const RUIN_SIZE = 2;
// half — половина стороны открытого квадрата; castle — уровень Цитадели для открытия
export const ZONES = [
  { castle: 1, half: 8 },
  { castle: 3, half: 11 },
  { castle: 5, half: 14 },
  { castle: 7, half: 17 },
];

export function zoneIndex(castleLevel) {
  let z = 0;
  for (let i = 0; i < ZONES.length; i++) if (castleLevel >= ZONES[i].castle) z = i;
  return z;
}
export const nextZone = (castleLevel) => ZONES[zoneIndex(castleLevel) + 1] || null;
// Открытый квадрат: клетки x0..x1-1, y0..y1-1
export function cityRect(castleLevel) {
  const h = ZONES[zoneIndex(castleLevel)].half;
  return { x0: C - h, y0: C - h, x1: C + h, y1: C + h };
}
export const rectOfZone = (i) => ({ x0: C - ZONES[i].half, y0: C - ZONES[i].half, x1: C + ZONES[i].half, y1: C + ZONES[i].half });
export function inCity(x, y, size, castleLevel) {
  const r = cityRect(castleLevel);
  return x >= r.x0 && y >= r.y0 && x + size <= r.x1 && y + size <= r.y1;
}
// Номер зоны, к которой относится клетка (для руин закрытых зон)
export function zoneOfTile(x, y) {
  for (let i = 0; i < ZONES.length; i++) {
    const r = rectOfZone(i);
    if (x >= r.x0 && y >= r.y0 && x < r.x1 && y < r.y1) return i;
  }
  return ZONES.length;
}

// Клетки стены — по периметру открытого квадрата (нужны бою-набегу)
export function wallTiles(castleLevel) {
  const r = cityRect(castleLevel), out = [];
  for (let x = r.x0 - 1; x <= r.x1; x++) { out.push([x, r.y0 - 1]); out.push([x, r.y1]); }
  for (let y = r.y0; y < r.y1; y++) { out.push([r.x0 - 1, y]); out.push([r.x1, y]); }
  return out;
}

const sizeOf = (b) => BUILDINGS[b.type]?.size || 3;
const overlap = (ax, ay, as, bx, by, bs) => ax < bx + bs && bx < ax + as && ay < by + bs && by < ay + as;

// Место свободно: внутри открытой части, не на зданиях и не на руинах
export function fits(state, x, y, size, castleLevel, ignoreId = null) {
  if (!inCity(x, y, size, castleLevel)) return false;
  for (const b of state.buildings) {
    if (b.id === ignoreId || b.type === 'wall') continue;
    if (overlap(x, y, size, b.x, b.y, sizeOf(b))) return false;
  }
  for (const d of state.decor || []) if (overlap(x, y, size, d.x, d.y, RUIN_SIZE)) return false;
  return true;
}
export function blockedBy(state, x, y, size) {
  for (const d of state.decor || []) if (overlap(x, y, size, d.x, d.y, RUIN_SIZE)) return { ruin: d };
  for (const b of state.buildings) if (b.type !== 'wall' && overlap(x, y, size, b.x, b.y, sizeOf(b))) return { building: b };
  return null;
}

// Ближайшее к центру свободное место (по спирали)
export function autoPlace(state, size, castleLevel, near = { x: C, y: C }) {
  const r = cityRect(castleLevel);
  let best = null;
  for (let y = r.y0; y + size <= r.y1; y++) for (let x = r.x0; x + size <= r.x1; x++) {
    if (!fits(state, x, y, size, castleLevel)) continue;
    const d = Math.hypot(x + size / 2 - near.x, y + size / 2 - near.y);
    if (!best || d < best.d) best = { x, y, d };
  }
  return best;
}

// --- Стартовая раскладка --------------------------------------------------------
// Захваченные врагом здания: отвоёвываются боем героев (сила врага растёт)
export const CAPTURED = [
  { type: 'statue', x: 24, y: 25, enemy: 1, title: 'Статуя-страж', story: 'Разбойники осквернили Статую-страж — источник силы нашей расы.' },
  { type: 'tavern', x: 16, y: 21, enemy: 3, title: 'Таверна героев', story: 'В таверне засели наёмники Морвейна и держат хозяина в погребе.' },
  { type: 'barracks', x: 21, y: 15, enemy: 5, title: 'Казармы', story: 'Казармы заняли дезертиры. Без них не собрать войско.' },
];
export const STARTER = [
  { type: 'castle', x: CASTLE_POS.x, y: CASTLE_POS.y },
  { type: 'farm', x: 25, y: 19 },
  { type: 'warehouse', x: 17, y: 25 },
];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Руины по всем зонам: в первой — 6 штук рядом со стартом, дальше — по 6–8 на кольцо
export function genRuins(seed, state, nextId) {
  const r = rng(seed);
  const kinds = ['rubble', 'ruin_hut', 'logs', 'fence', 'stones', 'deadtree'];
  const out = [];
  const tmp = { buildings: state.buildings, decor: out };
  for (let z = 0; z < ZONES.length; z++) {
    const outer = rectOfZone(z), inner = z ? rectOfZone(z - 1) : null;
    const want = z === 0 ? 6 : 7;
    let tries = 0;
    while (out.filter((d) => zoneOfTile(d.x, d.y) === z).length < want && tries++ < 400) {
      const x = outer.x0 + 1 + Math.floor(r() * (outer.x1 - outer.x0 - RUIN_SIZE - 1));
      const y = outer.y0 + 1 + Math.floor(r() * (outer.y1 - outer.y0 - RUIN_SIZE - 1));
      if (inner && x + RUIN_SIZE > inner.x0 && y + RUIN_SIZE > inner.y0 && x < inner.x1 && y < inner.y1) continue;
      // зазор в клетку от зданий и других руин, чтобы оставались проходы
      if (!fits(tmp, x - 1, y - 1, RUIN_SIZE + 2, 99)) continue;
      out.push({ id: nextId++, kind: kinds[Math.floor(r() * kinds.length)], x, y });
    }
  }
  return { decor: out, nextId };
}
