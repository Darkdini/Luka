// ============================================================================
//  Походы по карте мира: общие расчёты для сервера и клиента (оценка силы,
//  время в пути, груз, награды). Герои ведут войска; сила войск усиливает героев.
// ============================================================================
import { troopStats, parseKey, TROOP_KINDS } from './troops.js';
import { SITE_TYPES } from './worldgen.js';
import { RES_K } from './config.js';

export const SITE_COOLDOWN_MIN = 30;
// одновременных походов: 2, +1 на Цитадели 4 и 7
export const marchSlots = (castleLevel) => 2 + (castleLevel >= 4 ? 1 : 0) + (castleLevel >= 7 ? 1 : 0);
// сколько воинов в одном походе
export const marchCap = (castleLevel) => 300 + castleLevel * 150;
export const MAX_HEROES = 5;

// «Мощь» войск: атака + защита с учётом здоровья; род войск, бьющий врага, сильнее
export function troopMight(troops, race, enemyKind = null) {
  let t = 0;
  for (const [k, n] of Object.entries(troops || {})) {
    if (!n) continue;
    const { kind, tier } = parseKey(k);
    const st = troopStats(kind, tier, race);
    let m = (st.atk + st.def) * st.hp / 100 * n;
    if (enemyKind) {
      if (TROOP_KINDS[kind].beats === enemyKind) m *= 1.25;
      else if (TROOP_KINDS[enemyKind]?.beats === kind) m *= 0.85;
    }
    t += m;
  }
  return Math.round(t);
}
export function troopLoad(troops, race) {
  let t = 0;
  for (const [k, n] of Object.entries(troops || {})) { const { kind, tier } = parseKey(k); t += troopStats(kind, tier, race).load * n; }
  return t;
}
export const troopCount = (troops) => Object.values(troops || {}).reduce((a, v) => a + v, 0);

// Сила врага на объекте
export const siteMight = (level) => Math.round(700 * Math.pow(1.75, level - 1));
// какой этап похода героев соответствует уровню объекта (враги-герои)
export const siteStage = (level) => Math.max(1, Math.round(level * 2 - 2));
// множитель героев по соотношению сил войск
export const mightMul = (mine, enemy) => Math.max(0.35, Math.min(3, Math.pow(Math.max(1, mine) / Math.max(1, enemy), 0.8)));

// Время в пути: конница быстрее; от 10 с до 30 мин
export function travelSec(dist, troops) {
  const kinds = Object.entries(troops || {}).filter(([, n]) => n > 0).map(([k]) => parseKey(k).kind);
  const per = kinds.length && kinds.every((k) => k === 'cavalry') ? 2.5 : 4;
  return Math.round(Math.max(10, Math.min(1800, dist * per)));
}

// Запас ресурса на объекте и скорость сбора
export const siteAmount = (type, level) => Math.round(1800 * Math.pow(level, 1.3) * (RES_K[SITE_TYPES[type].res] || 1));
export const gatherRate = (level) => 8 * (1 + level * 0.15); // в секунду

// Награда за победу над врагом
export function siteReward(level, type) {
  const k = Math.pow(level, 1.5);
  const r = { food: Math.round(700 * k), wood: Math.round(600 * k), stone: Math.round(400 * k), gems: 2 + level, book: Math.ceil(level / 3) };
  if (level >= 3) r.iron = Math.round(150 * k);
  if (level >= 6) r.mana = Math.round(40 * k);
  if (type === 'lair' || type === 'tower' || type === 'throne') { r.gems += level * 2; r.book += 1; }
  return r;
}
export const siteExp = (level) => Math.round(300 * Math.pow(level, 1.4));
