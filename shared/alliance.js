// Союзы: общие константы для сервера и клиента.
export const ALLY_CRESTS = ['lion', 'eagle', 'wolf', 'bear', 'dragon', 'stag', 'raven', 'boar', 'serpent',
  'tower', 'crown', 'swords', 'axe', 'hammer', 'oak', 'sun', 'moon', 'star'];
export const ALLY_MAX = 40;
export const ALLY_COST = 200;          // самоцветы (с Цитадели 3 — бесплатно)
export const HELP_MAX = 10;
export const GIFT_TTL = 24 * 3600e3;
// ранги: 4 глава, 3 офицер, 2 воин, 1 новобранец
export const RANKS = { 4: 'Глава', 3: 'Офицер', 2: 'Воин', 1: 'Новобранец' };
export const RANK_ICON = { 4: 'ai_leader', 3: 'ai_officer', 2: 'ai_member', 1: 'ai_recruit' };
// одна помощь: 1% от полного времени, но не меньше минуты
export const helpCut = (total) => Math.max(60, Math.round(total * 0.01));
