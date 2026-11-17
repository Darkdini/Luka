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
