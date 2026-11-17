// ============================================================================
//  Процедурный континент. Детерминированная функция от координат: сервер и
//  клиент получают одинаковый рельеф и лагеря NPC без передачи карты по сети.
// ============================================================================

export const WORLD = 360;               // клеток по стороне (129 600 клеток, ~14 000 мест под замки)
export const CENTER = WORLD / 2;
export const WORLD_SEED = 1337;
export const CASTLE_GAP = 1;            // замки не могут стоять вплотную

// --- Шум ------------------------------------------------------------------
function hash(x, y, s = WORLD_SEED) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const hash01 = hash;

function smooth(t) { return t * t * (3 - 2 * t); }
function valueNoise(x, y, s) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s), c = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y, s, oct = 4) {
  let v = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { v += valueNoise(x * f, y * f, s + i * 101) * amp; n += amp; amp *= 0.5; f *= 2; }
  return v / n;
}

// --- Биомы ---------------------------------------------------------------
export const BIOMES = {
  water: { name: 'Озеро', color: '#2f7fc4', build: false },
  deep: { name: 'Море', color: '#1f5f9e', build: false },
  grass: { name: 'Луга', color: '#7cbf3a', build: true },
  meadow: { name: 'Цветущий луг', color: '#8fcf48', build: true },
  forest: { name: 'Лес', color: '#3f8f2a', build: true },
  pines: { name: 'Хвойный лес', color: '#2f6f2a', build: false },
  hills: { name: 'Холмы', color: '#9a9a6a', build: true },
  mountain: { name: 'Горы', color: '#8a8580', build: false },
  snow: { name: 'Снежные равнины', color: '#e8eef4', build: true },
  desert: { name: 'Пустошь', color: '#e0c27a', build: true },
  swamp: { name: 'Топи', color: '#5f7a4a', build: false },
};

const cache = new Map();
export function terrainAt(x, y) {
  if (x < 0 || y < 0 || x >= WORLD || y >= WORLD) return 'deep';
  const k = x * WORLD + y;
  const c = cache.get(k);
  if (c) return c;
  const t = computeTerrain(x, y);
  if (cache.size > 200000) cache.clear();
  cache.set(k, t);
  return t;
}

function computeTerrain(x, y) {
  const nx = x / WORLD, ny = y / WORLD;
  const dc = Math.hypot(nx - 0.5, ny - 0.5) * 2;           // 0 в центре, ~1 у края
  let e = fbm(x / 34, y / 34, 11) * 1.05 - Math.max(0, dc - 0.78) * 2.2; // к краям — море
  e += Math.max(0, 0.16 - dc) * 1.2;                         // центр всегда суша
  const m = fbm(x / 24, y / 24, 77);
  const temp = ny + (fbm(x / 50, y / 50, 300) - 0.5) * 0.25; // север холодный, юг жаркий
  if (e < 0.3) return e < 0.22 ? 'deep' : 'water';
  if (e > 0.7) return 'mountain';
  if (temp < 0.16) return m > 0.55 ? 'pines' : 'snow';
  if (temp > 0.86 && m < 0.55) return 'desert';
  if (e > 0.62) return 'hills';
  if (m > 0.66 && e < 0.42) return 'swamp';
  if (m > 0.62) return 'pines';
  if (m > 0.53) return 'forest';
  return hash(x, y, 9) > 0.8 ? 'meadow' : 'grass';
}

export const buildable = (x, y) => BIOMES[terrainAt(x, y)].build;

// --- Лагеря NPC ---------------------------------------------------------------
export const CAMP_TYPES = {
  bandits: { name: 'Лагерь разбойников', sprite: 'buildings/armycamp_1' },
  ruins: { name: 'Древние руины', sprite: 'buildings/rubble_3' },
  crystal: { name: 'Кристальная жила', sprite: 'decor/gems' },
  mine: { name: 'Захваченный рудник', sprite: 'buildings/goldmine_2' },
  fort: { name: 'Форпост Морвейна', sprite: 'buildings/castle_3', dark: true },
  darklord: { name: 'Цитадель Тёмного лорда', sprite: 'buildings/castle_6', dark: true },
};

export function campAt(x, y) {
  if (x === CENTER && y === CENTER) return { id: 'darklord', x, y, type: 'darklord', level: 10, name: CAMP_TYPES.darklord.name };
  if (Math.abs(x - CENTER) <= 3 && Math.abs(y - CENTER) <= 3) return null;
  if (!buildable(x, y)) return null;
  const h = hash(x, y, 4242);
  if (h > 0.02) return null;
  // не ставим лагеря вплотную друг к другу
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((dx || dy) && (dy < 0 || (dy === 0 && dx < 0)) && buildable(x + dx, y + dy) && hash(x + dx, y + dy, 4242) <= 0.02) return null;
  }
  const dc = Math.hypot(x - CENTER, y - CENTER) / (WORLD / 2);
  const level = Math.max(1, Math.min(9, Math.round((1 - dc) * 9 + (hash(x, y, 5) - 0.5) * 2)));
  const r = hash(x, y, 6);
  const type = level >= 8 ? 'fort' : r < 0.55 ? 'bandits' : r < 0.72 ? 'ruins' : r < 0.86 ? 'mine' : 'crystal';
  return { id: `c${x}_${y}`, x, y, type, level, name: CAMP_TYPES[type].name };
}

export function campById(id) {
  if (id === 'darklord') return campAt(CENTER, CENTER);
  const m = /^c(\d+)_(\d+)$/.exec(id);
  return m ? campAt(+m[1], +m[2]) : null;
}

export function campSeed(c) { return (c.x * 7919 + c.y * 104729 + 17) >>> 0; }
