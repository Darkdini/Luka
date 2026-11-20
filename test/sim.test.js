import test from 'node:test';
import assert from 'node:assert/strict';
import { runBattle, createBattle, step } from '../shared/sim.js';
import { npcBase } from '../server/world.js';
import { newPlayerState, tick, actions, lootableBase } from '../server/game.js';
import { CAPTURED } from '../shared/city.js';

const attacker = { army: { swordsman: 20, crossbowman: 10, shieldbearer: 2, sapper: 2 }, spells: { fireball: 1 }, heroes: { knight: { level: 3 } }, troopLevels: {}, race: 'humans' };
const log = [];
for (let i = 0; i < 20; i++) log.push({ t: i * 2, c: 'troop', k: 'swordsman', x: 1.5, y: 10 + i * 0.5 });
for (let i = 0; i < 10; i++) log.push({ t: 50 + i, c: 'troop', k: 'crossbowman', x: 1.5, y: 20 + i * 0.3 });
log.push({ t: 60, c: 'troop', k: 'shieldbearer', x: 1.5, y: 25 }, { t: 61, c: 'troop', k: 'shieldbearer', x: 1.5, y: 26 });
log.push({ t: 40, c: 'troop', k: 'sapper', x: 1.5, y: 21 }, { t: 41, c: 'troop', k: 'sapper', x: 1.5, y: 22 });
log.push({ t: 70, c: 'hero', k: 'knight', x: 1.5, y: 22 }, { t: 200, c: 'ability', k: 'knight' }, { t: 150, c: 'spell', k: 'fireball', x: 21, y: 21 });

test('бой детерминирован и даёт результат', () => {
  for (const lvl of [1, 3, 6]) {
    const base = { buildings: npcBase(lvl, 12345) };
    const a = runBattle({ base, defRace: null, attacker }, log);
    const b = runBattle({ base, defRace: null, attacker }, log);
    assert.deepEqual(a, b);
    console.log('NPC', lvl, 'зданий', base.buildings.length, '→', JSON.stringify(a));
  }
});

test('нельзя высадить войска внутри базы и больше, чем есть', () => {
  const base = { buildings: npcBase(2, 1) };
  const S = createBattle({ base, defRace: null, attacker });
  step(S, [{ c: 'troop', k: 'swordsman', x: 21, y: 21 }, { c: 'troop', k: 'griffin', x: 1, y: 1 }]);
  assert.equal(S.units.length, 0);
});

test('экономика: стройка по сетке, сбор, обучение', () => {
  const s = newPlayerState('humans', 42);
  tick(s, Date.now() + 3600e3);
  const farm = s.buildings.find((b) => b.type === 'farm');
  assert.ok(farm.store > 300);
  const food = s.res.food;
  actions.collect(s, {});
  assert.ok(s.res.food > food);
  assert.throws(() => actions.train(s, { k: 'swordsman', n: 2 }), /Казармы/, 'казармы захвачены врагом');
  assert.throws(() => actions.place(s, { type: 'farm', x: 2, y: 2 }), /не расчищена/);
  assert.throws(() => actions.place(s, { type: 'farm', x: 20, y: 20 }), /занято/);
  const r = actions.place(s, { type: 'farm', x: 14, y: 14 });
  assert.ok(s.buildings.find((b) => b.id === r.id).up, 'стройка идёт');
  assert.throws(() => actions.place(s, { type: 'mine', x: 26, y: 26 }), /Цитадели 2/);
  actions.buyBuilder(s);
  assert.equal(s.builders, 3);
  assert.ok(lootableBase(s).some((b) => b.loot.gold > 0 || b.loot.food > 0));
});

test('город: руины, захваченные здания, перенос, стена', () => {
  const s = newPlayerState('dwarves', 3);
  assert.equal(s.buildings.filter((b) => b.captured).length, CAPTURED.length);
  const statue = s.buildings.find((b) => b.type === 'statue');
  assert.throws(() => actions.upgrade(s, { id: statue.id }), /захвачено/);
  // руина первой зоны расчищается и даёт ресурс
  const ruin = s.decor.find((d) => d.x >= 14 && d.y >= 14 && d.x + 2 <= 30 && d.y + 2 <= 30);
  const before = s.res.wood + s.res.stone;
  actions.removeDecor(s, { id: ruin.id });
  assert.ok(s.res.wood + s.res.stone > before);
  // бой за статую: стартовый отряд против врага 1 уровня
  const res = actions.liberate(s, { id: statue.id });
  assert.equal(res.battle.winner, 'a');
  assert.equal(statue.captured, false);
  actions.upgrade(s, { id: statue.id });
  tick(s, Date.now() + 3600e3);
  assert.equal(statue.level, 1);
  const farm = s.buildings.find((b) => b.type === 'farm');
  actions.move(s, { id: farm.id, x: 15, y: 15 });
  assert.deepEqual([farm.x, farm.y], [15, 15]);
  assert.throws(() => actions.move(s, { id: farm.id, x: 21, y: 21 }), /занято/);
  assert.equal(s.wallLevel, 1, 'частокол с первого дня');
  s.res.stone = 100000;
  assert.throws(() => actions.wallUpgrade(s), /Цитадель/);
  s.buildings.find((v) => v.type === 'castle').level = 2;
  actions.wallUpgrade(s);
  assert.equal(s.wallLevel, 2);
  assert.ok(lootableBase(s).filter((v) => v.type === 'wall').length > 60);
});

import { findSpot, region, profile, startAttack, finishAttack } from '../server/world.js';
import { db } from '../server/db.js';
import { CHAPTERS } from '../shared/story.js';
import { campAt, buildable } from '../shared/worldgen.js';

test('мир: свободное место на суше, не на лагере', () => {
  const s = findSpot(42);
  assert.ok(buildable(s.x, s.y));
  assert.equal(campAt(s.x, s.y), null);
});

test('сюжет: глава 1 проходится и даёт награду один раз', () => {
  const st = newPlayerState('elves', 9);
  st.army = { swordsman: 20, crossbowman: 10 };
  const now = Date.now();
  const r = db.prepare(`INSERT INTO players (username, pass, castle_name, race, realm, plot, wx, wy, state, created_at, seen_at) VALUES (?, 'x', 'Тест', 'elves', 1, 0, 5, 5, ?, ?, ?)`)
    .run('story' + now, JSON.stringify(st), now, now);
  const me = { id: Number(r.lastInsertRowid), castle_name: 'Тест', state: st };
  const b = startAttack(me, { kind: 'story', id: 1 });
  const log = [];
  for (let i = 0; i < 20; i++) log.push({ t: i, c: 'troop', k: 'swordsman', x: 1.5, y: 12 + i * 0.6 });
  for (let i = 0; i < 10; i++) log.push({ t: 30 + i, c: 'troop', k: 'crossbowman', x: 1.5, y: 20 + i * 0.4 });
  const gems = st.res.gems;
  const res = finishAttack(me, b.battleId, log);
  assert.ok(res.stars > 0, 'глава 1 должна проходиться стартовой армией');
  assert.equal(st.res.gems - gems, CHAPTERS[0].reward.gems + (res.stars === 3 ? CHAPTERS[0].starGems : 0));
  assert.throws(() => startAttack(me, { kind: 'story', id: 3 }));
  assert.ok(Array.isArray(region(0, 0, 50, 50, () => false)));
});

import { TUTORIAL } from '../shared/quests.js';

test('обучение и ежедневные награды', () => {
  const s = newPlayerState('humans', 5);
  assert.throws(() => actions.claimQuest(s), /не выполнено/);
  actions.collect(s, {});                      // стартовая ферма наполовину полна
  assert.ok(s.stats.collectedFood > 0);
  const gems = s.res.gems;
  const r = actions.claimQuest(s);
  assert.equal(s.tutorial, 1);
  assert.equal(s.res.gems - gems, TUTORIAL[0].reward.gems);
  assert.ok(r.got.wood > 0);
  const d = actions.daily(s);                  // календарь: день 1
  assert.equal(d.day, 1);
  assert.throws(() => actions.daily(s), /уже получена/);
  assert.ok(s.daily.c.food > 0, 'сбор засчитан в задание дня');
});

import { checkUsername, hasProfanity, censor } from '../shared/names.js';

test('ники: латиница от 5 символов, без мата', () => {
  assert.equal(checkUsername('Arthur_77'), null);
  assert.ok(checkUsername('Abc'));
  assert.ok(checkUsername('Артур123'));
  for (const w of ['fuuuck', 'xyй', 'p1zda', 'blyat_1', 'SukaKing']) assert.ok(hasProfanity(w), w);
  for (const w of ['Hancock', 'Херсон', 'Команда', 'Shopper', 'Herald']) assert.ok(!hasProfanity(w), w);
  assert.equal(censor('привет сука'), 'привет ★★★★');
});

import { simulate } from '../shared/herobattle.js';
import { stageEnemies } from '../shared/heroes.js';

test('герои: найм, сборка, прокачка, кампания', () => {
  const s = newPlayerState('humans', 11);
  tick(s);
  assert.ok(Object.keys(s.roster).length >= 4, 'стартовый отряд');
  const r = actions.summon(s, { kind: 'normal', count: 1 });
  assert.equal(r.results.length, 1);
  s.items.book = 10;
  const id = s.formation.find(Boolean);
  const lv = actions.heroLevelUp(s, { id, max: true });
  assert.ok(lv.level > 1);
  const before = s.campaign.stage;
  const f = actions.campaignFight(s);
  assert.ok(f.battle.log.length > 5);
  if (f.battle.winner === 'a') assert.equal(s.campaign.stage, before + 1);
  const a = simulate([{ id: 'rowan' }], stageEnemies(1));
  const b = simulate([{ id: 'rowan' }], stageEnemies(1));
  assert.deepEqual(a, b, 'бой детерминирован');
  s.frags.selene = 30;
  actions.heroAssemble(s, { id: 'selene' });
  assert.ok(s.roster.selene);
});

import { troopCost, batchMax } from '../shared/troops.js';

test('войска: обучение в лагерях, ступени, ускорение, госпиталь', () => {
  const s = newPlayerState('orcs', 77);
  assert.equal(s.troops.infantry1, 60);
  assert.throws(() => actions.trainTroops(s, { kind: 'infantry', tier: 1, n: 10 }), /Казармы/);
  const bar = s.buildings.find((b) => b.type === 'barracks');
  bar.captured = false; bar.level = 2;
  assert.throws(() => actions.trainTroops(s, { kind: 'infantry', tier: 3, n: 10 }), /Ступень 3/);
  assert.throws(() => actions.trainTroops(s, { kind: 'infantry', tier: 2, n: batchMax(2) + 1 }), /не больше/);
  const food = s.res.food;
  actions.trainTroops(s, { kind: 'infantry', tier: 2, n: 20 });
  assert.equal(food - s.res.food, troopCost('infantry', 2, 20).food);
  assert.throws(() => actions.trainTroops(s, { kind: 'infantry', tier: 1, n: 5 }), /уже обучает/);
  tick(s, Date.now() + 3600e3);
  assert.equal(s.troops.infantry2, 20);
  // госпиталь
  s.wounded = { infantry1: 10 };
  assert.throws(() => actions.healAll(s), /Госпиталь/);
  s.buildings.push({ id: 999, type: 'hospital', level: 1, x: 14, y: 26 });
  actions.healAll(s);
  tick(s, Date.now() + 3600e3);
  assert.equal(s.troops.infantry1, 70);
});

import { processMarches } from '../server/march.js';
import { campAt as siteAt } from '../shared/worldgen.js';

test('походы: атака лагеря, сбор ресурсов, отзыв', () => {
  const s = newPlayerState('humans', 31);
  const p = { id: -1, wx: 600, wy: 340, castle_name: 'Тест', state: s };
  for (const [k, v] of Object.entries({ _pid: -1, _x: 600, _y: 340, _name: 'Тест' })) Object.defineProperty(s, k, { value: v, enumerable: false });
  // ближайшие разбойники и ресурс
  let bandits = null, res = null;
  for (let r = 1; r < 120 && !(bandits && res); r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
    const c = siteAt(600 + dx, 340 + dy);
    if (!c) continue;
    if (!bandits && c.type === 'bandits' && c.level <= 2) bandits = c;
    if (!res && c.type === 'wood') res = c;
  }
  assert.ok(bandits && res, 'рядом есть цели');
  const heroes = s.formation.filter(Boolean);
  assert.throws(() => actions.march(s, { kind: 'attack', siteId: bandits.id, heroes: [], troops: { infantry1: 10 } }), /герой/);
  actions.march(s, { kind: 'attack', siteId: bandits.id, heroes, troops: { infantry1: 60, archer1: 20 } });
  assert.equal(s.troops.infantry1, 0);
  assert.throws(() => actions.march(s, { kind: 'gather', siteId: res.id, heroes: heroes.slice(0, 1), troops: { archer1: 10 } }), /другом походе/);
  actions.march(s, { kind: 'gather', siteId: res.id, heroes: [], troops: { archer1: 20 } });
  assert.throws(() => actions.march(s, { kind: 'gather', siteId: res.id, heroes: [], troops: { archer1: 1 } }), /Все отряды|Столько/);
  console.log('разбойники ур.', bandits.level);
  const wood = s.res.wood;
  // через сутки всё разрешилось и вернулось
  processMarches(p, Date.now() + 864e5);
  processMarches(p, Date.now() + 2 * 864e5);
  assert.equal(s.marches.length, 0);
  assert.ok(s.res.wood > wood, 'дерево собрано');
  assert.ok(s.troops.infantry1 + (s.wounded.infantry1 || 0) > 0);
  assert.equal(s.battleLogs.length, 1);
  assert.equal(s.battleLogs[0].win, true, 'стартовый отряд бьёт разбойников 1 ур.');
});

import { allyOp, allyView, allyGift } from '../server/alliance.js';
import { getPlayer as gp, savePlayer as sp } from '../server/db.js';

test('союзы: создание, вступление, помощь, подарки', () => {
  const mk = (name) => {
    const st = newPlayerState('humans', name.length * 7);
    const now = Date.now();
    const r = db.prepare(`INSERT INTO players (username, pass, castle_name, race, realm, plot, wx, wy, state, created_at, seen_at) VALUES (?, 'x', ?, 'humans', 1, 0, 10, 10, ?, ?, ?)`)
      .run(name + now, name, JSON.stringify(st), now, now);
    return gp(Number(r.lastInsertRowid));
  };
  const io = { notify() {}, allyBroadcast() {} };
  const a = mk('Глава'), b = mk('Воин');
  assert.throws(() => allyOp(a, { op: 'create', name: 'Ко', tag: 'K', crest: 'lion' }, io), /3 до 20/);
  a.state.res.gems = 500;
  const uid = Math.random().toString(36).slice(2, 5).toUpperCase();
  allyOp(a, { op: 'create', name: 'Стражи ' + uid + Date.now() % 100000, tag: 'T' + uid, crest: 'lion', open: true }, io);
  sp(a);
  assert.equal(a.state.res.gems, 300);
  allyOp(b, { op: 'join', id: a.ally }, io);
  assert.equal(b.ally, a.ally);
  // помощь в стройке
  const farm = a.state.buildings.find((x) => x.type === 'farm');
  farm.up = { to: 2, end: Date.now() + 3600e3, total: 3600 };
  sp(a);
  allyOp(a, { op: 'askHelp', id: farm.id }, io);
  const r = allyOp(b, { op: 'helpAll' }, io);
  assert.equal(r.helped, 1);
  const a2 = gp(a.id);
  assert.ok(a2.state.buildings.find((x) => x.id === farm.id).up.end < farm.up.end - 30e3);
  // подарок союзу
  allyGift(b.id, 'Воин', 6);
  const v = allyView(b, () => false);
  assert.equal(v.members.length, 2);
  assert.equal(v.gifts.length, 1);
  const g = allyOp(b, { op: 'claimGifts' }, io);
  assert.ok(g.got.gems > 0);
  allyOp(b, { op: 'leave' }, io);
  assert.equal(b.ally, null);
});

import { applyPurchase } from '../server/meta.js';
import { grant } from '../server/game.js';
import { mods } from '../shared/meta.js';

test('этап 6: академия, VIP, пропуск, покупки', () => {
  const s = newPlayerState('elves', 55);
  assert.throws(() => actions.research(s, { id: 'agri' }), /Академию/);
  s.buildings.push({ id: 8000, type: 'academy', level: 2, x: 14, y: 26, up: null });
  assert.throws(() => actions.research(s, { id: 'mining' }), /Академии 3/);
  actions.research(s, { id: 'agri' });
  assert.throws(() => actions.research(s, { id: 'logging' }), /уже исследует/);
  tick(s, Date.now() + 864e5);
  assert.equal(s.tech.agri, 1);
  assert.ok(mods(s).food > 0.05);
  // VIP: ежедневный сундук раз в день
  const g0 = s.res.gems;
  actions.vipDaily(s);
  assert.ok(s.res.gems > g0);
  assert.throws(() => actions.vipDaily(s), /уже получен/);
  // пропуск: опыт за действия, награда ступени 1
  s.pass.xp = 150;
  actions.passClaim(s, { level: 1 });
  assert.throws(() => actions.passClaim(s, { level: 1 }), /Уже/);
  assert.throws(() => actions.passClaim(s, { level: 1, gold: true }), /золотой/);
  applyPurchase(s, 'pass', grant);
  actions.passClaim(s, { level: 1, gold: true });
  // набор с воинами и строителем
  applyPurchase(s, 'army', grant);
  assert.equal(s.troops.infantry2, 300);
  applyPurchase(s, 'builder', grant);
  assert.equal(s.builders, 3);
  assert.throws(() => applyPurchase(s, 'builder', grant), /уже куплен/);
  assert.ok(s.vip.pts > 1000);
});

import { processRallies, fortOwner, fortBonus } from '../server/forts.js';
import { campAt as at2 } from '../shared/worldgen.js';

test('битва союза за крепость: сбор, удар, владение', () => {
  let fort = null;
  for (let y = 0; y < 680 && !fort; y += 3) for (let x = 0; x < 680 && !fort; x++) { const c = at2(x, y); if (c?.fort && c.level === 1 && !fortOwner(c.id)) fort = c; }
  assert.ok(fort, 'есть свободная крепость');
  const mk = (name) => {
    const st = newPlayerState('dwarves', name.length * 13);
    st.troops = { infantry4: 600, archer4: 400 };
    const now = Date.now();
    const r = db.prepare(`INSERT INTO players (username, pass, castle_name, race, realm, plot, wx, wy, state, created_at, seen_at) VALUES (?, 'x', ?, 'dwarves', 1, 0, ?, ?, ?, ?, ?)`)
      .run(name + now + Math.random(), name, fort.x + 5, fort.y + 5, JSON.stringify(st), now, now);
    return gp(Number(r.lastInsertRowid));
  };
  const io = { notify() {}, allyBroadcast() {} };
  const a = mk('Воевода'), b = mk('Дружинник');
  a.state.res.gems = 500;
  const uid = Math.random().toString(36).slice(2, 5).toUpperCase();
  allyOp(a, { op: 'create', name: 'Молот ' + uid, tag: 'M' + uid, crest: 'hammer' }, io);
  sp(a);
  allyOp(b, { op: 'join', id: a.ally }, io);
  assert.throws(() => actions.march(a.state, { kind: 'attack', siteId: fort.id, heroes: a.state.formation.filter(Boolean), troops: { infantry4: 10 } }), /сбором союза/);
  allyOp(a, { op: 'rally', siteId: fort.id, heroes: a.state.formation.filter(Boolean), troops: { infantry4: 300, archer4: 150 } }, io);
  sp(a);
  allyOp(b, { op: 'rallyJoin', id: allyView(b, () => false).rallies[0].id, troops: { infantry4: 300, archer4: 150 } }, io);
  sp(b);
  assert.equal(gp(b.id).state.troops.infantry4, 300);
  processRallies(a.ally, Date.now() + 3600e3);
  processRallies(a.ally, Date.now() + 7200e3);
  assert.equal(fortOwner(fort.id)?.ally, a.ally, 'крепость взята');
  assert.ok(fortBonus(a.ally) > 0);
  assert.ok(gp(b.id).state.troops.infantry4 > 500, 'войска вернулись');
});

import { eventBoard } from '../server/events.js';
import { week, themeOf, MILESTONES } from '../shared/events.js';

test('событие недели: очки, рубеж, таблица, награда за место', () => {
  const st = newPlayerState('orcs', 91);
  const now = Date.now();
  const r = db.prepare(`INSERT INTO players (username, pass, castle_name, race, realm, plot, wx, wy, state, created_at, seen_at) VALUES (?, 'x', 'Событие', 'orcs', 1, 0, 1, 1, ?, ?, ?)`)
    .run('ev' + now + Math.random(), JSON.stringify(st), now, now);
  const p = gp(Number(r.lastInsertRowid));
  const s = p.state;
  const th = themeOf(week());
  const key = Object.keys(th.pts)[0];
  s.event.pts = 0;
  // набираем очки ключевым действием темы
  while (s.event.pts < MILESTONES[0].pts) { s.daily ||= { c: {} }; actionsBump(s, key); }
  actions.eventClaim(s, { i: 0 });
  assert.throws(() => actions.eventClaim(s, { i: 0 }), /Уже/);
  sp(p);
  const b = eventBoard(p.id);
  assert.ok(b.me && b.me.rank >= 1);
  // неделя закончилась → награда за место
  s.event.week -= 1;
  migrateEventT(s, Date.now());
  assert.ok(s.event.prev && !s.event.prev.rewarded);
  const g = actions.eventRankClaim(s);
  assert.ok(g.got.gems > 0);
  assert.throws(() => actions.eventRankClaim(s), /нет/);
});
import { bumpDaily as actionsBump } from '../server/game.js';
import { migrateEvent as migrateEventT } from '../server/events.js';
