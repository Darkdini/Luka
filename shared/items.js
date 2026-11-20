// ============================================================================
//  Предметы инвентаря: ускорения, сундуки ресурсов, щиты мира, телепорты, бонусы.
//  Общий каталог для сервера и клиента. Иконки временные (до листа предметов).
// ============================================================================
import { RES_K } from './config.js';

const R = { common: '#8a8f96', rare: '#3f7fd8', epic: '#9a52d6', legendary: '#e0a83a' };
export const RARITY_COLOR = R;

export const ITEMS = {};
const add = (id, o) => { ITEMS[id] = { id, ...o }; };

// --- Ускорения: universal — для всего; build — только стройка ---------------------
const SPEEDS = [['1m', 60, 5, 'common'], ['5m', 300, 25, 'common'], ['15m', 900, 45, 'rare'], ['60m', 3600, 180, 'rare'],
  ['3h', 10800, 450, 'epic'], ['8h', 28800, 1200, 'epic'], ['24h', 86400, 3600, 'legendary']];
const SP_ICON = ['sp1', 'sp2', 'sp3', 'sp4', 'sp5', 'sp6', 'sp6'];
const fmtDur = (sec) => (sec >= 3600 ? `${sec / 3600} ч` : `${sec / 60} мин`);
SPEEDS.forEach(([k, sec, gems, rar], i) => {
  add(`sp_${k}`, { tab: 'speed', kind: 'speed', for: null, sec, gems, rarity: rar, icon: SP_ICON[i], name: `Ускорение ${fmtDur(sec)}`, desc: 'Сокращает любое ожидание: стройку, обучение, исследование, лечение, поход.' });
});
for (const [k, sec, rar] of [['5m', 300, 'common'], ['60m', 3600, 'rare'], ['3h', 10800, 'epic']]) {
  add(`spb_${k}`, { tab: 'speed', kind: 'speed', for: 'build', sec, rarity: rar, icon: 'spb', name: `Ускорение стройки ${fmtDur(sec)}`, desc: 'Сокращает только время стройки и улучшения зданий.' });
}
add('spt_60m', { tab: 'speed', kind: 'speed', for: 'train', sec: 3600, rarity: 'rare', icon: 'spt', name: 'Ускорение обучения 1 ч', desc: 'Сокращает только обучение войск.' });
add('sph_60m', { tab: 'speed', kind: 'speed', for: 'heal', sec: 3600, rarity: 'rare', icon: 'sph', name: 'Ускорение лечения 1 ч', desc: 'Сокращает только лечение в Госпитале.' });
add('spm_15m', { tab: 'speed', kind: 'speed', for: 'march', sec: 900, rarity: 'rare', icon: 'spm', name: 'Ускорение похода 15 мин', desc: 'Сокращает только путь отряда.' });
add('spr_60m', { tab: 'speed', kind: 'speed', for: 'research', sec: 3600, rarity: 'rare', icon: 'spr', name: 'Ускорение науки 1 ч', desc: 'Сокращает только исследования в Академии.' });

// --- Сундуки ресурсов -----------------------------------------------------------------
const RES = { food: ['Еда', 'rc_food'], wood: ['Дерево', 'rc_wood'], stone: ['Камень', 'rc_stone'], iron: ['Железо', 'rc_iron'], mana: ['Мана', 'rc_mana'], gold: ['Золото', 'rc_gold'] };
for (const [r, [nm, icon]] of Object.entries(RES)) {
  for (const [k, base, gems, rar] of [['1k', 1000, 10, 'common'], ['10k', 10000, 50, 'rare'], ['50k', 50000, 180, 'epic']]) {
    const amount = Math.round(base * (RES_K[r] || 1));
    add(`rc_${r}_${k}`, { tab: 'res', kind: 'res', res: r, amount, gems, rarity: rar, icon, name: `${nm}: ${amount >= 1000 ? amount / 1000 + 'K' : amount}`, desc: `Открыть — получить ${amount.toLocaleString('ru-RU')} ед. (${nm.toLowerCase()}).` });
  }
}

// --- Щиты, телепорты, бонусы ----------------------------------------------------------
add('sh_8h', { tab: 'special', kind: 'shield', sec: 8 * 3600, gems: 500, rarity: 'rare', icon: 'sh1', name: 'Щит мира 8 ч', desc: 'Ваш замок нельзя атаковать. Снимается, если вы сами нападаете на игрока.' });
add('sh_24h', { tab: 'special', kind: 'shield', sec: 24 * 3600, gems: 1000, rarity: 'epic', icon: 'sh2', name: 'Щит мира 24 ч', desc: 'Ваш замок нельзя атаковать. Снимается, если вы сами нападаете на игрока.' });
add('sh_3d', { tab: 'special', kind: 'shield', sec: 72 * 3600, gems: 2500, rarity: 'legendary', icon: 'sh3', name: 'Щит мира 3 дня', desc: 'Ваш замок нельзя атаковать. Снимается, если вы сами нападаете на игрока.' });
add('tp_rand', { tab: 'special', kind: 'teleport', rand: true, gems: 500, rarity: 'rare', icon: 'tp1', name: 'Случайный телепорт', desc: 'Переносит замок в случайное свободное место. Все отряды должны быть дома.' });
add('tp_adv', { tab: 'special', kind: 'teleport', rand: false, gems: 2000, rarity: 'legendary', icon: 'tp2', name: 'Телепорт', desc: 'Переносит замок в выбранное место на карте. Все отряды должны быть дома.' });
// бонусы: eff — ключ mods(), val — прибавка, sec — длительность
add('bo_march', { tab: 'special', kind: 'boost', eff: 'march', val: 0.25, sec: 8 * 3600, gems: 300, rarity: 'rare', icon: 'bo_march', name: 'Эликсир скорости', desc: '+25% к скорости походов на 8 часов.' });
add('bo_gather', { tab: 'special', kind: 'boost', eff: 'gather', val: 0.25, sec: 8 * 3600, gems: 150, rarity: 'rare', icon: 'spg', name: 'Серп жнеца', desc: '+25% к скорости сбора на 8 часов.' });
add('bo_atk', { tab: 'special', kind: 'boost', eff: 'atk', val: 0.1, sec: 8 * 3600, gems: 150, rarity: 'rare', icon: 'bo_atk', name: 'Боевое знамя', desc: '+10% к атаке войск на 8 часов.' });
add('bo_def', { tab: 'special', kind: 'boost', eff: 'def', val: 0.1, sec: 8 * 3600, gems: 200, rarity: 'rare', icon: 'bo_def', name: 'Рунный щит', desc: '+10% к защите войск на 8 часов.' });
add('bo_res', { tab: 'special', kind: 'boost', eff: 'resAll', val: 0.25, sec: 24 * 3600, gems: 400, rarity: 'epic', icon: 'bo_res', name: 'Рог изобилия', desc: '+25% к добыче всех ресурсов в городе на сутки.' });

// Предметы героев (хранятся в s.items, не в сумке)
export const HERO_ITEMS = {
  book: { name: 'Книга опыта', icon: 'book', desc: 'Даёт герою 500 опыта. Используется в карточке героя.' },
  ticket: { name: 'Билет найма', icon: 'ticket', desc: 'Обычный найм в таверне.' },
  statue: { name: 'Звёздная статуя', icon: 'statue', desc: 'Нужна для повышения звёзд героя с 3-й звезды.' },
};

export const TABS = [['speed', 'Ускорения'], ['res', 'Ресурсы'], ['special', 'Особые'], ['hero', 'Герои']];
// Что продаётся в лавке за самоцветы
export const SHOP_ITEMS = Object.values(ITEMS).filter((i) => i.gems).map((i) => i.id);
export const isItem = (k) => Object.hasOwn(ITEMS, k);
