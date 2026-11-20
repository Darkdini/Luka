// ============================================================================
//  Вовлечение: обучение «Путь правителя», ежедневные задания, календарь входа.
//  Проверки — чистые функции от «контекста», общие для сервера и клиента.
// ============================================================================

// Контекст из состояния игрока (сервер) или из view (клиент)
export function questCtx({ buildings, stats, story, achClaimed, wallLevel, summon, campaign, ally, tech }) {
  const lvl = (t) => Math.max(0, ...buildings.filter((b) => b.type === t && !b.captured).map((b) => b.level));
  return {
    castle: lvl('castle') || 1,
    count: (t) => buildings.filter((b) => b.type === t && (b.level > 0 || b.up) && !b.captured).length,
    lvl,
    freed: (t) => buildings.some((b) => b.type === t && !b.captured),
    st: stats || {},
    story: story || {},
    achClaimed: achClaimed || 0,
    wall: wallLevel || 0,
    summons: summon?.total || 0,
    stage: campaign?.stage || 1,
    ally: !!ally,
    techs: Object.values(tech || {}).reduce((a, v) => a + v, 0),
  };
}

// Главы: задания по одному, у каждой главы — своё имя.
// target: { building: тип [, bubble] } — указать на здание; { ruin: true } — на руины; { ui: селектор } — на кнопку
const CH1 = 'Глава 1 · Пепел и камень', CH2 = 'Глава 2 · Обретение формы', CH3 = 'Глава 3 · Сталь и слава', CH4 = 'Глава 4 · За стеной';
export const TUTORIAL = [
  { ch: CH1, id: 'food', title: 'Хлеб для людей', text: 'Ферма полна еды! Нажмите на значок над Фермой, чтобы собрать урожай.',
    done: (c) => c.st.collectedFood > 0, target: { building: 'farm', bubble: true }, reward: { wood: 500, gems: 5 } },
  { ch: CH1, id: 'farm2', title: 'Вторая ферма', text: 'Еды мало для растущего города. Нажмите «Построить» и поставьте ещё одну Ферму.',
    done: (c) => c.count('farm') >= 2, target: { ui: '#btn-build' }, reward: { food: 800, wood: 400 } },
  { ch: CH1, id: 'ruins', title: 'Расчистка', text: 'Город лежит в руинах. Нажмите на завалы и расчистите 4 из них — получите дерево и камень.',
    done: (c) => (c.st.ruinsCleared || 0) >= 4, target: { ruin: true }, reward: { stone: 600, gems: 5 } },
  { ch: CH1, id: 'statue', title: 'Статуя-страж', text: 'Враги осквернили Статую-страж — источник силы нашей расы. Нажмите на неё и отвоюйте героями!',
    done: (c) => c.freed('statue'), target: { building: 'statue' }, reward: { gems: 15, book: 3 } },
  { ch: CH1, id: 'statue2', title: 'Починка Статуи', text: 'Статуя наша, но разбита. Нажмите на неё и почините.',
    done: (c) => c.lvl('statue') >= 1, target: { building: 'statue' }, reward: { wood: 1000, stone: 800, ticket: 2 } },
  { ch: CH2, id: 'saw', title: 'Звон пил', text: 'Без дерева нет стройки. Постройте Лесопилку.',
    done: (c) => c.count('sawmill') >= 1, target: { ui: '#btn-build' }, reward: { food: 1000, gems: 5 } },
  { ch: CH2, id: 'castle2', title: 'Сердце королевства', text: 'Улучшите Цитадель до 2 уровня: откроются Рудник, Рынок и новые уровни зданий.',
    done: (c) => c.castle >= 2, target: { building: 'castle' }, reward: { wood: 1500, stone: 1500, gems: 10 } },
  { ch: CH2, id: 'tavern', title: 'Таверна в осаде', text: 'Наёмники Морвейна засели в Таверне героев. Отвоюйте её!',
    done: (c) => c.freed('tavern'), target: { building: 'tavern' }, reward: { gems: 20, ticket: 3 } },
  { ch: CH2, id: 'tavern2', title: 'Двери открыты', text: 'Почините Таверну — сюда потянутся герои со всего края.',
    done: (c) => c.lvl('tavern') >= 1, target: { building: 'tavern' }, reward: { gold: 1500, book: 3 } },
  { ch: CH2, id: 'summon', title: 'Новый соратник', text: 'Откройте «Герои» → «Таверна» и наймите героя.',
    done: (c) => c.summons >= 1, target: { ui: '#btn-heroes' }, reward: { gems: 10, book: 2 } },
  { ch: CH3, id: 'camp', title: 'Поход', text: 'Отряд готов к походу. Откройте «Поход» и пройдите этап 1-3.',
    done: (c) => c.stage >= 4, target: { ui: '#btn-campaign' }, reward: { food: 2000, gems: 10 } },
  { ch: CH3, id: 'quarry', title: 'Камень для стен', text: 'Постройте Каменоломню.',
    done: (c) => c.count('quarry') >= 1, target: { ui: '#btn-build' }, reward: { wood: 1500 } },
  { ch: CH3, id: 'castle3', title: 'Новые земли', text: 'Цитадель 3 уровня расчистит новые земли за стеной.',
    done: (c) => c.castle >= 3, target: { building: 'castle' }, reward: { wood: 3000, stone: 3000, gems: 20 } },
  { ch: CH3, id: 'barracks', title: 'Казармы', text: 'Дезертиры заняли Казармы. Отвоюйте их — без них не собрать войско.',
    done: (c) => c.freed('barracks'), target: { building: 'barracks' }, reward: { iron: 800, gems: 15 } },
  { ch: CH3, id: 'barracks2', title: 'Под знамёна', text: 'Почините Казармы.',
    done: (c) => c.lvl('barracks') >= 1, target: { building: 'barracks' }, reward: { gems: 30, food: 3000, gold: 2000 } },
  { ch: CH3, id: 'troops', title: 'Первые полки', text: 'Откройте «Армия» и обучите 50 воинов в Казармах.',
    done: (c) => (c.st.trained || 0) >= 50, target: { ui: '#btn-army' }, reward: { gems: 30, food: 3000, wood: 2000 } },
  { ch: CH4, id: 'gather', title: 'Дары земли', text: 'Откройте «Карту», нажмите на ресурс рядом с замком и отправьте отряд на сбор.',
    done: (c) => (c.st.gathered || 0) > 0, target: { ui: '#btn-attack' }, reward: { wood: 3000, stone: 2000, gems: 10 } },
  { ch: CH4, id: 'camp', title: 'Разбойничий стан', text: 'На карте разбойники грабят караваны. Отправьте героев с войсками на лагерь 1–2 уровня.',
    done: (c) => (c.st.npcWins || 0) > 0, target: { ui: '#btn-attack' }, reward: { gems: 20, book: 3, iron: 1000 } },
  { ch: CH4, id: 'ally', title: 'Плечом к плечу', text: 'В одиночку Морвейна не одолеть. Вступите в союз или основайте свой — кнопка «Союз» слева.',
    done: (c) => c.ally, target: { ui: '#btn-ally' }, reward: { gems: 30, ticket: 2 } },
  { ch: CH4, id: 'academy', title: 'Свет знаний', text: 'Постройте Академию и изучите первую технологию.',
    done: (c) => c.techs > 0, target: { ui: '#btn-build' }, reward: { gems: 50, mana: 500, book: 5 } },
];

// --- Ежедневные задания --------------------------------------------------------
// counter — ключ дневного счётчика s.daily.c
export const DAILY_POOL = [
  { id: 'wins', text: 'Победите в {n} атаках', counter: 'wins', goal: (cl) => 2 + Math.floor(cl / 2) },
  { id: 'stars', text: 'Соберите {n} звёзд в атаках', counter: 'stars', goal: (cl) => 4 + cl },
  { id: 'gold', text: 'Соберите {n} золота с рынков', counter: 'gold', goal: (cl) => 1000 * cl },
  { id: 'food', text: 'Соберите {n} еды с ферм', counter: 'food', goal: (cl) => 1500 * cl },
  { id: 'trained', text: 'Обучите {n} воинов', counter: 'trained', goal: (cl) => 10 + cl * 5 },
  { id: 'upgrades', text: 'Начните {n} улучшения', counter: 'upgrades', goal: () => 2 },
  { id: 'npc', text: 'Разгромите {n} лагеря NPC', counter: 'npc', goal: () => 2 },
];
export const DAILY_BONUS_GEMS = 20;

export const today = (now = Date.now()) => Math.floor(now / 86400e3);

export function dailyQuests(day, castle) {
  const picks = [];
  let h = (day * 2654435761) >>> 0;
  while (picks.length < 3) {
    h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    const q = DAILY_POOL[h % DAILY_POOL.length];
    if (!picks.includes(q)) picks.push(q);
  }
  return picks.map((q) => ({
    id: q.id, counter: q.counter, goal: q.goal(castle), text: q.text.replace('{n}', q.goal(castle).toLocaleString('ru-RU')),
    reward: { gems: 5, gold: 400 * castle, food: 400 * castle, wood: 400 * castle },
  }));
}

// --- Календарь входа -----------------------------------------------------------
// gold/food умножаются на уровень Цитадели
export const STREAK = [
  { gold: 800, label: 'Мешок золота', img: 'rewards/gold_pile' },
  { food: 800, label: 'Корзина зерна', img: 'rewards/bread_basket' },
  { gems: 10, label: 'Горсть кристаллов', img: 'rewards/gems_small' },
  { gold: 1500, food: 1500, label: 'Серебряный сундук', img: 'rewards/chest_silver' },
  { gems: 20, label: 'Мешочек кристаллов', img: 'rewards/gems_bag' },
  { gold: 3000, food: 3000, label: 'Золотой сундук', img: 'rewards/chest_gold' },
  { gems: 50, gold: 5000, food: 5000, label: 'Королевский сундук', img: 'rewards/chest_royal', big: true },
];
