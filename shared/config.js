// ============================================================================
//  БАЛАНС ИГРЫ — единый источник правды для сервера и клиента.
//  Все числа сведены в таблицы, чтобы крутить экономику без правки кода.
//  Подробное описание логики баланса и монетизации: docs/BALANCE.md
// ============================================================================

export const GAME_TITLE = 'Короны и Крепости';

// --- Сетка базы -------------------------------------------------------------
export const GRID = 44;          // полный размер поля (с зоной высадки)
export const BUILD_MIN = 2;      // строить можно в [BUILD_MIN, BUILD_MAX)
export const BUILD_MAX = 42;

// --- Время и ресурсы --------------------------------------------------------
// Время улучшения по уровню (сек). Ранние уровни — секунды/минуты (быстрый
// «крючок»), поздние — часы (основной рычаг ускорений за кристаллы).
export const TIME_TABLE = [10, 60, 240, 900, 2400, 5400, 10800, 21600, 36000, 57600, 86400, 129600];
// Базовая стоимость по уровню; умножается на коэффициент здания.
export const COST_TABLE = [150, 500, 1400, 3200, 7000, 14000, 26000, 45000, 75000, 120000, 180000, 260000];

export const START = { gold: 3000, food: 3000, gems: 300 };
export const RES_NAMES = { gold: 'Золото', food: 'Зерно', gems: 'Кристаллы' };

// --- Кристаллы (премиум-валюта) ---------------------------------------------
// Кусочно-логарифмическая интерполяция по опорным точкам.
const GEM_TIME_ANCHORS = [[0, 0], [60, 1], [3600, 20], [86400, 260], [604800, 1000]];
const GEM_RES_ANCHORS = [[0, 0], [100, 1], [1000, 5], [10000, 25], [100000, 125], [1000000, 600]];

function interp(anchors, v) {
  if (v <= 0) return 0;
  for (let i = 1; i < anchors.length; i++) {
    const [x0, y0] = anchors[i - 1], [x1, y1] = anchors[i];
    if (v <= x1) {
      if (x0 === 0) return Math.max(1, Math.ceil(y1 * v / x1));
      const t = Math.log(v / x0) / Math.log(x1 / x0);
      return Math.max(1, Math.ceil(y0 + (y1 - y0) * t));
    }
  }
  const [xa, ya] = anchors[anchors.length - 1];
  return Math.ceil(ya * v / xa);
}
export const gemsForTime = (sec) => interp(GEM_TIME_ANCHORS, sec);
export const gemsForResources = (amount) => interp(GEM_RES_ANCHORS, amount);

// Строители: 2 бесплатно, остальные — за кристаллы (классический рычаг доната).
export const BUILDER_GEM_COST = [0, 0, 250, 500, 1000];
export const MAX_BUILDERS = 5;

// Бесплатные источники кристаллов (F2P должен иметь стабильный приток).
export const GEMS_FREE = {
  obstacleMin: 0, obstacleMax: 6,   // за расчистку декора
  dailyBonus: 15,                   // ежедневная награда
  firstStarsBonus: 5,               // первая победа за день
};

// Пакеты доната (оплата пока не подключена — витрина и логика наград).
export const DONATE_PACKS = [
  { id: 'gems_s', gems: 500, price: 99, label: 'Горсть кристаллов' },
  { id: 'gems_m', gems: 1200, price: 199, label: 'Мешочек кристаллов', tag: '+20%' },
  { id: 'gems_l', gems: 2500, price: 399, label: 'Сундук кристаллов', tag: '+25%' },
  { id: 'gems_xl', gems: 6500, price: 899, label: 'Казна короля', tag: 'Выгодно' },
  { id: 'starter', gems: 500, price: 149, label: 'Набор новичка', tag: 'Один раз',
    bonus: { gold: 20000, food: 20000, builder: true } },
];

// --- Расы -------------------------------------------------------------------
export const RACES = {
  humans: { name: 'Люди', color: '#2f6fd6', bonus: { goldRate: 0.10 }, desc: '+10% к добыче золота' },
  elves: { name: 'Эльфы', color: '#2f9e4f', bonus: { rangedDmg: 0.10 }, desc: '+10% урона стрелков' },
  dwarves: { name: 'Гномы', color: '#c0602a', bonus: { buildingHp: 0.10 }, desc: '+10% прочности зданий' },
  orcs: { name: 'Орки', color: '#b8262b', bonus: { meleeDmg: 0.10 }, desc: '+10% урона ближнего боя' },
};

// --- Здания -----------------------------------------------------------------
// cat: castle | resource | storage | army | defense | wall | trap | other
// sprite: префикс спрайта; tiers: сколько вариантов арта (уровни мапятся на них)
// maxByCastle[castleLevel-1]: макс. уровень здания при данном уровне замка
// countByCastle[castleLevel-1]: сколько штук можно построить
const D = (o) => ({ size: 3, tiers: 3, hp: 600, costMul: 1, timeMul: 1, res: 'gold', ...o });

export const BUILDINGS = {
  castle: D({ name: 'Цитадель', cat: 'castle', size: 5, tiers: 6, hp: 2000, costMul: 4, timeMul: 2,
    maxByCastle: [1, 2, 3, 4, 5, 6], countByCastle: [1, 1, 1, 1, 1, 1], storage: [1500, 4000, 8000, 15000, 25000, 40000],
    desc: 'Сердце королевства. Улучшение открывает новые здания и уровни.' }),
  builderhut: D({ name: 'Хижина строителя', cat: 'other', size: 3, tiers: 1, hp: 250, sprite: 'builderhut',
    maxByCastle: [1, 1, 1, 1, 1, 1], countByCastle: [5, 5, 5, 5, 5, 5],
    desc: 'Каждая хижина — один строитель. Больше строителей — больше строек одновременно.' }),
  goldmine: D({ name: 'Золотой рудник', cat: 'resource', res: 'food', costMul: 0.6, timeMul: 0.7, hp: 450,
    produces: 'gold', rate: [300, 500, 750, 1050, 1400, 1800, 2250, 2750, 3300, 3900],
    maxByCastle: [2, 4, 6, 7, 8, 10], countByCastle: [1, 2, 3, 4, 5, 6],
    desc: 'Добывает золото. Собирайте вовремя — склад рудника ограничен.' }),
  farm: D({ name: 'Мельница', cat: 'resource', res: 'gold', costMul: 0.6, timeMul: 0.7, hp: 450,
    produces: 'food', rate: [300, 500, 750, 1050, 1400, 1800, 2250, 2750, 3300, 3900],
    maxByCastle: [2, 4, 6, 7, 8, 10], countByCastle: [1, 2, 3, 4, 5, 6],
    desc: 'Производит зерно — пищу для армии.' }),
  treasury: D({ name: 'Казна', cat: 'storage', res: 'food', costMul: 0.8, timeMul: 0.8, hp: 800,
    stores: 'gold', capacity: [3000, 6000, 12000, 25000, 50000, 90000, 150000, 250000, 400000, 600000],
    maxByCastle: [2, 4, 6, 7, 8, 10], countByCastle: [1, 1, 2, 2, 3, 3],
    desc: 'Хранит золото.' }),
  granary: D({ name: 'Амбар', cat: 'storage', res: 'gold', costMul: 0.8, timeMul: 0.8, hp: 800,
    stores: 'food', capacity: [3000, 6000, 12000, 25000, 50000, 90000, 150000, 250000, 400000, 600000],
    maxByCastle: [2, 4, 6, 7, 8, 10], countByCastle: [1, 1, 2, 2, 3, 3],
    desc: 'Хранит зерно.' }),
  barracks: D({ name: 'Казармы', cat: 'army', res: 'gold', tiers: 1, hp: 700,
    maxByCastle: [2, 4, 5, 6, 7, 8], countByCastle: [1, 1, 2, 2, 3, 3], queue: [10, 15, 20, 25, 30, 35, 40, 45],
    desc: 'Обучают войска. Уровень открывает новые типы воинов.' }),
  armycamp: D({ name: 'Военный лагерь', cat: 'army', res: 'gold', size: 3, tiers: 1, hp: 500, costMul: 0.9,
    housing: [20, 30, 40, 50, 60, 70], maxByCastle: [1, 2, 3, 4, 5, 6], countByCastle: [1, 1, 2, 2, 3, 4],
    desc: 'Вмещает армию. Больше лагерей — больше воинов в атаке.' }),
  forge: D({ name: 'Кузница', cat: 'army', res: 'food', tiers: 1, hp: 650, costMul: 1.4,
    maxByCastle: [0, 0, 1, 2, 3, 4], countByCastle: [0, 0, 1, 1, 1, 1],
    desc: 'Улучшает оружие и доспехи войск.' }),
  spelltower: D({ name: 'Башня алхимика', cat: 'army', res: 'gold', tiers: 1, hp: 600, costMul: 1.6,
    maxByCastle: [0, 0, 2, 3, 4, 5], countByCastle: [0, 0, 1, 1, 1, 1],
    desc: 'Варит боевые заклинания. Уровень = число зелий в запасе и новые заклинания.' }),
  heroaltar: D({ name: 'Алтарь героев', cat: 'army', res: 'gold', tiers: 1, hp: 900, costMul: 2,
    maxByCastle: [0, 1, 1, 1, 1, 1], countByCastle: [0, 1, 1, 1, 1, 1],
    desc: 'Призывает героев и усиливает их.' }),
  archertower: D({ name: 'Башня лучников', cat: 'defense', hp: 520,
    maxByCastle: [2, 3, 4, 6, 8, 10], countByCastle: [1, 2, 3, 3, 4, 5],
    def: { range: 7, interval: 0.9, dmg: 14, air: true, ground: true },
    desc: 'Быстро стреляет по наземным и воздушным целям.' }),
  ballista: D({ name: 'Баллиста', cat: 'defense', hp: 650, costMul: 1.1,
    maxByCastle: [0, 3, 4, 6, 8, 10], countByCastle: [0, 1, 2, 2, 3, 4],
    def: { range: 6.5, interval: 1.8, dmg: 58, ground: true },
    desc: 'Тяжёлые болты пробивают даже латников. Только наземные цели.' }),
  trebuchet: D({ name: 'Требушет', cat: 'defense', hp: 700, costMul: 1.8, timeMul: 1.3,
    maxByCastle: [0, 0, 0, 3, 5, 8], countByCastle: [0, 0, 0, 1, 1, 2],
    def: { range: 11, minRange: 3.5, interval: 4.5, dmg: 48, splash: 1.6, ground: true },
    desc: 'Камни бьют по площади издалека, но вблизи требушет беспомощен.' }),
  magetower: D({ name: 'Башня магов', cat: 'defense', hp: 600, costMul: 1.5, timeMul: 1.2,
    maxByCastle: [0, 0, 2, 4, 6, 8], countByCastle: [0, 0, 1, 1, 2, 3],
    def: { range: 5.5, interval: 1.6, dmg: 26, splash: 1.1, air: true, ground: true },
    desc: 'Магические заряды поражают группы врагов — и на земле, и в небе.' }),
  wall: D({ name: 'Крепостная стена', cat: 'wall', size: 1, tiers: 4, hp: 350, costMul: 0.35, timeMul: 0,
    maxByCastle: [0, 2, 3, 4, 6, 8], countByCastle: [0, 1, 1, 1, 1, 1],
    desc: 'Опоясывает город и растёт вместе с ним. Улучшается целиком и мгновенно.' }),
  trap_spikes: D({ name: 'Шипы', cat: 'trap', size: 1, tiers: 1, hp: 1, costMul: 0.3, timeMul: 0.2, sprite: 'trap_spikes',
    maxByCastle: [0, 1, 2, 2, 3, 3], countByCastle: [0, 2, 2, 3, 4, 4],
    trap: { radius: 1.2, dmg: 60, ground: true },
    desc: 'Скрытая ловушка: шипы ранят всех рядом.' }),
  trap_bear: D({ name: 'Капкан', cat: 'trap', size: 1, tiers: 1, hp: 1, costMul: 0.4, timeMul: 0.2, sprite: 'trap_bear',
    maxByCastle: [0, 0, 1, 2, 3, 3], countByCastle: [0, 0, 1, 2, 2, 3],
    trap: { radius: 0.6, dmg: 260, stun: 3, ground: true },
    desc: 'Захлопывается на одном воине: огромный урон и оглушение.' }),
  trap_rune: D({ name: 'Руна неба', cat: 'trap', size: 1, tiers: 1, hp: 1, costMul: 0.6, timeMul: 0.3, sprite: 'trap_rune',
    maxByCastle: [0, 0, 0, 1, 2, 3], countByCastle: [0, 0, 0, 1, 2, 2],
    trap: { radius: 2, dmg: 400, air: true },
    desc: 'Взрывается под пролетающими грифонами.' }),
  trap_barrel: D({ name: 'Пороховая бочка', cat: 'trap', size: 1, tiers: 1, hp: 1, costMul: 0.35, timeMul: 0.2, sprite: 'trap_barrel',
    maxByCastle: [0, 1, 2, 2, 3, 3], countByCastle: [0, 1, 2, 3, 3, 4],
    trap: { radius: 1.6, dmg: 110, ground: true },
    desc: 'Мощный взрыв по площади.' }),
};

export const DECOR = ['oak', 'pine', 'bush', 'rock_big', 'rocks', 'stump', 'mushrooms', 'log'];
export const DECOR_REMOVE_COST = 200; // золото за расчистку

export const buildingHp = (type, level, race) => {
  const b = BUILDINGS[type];
  const bonus = race && RACES[race]?.bonus.buildingHp || 0;
  return Math.round(b.hp * (1 + 0.24 * (level - 1)) * (1 + bonus));
};
export const upgradeCost = (type, toLevel) => {
  const b = BUILDINGS[type];
  if (b.cat === 'wall') return Math.round([50, 300, 1200, 4000, 10000, 22000, 45000, 80000][toLevel - 1] ?? 120000);
  return Math.round(COST_TABLE[Math.min(toLevel - 1, COST_TABLE.length - 1)] * b.costMul);
};
// Стена улучшается целиком: цена одной секции × коэффициент
export const WALL_SEGMENTS_MUL = 30;
export const wallCost = (toLevel) => upgradeCost('wall', toLevel) * WALL_SEGMENTS_MUL;

export const upgradeTime = (type, toLevel) => {
  const b = BUILDINGS[type];
  if (b.cat === 'castle' && toLevel === 1) return 0;
  return Math.round(TIME_TABLE[Math.min(toLevel - 1, TIME_TABLE.length - 1)] * b.timeMul);
};
export const spriteFor = (type, level) => {
  const b = BUILDINGS[type];
  const base = b.sprite || type;
  if (b.tiers <= 1) return base.startsWith('trap_') ? base : `${base}_1`;
  if (b.cat === 'castle') return `castle_${Math.min(6, level)}`;
  if (b.cat === 'wall') return `wall_${Math.min(4, Math.ceil(level / 2))}`;
  return `${base}_${level <= 3 ? 1 : level <= 6 ? 2 : 3}`;
};

// --- Войска -----------------------------------------------------------------
// target: any | defense | resource | wall | castle | heal
export const TROOPS = {
  swordsman: { name: 'Мечник', space: 1, cost: 30, time: 6, hp: 95, dmg: 12, interval: 1.0, range: 0.7, speed: 2.0, target: 'any', melee: true, barracks: 1,
    desc: 'Надёжный боец ближнего боя.' },
  crossbowman: { name: 'Арбалетчик', space: 1, cost: 60, time: 8, hp: 45, dmg: 11, interval: 1.0, range: 3.5, speed: 2.2, target: 'any', ranged: true, barracks: 1,
    desc: 'Стреляет из-за стен. Хрупкий.' },
  thief: { name: 'Вор', space: 1, cost: 50, time: 8, hp: 50, dmg: 12, interval: 1.0, range: 0.7, speed: 3.2, target: 'resource', resMul: 2, melee: true, barracks: 2,
    desc: 'Спешит к рудникам и хранилищам, грабит вдвое быстрее.' },
  shieldbearer: { name: 'Латник', space: 5, cost: 300, time: 25, hp: 650, dmg: 18, interval: 1.4, range: 0.9, speed: 1.4, target: 'defense', melee: true, barracks: 3,
    desc: 'Живой щит. Идёт прямо на оборону и принимает удар на себя.' },
  sapper: { name: 'Сапёр', space: 2, cost: 400, time: 15, hp: 35, dmg: 40, wallMul: 15, splash: 1.2, interval: 1, range: 0.6, speed: 3.0, target: 'wall', suicide: true, barracks: 4,
    desc: 'Подрывает стены пороховой бочкой.' },
  battlemage: { name: 'Боевой маг', space: 4, cost: 900, time: 30, hp: 100, dmg: 70, splash: 0.9, interval: 1.6, range: 3.0, speed: 1.8, target: 'any', ranged: true, barracks: 5,
    desc: 'Огненные шары по площади.' },
  priest: { name: 'Жрец', space: 6, cost: 1500, time: 40, hp: 220, heal: 40, healRadius: 2, interval: 1.0, range: 2, speed: 1.8, target: 'heal', barracks: 6,
    desc: 'Лечит союзников вокруг себя.' },
  ram: { name: 'Таран', space: 8, cost: 2500, time: 60, hp: 1300, dmg: 120, interval: 2.0, range: 0.9, speed: 1.2, target: 'castle', melee: true, barracks: 7,
    desc: 'Ломится прямо к Цитадели.' },
  griffin: { name: 'Всадник на грифоне', space: 10, cost: 4000, time: 80, hp: 1100, dmg: 90, interval: 1.5, range: 1.2, speed: 2.0, target: 'any', air: true, melee: true, barracks: 8,
    desc: 'Летит над стенами. Уязвим для башен лучников и магов.' },
};
export const troopLevelMul = (level) => 1 + 0.15 * (level - 1);
export const forgeCost = (toLevel) => [0, 5000, 20000, 60000, 150000][toLevel - 1] ?? 300000;
export const forgeTime = (toLevel) => [0, 1800, 7200, 21600, 43200][toLevel - 1] ?? 86400;

// --- Заклинания ------------------------------------------------------------
export const SPELLS = {
  fireball: { name: 'Огненный шар', cost: 1500, time: 60, tower: 1, radius: 2.2, dmg: 300, desc: 'Урон зданиям в области.' },
  lightning: { name: 'Молния', cost: 1800, time: 60, tower: 2, radius: 1.0, dmg: 240, strikes: 3, desc: 'Три удара молнии по точке.' },
  heal: { name: 'Исцеление', cost: 2000, time: 90, tower: 3, radius: 3, heal: 30, duration: 6, desc: 'Лечит войска в круге.' },
  rage: { name: 'Ярость', cost: 2500, time: 90, tower: 4, radius: 3.5, dmgMul: 1.6, speedMul: 1.4, duration: 7, desc: '+60% урона и +40% скорости войскам.' },
  freeze: { name: 'Заморозка', cost: 3000, time: 120, tower: 5, radius: 3, duration: 4, desc: 'Замораживает оборону и ловушки.' },
};

// --- Герои ------------------------------------------------------------------
export const HEROES = {
  knight: { name: 'Рыцарь-командор', castle: 2, unlock: 5000, res: 'gold', hp: 1400, dmg: 70, interval: 1.2, range: 0.9, speed: 2.0, target: 'any', melee: true,
    ability: { name: 'Боевой клич', heal: 0.4, radius: 4, dmgMul: 1.4, speedMul: 1.3, duration: 6 },
    desc: 'Ведёт армию в бой. Клич лечит его и воодушевляет войска рядом.' },
  huntress: { name: 'Лесная охотница', castle: 3, unlock: 20000, res: 'food', hp: 650, dmg: 60, interval: 0.8, range: 4, speed: 2.4, target: 'any', ranged: true,
    ability: { name: 'Град стрел', rateMul: 3, duration: 5, stealth: true },
    desc: 'Стреляет издалека. Град стрел — тройная скорость и невидимость.' },
  runesmith: { name: 'Рунный кузнец', castle: 4, unlock: 50000, res: 'gold', hp: 1800, dmg: 90, interval: 1.6, range: 0.9, speed: 1.6, target: 'defense', melee: true,
    ability: { name: 'Руна сотрясения', radius: 3, dmg: 500, wallMul: 3 },
    desc: 'Крушит оборону. Руна сотрясения обрушивает здания вокруг.' },
  sorceress: { name: 'Чародейка', castle: 5, unlock: 100000, res: 'food', hp: 700, dmg: 85, splash: 1, interval: 1.4, range: 3.5, speed: 2.0, target: 'any', ranged: true,
    ability: { name: 'Огненный шторм', radius: 3, dmg: 150, count: 6 },
    desc: 'Огненная магия. Шторм обрушивает дождь пламени на врагов.' },
};
export const heroLevelMul = (level) => 1 + 0.08 * (level - 1);
export const heroMaxLevel = (castleLevel) => Math.max(0, castleLevel * 5 - 5);
export const heroUpgradeCost = (hero, toLevel) => Math.round(HEROES[hero].unlock * 0.25 * toLevel);
export const heroUpgradeTime = (toLevel) => Math.round(Math.min(86400, 120 * toLevel * toLevel));

// --- Бой --------------------------------------------------------------------
export const BATTLE = {
  tickRate: 10,            // тиков в секунду (симуляция детерминирована)
  duration: 180,           // секунд на атаку
  scoutTime: 30,           // секунд на разведку до высадки
  lootStoragePct: 0.2,     // доля хранилищ, которую можно унести
  lootCollectorPct: 0.5,   // доля несобранного в рудниках/мельницах
  shield: [[90, 12], [60, 10], [30, 8]], // [%разрушения, часов щита]
  newPlayerShieldH: 24,
};
export function trophyOffer(attT, defT) {
  return Math.max(5, Math.min(35, Math.round(15 + (defT - attT) / 15)));
}

// --- Мир --------------------------------------------------------------------
// Рельеф и лагеря NPC — в shared/worldgen.js, сюжет — в shared/story.js
export const NPC_RESPAWN_SEC = 20 * 60;

// --- Вспомогательное ---------------------------------------------------------
export function castleLevelOf(state) {
  const c = state.buildings.find((b) => b.type === 'castle');
  return c ? c.level : 1;
}
export function countOf(state, type) {
  return state.buildings.filter((b) => b.type === type).length;
}
export function storageCap(state, res) {
  let cap = 0;
  for (const b of state.buildings) {
    const def = BUILDINGS[b.type];
    if (b.type === 'castle') cap += def.storage[b.level - 1];
    if (def.stores === res && b.level > 0) cap += def.capacity[b.level - 1];
  }
  return cap;
}
export function armyCapacity(state) {
  let cap = 0;
  for (const b of state.buildings) if (b.type === 'armycamp' && b.level > 0) cap += BUILDINGS.armycamp.housing[b.level - 1];
  return cap;
}
export function armyUsed(army) {
  let n = 0;
  for (const [t, c] of Object.entries(army || {})) n += (TROOPS[t]?.space || 0) * c;
  return n;
}
export function spellCapacity(state) {
  const t = state.buildings.find((b) => b.type === 'spelltower' && b.level > 0);
  return t ? t.level : 0;
}
export function barracksLevel(state) {
  let m = 0;
  for (const b of state.buildings) if (b.type === 'barracks') m = Math.max(m, b.level);
  return m;
}
export const collectorCap = (b) => BUILDINGS[b.type].rate[b.level - 1] * 3;
export const fmt = (n) => Math.floor(n).toLocaleString('ru-RU');
export function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  if (d) return `${d}д ${h}ч`;
  if (h) return `${h}ч ${m}м`;
  if (m) return `${m}м ${s ? s + 'с' : ''}`.trim();
  return `${s}с`;
}
