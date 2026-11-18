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

// Кольцо 1 открыто сразу, 2 — с Цитадели 2, 3 — с Цитадели 4, «4» — Верхний город, Цитадель 5
export const RING_UNLOCK = [0, 1, 2, 4, 5];

const ringOf = (bx, by) => Math.max(Math.abs(bx - 3.5), Math.abs(by - 3.5)) - 0.5;

const ALL_PLOTS = (() => {
  const out = [];
  for (let by = 0; by < NB; by++) for (let bx = 0; bx < NB; bx++) {
    const ring = ringOf(bx, by);
    if (ring === 0) continue; // площадь Цитадели
    out.push({ x: X0 + bx * PITCH, y: X0 + by * PITCH, ring, bx, by });
  }
  return out.sort((a, b) => a.ring - b.ring || Math.hypot(a.bx - 3.5, a.by - 3.5) - Math.hypot(b.bx - 3.5, b.by - 3.5) || a.y - b.y || a.x - b.x);
})();

// Ячейки, у которых есть площадка на рисованной панораме города (client/assets/bg/town.jpg).
// Панорама 1: 12 площадок (сразу), 6 (Цитадель 2), 5 (Цитадель 4).
// Панорама 2 «Верхний город»: 12 площадок (Цитадель 4) и 12 (Цитадель 5).
// ring задаёт только уровень открытия; положение ячейки на сетке боя — своё.
const USED = [
  ...[...Array(18).keys()].map((k) => [k]), [32], [33], [34], [35], [36],
  ...[37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48].map((k) => [k, 3]),
  ...[49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 18 + 0].map((k) => [k, 4]),
];
export const PLOTS = USED.map(([k, ring], i) => ({ ...ALL_PLOTS[k], ...(ring != null ? { ring } : {}), i }));

// Площадки на панораме: центр и ширина верхней грани в пикселях склейки (порядок = PLOTS).
// Центры найдены автоматически по цвету камня: python3 tools/find_pads.py
export const PANO = {
  src: 'bg/town', w: 1916 * 2 - 140, h: 821,
  plaza: [1550, 238, 230],
  pads: [
    [466, 569, 106], [564, 210, 106], [574, 496, 106], [634, 282, 106], [712, 570, 106], [712, 402, 106],
    [734, 178, 106], [765, 342, 106], [854, 496, 106], [889, 608, 106], [928, 228, 106], [940, 154, 106],
    [1105, 170, 106], [1123, 363, 106], [1287, 331, 106], [1300, 449, 106], [1390, 382, 106], [1390, 558, 106],
    [1470, 434, 106], [1562, 518, 106], [1635, 600, 106], [1683, 454, 106], [1755, 534, 106], [1949, 402, 130],
    [2071, 494, 130], [2070, 312, 130], [2184, 201, 130], [2227, 566, 130], [2245, 402, 130], [2333, 273, 130],
    [2422, 492, 130], [2494, 586, 130], [2546, 392, 130], [2664, 145, 130], [2704, 508, 130], [2822, 199, 130],
    [2842, 580, 130], [2858, 332, 130], [3012, 274, 130], [3034, 424, 130], [3185, 521, 130], [3212, 228, 130],
    [3236, 396, 130], [3326, 578, 130], [3400, 274, 130], [3424, 486, 130], [3539, 372, 130],
  ],
};

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
