// ============================================================================
//  Войска «Пепла Короны»: три рода (пехота, стрелки, кавалерия), ступени I–VIII.
//  Каждый род готовит свой лагерь, ступени открываются уровнем лагеря.
//  Пехота сильна против кавалерии, кавалерия — против стрелков, стрелки — против пехоты.
// ============================================================================
import { RACES } from './config.js';

export const TIER_MAX = 8;
export const TROOP_KINDS = {
  infantry: { name: 'Пехота', camp: 'barracks', beats: 'cavalry', desc: 'Держит строй и защищает стрелков. Сильна против кавалерии.' },
  archer: { name: 'Стрелки', camp: 'range', beats: 'infantry', desc: 'Наносят урон издалека. Сильны против пехоты.' },
  cavalry: { name: 'Кавалерия', camp: 'stables', beats: 'archer', desc: 'Быстрая и тяжёлая. Сильна против стрелков, больше уносит добычи.' },
};
export const KIND_ORDER = ['infantry', 'archer', 'cavalry'];
// уровень лагеря, с которого открывается ступень
export const TIER_CAMP = [1, 2, 3, 4, 6, 7, 9, 10];
export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

// Имена по расе: [ступени I–II, III–IV, V–VI, VII–VIII]
export const TROOP_NAMES = {
  humans: {
    infantry: ['Ополченец', 'Латник', 'Алебардист', 'Рыцарь'],
    archer: ['Охотник', 'Лучник', 'Арбалетчик', 'Королевский арбалетчик'],
    cavalry: ['Разведчик', 'Копейщик', 'Тяжёлый рыцарь', 'Королевский катафракт'],
  },
  elves: {
    infantry: ['Лесной страж', 'Часовой', 'Хранитель', 'Танцующий с клинками'],
    archer: ['Следопыт', 'Рейнджер', 'Меткий стрелок', 'Лунный лучник'],
    cavalry: ['Всадник на олене', 'Эльфийский копейщик', 'Рыцарь оленя', 'Чемпион белого лося'],
  },
  dwarves: {
    infantry: ['Рудокоп', 'Секироносец', 'Железолом', 'Рунный страж'],
    archer: ['Пращник', 'Арбалетчик', 'Тяжёлый арбалетчик', 'Громовержец'],
    cavalry: ['Разведчик на пони', 'Наездник барана', 'Наездник вепря', 'Рунный медвежий всадник'],
  },
  orcs: {
    infantry: ['Рубака', 'Налётчик', 'Громила', 'Страж вождя'],
    archer: ['Метатель копий', 'Охотник', 'Тяжёлый арбалетчик', 'Кровавый лучник'],
    cavalry: ['Волчий всадник', 'Бронированный волчий всадник', 'Наездник вепря', 'Вождь на боевом вепре'],
  },
};
export const artGroup = (tier) => Math.min(4, Math.ceil(tier / 2));
export const troopName = (race, kind, tier) => (TROOP_NAMES[race] || TROOP_NAMES.humans)[kind][artGroup(tier) - 1];
export const troopKey = (kind, tier) => kind + tier;
export const parseKey = (key) => ({ kind: key.replace(/\d+$/, ''), tier: +key.match(/\d+$/)[0] });

const BASE = {
  infantry: { atk: 10, def: 14, hp: 60, load: 10 },
  archer: { atk: 15, def: 6, hp: 40, load: 8 },
  cavalry: { atk: 13, def: 9, hp: 55, load: 16 },
};
const GROW = 1.42;
export function troopStats(kind, tier, race) {
  const b = BASE[kind], k = Math.pow(GROW, tier - 1), bon = RACES[race]?.bonus || {};
  const atkB = kind === 'archer' ? bon.rangedDmg || 0 : bon.meleeDmg || 0;
  return {
    atk: Math.round(b.atk * k * (1 + atkB)),
    def: Math.round(b.def * k),
    hp: Math.round(b.hp * k * (1 + (bon.troopHp || 0))),
    load: Math.round(b.load * (1 + (tier - 1) * 0.25)),
  };
}
// сила одного воина
export const POWER = [1, 2, 3, 5, 8, 12, 18, 27];
export const troopPowerOf = (tier) => POWER[tier - 1] || 1;

// Цена одного воина
const COST = {
  infantry: { food: 40, wood: 30 },
  archer: { food: 35, wood: 45 },
  cavalry: { food: 60, wood: 25 },
};
export function troopCost(kind, tier, n = 1) {
  const k = Math.pow(1.55, tier - 1);
  const out = {};
  for (const [r, v] of Object.entries(COST[kind])) out[r] = Math.round(v * k * n);
  if (tier >= 3) out.iron = Math.round(8 * Math.pow(1.5, tier - 3) * n);
  if (tier >= 6) out.mana = Math.round(4 * Math.pow(1.5, tier - 6) * n);
  return out;
}
// секунд на одного воина
export const troopTime = (tier, race) => 4 * Math.pow(1.38, tier - 1) * (1 - (RACES[race]?.bonus.trainSpeed || 0));
// сколько воинов за одну партию
export const batchMax = (campLevel) => (campLevel > 0 ? 50 + 50 * campLevel : 0);
export const maxTierOf = (campLevel) => TIER_CAMP.filter((l) => campLevel >= l).length;

// Госпиталь
export const hospitalCapOf = (levels) => levels.reduce((t, l) => t + 300 * l, 0);
export const healCost = (kind, tier, n) => Object.fromEntries(Object.entries(troopCost(kind, tier, n)).map(([r, v]) => [r, Math.ceil(v * 0.25)]));
export const healTime = (tier, n) => 1.2 * Math.pow(1.3, tier - 1) * n;
