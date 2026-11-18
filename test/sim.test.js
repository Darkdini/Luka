import test from 'node:test';
import assert from 'node:assert/strict';
import { runBattle, createBattle, step } from '../shared/sim.js';
import { npcBase } from '../server/world.js';
import { newPlayerState, tick, actions, lootableBase } from '../server/game.js';

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

test('экономика: стройка, сбор, обучение', () => {
  const s = newPlayerState('humans', 42);
  tick(s, Date.now() + 3600e3);
  const gm = s.buildings.find((b) => b.type === 'goldmine');
  assert.ok(gm.store > 300);
  actions.collect(s, {});
  assert.ok(s.res.gold > 3000);
  actions.train(s, { k: 'swordsman', n: 2 });
  assert.equal(s.training.length, 2);
  actions.place(s, { type: 'builderhut', x: 30, y: 33 });
  assert.equal(s.res.gems, 50);
  assert.ok(lootableBase(s).some((b) => b.loot.gold > 0));
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
  actions.collect(s, {});                      // стартовые рудники наполовину полны
  assert.ok(s.stats.collectedGold > 0);
  const gems = s.res.gems;
  const r = actions.claimQuest(s);
  assert.equal(s.tutorial, 1);
  assert.equal(s.res.gems - gems, TUTORIAL[0].reward.gems);
  assert.ok(r.got.gold > 0);
  const d = actions.daily(s);                  // календарь: день 1
  assert.equal(d.day, 1);
  assert.throws(() => actions.daily(s), /уже получена/);
  assert.ok(s.daily.c.gold > 0, 'сбор засчитан в задание дня');
});
