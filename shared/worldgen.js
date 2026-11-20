// ============================================================================
//  Процедурный континент. Детерминированная функция от координат: сервер и
//  клиент получают одинаковый рельеф и лагеря NPC без передачи карты по сети.
// ============================================================================

export const WORLD = 680;               // клеток по стороне: ~7 000 замков с просторными промежутками
export const CENTER = WORLD / 2;
export const WORLD_SEED = 1337;
export const CASTLE_GAP = 3;            // вокруг замка 3 свободные клетки: соседи не стоят впритирку

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

// --- Биомы: луга в середине, снега на севере, степь на юге, лесные пятна ---
export const BIOMES = {
  meadow: { name: 'Луга', color: '#7f9a3e', tex: 'tex_meadow', build: true },
  steppe: { name: 'Степь', color: '#c79a3c', tex: 'tex_steppe', build: true },
  snow: { name: 'Снежные равнины', color: '#e4e8ec', tex: 'tex_snow', build: true },
  forest: { name: 'Лесная чаща', color: '#4f5e2c', tex: 'tex_forest', build: true },
};

const cache = new Map();
export function terrainAt(x, y) {
  if (x < 0 || y < 0 || x >= WORLD || y >= WORLD) return 'forest';
  const k = x * WORLD + y;
  const c = cache.get(k);
  if (c) return c;
  const t = computeTerrain(x, y);
  if (cache.size > 200000) cache.clear();
  cache.set(k, t);
  return t;
}

function computeTerrain(x, y) {
  const m = fbm(x / 26, y / 26, 77);
  const temp = (y / WORLD) + (fbm(x / 60, y / 60, 300) - 0.5) * 0.3; // север холодный, юг жаркий
  if (temp < 0.1) return 'snow';
  if (temp > 0.9) return 'steppe';
  if (m > 0.6) return 'forest';
  return 'meadow';
}

// Природа на клетке (крупные кластеры): занимает клетку, замки рядом не ставятся
const DECOR_BY = {
  meadow: ['d_autumn', 'd_pines', 'd_boulders', 'd_hill', 'd_stones', 'd_pines', 'd_autumn', 'd_road'],
  forest: ['d_pines', 'd_pines', 'd_autumn', 'd_hill', 'd_pines', 'd_boulders'],
  steppe: ['d_boulders', 'd_hill', 'd_mount', 'd_stones', 'd_autumn', 'd_ford', 'd_village'],
  snow: ['d_pines', 'd_mount', 'd_hill', 'd_boulders', 'd_pines', 'd_tower'],
};
export function decorAt(x, y) {
  if (Math.abs(x - CENTER) <= 4 && Math.abs(y - CENTER) <= 4) return null;
  const t = terrainAt(x, y);
  const h = hash(x, y, 909);
  const dens = t === 'forest' ? 0.12 : 0.022;
  if (h > dens) return null;
  if (siteRaw(x, y)) return null;
  // не вплотную к другой природе (чтобы кластеры не слипались)
  if (hash(x - 1, y, 909) <= dens || hash(x, y - 1, 909) <= dens) { if (t !== 'forest') return null; }
  const list = DECOR_BY[t];
  return list[Math.floor(hash(x, y, 910) * list.length)];
}

export const buildable = (x, y) => x >= 0 && y >= 0 && x < WORLD && y < WORLD && !decorAt(x, y);

// --- Объекты карты: ресурсы и враги -------------------------------------------
// res — что добывается; enemy — род войск врага (кого бьёт пехота/конница/стрелки)
export const SITE_TYPES = {
  food: { name: 'Хлебные поля', sprite: 's_food', res: 'food' },
  wood: { name: 'Лесозаготовка', sprite: 's_wood', res: 'wood' },
  stone: { name: 'Каменоломня', sprite: 's_stone', res: 'stone' },
  iron: { name: 'Железный рудник', sprite: 's_iron', res: 'iron' },
  mana: { name: 'Кристаллы маны', sprite: 's_mana', res: 'mana' },
  gold: { name: 'Золотая жила', sprite: 's_gold', res: 'gold' },
  bandits: { name: 'Лагерь разбойников', sprite: 's_bandits', enemy: 'infantry' },
  raiders: { name: 'Крепость налётчиков', sprite: 's_raiders', enemy: 'cavalry' },
  lair: { name: 'Логово чудовища', sprite: 's_lair', enemy: null },
  tower: { name: 'Башня отступника', sprite: 's_tower', enemy: 'archer' },
  throne: { name: 'Престол Морвейна', sprite: 's_city', enemy: null },
};
export const CAMP_TYPES = SITE_TYPES; // совместимость

function siteRaw(x, y) {
  if (x === CENTER && y === CENTER) return 'throne';
  if (Math.abs(x - CENTER) <= 4 && Math.abs(y - CENTER) <= 4) return null;
  const h = hash(x, y, 4242);
  return h <= 0.022 ? 'site' : null;
}

export function campAt(x, y) {
  const raw = siteRaw(x, y);
  if (!raw) return null;
  if (raw === 'throne') return { id: 'throne', x, y, type: 'throne', level: 15, name: SITE_TYPES.throne.name };
  // не вплотную к соседнему объекту
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((dx || dy) && (dy < 0 || (dy === 0 && dx < 0)) && siteRaw(x + dx, y + dy)) return null;
  }
  const dc = Math.hypot(x - CENTER, y - CENTER) / (WORLD / 2);
  const level = Math.max(1, Math.min(10, Math.round((1 - dc) * 10 + (hash(x, y, 5) - 0.5) * 3)));
  const r = hash(x, y, 6);
  let type;
  if (r < 0.58) {
    const q = hash(x, y, 7);
    type = q < 0.24 ? 'food' : q < 0.48 ? 'wood' : q < 0.68 ? 'stone' : q < 0.84 ? 'iron' : q < 0.93 ? 'gold' : 'mana';
  } else type = level >= 8 ? (r < 0.9 ? 'lair' : 'tower') : level >= 5 ? (r < 0.8 ? 'raiders' : 'lair') : 'bandits';
  return { id: `c${x}_${y}`, x, y, type, level, name: SITE_TYPES[type].name };
}

export function campById(id) {
  if (id === 'throne' || id === 'darklord') return campAt(CENTER, CENTER);
  const m = /^c(\d+)_(\d+)$/.exec(id);
  return m ? campAt(+m[1], +m[2]) : null;
}

export function campSeed(c) { return (c.x * 7919 + c.y * 104729 + 17) >>> 0; }
