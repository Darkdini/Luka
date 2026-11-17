// Достижения, лиги, аватары. Награды кристаллами — стабильный бесплатный
// приток премиум-валюты (см. docs/BALANCE.md).

export const LEAGUES = [
  { min: 0, name: 'Без лиги', color: '#8a8a8a', icon: '🪵' },
  { min: 200, name: 'Бронза', color: '#b06a36', icon: '🥉' },
  { min: 600, name: 'Серебро', color: '#9fb0c2', icon: '🥈' },
  { min: 1200, name: 'Золото', color: '#e3a21f', icon: '🥇' },
  { min: 2000, name: 'Платина', color: '#38c7c0', icon: '💠' },
  { min: 3000, name: 'Алмаз', color: '#7b6cff', icon: '💎' },
  { min: 4200, name: 'Легенда', color: '#ff4d6d', icon: '👑' },
];
export function leagueOf(trophies) {
  let l = LEAGUES[0];
  for (const x of LEAGUES) if (trophies >= x.min) l = x;
  return l;
}

// stat: имя счётчика в state.stats либо вычисляемое значение (см. statValue)
export const ACHIEVEMENTS = [
  { id: 'castle', name: 'Строитель империи', stat: 'castleLevel', tiers: [2, 4, 6], gems: [10, 30, 100], title: 'Зодчий', desc: 'Улучшите Цитадель до уровня {n}' },
  { id: 'conqueror', name: 'Завоеватель', stat: 'wins', tiers: [10, 100, 1000], gems: [10, 50, 250], title: 'Завоеватель', desc: 'Победите в {n} атаках' },
  { id: 'stars', name: 'Звездочёт', stat: 'starsTotal', tiers: [30, 300, 3000], gems: [10, 50, 250], title: 'Звёздный рыцарь', desc: 'Соберите {n} звёзд в атаках' },
  { id: 'fortress', name: 'Неприступная крепость', stat: 'defWins', tiers: [5, 50, 250], gems: [10, 50, 200], title: 'Несокрушимый', desc: 'Отбейте {n} нападений' },
  { id: 'robber', name: 'Гроза казны', stat: 'goldLooted', tiers: [50000, 1000000, 20000000], gems: [10, 50, 250], title: 'Золотая рука', desc: 'Награбьте {n} золота' },
  { id: 'farmer', name: 'Хлебный барон', stat: 'foodLooted', tiers: [50000, 1000000, 20000000], gems: [10, 50, 250], title: 'Хлебный барон', desc: 'Награбьте {n} зерна' },
  { id: 'destroyer', name: 'Разрушитель', stat: 'destroyed', tiers: [100, 2000, 25000], gems: [10, 50, 200], title: 'Сокрушитель', desc: 'Разрушьте {n} зданий' },
  { id: 'hunter', name: 'Охотник на разбойников', stat: 'npcWins', tiers: [10, 100, 500], gems: [10, 40, 150], title: 'Гроза разбойников', desc: 'Разгромите {n} лагерей NPC' },
  { id: 'general', name: 'Полководец', stat: 'trained', tiers: [100, 2000, 20000], gems: [10, 40, 150], title: 'Полководец', desc: 'Обучите {n} воинов' },
  { id: 'clearer', name: 'Лесоруб', stat: 'cleared', tiers: [5, 20, 40], gems: [5, 15, 50], title: 'Лесоруб', desc: 'Расчистите {n} препятствий' },
  { id: 'heroes', name: 'Зал славы', stat: 'heroes', tiers: [1, 2, 4], gems: [10, 30, 100], title: 'Повелитель героев', desc: 'Призовите {n} героев' },
  { id: 'glory', name: 'Слава королевства', stat: 'trophiesMax', tiers: [600, 2000, 4200], gems: [20, 100, 400], title: 'Легенда Валории', desc: 'Наберите {n} кубков' },
  { id: 'saga', name: 'Пепел Короны', stat: 'story', tiers: [3, 6, 10], gems: [20, 60, 200], title: 'Носитель Короны', desc: 'Пройдите {n} глав сюжета' },
];

export function statValue(state, stat) {
  if (stat === 'castleLevel') return state.buildings.find((b) => b.type === 'castle')?.level || 1;
  if (stat === 'heroes') return Object.keys(state.heroes || {}).length;
  if (stat === 'story') return Object.values(state.story || {}).filter((c) => c.stars > 0).length;
  return state.stats?.[stat] || 0;
}

// Текущее состояние каждого достижения: сколько ступеней получено/забрано
export function achievementStatus(state) {
  const claimed = state.achievements || {};
  return ACHIEVEMENTS.map((a) => {
    const v = statValue(state, a.stat);
    const reached = a.tiers.filter((t) => v >= t).length;
    return { ...a, value: v, reached, claimed: claimed[a.id] || 0 };
  });
}

// Аватары: открываются вместе с героями и войсками
export const AVATARS = [
  { id: 'knight', img: 'heroes/knight_portrait', need: null },
  { id: 'huntress', img: 'heroes/huntress_portrait', need: { hero: 'huntress' } },
  { id: 'runesmith', img: 'heroes/runesmith_portrait', need: { hero: 'runesmith' } },
  { id: 'sorceress', img: 'heroes/sorceress_portrait', need: { hero: 'sorceress' } },
  { id: 'swordsman', img: 'troops/swordsman', need: null },
  { id: 'crossbowman', img: 'troops/crossbowman', need: null },
  { id: 'thief', img: 'troops/thief', need: { ach: 'robber' } },
  { id: 'shieldbearer', img: 'troops/shieldbearer', need: { ach: 'fortress' } },
  { id: 'battlemage', img: 'troops/battlemage', need: { ach: 'stars' } },
  { id: 'priest', img: 'troops/priest', need: { ach: 'general' } },
  { id: 'griffin', img: 'troops/griffin', need: { ach: 'conqueror' } },
  { id: 'sapper', img: 'troops/sapper', need: { ach: 'destroyer' } },
];

export function avatarUnlocked(state, av) {
  if (!av.need) return true;
  if (av.need.hero) return !!state.heroes?.[av.need.hero];
  if (av.need.ach) return (state.achievements?.[av.need.ach] || 0) >= 1;
  return false;
}

export function titlesOf(state) {
  return ACHIEVEMENTS.filter((a) => (state.achievements?.[a.id] || 0) >= 3).map((a) => a.title);
}
