// ============================================================================
//  БАЛАНС ИГРЫ — единый источник правды для сервера и клиента.
//  Все числа сведены в таблицы, чтобы крутить экономику без правки кода.
//  Подробное описание логики баланса и монетизации: docs/BALANCE.md
// ============================================================================

export const GAME_TITLE = 'Пепел Короны';

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

// Ресурсы города (самоцветы — премиум, без склада)
export const RES_LIST = ['food', 'wood', 'stone', 'iron', 'mana', 'gold'];
export const RES_NAMES = { food: 'Еда', wood: 'Дерево', stone: 'Камень', iron: 'Железо', mana: 'Мана', gold: 'Золото', gems: 'Самоцветы' };
export const RES_GEN = { food: 'еды', wood: 'дерева', stone: 'камня', iron: 'железа', mana: 'маны', gold: 'золота', gems: 'самоцветов' };
// редкие ресурсы копятся и добываются медленнее
export const RES_K = { food: 1, wood: 1, stone: 0.8, iron: 0.5, mana: 0.3, gold: 0.8 };
export const START = { food: 3000, wood: 3000, stone: 1500, iron: 600, mana: 200, gold: 2000, gems: 300 };

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
  humans: { name: 'Люди', house: 'Королевство Аурелии', color: '#2f5fb8', mentor: 'Сэр Аларик',
    bonus: { buildSpeed: 0.05, buildingHp: 0.05 }, perks: ['Скорость стройки +5%', 'Прочность зданий +5%'],
    desc: 'Наследники павшего короля. Рыцари, белые замки и упрямство — люди строят быстрее всех и держат стены до последнего.' },
  elves: { name: 'Эльфы', house: 'Сумрачный лес', color: '#3a8a4a', mentor: 'Лучница Лиэна',
    bonus: { brewSpeed: 0.05, rangedDmg: 0.05 }, perks: ['Скорость исследований +5%', 'Атака стрелков +5%'],
    desc: 'Древний народ лесов. Их стрелы не знают промаха, а знания — границ.' },
  dwarves: { name: 'Гномы', house: 'Горный оплот', color: '#b0702a', mentor: 'Рунный кузнец Торгрим',
    bonus: { goldRate: 0.05, troopHp: 0.05 }, perks: ['Добыча ресурсов +5%', 'Здоровье войск +5%'],
    desc: 'Мастера камня и рун. Богатые копи и крепкие воины, которых не сломать.' },
  orcs: { name: 'Орки', house: 'Кровавые степи', color: '#a8322a', mentor: 'Вождь Грохмар',
    bonus: { trainSpeed: 0.05, meleeDmg: 0.05 }, perks: ['Скорость тренировки +5%', 'Атака ближнего боя +5%'],
    desc: 'Дети степей и ярости. Армия орков собирается быстрее и бьёт сильнее любой другой.' },
};
// Сохранения из промежуточной «ночной» версии
for (const [old, now] of Object.entries({ hunters: 'humans', mages: 'elves', werewolves: 'dwarves', vampires: 'orcs' })) {
  Object.defineProperty(RACES, old, { value: RACES[now], enumerable: false });
}

// --- Здания -----------------------------------------------------------------
// cat: castle | resource | storage | army | special | wall
// cost: доли базовой цены уровня по ресурсам; countByCastle[ц-1]: сколько можно построить.
// Уровень любого здания не выше уровня Цитадели. Цитадель — до CASTLE_MAX.
export const CASTLE_MAX = 10;
const C10 = (...a) => a.concat(Array(10 - a.length).fill(a[a.length - 1]));
const D = (o) => ({ size: 3, hp: 600, timeMul: 1, pw: 12, ...o, countByCastle: C10(...o.count) });
// добыча в час по уровню (умножается на RES_K ресурса)
export const RATE = [200, 300, 420, 560, 720, 900, 1100, 1320, 1560, 1820];
export const COLLECT_HOURS = 4; // сколько часов копится у здания добычи

export const BUILDINGS = {
  castle: D({ name: 'Цитадель', cat: 'castle', size: 4, hp: 2000, timeMul: 2, pw: 60, count: [1],
    cost: { wood: 1.6, stone: 1.6, iron: 0.4, gold: 0.8 },
    storage: [6000, 12000, 25000, 45000, 80000, 130000, 200000, 300000, 450000, 650000],
    desc: 'Сердце королевства. Уровень Цитадели — предел уровня всех зданий; открывает новые здания и земли.' }),
  farm: D({ name: 'Ферма', cat: 'resource', produces: 'food', count: [2, 3, 4, 4, 5, 5, 6],
    cost: { wood: 0.6, stone: 0.2 }, desc: 'Выращивает еду для войска и жителей.' }),
  sawmill: D({ name: 'Лесопилка', cat: 'resource', produces: 'wood', count: [1, 2, 2, 3, 3, 4],
    cost: { food: 0.4, stone: 0.3 }, desc: 'Даёт дерево — главный ресурс стройки.' }),
  quarry: D({ name: 'Каменоломня', cat: 'resource', produces: 'stone', count: [1, 1, 2, 2, 3, 3],
    cost: { wood: 0.6, food: 0.2 }, desc: 'Добывает камень для крепких стен и зданий.' }),
  mine: D({ name: 'Рудник', cat: 'resource', produces: 'iron', count: [0, 1, 1, 2, 2, 3],
    cost: { wood: 0.6, stone: 0.4 }, desc: 'Даёт железо для оружия, доспехов и Кузницы.' }),
  manaspring: D({ name: 'Источник маны', cat: 'resource', produces: 'mana', count: [0, 0, 1, 1, 1, 2],
    cost: { stone: 0.6, iron: 0.2 }, desc: 'Древний источник силы: мана нужна героям и исследованиям.' }),
  market: D({ name: 'Рынок', cat: 'resource', produces: 'gold', count: [0, 1, 1, 1, 2, 2],
    cost: { wood: 0.5, stone: 0.5 }, desc: 'Торговцы платят налог золотом.' }),
  warehouse: D({ name: 'Склад', cat: 'storage', count: [1, 1, 1, 2, 2, 2, 3],
    cost: { wood: 0.8, stone: 0.5 }, capacity: [8000, 16000, 30000, 50000, 80000, 120000, 180000, 260000, 360000, 500000],
    desc: 'Увеличивает запас всех ресурсов.' }),
  tavern: D({ name: 'Таверна героев', cat: 'special', count: [1], cost: { wood: 0.8, gold: 0.3 }, pw: 18,
    desc: 'Здесь нанимают героев. Уровень таверны повышает силу отряда.' }),
  statue: D({ name: 'Статуя-страж', cat: 'special', count: [1], cost: { stone: 1 }, pw: 25,
    desc: 'Хранитель расы: усиливает бонус вашей расы и защищает город.' }),
  altar: D({ name: 'Алтарь героев', cat: 'special', count: [0, 1], cost: { stone: 0.8, mana: 0.4 }, pw: 20,
    desc: 'Восстанавливает и усиливает героев.' }),
  advisor: D({ name: 'Кабинет советника', cat: 'special', count: [0, 0, 1], cost: { wood: 0.6, gold: 0.4 },
    desc: 'Советник берёт поручения и приносит награды.' }),
  embassy: D({ name: 'Посольство', cat: 'special', count: [0, 0, 0, 1], cost: { stone: 0.7, gold: 0.5 },
    desc: 'Связь с союзом: помощь союзников и подкрепления.' }),
  barracks: D({ name: 'Казармы', cat: 'army', count: [1, 1, 1, 2], cost: { wood: 0.7, iron: 0.3 }, hp: 700,
    queue: [10, 15, 20, 25, 30, 35, 40, 45, 50, 55], desc: 'Готовят пехоту. Уровень открывает новые отряды.' }),
  range: D({ name: 'Стрельбище', cat: 'army', count: [0, 1, 1, 1, 2], cost: { wood: 0.8, iron: 0.2 },
    desc: 'Готовит стрелков.' }),
  stables: D({ name: 'Конюшни', cat: 'army', count: [0, 0, 1, 1, 1, 2], cost: { wood: 0.6, food: 0.6, iron: 0.2 },
    desc: 'Растит боевых коней для кавалерии.' }),
  hospital: D({ name: 'Госпиталь', cat: 'army', count: [0, 1, 1, 2], cost: { wood: 0.5, stone: 0.5 },
    desc: 'Лечит раненых воинов после боя.' }),
  forge: D({ name: 'Кузница', cat: 'army', count: [0, 0, 1], cost: { stone: 0.6, iron: 0.6 }, hp: 650,
    desc: 'Улучшает оружие и доспехи войск.' }),
  academy: D({ name: 'Академия', cat: 'army', count: [0, 0, 1], cost: { stone: 0.7, mana: 0.5 },
    desc: 'Исследования и боевые зелья.' }),
  // стена: обводит открытую часть города, улучшается целиком (нужна набегам)
  wall: D({ name: 'Крепостная стена', cat: 'wall', size: 1, hp: 350, count: [1], cost: { stone: 0.35 }, pw: 0,
    desc: 'Опоясывает город и растёт вместе с ним.' }),
};
// Старые типы зданий → новые (миграция сохранений)
export const LEGACY_TYPES = { goldmine: 'market', treasury: 'warehouse', granary: 'warehouse', armycamp: 'range',
  spelltower: 'academy', heroaltar: 'altar' };

export const DECOR = ['rubble', 'ruin_hut', 'logs', 'fence', 'stones', 'deadtree'];
// Расчистка руин: награда ресурсом по виду завала
export const RUIN_REWARD = { rubble: { stone: 300 }, ruin_hut: { wood: 250, stone: 150 }, logs: { wood: 400 },
  fence: { wood: 250 }, stones: { stone: 400 }, deadtree: { wood: 300 } };
export const DECOR_REMOVE_COST = 0;

export const maxLevelOf = (type, castleLevel) => (type === 'castle' ? CASTLE_MAX : Math.min(CASTLE_MAX, castleLevel));
export const buildingHp = (type, level, race) => {
  const b = BUILDINGS[type];
  const bonus = race && RACES[race]?.bonus.buildingHp || 0;
  return Math.round(b.hp * (1 + 0.24 * (level - 1)) * (1 + bonus));
};
// Цена уровня: { ресурс: сколько }
export const buildCost = (type, toLevel) => {
  const b = BUILDINGS[type];
  const base = COST_TABLE[Math.min(toLevel - 1, COST_TABLE.length - 1)];
  const out = {};
  for (const [r, k] of Object.entries(b.cost)) out[r] = Math.round(base * k * (r === 'gold' ? 1 : 1));
  return out;
};
export const upgradeCost = (type, toLevel) => Object.values(buildCost(type, toLevel)).reduce((a, v) => a + v, 0);
export const canAfford = (res, cost) => Object.entries(cost).every(([r, v]) => (res[r] || 0) >= v);
export const missingOf = (res, cost) => Object.fromEntries(Object.entries(cost).map(([r, v]) => [r, Math.max(0, v - (res[r] || 0))]).filter(([, v]) => v > 0));
// Стена улучшается целиком: цена одной секции × коэффициент
export const WALL_SEGMENTS_MUL = 30;
export const wallCost = (toLevel) => Math.round([50, 300, 1200, 4000, 10000, 22000, 45000, 80000][toLevel - 1] ?? 120000) * WALL_SEGMENTS_MUL;

export const upgradeTime = (type, toLevel) => {
  const b = BUILDINGS[type];
  if (b.cat === 'castle' && toLevel === 1) return 0;
  return Math.round(TIME_TABLE[Math.min(toLevel - 1, TIME_TABLE.length - 1)] * b.timeMul);
};
export const rateOf = (type, level) => (BUILDINGS[type].produces && level > 0 ? Math.round(RATE[Math.min(level, RATE.length) - 1] * RES_K[BUILDINGS[type].produces]) : 0);
export const buildingPower = (type, level) => (level > 0 ? Math.round(BUILDINGS[type].pw * Math.pow(level, 1.35)) : 0);
// Что даёт уровень — для окна здания: [название, значение]
export function levelEffects(type, level) {
  const d = BUILDINGS[type];
  const out = [['Сила', buildingPower(type, level)]];
  if (d.produces) out.push([`Добыча ${RES_GEN[d.produces]} в час`, rateOf(type, level)], ['Запас у здания', rateOf(type, level) * COLLECT_HOURS]);
  if (d.storage) out.push(['Вместимость склада', d.storage[level - 1]]);
  if (d.capacity) out.push(['Вместимость склада', d.capacity[level - 1]]);
  if (d.queue) out.push(['Очередь обучения', d.queue[level - 1]]);
  if (['barracks', 'range', 'stables'].includes(type)) out.push(['Места в лагере', 8 * level]);
  return out;
}
export const spriteFor = (type) => type;

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
  if (res === 'gems') return Infinity;
  let cap = 0;
  for (const b of state.buildings) {
    if (b.level < 1 || b.captured) continue;
    const def = BUILDINGS[b.type];
    if (!def) continue;
    if (def.storage) cap += def.storage[b.level - 1];
    if (def.capacity) cap += def.capacity[b.level - 1];
  }
  return Math.round(cap * (RES_K[res] || 1));
}
export function armyCapacity(state) {
  let cap = 20;
  for (const b of state.buildings) if (['barracks', 'range', 'stables'].includes(b.type) && b.level > 0) cap += 8 * b.level;
  return cap;
}
export function armyUsed(army) {
  let n = 0;
  for (const [t, c] of Object.entries(army || {})) n += (TROOPS[t]?.space || 0) * c;
  return n;
}
export function spellCapacity(state) {
  const t = state.buildings.find((b) => b.type === 'academy' && b.level > 0);
  return t ? t.level : 0;
}
export function barracksLevel(state) {
  let m = 0;
  for (const b of state.buildings) if (b.type === 'barracks') m = Math.max(m, b.level);
  return m;
}
export const collectorCap = (b) => rateOf(b.type, b.level) * COLLECT_HOURS;
export const fmt = (n) => Math.floor(n).toLocaleString('ru-RU');
export function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  if (d) return `${d}д ${h}ч`;
  if (h) return `${h}ч ${m}м`;
  if (m) return `${m}м ${s ? s + 'с' : ''}`.trim();
  return `${s}с`;
}
