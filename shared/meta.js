// ============================================================================
//  Академия (технологии), VIP, боевой пропуск, месячная карта и наборы лавки.
//  mods(state) — сводные бонусы технологий и VIP для всей экономики и армии.
// ============================================================================

// --- Технологии -----------------------------------------------------------------
// eff — ключ бонуса, per — прибавка за уровень, req — уровень Академии для открытия
const T = (id, branch, name, icon, eff, per, req, desc) => ({ id, branch, name, icon, eff, per, req, desc, max: 5 });
export const TECHS = [
  T('agri', 'eco', 'Земледелие', 't_farm', 'food', 0.06, 1, 'Добыча еды'),
  T('logging', 'eco', 'Лесоповал', 't_wood', 'wood', 0.06, 1, 'Добыча дерева'),
  T('masonry', 'eco', 'Каменотёсы', 't_stone', 'stone', 0.06, 2, 'Добыча камня'),
  T('mining', 'eco', 'Горное дело', 't_iron', 'iron', 0.06, 3, 'Добыча железа'),
  T('arcana', 'eco', 'Тайные знания', 't_mana', 'mana', 0.06, 4, 'Добыча маны'),
  T('trade', 'eco', 'Торговля', 't_gold', 'gold', 0.06, 2, 'Доход золота'),
  T('architect', 'eco', 'Зодчество', 't_build', 'build', 0.04, 1, 'Скорость стройки'),
  T('wagons', 'eco', 'Обозы', 't_wagon', 'load', 0.08, 2, 'Груз войск'),
  T('blades', 'war', 'Закалка клинков', 't_atk', 'atk', 0.04, 1, 'Атака войск'),
  T('shields', 'war', 'Щиты', 't_def', 'def', 0.04, 1, 'Защита войск'),
  T('plate', 'war', 'Латы', 't_armor', 'hp', 0.04, 2, 'Здоровье войск'),
  T('archery', 'war', 'Стрельба', 't_bow', 'archer', 0.05, 3, 'Мощь стрелков'),
  T('lances', 'war', 'Копья и подковы', 't_lance', 'cavalry', 0.05, 3, 'Мощь кавалерии'),
  T('drill', 'war', 'Муштра', 't_drum', 'train', 0.05, 2, 'Скорость обучения'),
  T('medicine', 'war', 'Лекарское дело', 't_heal', 'heal', 0.06, 2, 'Дешевле лечение'),
  T('marching', 'war', 'Походный шаг', 't_march', 'march', 0.06, 1, 'Скорость походов'),
  T('lore', 'hero', 'Летописи', 't_book', 'exp', 0.06, 1, 'Опыт героев в походе'),
  T('scouting', 'hero', 'Следопыты', 't_scout', 'gather', 0.08, 1, 'Скорость сбора'),
  T('scholar', 'hero', 'Учёность', 't_time', 'research', 0.05, 2, 'Скорость исследований'),
  T('command', 'hero', 'Знамя командира', 't_banner', 'cap', 0.06, 3, 'Воинов в походе'),
];
export const TECH = Object.fromEntries(TECHS.map((t) => [t.id, t]));
export const BRANCHES = { eco: 'Экономика', war: 'Армия', hero: 'Герои и походы' };
const RES_BY = { eco: ['wood', 'stone', 'food'], war: ['food', 'iron', 'wood'], hero: ['wood', 'mana', 'stone'] };
export function techCost(id, toLevel) {
  const t = TECH[id], k = Math.pow(1.9, toLevel - 1) * (1 + (t.req - 1) * 0.4);
  const [a, b, c] = RES_BY[t.branch];
  return { [a]: Math.round(900 * k), [b]: Math.round(600 * k), [c]: Math.round(400 * k) };
}
export const techTime = (id, toLevel) => Math.round(90 * Math.pow(2.3, toLevel - 1) * (1 + (TECH[id].req - 1) * 0.3));
export const techMax = (id, academyLevel) => Math.min(TECH[id].max, Math.max(0, academyLevel - TECH[id].req + 1));

// --- VIP -------------------------------------------------------------------------
export const VIP_PTS = [0, 150, 400, 900, 1800, 3500, 7000, 13000, 25000, 50000]; // для VIP 1..10
export const vipLevel = (pts) => { let l = 1; for (let i = 0; i < VIP_PTS.length; i++) if (pts >= VIP_PTS[i]) l = i + 1; return l; };
export const VIP_DAILY_PTS = 30;
export const vipPerks = (l) => ({ build: 0.01 * l, gather: 0.02 * l, train: 0.01 * l, march: l >= 6 ? 1 : 0 });
export const vipChest = (l) => ({ gems: 3 * l, food: 500 * l, wood: 500 * l, stone: 300 * l, book: Math.ceil(l / 3) });
export function vipLines(l) {
  const p = vipPerks(l);
  return [`Стройка быстрее на ${Math.round(p.build * 100)}%`, `Сбор быстрее на ${Math.round(p.gather * 100)}%`, `Обучение быстрее на ${Math.round(p.train * 100)}%`,
    ...(p.march ? ['+1 отряд в поход'] : []), `Ежедневный сундук: ${vipChest(l).gems} самоцветов и ресурсы`];
}

// --- Сводные бонусы ----------------------------------------------------------------
export function mods(s) {
  const out = {};
  for (const [id, lv] of Object.entries(s.tech || {})) { const t = TECH[id]; if (t && lv) out[t.eff] = (out[t.eff] || 0) + t.per * lv; }
  const v = vipPerks(vipLevel(s.vip?.pts || 0));
  out.build = (out.build || 0) + v.build;
  out.gather = (out.gather || 0) + v.gather;
  out.train = (out.train || 0) + v.train;
  out.slots = v.march;
  return out;
}

// --- Боевой пропуск ------------------------------------------------------------
export const SEASON_MS = 30 * 864e5;
export const season = (now = Date.now()) => Math.floor(now / SEASON_MS);
export const PASS_LEVELS = 30;
export const PASS_XP_LEVEL = 100;
// опыт пропуска за действия (ключи счётчиков дня)
export const PASS_XP = { upgrades: 20, trained: 0.2, npc: 25, wins: 30, gather: 15, help: 5, research: 20 };
export function passReward(level, gold) {
  if (!gold) {
    if (level % 10 === 0) return { gems: 50, ticket: 3 };
    if (level % 5 === 0) return { gems: 20, book: 3 };
    return level % 2 ? { food: 1500 + level * 100, wood: 1500 + level * 100 } : { stone: 1000 + level * 80, ticket: 1 };
  }
  if (level === 30) return { gems: 300, frag: 'legendary', fragN: 20 };
  if (level % 10 === 0) return { gems: 150, frag: 'epic', fragN: 15 };
  if (level % 5 === 0) return { gems: 80, ticket: 5 };
  return level % 2 ? { gems: 20, book: 2, iron: 500 + level * 50 } : { ticket: 2, mana: 200 + level * 20 };
}

// --- Лавка ---------------------------------------------------------------------
export const OFFERS = [
  { id: 'starter', img: 'o_starter', label: 'Набор новичка', price: 149, gems: 500, once: true, tag: 'Один раз',
    items: { food: 20000, wood: 20000, ticket: 10 }, text: 'Быстрый старт: ресурсы и билеты найма' },
  { id: 'builder', img: 'o_builder', label: 'Набор зодчего', price: 299, gems: 600, once: true, tag: 'Один раз',
    items: { stone: 30000, wood: 20000 }, builder: true, text: 'Третий строитель навсегда и камень' },
  { id: 'hero', img: 'o_hero', label: 'Зов героев', price: 499, gems: 1000, items: { ticket: 30 }, legendary: 20, text: '30 билетов и 20 фрагментов легенды' },
  { id: 'army', img: 'o_army', label: 'Поход на Морвейн', price: 399, gems: 800, items: { iron: 5000 }, troops: { infantry2: 300, archer2: 200 }, text: '500 воинов II ступени и железо' },
  { id: 'month', img: 'o_month', label: 'Королевская грамота', price: 299, gems: 300, month: true, tag: '30 дней', text: '300 самоцветов сразу и по 60 каждый день месяц' },
  { id: 'pass', img: 'o_month', label: 'Золотой пропуск', price: 399, gems: 0, pass: true, text: 'Золотая дорожка наград сезона' },
];
export const GEM_PACKS = [
  { id: 'gems_s', img: 'gems1', gems: 500, price: 99, label: 'Горсть самоцветов' },
  { id: 'gems_m', img: 'gems2', gems: 1200, price: 199, label: 'Мешочек самоцветов', tag: '+20%' },
  { id: 'gems_l', img: 'gems3', gems: 2500, price: 399, label: 'Ларец самоцветов', tag: '+25%' },
  { id: 'gems_xl', img: 'gems4', gems: 6500, price: 899, label: 'Казна короля', tag: 'Выгодно' },
];
export const MONTH_DAYS = 30, MONTH_DAILY = 60;
