// ============================================================================
//  Планировка города: одинаковые ячейки под здания, мощёные дороги между
//  ними, большая площадь Цитадели в центре. Город растёт кольцами.
//
//  Блоки 8×8 с шагом 4 клетки: ячейка 3×3 + дорога 1 клетка.
//  Центральные 2×2 блока — площадь Цитадели (Цитадель 5×5 в центре).
// ============================================================================

export const PLOT = 3;          // размер ячейки (все здания одного размера)
export const PITCH = 4;         // ячейка + дорога
export const X0 = 6;            // начало сетки блоков
export const NB = 8;            // блоков по стороне
export const CASTLE_POS = { x: 19, y: 19, size: 5 };
export const PLAZA = { x: 18, y: 18, size: 7 };

// Кольцо 1 открыто сразу, 2 — с Цитадели 2, 3 — с Цитадели 4
export const RING_UNLOCK = [0, 1, 2, 4];

const ringOf = (bx, by) => Math.max(Math.abs(bx - 3.5), Math.abs(by - 3.5)) - 0.5;

export const PLOTS = (() => {
  const out = [];
  for (let by = 0; by < NB; by++) for (let bx = 0; bx < NB; bx++) {
    const ring = ringOf(bx, by);
    if (ring === 0) continue; // площадь Цитадели
    out.push({ i: out.length, x: X0 + bx * PITCH, y: X0 + by * PITCH, ring, bx, by });
  }
  // ближе к центру — раньше в списке (так раскладываются стартовые здания)
  return out.sort((a, b) => a.ring - b.ring || Math.hypot(a.bx - 3.5, a.by - 3.5) - Math.hypot(b.bx - 3.5, b.by - 3.5) || a.i - b.i)
    .map((p, i) => ({ ...p, i }));
})();

export const ringOpen = (ring, castleLevel) => castleLevel >= RING_UNLOCK[ring];
export function maxRing(castleLevel) {
  let r = 1;
  for (let k = 1; k <= 3; k++) if (castleLevel >= RING_UNLOCK[k]) r = k;
  return r;
}

// Прямоугольник открытой части города (включая окружающую дорогу)
export function cityRect(castleLevel) {
  const r = maxRing(castleLevel);
  const lo = X0 + (3 - r) * PITCH - 1;
  const hi = X0 + (4 + r) * PITCH + PLOT;
  return { x0: lo, y0: lo, x1: hi, y1: hi };
}

export function plotAt(x, y) {
  return PLOTS.find((p) => p.x === x && p.y === y) || null;
}

export function inPlot(x, y) {
  return PLOTS.find((p) => x >= p.x && x < p.x + PLOT && y >= p.y && y < p.y + PLOT) || null;
}

const inCastle = (x, y) => x >= CASTLE_POS.x && x < CASTLE_POS.x + CASTLE_POS.size && y >= CASTLE_POS.y && y < CASTLE_POS.y + CASTLE_POS.size;

// Дорога: клетка внутри открытого города, не ячейка и не сама Цитадель
export function isRoad(x, y, castleLevel) {
  const r = cityRect(castleLevel);
  if (x < r.x0 || y < r.y0 || x > r.x1 || y > r.y1) return false;
  if (inCastle(x, y)) return false;
  const p = inPlot(x, y);
  return !p;
}

// Крепостная стена — по периметру открытой части города
export function wallTiles(castleLevel) {
  const r = cityRect(castleLevel);
  const a = r.x0 - 1, b = r.x1 + 1;
  const out = [];
  for (let i = a; i <= b; i++) { out.push([i, a]); out.push([i, b]); }
  for (let i = a + 1; i < b; i++) { out.push([a, i]); out.push([b, i]); }
  return out;
}

export const isPlotType = (type) => type !== 'wall' && !type.startsWith('trap_') && type !== 'castle';
