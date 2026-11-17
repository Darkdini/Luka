// Нагрузочный тест: заселяет мир N ботами (только для разработки!).
//   node --no-warnings tools/seed_bots.js 5000
import crypto from 'node:crypto';
import { db } from '../server/db.js';
import { findSpot, npcBase } from '../server/world.js';
import { newPlayerState, rng } from '../server/game.js';
import { RACES } from '../shared/config.js';

const N = Number(process.argv[2] || 1000);
const r = rng(Date.now() >>> 0);
const A = ['Север', 'Камен', 'Золот', 'Сереб', 'Чёрн', 'Бел', 'Ясн', 'Гроз', 'Тих', 'Огнен', 'Ледян', 'Вольн', 'Дубов', 'Орлин', 'Волч'];
const B = ['ный Оплот', 'ная Твердыня', 'ный Бастион', 'ная Цитадель', 'ный Форт', 'ная Застава', 'ный Кремль', 'ные Врата', 'ный Шпиль', 'ная Гавань'];
const N1 = ['Ар', 'Бор', 'Вел', 'Гор', 'Дар', 'Ель', 'Зор', 'Иль', 'Кай', 'Лют', 'Мир', 'Рад', 'Свят', 'Тор', 'Ульф'];
const N2 = ['ан', 'ислав', 'омир', 'ена', 'ина', 'гард', 'вин', 'мар', 'дан', 'рик'];
const races = Object.keys(RACES);
const pass = crypto.randomBytes(16).toString('hex'); // войти за бота нельзя
const ins = db.prepare(`INSERT INTO players (username, pass, castle_name, race, realm, plot, wx, wy, trophies, castle_level, state, created_at, seen_at, avatar)
  VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?)`);
const avatars = ['knight', 'huntress', 'runesmith', 'sorceress', 'swordsman', 'crossbowman', 'griffin', 'battlemage'];
const t0 = Date.now();
db.exec('BEGIN');
for (let i = 0; i < N; i++) {
  const lvl = 1 + Math.floor(Math.pow(r(), 1.6) * 9);
  const race = races[Math.floor(r() * races.length)];
  const st = newPlayerState(race, i * 31 + 7);
  st.buildings = npcBase(lvl, i * 977 + 13).map((b) => ({ id: b.id, type: b.type, level: b.level, x: b.x, y: b.y, up: null, ...(b.type === 'goldmine' || b.type === 'farm' ? { store: 0, last: Date.now() } : {}) }));
  st.nextId = st.buildings.length + 100;
  st.shieldUntil = 0;
  st.trophies = Math.round(lvl * 180 + r() * 400);
  st.res.gold = Math.round(2000 * lvl * lvl * r()); st.res.food = Math.round(2000 * lvl * lvl * r());
  const spot = findSpot(i * 104729 + 1);
  const name = `${N1[i % 15]}${N2[Math.floor(r() * 10)]}${i}`;
  const castle = st.buildings.find((b) => b.type === 'castle').level;
  ins.run(name, pass, A[Math.floor(r() * A.length)] + B[Math.floor(r() * B.length)], race, spot.x, spot.y, st.trophies, castle,
    JSON.stringify(st), Date.now() - Math.floor(r() * 30 * 86400e3), Date.now() - Math.floor(r() * 5 * 86400e3), avatars[Math.floor(r() * avatars.length)]);
  if ((i + 1) % 1000 === 0) console.log(`${i + 1} ботов…`);
}
db.exec('COMMIT');
console.log(`Готово: ${N} ботов за ${((Date.now() - t0) / 1000).toFixed(1)} с`);
