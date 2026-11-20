// Академия, VIP, боевой пропуск, месячная карта и покупки в лавке.
import { gemsForTime, castleLevelOf } from '../shared/config.js';
import {
  TECH, techCost, techTime, techMax, mods, vipLevel, VIP_DAILY_PTS, vipChest, season, PASS_LEVELS, PASS_XP_LEVEL, PASS_XP,
  passReward, OFFERS, GEM_PACKS, MONTH_DAYS, MONTH_DAILY,
} from '../shared/meta.js';
import { HERO_DEFS } from '../shared/heroes.js';
import { eventPts } from './events.js';

export class MetaError extends Error {}
const fail = (m) => { throw new MetaError(m); };
const day = (t = Date.now()) => Math.floor(t / 864e5);

export function migrateMeta(s) {
  s.tech ||= {};
  s.vip ||= { pts: 0, day: 0 };
  if (!s.pass || s.pass.season !== season()) s.pass = { season: season(), xp: 0, gold: s.pass?.season === season() ? s.pass.gold : false, free: [], paid: [] };
}
export function tickMeta(s, now = Date.now()) {
  migrateMeta(s);
  if (s.research && s.research.end <= now) { s.tech[s.research.id] = s.research.to; s.research = null; passXp(s, 'research', 1); eventPts(s, 'research', 1); }
}
export function passXp(s, key, n = 1) {
  if (!PASS_XP[key]) return;
  migrateMeta(s);
  s.pass.xp = Math.min(PASS_LEVELS * PASS_XP_LEVEL, s.pass.xp + PASS_XP[key] * n);
}
const academy = (s) => s.buildings.filter((b) => b.type === 'academy' && !b.captured && b.level > 0).reduce((m, b) => Math.max(m, b.level), 0);

// Награда пропуска → обычная награда (фрагменты — эпический/легендарный герой расы)
function passGrant(s, r, grant) {
  const out = { ...r };
  delete out.frag; delete out.fragN;
  const got = grant(s, out);
  if (r.frag) {
    const pool = HERO_DEFS.filter((h) => h.rarity === r.frag);
    const h = pool.find((x) => x.race === s.race && !s.roster[x.id]) || pool.find((x) => x.race === s.race) || pool[0];
    s.frags[h.id] = (s.frags[h.id] || 0) + r.fragN;
    got.frag = { hero: h.id, n: r.fragN };
  }
  return got;
}

export function metaActions({ pay, payCost, grant }) {
  return {
    research(s, { id }) {
      migrateMeta(s);
      const t = TECH[id] || fail('Нет такой технологии');
      if (s.research) fail('Академия уже исследует');
      const al = academy(s);
      if (!al) fail('Постройте Академию');
      const cur = s.tech[id] || 0, max = techMax(id, al);
      if (al < t.req) fail(`Откроется на Академии ${t.req} ур.`);
      if (cur >= t.max) fail('Изучено полностью');
      if (cur >= max) fail(`Следующий уровень — на Академии ${t.req + cur} ур.`);
      payCost(s, techCost(id, cur + 1));
      const time = Math.max(1, Math.round(techTime(id, cur + 1) * (1 - (mods(s).research || 0))));
      s.research = { id, to: cur + 1, end: Date.now() + time * 1000, total: time };
      return { time };
    },
    speedupResearch(s) {
      migrateMeta(s);
      if (!s.research) fail('Нечего ускорять');
      pay(s, 'gems', gemsForTime((s.research.end - Date.now()) / 1000));
      s.research.end = Date.now();
      tickMeta(s);
    },
    vipDaily(s) {
      migrateMeta(s);
      if (s.vip.day === day()) fail('Сундук уже получен сегодня');
      s.vip.day = day();
      const lvl = vipLevel(s.vip.pts);
      s.vip.pts += VIP_DAILY_PTS;
      return { got: grant(s, vipChest(lvl)), lvl, up: vipLevel(s.vip.pts) > lvl };
    },
    passClaim(s, { level, gold }) {
      migrateMeta(s);
      level |= 0;
      if (level < 1 || level > PASS_LEVELS) fail('Нет такой ступени');
      if (Math.floor(s.pass.xp / PASS_XP_LEVEL) < level) fail('Ступень ещё не достигнута');
      if (gold && !s.pass.gold) fail('Нужен золотой пропуск');
      const list = gold ? s.pass.paid : s.pass.free;
      if (list.includes(level)) fail('Уже получено');
      list.push(level);
      return { got: passGrant(s, passReward(level, !!gold), grant) };
    },
    monthClaim(s) {
      if (!s.month || s.month.until < Date.now()) fail('Королевская грамота не активна');
      if (s.month.last === day()) fail('Сегодня уже получено');
      s.month.last = day();
      return { got: grant(s, { gems: MONTH_DAILY }) };
    },
  };
}

// Покупка в лавке (оплата подключается позже; DEV_PURCHASES — тестовые покупки)
export function applyPurchase(s, id, grant) {
  migrateMeta(s);
  const o = OFFERS.find((x) => x.id === id) || GEM_PACKS.find((x) => x.id === id) || fail('Набор не найден');
  s.purchased ||= {};
  if (o.once && s.purchased[id]) fail('Набор уже куплен');
  if (o.pass && s.pass.gold) fail('Золотой пропуск уже активен');
  if (o.month && s.month?.until > Date.now()) fail('Грамота ещё действует');
  const got = grant(s, { gems: o.gems || 0, ...(o.items || {}) });
  if (o.builder) s.builders = Math.min(5, (s.builders || 2) + 1);
  if (o.troops) for (const [k, n] of Object.entries(o.troops)) s.troops[k] = (s.troops[k] || 0) + n;
  if (o.legendary) {
    const h = HERO_DEFS.find((x) => x.rarity === 'legendary' && x.race === s.race && !s.roster[x.id]) || HERO_DEFS.find((x) => x.rarity === 'legendary' && x.race === s.race);
    s.frags[h.id] = (s.frags[h.id] || 0) + o.legendary;
  }
  if (o.month) s.month = { until: Date.now() + MONTH_DAYS * 864e5, last: 0 };
  if (o.pass) s.pass.gold = true;
  s.vip.pts += Math.max(o.gems || 0, o.price * 3);
  s.purchased[id] = (s.purchased[id] || 0) + 1;
  return { got, price: o.price, gems: o.gems || 0 };
}

export function metaView(s) {
  migrateMeta(s);
  return {
    tech: s.tech, research: s.research || null, academy: academy(s), mods: mods(s),
    vip: { pts: s.vip.pts, level: vipLevel(s.vip.pts), dailyReady: s.vip.day !== day() },
    pass: { season: s.pass.season, xp: s.pass.xp, gold: s.pass.gold, free: s.pass.free, paid: s.pass.paid, ends: (s.pass.season + 1) * 30 * 864e5 },
    month: s.month && s.month.until > Date.now() ? { until: s.month.until, ready: s.month.last !== day() } : null,
    purchased: s.purchased || {},
  };
}
void castleLevelOf;
