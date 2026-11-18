// Загрузка спрайтов. Всё, что нарезано tools/slice_sheets.py, лежит в /assets.
const imgs = new Map();

const LIST = [
  ...[1, 2, 3, 4, 5, 6].map((i) => `buildings/castle_${i}`),
  ...['archertower', 'ballista', 'trebuchet', 'magetower', 'goldmine', 'farm', 'treasury', 'granary']
    .flatMap((n) => [1, 2, 3].map((i) => `buildings/${n}_${i}`)),
  ...['armycamp', 'barracks', 'heroaltar', 'builderhut', 'forge', 'spelltower', 'guildhall', 'workshop', 'tavern'].map((n) => `buildings/${n}_1`),
  ...[1, 2, 3, 4].flatMap((i) => [`buildings/wall_${i}`, `buildings/wall_${i}c`]),
  ...['trap_spikes', 'trap_bear', 'trap_rune', 'trap_barrel', 'rubble_1', 'rubble_2', 'rubble_3', 'rubble_fire'].map((n) => `buildings/${n}`),
  ...['oak', 'pine', 'bush', 'rock_big', 'rocks', 'stump', 'mushrooms', 'flowers', 'log', 'haystack', 'well', 'signpost', 'banner', 'campfire', 'gems', 'chest'].map((n) => `decor/${n}`),
  ...['swordsman', 'crossbowman', 'shieldbearer', 'thief', 'sapper', 'battlemage', 'priest', 'ram', 'griffin'].map((n) => `troops/${n}`),
  ...['knight', 'huntress', 'runesmith', 'sorceress'].flatMap((n) => [`heroes/${n}`, `heroes/${n}_portrait`]),
  ...['fireball', 'lightning', 'heal', 'rage'].map((n) => `spells/${n}`),
  ...['fireball', 'lightning', 'heal', 'rage', 'freeze', 'quake', 'invis', 'skeletons'].map((n) => `spells/fx_${n}`),
  ...['builder', 'peasant', 'farmer', 'merchant', 'guard', 'monk', 'child', 'smith'].map((n) => `villagers/${n}`),
  ...['chest_wood', 'chest_silver', 'chest_gold', 'chest_royal', 'gems_small', 'gems_bag', 'gold_pile', 'bread_basket'].map((n) => `rewards/${n}`),
  ...['fx_levelup', 'fx_confetti', 'fx_star', 'fx_sparkle', 'fx_rays', 'fx_arrow', 'fx_coins', 'fx_magic'].map((n) => `fx/${n}`),
  ...['icon_gold', 'icon_food', 'icon_gem', 'star', 'star_empty', 'trophy'].map((n) => `ui/${n}`),
  ...['plot', 'plot_locked', 'road', 'road_t', 'road_cross', 'gate', 'fountain', 'market', 'plaza'].map((n) => `city/${n}`),
  ...['pad_s', 'pad_m', 'pad_l', 'pad_wood', 'pad_marble', 'road', 'road_cross', 'stairs'].map((n) => `pads/${n}`),
];

export function img(name) { return imgs.get(name); }

export function url(name) {
  if (name.startsWith('bg/')) return `/assets/${name}`;
  return `/assets/${name}.png`;
}

export async function loadAll(onProgress) {
  const all = [...LIST, 'bg/base.jpg', 'bg/world_map.jpg', 'bg/grass.jpg'];
  let done = 0;
  await Promise.all(all.map((n) => new Promise((res) => {
    const im = new Image();
    im.onload = () => { imgs.set(n.replace(/\.jpg$/, ''), im); done++; onProgress?.(done / all.length); res(); };
    im.onerror = () => { done++; onProgress?.(done / all.length); res(); };
    im.src = url(n);
  })));
}
