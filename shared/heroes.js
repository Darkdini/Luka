// ============================================================================
//  Герои — ядро игры. Коллекция из 32 героев четырёх рас, редкость, роли,
//  прокачка (уровень, звёзды), найм и формулы силы. Общий для сервера и клиента.
// ============================================================================

export const RARITY = {
  common: { name: 'Обычный', short: 'Обычн.', color: '#5fae4a', mul: 1.0, frags: 10, starFrags: [5, 10, 15, 25, 40] },
  rare: { name: 'Редкий', short: 'Редк.', color: '#3f7fd8', mul: 1.3, frags: 20, starFrags: [10, 15, 25, 40, 60] },
  epic: { name: 'Эпический', short: 'Эпич.', color: '#9a52d6', mul: 1.7, frags: 30, starFrags: [15, 25, 40, 60, 90] },
  legendary: { name: 'Легендарный', short: 'Легенд.', color: '#e0a83a', mul: 2.2, frags: 50, starFrags: [20, 35, 55, 80, 120] },
};
export const RARITY_ORDER = ['legendary', 'epic', 'rare', 'common'];

// Роли: множители базовых параметров и поведение ульты
export const ROLES = {
  tank: { name: 'Танк', icon: 'tank', hp: 1.7, atk: 0.65, def: 1.6, spd: 0.85 },
  dmg: { name: 'Урон', icon: 'dmg', hp: 1.0, atk: 1.35, def: 0.9, spd: 1.05 },
  aoe: { name: 'AoE', icon: 'aoe', hp: 0.9, atk: 1.15, def: 0.85, spd: 1.0 },
  heal: { name: 'Лекарь', icon: 'heal', hp: 1.05, atk: 0.85, def: 1.0, spd: 1.1 },
  support: { name: 'Поддержка', icon: 'support', hp: 1.2, atk: 0.95, def: 1.15, spd: 1.15 },
};
export const TROOP_TYPES = { infantry: 'Пехота', archer: 'Стрелки', cavalry: 'Кавалерия' };

const H = (id, race, name, title, rarity, role, troop, ult, lore, extra = {}) => ({ id, race, name, title, rarity, role, troop, ult, lore, ...extra });

export const HERO_DEFS = [
  // --- Люди -------------------------------------------------------------------
  H('elinor', 'humans', 'Элинор', 'Королева без короны', 'legendary', 'support', 'infantry', 'Знамя Аурелии',
    'Вдова павшего короля. Пока её знамя поднято, ни один солдат Аурелии не отступит.'),
  H('gaven', 'humans', 'Брат Гавен', 'Молот веры', 'epic', 'heal', 'infantry', 'Свет обители',
    'Монах-воин из обители Рассвета. Лечит словом, а несогласных — булавой.'),
  H('mira', 'humans', 'Мира', 'Арбалетчица с границы', 'rare', 'dmg', 'archer', 'Залп в упор',
    'Дочь мельника, взявшая арбалет, когда сожгли её деревню. Не промахивается.'),
  H('rowan', 'humans', 'Роуэн', 'Оруженосец', 'common', 'tank', 'infantry', 'Стена щитов',
    'Мечтает о рыцарских шпорах. Пока — первым встречает удар.'),
  H('varrick', 'humans', 'Лорд Варрик', 'Маршал Чёрной стали', 'legendary', 'dmg', 'infantry', 'Удар маршала',
    'Командовал королевской армией двадцать лет. Двуручный меч помнит каждую битву.'),
  H('selene', 'humans', 'Селена', 'Придворная чародейка', 'epic', 'aoe', 'archer', 'Ледяная буря',
    'Хранила тайны короля. Теперь мстит за него холодом и огнём.'),
  H('edric', 'humans', 'Эдрик', 'Королевский копейщик', 'rare', 'dmg', 'cavalry', 'Рыцарский таран',
    'Лучший копейщик турниров. На войне турнирных правил нет — и ему это нравится.'),
  H('hilda', 'humans', 'Хильда', 'Ополченка', 'common', 'dmg', 'infantry', 'Вилы наголо',
    'Крестьянка, защищающая свой дом. Вилами владеет лучше иного рыцаря.'),
  // --- Эльфы ------------------------------------------------------------------
  H('aerith', 'elves', 'Аэрит', 'Лунный лук', 'legendary', 'dmg', 'archer', 'Стрела полнолуния',
    'Верховная лучница Сумрачного леса. Её стрела находит цель даже сквозь туман.'),
  H('thalion', 'elves', 'Талион', 'Танцующий клинок', 'epic', 'dmg', 'infantry', 'Танец лезвий',
    'Мастер парных клинков. Появляется за спиной врага раньше, чем тот поймёт.', { assassin: true }),
  H('ysolde', 'elves', 'Изольда', 'Друид рощи', 'rare', 'heal', 'archer', 'Дыхание рощи',
    'Слышит, как растёт трава. Её лозы затягивают любые раны.'),
  H('fenn', 'elves', 'Фенн', 'Юный разведчик', 'common', 'dmg', 'archer', 'Меткий выстрел',
    'Самый быстрый разведчик леса. И самый болтливый.'),
  H('elandor', 'elves', 'Эландор', 'Древний владыка', 'legendary', 'aoe', 'archer', 'Звёздный свет',
    'Помнит основание Короны. Его магия — свет давно погасших звёзд.'),
  H('nyra', 'elves', 'Нира', 'Тень леса', 'epic', 'dmg', 'infantry', 'Удар из тени',
    'Убийца, которой эльфы не признаются, что пользуются её услугами.', { assassin: true }),
  H('caelum', 'elves', 'Келум', 'Страж древа', 'rare', 'tank', 'infantry', 'Кора древнего дуба',
    'Его доспех выращен, а не выкован. Стоит, как корни горы.'),
  H('lirien', 'elves', 'Лириэн', 'Травница', 'common', 'heal', 'archer', 'Целебный отвар',
    'Собирает травы для раненых и знает, какие из них ядовиты.'),
  // --- Гномы ------------------------------------------------------------------
  H('durin', 'dwarves', 'Король Дурин', 'Железный кулак', 'legendary', 'tank', 'infantry', 'Гнев горы',
    'Король Горного оплота. Его топор сломал ворота трёх осаждённых крепостей.'),
  H('brenna', 'dwarves', 'Бренна', 'Дева щита', 'epic', 'tank', 'infantry', 'Рунный щит',
    'Её башенный щит выдерживал удар тролля. Дважды.'),
  H('bolgar', 'dwarves', 'Болгар', 'Инженер', 'rare', 'dmg', 'archer', 'Механический залп',
    'Собрал самострел, стреляющий пятью болтами сразу. Работает в трёх случаях из пяти.'),
  H('grim', 'dwarves', 'Грим', 'Шахтёр', 'common', 'dmg', 'infantry', 'Удар кирки',
    'Пробил тоннель сквозь гору. Пробьёт и шлем.'),
  H('hrafna', 'dwarves', 'Храфна', 'Жрица камня', 'legendary', 'support', 'infantry', 'Руны предков',
    'Говорит с духами гор. Руны на её посохе горят, когда враг рядом.'),
  H('kargan', 'dwarves', 'Карган', 'Берсерк', 'epic', 'dmg', 'infantry', 'Рёв берсерка',
    'Татуировки на его теле — счёт павших врагов. Места почти не осталось.'),
  H('odda', 'dwarves', 'Одда', 'Пивовар-лекарь', 'rare', 'heal', 'infantry', 'Бочонок здравия',
    'Утверждает, что эль лечит всё. Странно, но он прав.'),
  H('thrain', 'dwarves', 'Траин', 'Молодой страж', 'common', 'tank', 'infantry', 'Круговая оборона',
    'Впервые в дозоре. Очень старается.'),
  // --- Орки -------------------------------------------------------------------
  H('ashka', 'orcs', 'Ашка', 'Кровавая луна', 'legendary', 'dmg', 'infantry', 'Мясницкий удар',
    'Вождь, объединившая три враждующих клана. Тех, кто спорил, больше нет.'),
  H('murg', 'orcs', 'Мург', 'Старый шаман', 'epic', 'support', 'archer', 'Зов предков',
    'Его дым показывает будущее. Чаще всего — чужую смерть.'),
  H('tarrok', 'orcs', 'Таррок', 'Волчий наездник', 'rare', 'dmg', 'cavalry', 'Набег стаи',
    'Ездит на волке размером с лошадь. Волк злее хозяина.'),
  H('skab', 'orcs', 'Скаб', 'Новобранец', 'common', 'tank', 'infantry', 'Дубовый щит',
    'Мечтает стать вождём. Пока стоит в первом ряду.'),
  H('gorrum', 'orcs', 'Горрум', 'Сокрушитель', 'legendary', 'tank', 'infantry', 'Землетряс',
    'Самый большой орк степей. Молот весит как бычок.'),
  H('vexa', 'orcs', 'Векса', 'Кровавая ведьма', 'epic', 'aoe', 'archer', 'Кровавый ритуал',
    'Ведьма, чья магия пьёт кровь врагов — и своих, если те медлят.'),
  H('brakk', 'orcs', 'Бракк', 'Лучник степей', 'rare', 'dmg', 'archer', 'Чёрные стрелы',
    'Его лук из рога тура пробивает кольчугу с двухсот шагов.'),
  H('gnash', 'orcs', 'Гнаш', 'Добытчик', 'common', 'dmg', 'infantry', 'Тесак',
    'Собирает всё, что плохо лежит. И что хорошо лежит — тоже.'),
];
export const HERO = Object.fromEntries(HERO_DEFS.map((h) => [h.id, h]));

// --- Формулы ----------------------------------------------------------------
const BASE = { hp: 1000, atk: 190, def: 45, spd: 100 };
export const maxHeroLevel = (castleLevel) => Math.min(100, 10 + castleLevel * 10);
export const expToNext = (level) => Math.round(80 * level * (1 + level * 0.12));
export const BOOK_EXP = 500;

export function heroStats(id, level = 1, stars = 0, skills = null) {
  const d = HERO[id], r = RARITY[d.rarity], role = ROLES[d.role];
  const aw = skills ? 0.04 * (skills[3] || 0) : 0;
  const k = r.mul * (1 + 0.1 * (level - 1)) * (1 + 0.15 * stars) * (1 + aw);
  return {
    hp: Math.round(BASE.hp * role.hp * k),
    atk: Math.round(BASE.atk * role.atk * k),
    def: Math.round(BASE.def * role.def * k),
    spd: Math.round(BASE.spd * role.spd * (1 + 0.01 * stars)),
  };
}
export function heroPower(id, level, stars, skills = null) {
  const s = heroStats(id, level, stars, skills);
  const sk = skills ? skills.reduce((t, x) => t + x, 0) * 40 : 0;
  return Math.round(s.hp * 0.3 + s.atk * 2.2 + s.def * 2 + s.spd + sk);
}

// --- Навыки: обычная атака, пассив, ульта, пробуждение (с 3 звёзд) -----------------
export const SKILL_MAX = 10;
export const skillCost = (lvl) => [0, 2, 3, 4, 5, 6, 8, 10, 12, 15][lvl] ?? 99; // фрагменты героя за следующий уровень
export const AWAKEN_STARS = 3;
export const defaultSkills = () => [1, 1, 1, 0];

// Коэффициенты навыков по уровням — используются и в описании, и в бою
export function skillNumbers(role, lv = defaultSkills(), assassin = false) {
  const [b, p, u, w] = lv;
  const ultBase = { tank: 1.2, dmg: assassin ? 3 : 2.8, aoe: 1.3, heal: 0.8, support: 1.2 }[role];
  return {
    basic: 1 + 0.06 * (b - 1),
    passive: { tank: 0.15 + 0.01 * (p - 1), dmg: 0.2 + 0.02 * (p - 1), aoe: 10 + (p - 1), heal: 0.3 + 0.03 * (p - 1), support: 0.05 + 0.005 * (p - 1) }[role],
    ult: ultBase * (1 + 0.08 * (u - 1)),
    awaken: 0.04 * w, // +к атаке и здоровью
  };
}
const pct = (x) => `${Math.round(x * 1000) / 10}%`;
export function heroSkills(id, lv = defaultSkills()) {
  const d = HERO[id];
  const n = skillNumbers(d.role, lv, d.assassin);
  const nx = skillNumbers(d.role, lv.map((x, i) => (i === 3 && x === 0 ? 0 : Math.min(SKILL_MAX, x + 1))), d.assassin);
  const basicName = d.troop === 'archer' ? 'Выстрел' : 'Удар';
  const P = {
    tank: ['Несгибаемость', (v) => `Получает на ${pct(v)} меньше урона.`],
    dmg: ['Жажда битвы', (v) => `+${pct(v)} к урону по врагам с запасом здоровья выше половины.`],
    aoe: ['Поток силы', (v) => `Каждое действие даёт +${v} энергии сверх обычного.`],
    heal: ['Милосердие', (v) => `Обычная атака лечит самого раненого союзника на ${pct(v)} атаки.`],
    support: ['Вдохновение', (v) => `Весь отряд получает +${pct(v)} к атаке.`],
  }[d.role];
  const U = {
    tank: (v) => `Принимает удар на себя: −40% получаемого урона на 2 раунда, урон ${pct(v)} атаки по первому ряду.`,
    dmg: (v) => (d.assassin ? `Прыжок к самому слабому врагу в заднем ряду: урон ${pct(v)} атаки.` : `Мощный удар по одной цели: урон ${pct(v)} атаки.`),
    aoe: (v) => `Бьёт всех врагов: урон ${pct(v)} атаки каждому.`,
    heal: (v) => `Лечит весь отряд на ${pct(v)} атаки.`,
    support: (v) => `Отряд получает +30% к атаке на 2 раунда, удар по цели ${pct(v)} атаки.`,
  }[d.role];
  const tags = { tank: ['Защита', 'Контроль'], dmg: ['Урон', d.assassin ? 'Убийца' : 'Одиночная цель'], aoe: ['AoE', 'Урон'], heal: ['Лечение', 'Поддержка'], support: ['Бафф', 'Отряд'] }[d.role];
  return [
    { kind: 'basic', name: basicName, lvl: lv[0], tags: ['Обычная атака'], desc: `Обычная атака: урон ${pct(n.basic)} атаки. Даёт энергию.`, next: [['Урон', pct(n.basic), pct(nx.basic)]] },
    { kind: 'passive', name: P[0], lvl: lv[1], tags: ['Пассивный навык'], desc: P[1](n.passive), next: [['Эффект', d.role === 'aoe' ? `+${n.passive}` : pct(n.passive), d.role === 'aoe' ? `+${nx.passive}` : pct(nx.passive)]] },
    { kind: 'ult', name: d.ult, lvl: lv[2], tags: ['Активный навык', ...tags], desc: U(n.ult) + ' Срабатывает при полной энергии.', next: [['Сила навыка', pct(n.ult), pct(nx.ult)]] },
    { kind: 'awaken', name: 'Пробуждение', lvl: lv[3], tags: ['Пассивный навык', 'Отряд'], locked: lv[3] === 0,
      desc: lv[3] === 0 ? `Откроется на ${AWAKEN_STARS} звёздах. Даёт герою +4% к атаке и здоровью за уровень.` : `+${pct(n.awaken)} к атаке и здоровью героя.`,
      next: [['Бонус', pct(n.awaken), pct(nx.awaken)]] },
  ];
}

// --- Синергия рас: 3/4/5 героев одной расы в отряде ----------------------------
export function raceSynergy(ids) {
  const cnt = {};
  for (const id of ids) if (id && HERO[id]) cnt[HERO[id].race] = (cnt[HERO[id].race] || 0) + 1;
  const best = Math.max(0, ...Object.values(cnt));
  const race = Object.keys(cnt).find((r) => cnt[r] === best) || null;
  const bonus = best >= 5 ? 0.15 : best >= 4 ? 0.10 : best >= 3 ? 0.05 : 0;
  return { race, count: best, bonus };
}

// --- Найм ------------------------------------------------------------------
export const SUMMON = {
  normal: { name: 'Обычный найм', freePerDay: 4, ticket: 'ticket', gems: 0 },
  advanced: { name: 'Продвинутый найм', gems: 280, gems10: 2500, pity: 10 },
  pityGift: 50,
};
// Детерминированный ГСЧ из сида
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const byRarity = (r) => HERO_DEFS.filter((h) => h.rarity === r);

// Один найм: в основном фрагменты; редко — целый герой
export function rollSummon(kind, r, guaranteeEpic) {
  const x = r();
  if (kind === 'normal') {
    if (x < 0.30) return { type: 'book', n: 1 + Math.floor(r() * 2) };
    if (x < 0.45) return { type: 'gold', n: 2000 };
    const rar = x < 0.85 ? 'common' : x < 0.98 ? 'rare' : 'epic';
    const h = pick(byRarity(rar), r);
    return { type: 'frag', hero: h.id, n: rar === 'common' ? 3 + Math.floor(r() * 3) : rar === 'rare' ? 2 + Math.floor(r() * 2) : 1 };
  }
  // продвинутый
  if (guaranteeEpic || x < 0.06) {
    const rar = r() < 0.2 ? 'legendary' : 'epic';
    const h = pick(byRarity(rar), r);
    return r() < 0.35 ? { type: 'hero', hero: h.id } : { type: 'frag', hero: h.id, n: rar === 'legendary' ? 5 : 8 };
  }
  if (x < 0.30) return { type: 'book', n: 3 + Math.floor(r() * 3) };
  if (x < 0.40) return { type: 'statue', n: 1 };
  const rar = x < 0.75 ? 'rare' : 'epic';
  const h = pick(byRarity(rar), r);
  return { type: 'frag', hero: h.id, n: rar === 'rare' ? 4 + Math.floor(r() * 3) : 2 + Math.floor(r() * 2) };
}
const pick = (arr, r) => arr[Math.floor(r() * arr.length)];

// Стартовый отряд по расе игрока
export const STARTER = {
  humans: ['rowan', 'mira', 'hilda', 'lirien'],
  elves: ['fenn', 'caelum', 'lirien', 'hilda'],
  dwarves: ['thrain', 'bolgar', 'grim', 'lirien'],
  orcs: ['skab', 'brakk', 'gnash', 'lirien'],
};

// --- Кампания «Тропа осколков» -----------------------------------------------
export const STAGES_PER_CHAPTER = 10;
export const CHAPTER_NAMES = ['Пограничье', 'Сумрачный лес', 'Кристальные пещеры', 'Древние руины', 'Заброшенные копи',
  'Мятежная столица', 'Гавань туманов', 'Чёрный форпост', 'Врата Пепла', 'Цитадель Морвейна'];
export const stageName = (n) => `${Math.floor((n - 1) / STAGES_PER_CHAPTER) + 1}-${((n - 1) % STAGES_PER_CHAPTER) + 1}`;

// Вражеский отряд этапа: герои-изменники и нежить — детерминированно по номеру
export function stageEnemies(n) {
  const r = rng(n * 7919 + 13);
  const size = Math.min(5, 2 + Math.floor((n + 1) / 3));
  const level = Math.max(1, Math.round(1 + (n - 1) * 0.8));
  const pool = HERO_DEFS.filter((h) => (n < 12 ? h.rarity === 'common' || h.rarity === 'rare' : n < 30 ? h.rarity !== 'legendary' : true));
  const team = [];
  const used = new Set();
  // первый ряд — по возможности танки
  while (team.length < size) {
    const wantTank = team.length < 2;
    const cand = pool.filter((h) => !used.has(h.id) && (!wantTank || h.role === 'tank'));
    const h = pick(cand.length ? cand : pool.filter((x) => !used.has(x.id)), r);
    used.add(h.id);
    team.push({ id: h.id, level, stars: Math.min(5, Math.floor(n / 12)) });
  }
  const slots = [null, null, null, null, null];
  team.forEach((u, i) => { slots[i < 2 ? i : 2 + (i - 2)] = u; });
  return slots;
}
export function stageReward(n) {
  const boss = n % 5 === 0;
  return { exp: 150 + n * 40, gold: 400 + n * 120, gems: boss ? 30 : 5, books: boss ? 3 : 1, fragment: boss ? 'random-epic' : null };
}
// Пассивный доход кампании (в час): растёт с прогрессом
export function idleRate(stage) {
  return { exp: 300 + stage * 45, gold: 500 + stage * 90 };
}
export const IDLE_CAP_H = 12;
