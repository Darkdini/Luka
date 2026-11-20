// ============================================================================
//  Рейтинговое событие недели: тема меняется каждую неделю, очки — за действия,
//  личные рубежи с наградами и награды по месту в таблице после конца недели.
// ============================================================================
export const WEEK_MS = 7 * 864e5;
export const week = (now = Date.now()) => Math.floor((now + 3 * 864e5) / WEEK_MS); // неделя с понедельника
export const weekEnd = (w) => (w + 1) * WEEK_MS - 3 * 864e5;

// pts: очки за единицу счётчика дня (ключи bumpDaily)
export const EVENT_THEMES = [
  { id: 'hunt', name: 'Охота на чудовищ', banner: 'hunt', text: 'Побеждайте врагов на карте и в налётах',
    pts: { npc: 40, wins: 60, help: 2 } },
  { id: 'build', name: 'Великая стройка', banner: 'build', text: 'Стройте, улучшайте и исследуйте',
    pts: { upgrades: 50, research: 40, help: 4 } },
  { id: 'gather', name: 'Щедрая жатва', banner: 'gather', text: 'Собирайте ресурсы в городе и на карте',
    pts: { gather: 40, food: 0.02, gold: 0.03, help: 2 } },
  { id: 'muster', name: 'Сбор знамён', banner: 'muster', text: 'Обучайте войска и помогайте союзникам',
    pts: { trained: 1.5, help: 5, wins: 30 } },
];
export const themeOf = (w) => EVENT_THEMES[((w % EVENT_THEMES.length) + EVENT_THEMES.length) % EVENT_THEMES.length];

// Личные рубежи
export const MILESTONES = [
  { pts: 200, reward: { food: 3000, wood: 3000 } },
  { pts: 600, reward: { gems: 30, book: 2 } },
  { pts: 1500, reward: { stone: 6000, iron: 1500, ticket: 2 } },
  { pts: 3500, reward: { gems: 80, book: 5 } },
  { pts: 7000, reward: { gems: 150, ticket: 5, mana: 800 } },
];
// Награды по месту: [до места, награда]
export const RANK_REWARDS = [
  [1, { gems: 1500, ticket: 20, frag: 'legendary', fragN: 30 }],
  [3, { gems: 900, ticket: 12, frag: 'legendary', fragN: 15 }],
  [10, { gems: 500, ticket: 8, frag: 'epic', fragN: 20 }],
  [50, { gems: 250, ticket: 5 }],
  [200, { gems: 120, ticket: 3 }],
  [Infinity, { gems: 40, book: 3 }],
];
export const rankReward = (rank) => RANK_REWARDS.find(([n]) => rank <= n)[1];
export const rankMedal = (rank) => (rank === 1 ? 'gold' : rank <= 3 ? 'silver' : rank <= 10 ? 'bronze' : null);
