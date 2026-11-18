// ============================================================================
//  Вовлечение: обучение «Путь правителя», ежедневные задания, календарь входа.
//  Проверки — чистые функции от «контекста», общие для сервера и клиента.
// ============================================================================

// Контекст из состояния игрока (сервер) или из view (клиент)
export function questCtx({ buildings, stats, story, achClaimed }) {
  const lvl = (t) => Math.max(0, ...buildings.filter((b) => b.type === t).map((b) => b.level));
  return {
    castle: lvl('castle') || 1,
    count: (t) => buildings.filter((b) => b.type === t && b.level > 0).length,
    lvl,
    st: stats || {},
    story: story || {},
    achClaimed: achClaimed || 0,
  };
}

// target: { building: тип [, bubble] } — указать на здание; { ui: селектор } — на кнопку
export const TUTORIAL = [
  { id: 'gold', title: 'Казна ждёт', text: 'Рудник полон золота! Нажмите на монету над Золотым рудником.',
    done: (c) => c.st.collectedGold > 0, target: { building: 'goldmine', bubble: true }, reward: { gold: 500, gems: 5 } },
  { id: 'food', title: 'Хлеб для войска', text: 'Армия марширует на сытый желудок. Соберите зерно с Мельницы.',
    done: (c) => c.st.collectedFood > 0, target: { building: 'farm', bubble: true }, reward: { food: 500 } },
  { id: 'train', title: 'Новобранцы', text: 'Откройте «Армию» и обучите ещё 4 воинов — лагерь как раз вместит.',
    done: (c) => c.st.trained >= 4, target: { ui: '#btn-army' }, reward: { food: 400, gems: 5 } },
  { id: 'story1', title: 'Зарево на границе', text: 'Разбойники жгут наши хутора! Откройте «Сюжет» и пройдите первую главу.',
    done: (c) => c.story[1]?.stars > 0, target: { ui: '#btn-story' }, reward: { gems: 10 } },
  { id: 'mine2', title: 'Больше золота', text: 'Выберите Золотой рудник и нажмите «Улучшить».',
    done: (c) => c.lvl('goldmine') >= 2 || c.st.upgrades >= 2, target: { building: 'goldmine' }, reward: { gold: 600 } },
  { id: 'speed', title: 'Магия кристаллов', text: 'Не любите ждать? Выберите стройку и ускорьте её кристаллами — я возмещу расходы!',
    done: (c) => c.st.speedups > 0, target: { building: '@upgrading' }, reward: { gems: 15 } },
  { id: 'castle2', title: 'Сердце королевства', text: 'Улучшите Цитадель до 2 уровня — откроются стены, баллисты и Алтарь героев.',
    done: (c) => c.castle >= 2, target: { building: 'castle' }, reward: { gold: 1500, gems: 20 } },
  { id: 'walls', title: 'Каменный пояс', text: 'Откройте «Магазин» → «Стены и ловушки» и поставьте 10 секций стены.',
    done: (c) => c.count('wall') >= 10, target: { ui: '#btn-shop' }, reward: { gold: 1000 } },
  { id: 'ballista', title: 'Тяжёлые болты', text: 'Постройте Баллисту — она пробивает даже латников.',
    done: (c) => c.count('ballista') >= 1, target: { ui: '#btn-shop' }, reward: { gems: 10 } },
  { id: 'raid', title: 'Первый набег', text: 'Откройте «Карту мира» и разгромите лагерь разбойников рядом с замком.',
    done: (c) => c.st.npcWins >= 1, target: { ui: '#btn-attack' }, reward: { gems: 10, food: 800 } },
  { id: 'builder', title: 'Третьи руки', text: 'Два строителя — мало для великого королевства. Наймите третьего в Магазине.',
    done: (c) => c.count('builderhut') >= 3, target: { ui: '#btn-shop' }, reward: { gold: 2000, food: 2000 } },
  { id: 'ach', title: 'Первая слава', text: 'Ваши подвиги не остались незамеченными. Заберите награду за достижение.',
    done: (c) => c.achClaimed >= 1, target: { ui: '#btn-ach' }, reward: { gems: 5 } },
  { id: 'motto', title: 'Голос правителя', text: 'Нажмите на свой портрет и впишите девиз — пусть соседи знают, с кем имеют дело.',
    done: (c) => c.st.mottoSet > 0, target: { ui: '#hud-player' }, reward: { gems: 5 } },
  { id: 'castle3', title: 'Путь правителя', text: 'Последний урок: Цитадель 3 уровня. Дальше вы поведёте Валорию сами.',
    done: (c) => c.castle >= 3, target: { building: 'castle' }, reward: { gems: 50, gold: 3000, food: 3000 } },
];

// --- Ежедневные задания --------------------------------------------------------
// counter — ключ дневного счётчика s.daily.c
export const DAILY_POOL = [
  { id: 'wins', text: 'Победите в {n} атаках', counter: 'wins', goal: (cl) => 2 + Math.floor(cl / 2) },
  { id: 'stars', text: 'Соберите {n} звёзд в атаках', counter: 'stars', goal: (cl) => 4 + cl },
  { id: 'gold', text: 'Соберите {n} золота с рудников', counter: 'gold', goal: (cl) => 1500 * cl },
  { id: 'food', text: 'Соберите {n} зерна с мельниц', counter: 'food', goal: (cl) => 1500 * cl },
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
    reward: { gems: 5, gold: 400 * castle, food: 400 * castle },
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
