// Серверная логика героев: коллекция, найм, прокачка, построение, кампания.
import {
  HERO, HERO_DEFS, RARITY, STARTER, SUMMON, rng, rollSummon, maxHeroLevel, expToNext, BOOK_EXP,
  stageEnemies, stageReward, idleRate, IDLE_CAP_H, heroPower, SKILL_MAX, skillCost, AWAKEN_STARS, defaultSkills,
} from '../shared/heroes.js';
import { simulate } from '../shared/herobattle.js';
import { castleLevelOf } from '../shared/config.js';

export class HeroError extends Error {}
const fail = (m) => { throw new HeroError(m); };
const today = () => Math.floor(Date.now() / 86400e3);

// Поля героев в состоянии игрока (и миграция старых сохранений)
export function migrateHeroes(s) {
  if (s.roster) { for (const h of Object.values(s.roster)) h.skills ||= defaultSkills(); return; }
  const race = HERO_DEFS.some((h) => h.race === s.race) ? s.race : 'humans';
  const start = STARTER[race] || STARTER.humans;
  s.roster = {};
  for (const id of start) s.roster[id] = { level: 1, exp: 0, stars: 0, skills: defaultSkills() };
  s.frags = {};
  s.items = { book: 5, statue: 0, ticket: 5 };
  s.formation = [start[0], null, start[1], start[2], start[3]];
  s.campaign = { stage: 1, idleAt: Date.now() };
  s.summon = { day: today(), free: SUMMON.normal.freePerDay, pity: 0, total: 0, giftAt: 0 };
}

function addFrag(s, id, n) { s.frags[id] = (s.frags[id] || 0) + n; }
export function teamOf(s) {
  return s.formation.map((id) => (id && s.roster[id] ? { id, level: s.roster[id].level, stars: s.roster[id].stars, skills: s.roster[id].skills } : null));
}
export function teamPower(s) {
  return s.formation.reduce((t, id) => t + (id && s.roster[id] ? heroPower(id, s.roster[id].level, s.roster[id].stars, s.roster[id].skills) : 0), 0);
}

// Начисление награды (общая для найма и кампании)
function grant(s, it, addRes) {
  if (it.type === 'frag') addFrag(s, it.hero, it.n);
  else if (it.type === 'hero') {
    if (s.roster[it.hero]) { addFrag(s, it.hero, RARITY[HERO[it.hero].rarity].frags); it.dup = true; }
    else s.roster[it.hero] = { level: 1, exp: 0, stars: 0, skills: defaultSkills() };
  } else if (it.type === 'book') s.items.book += it.n;
  else if (it.type === 'statue') s.items.statue += it.n;
  else if (it.type === 'ticket') s.items.ticket += it.n;
  else if (it.type === 'gold') addRes(s, 'gold', it.n);
  else if (it.type === 'gems') s.res.gems += it.n;
}

export function heroActions({ pay, addRes }) {
  return {
    // Найм: обычный (бесплатно / билет), продвинутый (самоцветы), ×1 или ×10
    summon(s, { kind, count }) {
      migrateHeroes(s);
      count = count === 10 ? 10 : 1;
      if (s.summon.day !== today()) { s.summon.day = today(); s.summon.free = SUMMON.normal.freePerDay; }
      if (kind === 'normal') {
        const free = Math.min(s.summon.free, count);
        const need = count - free;
        if (s.items.ticket < need) fail('Не хватает билетов найма');
        s.summon.free -= free;
        s.items.ticket -= need;
      } else if (kind === 'advanced') {
        pay(s, 'gems', count === 10 ? SUMMON.advanced.gems10 : SUMMON.advanced.gems);
      } else fail('Неизвестный найм');
      const r = rng((Date.now() ^ (s.summon.total * 2654435761)) >>> 0);
      const results = [];
      for (let i = 0; i < count; i++) {
        s.summon.total++;
        let guarantee = false;
        if (kind === 'advanced') {
          s.summon.pity++;
          if (s.summon.pity >= SUMMON.advanced.pity) guarantee = true;
        }
        const it = rollSummon(kind, r, guarantee);
        if (kind === 'advanced' && (it.type === 'hero' || (it.type === 'frag' && ['epic', 'legendary'].includes(HERO[it.hero].rarity)))) s.summon.pity = 0;
        grant(s, it, addRes);
        results.push(it);
      }
      // бонусная карта при ×10 (11 карт, как в таверне)
      if (count === 10) { const it = { type: 'ticket', n: 1 }; grant(s, it, addRes); results.push(it); }
      return { results };
    },

    // Подарок за каждые 50 наймов
    summonGift(s) {
      migrateHeroes(s);
      if (s.summon.total - s.summon.giftAt < SUMMON.pityGift) fail('Подарок ещё не накоплен');
      s.summon.giftAt += SUMMON.pityGift;
      const epics = HERO_DEFS.filter((h) => h.rarity === 'epic');
      const h = epics[(s.summon.giftAt / SUMMON.pityGift) % epics.length];
      const it = { type: 'frag', hero: h.id, n: 10 };
      grant(s, it, addRes);
      return { results: [it] };
    },

    // Собрать героя из фрагментов
    heroAssemble(s, { id }) {
      migrateHeroes(s);
      const d = HERO[id] || fail('Нет такого героя');
      if (s.roster[id]) fail('Герой уже в отряде');
      const need = RARITY[d.rarity].frags;
      if ((s.frags[id] || 0) < need) fail(`Нужно ${need} фрагментов`);
      s.frags[id] -= need;
      s.roster[id] = { level: 1, exp: 0, stars: 0, skills: defaultSkills() };
      return { hero: id };
    },

    // Опыт из книг: до следующего уровня (или max — сколько хватит книг)
    heroLevelUp(s, { id, max }) {
      migrateHeroes(s);
      const h = s.roster[id] || fail('Герой не нанят');
      const cap = maxHeroLevel(castleLevelOf(s));
      if (h.level >= cap) fail(`Предел уровня ${cap} — улучшите Цитадель`);
      let used = 0;
      const target = max ? cap : h.level + 1;
      while (h.level < target && s.items.book > 0) {
        s.items.book--; used++;
        h.exp += BOOK_EXP;
        while (h.level < cap && h.exp >= expToNext(h.level)) { h.exp -= expToNext(h.level); h.level++; }
      }
      if (!used) fail('Нет книг опыта');
      if (h.level >= cap) h.exp = 0;
      return { level: h.level, used };
    },

    // Звезда: фрагменты героя + звёздная статуя (с 3-й звезды)
    heroStarUp(s, { id }) {
      migrateHeroes(s);
      const h = s.roster[id] || fail('Герой не нанят');
      if (h.stars >= 5) fail('Максимум звёзд');
      const need = RARITY[HERO[id].rarity].starFrags[h.stars];
      const statues = h.stars >= 2 ? h.stars - 1 : 0;
      if ((s.frags[id] || 0) < need) fail(`Нужно ${need} фрагментов героя`);
      if (s.items.statue < statues) fail(`Нужно звёздных статуй: ${statues}`);
      s.frags[id] -= need;
      s.items.statue -= statues;
      h.stars++;
      if (h.stars >= AWAKEN_STARS && !h.skills[3]) h.skills[3] = 1; // пробуждение
      return { stars: h.stars };
    },

    // Уровень навыка: фрагменты того же героя
    skillUp(s, { id, i }) {
      migrateHeroes(s);
      const h = s.roster[id] || fail('Герой не нанят');
      i |= 0;
      if (i < 0 || i > 3) fail('Нет такого навыка');
      if (!h.skills[i]) fail('Навык ещё не открыт');
      if (h.skills[i] >= SKILL_MAX) fail('Максимальный уровень навыка');
      const need = skillCost(h.skills[i]);
      if ((s.frags[id] || 0) < need) fail(`Нужно ${need} фрагментов героя`);
      s.frags[id] -= need;
      h.skills[i]++;
      return { lvl: h.skills[i] };
    },

    // Построение: 5 слотов (0–1 передний ряд, 2–4 задний)
    setFormation(s, { slots }) {
      migrateHeroes(s);
      if (!Array.isArray(slots) || slots.length !== 5) fail('Неверное построение');
      const seen = new Set();
      const clean = slots.map((id) => {
        if (!id) return null;
        if (!s.roster[id]) fail('Герой не нанят');
        if (seen.has(id)) fail('Герой уже в отряде');
        seen.add(id);
        return id;
      });
      if (!clean.some(Boolean)) fail('Отряд пуст');
      s.formation = clean;
    },

    // Кампания: бой считается на сервере, клиент проигрывает журнал
    campaignFight(s) {
      migrateHeroes(s);
      const team = teamOf(s);
      if (!team.some(Boolean)) fail('Поставьте героев в отряд');
      const n = s.campaign.stage;
      const battle = simulate(team, stageEnemies(n));
      let reward = null;
      if (battle.winner === 'a') {
        collectIdle(s, addRes); // доход до победы — по старой ставке
        const rw = stageReward(n);
        reward = { ...rw };
        addRes(s, 'gold', rw.gold);
        s.res.gems += rw.gems;
        s.items.book += rw.books;
        // опыт отряду
        for (const id of s.formation) if (id) gainExp(s, id, rw.exp);
        if (rw.fragment) {
          const epics = HERO_DEFS.filter((h) => h.rarity === 'epic');
          const h = epics[n % epics.length];
          addFrag(s, h.id, 5);
          reward.frag = { hero: h.id, n: 5 };
        }
        s.campaign.stage++;
        s.stats.stagesWon = (s.stats.stagesWon || 0) + 1;
      }
      return { battle, reward, stage: n, enemies: stageEnemies(n) };
    },

    campaignIdle(s) {
      migrateHeroes(s);
      const got = collectIdle(s, addRes);
      if (!got.exp && !got.gold) fail('Пока ничего не накоплено');
      return { got };
    },
  };
}

export function gainExp(s, id, exp) {
  const h = s.roster[id];
  const cap = maxHeroLevel(castleLevelOf(s));
  if (h.level >= cap) return;
  h.exp += exp;
  while (h.level < cap && h.exp >= expToNext(h.level)) { h.exp -= expToNext(h.level); h.level++; }
}

// Пассивный доход: опыт идёт в книги (500 опыта = книга), золото — в казну
export function idlePending(s, now = Date.now()) {
  const hours = Math.min(IDLE_CAP_H, Math.max(0, (now - s.campaign.idleAt) / 3600e3));
  const rate = idleRate(s.campaign.stage);
  return { hours, exp: Math.floor(rate.exp * hours), gold: Math.floor(rate.gold * hours), rate };
}
function collectIdle(s, addRes) {
  const p = idlePending(s);
  s.campaign.idleAt = Date.now();
  const books = Math.floor(p.exp / BOOK_EXP);
  s.items.book += books;
  const gold = addRes(s, 'gold', p.gold);
  return { exp: books * BOOK_EXP, books, gold };
}

export function heroView(s) {
  migrateHeroes(s);
  return {
    roster: s.roster, frags: s.frags, items: s.items, formation: s.formation,
    campaign: { ...s.campaign, idle: idlePending(s) },
    summon: { ...s.summon, free: s.summon.day === today() ? s.summon.free : SUMMON.normal.freePerDay },
    teamPower: teamPower(s),
  };
}
