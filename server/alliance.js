// Союзы: создание, вступление (открытые и по заявке), ранги, чат, помощь в стройке, подарки.
import { db, getPlayer, savePlayer } from './db.js';
import { GameError, tick, grant } from './game.js';
import { hasProfanity } from '../shared/names.js';
import { ALLY_CRESTS, ALLY_MAX, ALLY_COST, RANKS, HELP_MAX, helpCut, GIFT_TTL } from '../shared/alliance.js';
import { castleLevelOf } from '../shared/config.js';

const fail = (m) => { throw new GameError(m); };

db.exec(`
  CREATE TABLE IF NOT EXISTS alliances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL COLLATE NOCASE,
    tag TEXT UNIQUE NOT NULL COLLATE NOCASE,
    crest TEXT NOT NULL, motto TEXT NOT NULL DEFAULT '', open INTEGER NOT NULL DEFAULT 1,
    leader INTEGER NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS ally_chat (id INTEGER PRIMARY KEY AUTOINCREMENT, ally INTEGER, player INTEGER, name TEXT, text TEXT, ts INTEGER);
  CREATE INDEX IF NOT EXISTS ally_chat_a ON ally_chat(ally, id);
  CREATE TABLE IF NOT EXISTS ally_req (ally INTEGER, player INTEGER, ts INTEGER, PRIMARY KEY (ally, player));
`);
{
  const cols = new Set(db.prepare('PRAGMA table_info(players)').all().map((c) => c.name));
  if (!cols.has('ally')) db.exec('ALTER TABLE players ADD COLUMN ally INTEGER');
  if (!cols.has('ally_rank')) db.exec('ALTER TABLE players ADD COLUMN ally_rank INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS players_ally ON players(ally)');
}

const q = {
  get: db.prepare('SELECT * FROM alliances WHERE id = ?'),
  members: db.prepare('SELECT id, username, castle_name, race, castle_level, trophies, ally_rank, seen_at, avatar FROM players WHERE ally = ? ORDER BY ally_rank DESC, castle_level DESC'),
  count: db.prepare('SELECT COUNT(*) AS n FROM players WHERE ally = ?'),
  setAlly: db.prepare('UPDATE players SET ally = ?, ally_rank = ? WHERE id = ?'),
  setRank: db.prepare('UPDATE players SET ally_rank = ? WHERE id = ?'),
  saveData: db.prepare('UPDATE alliances SET data = ? WHERE id = ?'),
};
const getAlly = (id) => { const a = id && q.get.get(id); if (a) a.data = JSON.parse(a.data || '{}'); return a || null; };
const saveData = (a) => q.saveData.run(JSON.stringify(a.data), a.id);
const myRank = (p) => (p.ally ? p.ally_rank : 0);

function checkName(name, tag) {
  name = String(name || '').replace(/\s+/g, ' ').trim();
  tag = String(tag || '').trim().toUpperCase();
  if (name.length < 3 || name.length > 20) fail('Название союза — от 3 до 20 символов');
  if (!/^[A-ZА-ЯЁ0-9]{2,4}$/i.test(tag)) fail('Тег — 2–4 буквы или цифры');
  if (hasProfanity(name) || hasProfanity(tag)) fail('Недопустимые слова в названии');
  return { name, tag };
}

// Краткий вид союза для списков
function brief(a, n) {
  const power = db.prepare('SELECT COALESCE(SUM(castle_level), 0) AS s FROM players WHERE ally = ?').get(a.id).s;
  return { id: a.id, name: a.name, tag: a.tag, crest: a.crest, motto: a.motto, open: !!a.open, members: n ?? q.count.get(a.id).n, power };
}

export function allyList(p, query) {
  const like = `%${String(query || '').trim().slice(0, 20)}%`;
  const rows = db.prepare(`SELECT a.*, (SELECT COUNT(*) FROM players WHERE ally = a.id) AS n FROM alliances a
    WHERE a.name LIKE ? OR a.tag LIKE ? ORDER BY n DESC LIMIT 30`).all(like, like);
  const reqs = new Set(db.prepare('SELECT ally FROM ally_req WHERE player = ?').all(p.id).map((r) => r.ally));
  return rows.map((a) => ({ ...brief(a, a.n), requested: reqs.has(a.id) }));
}

export function allyView(p, online) {
  const a = getAlly(p.ally);
  if (!a) return { ally: null, invites: [] };
  const now = Date.now();
  const members = q.members.all(a.id).map((m) => ({ id: m.id, name: m.castle_name, owner: m.username, race: m.race, level: m.castle_level, rank: m.ally_rank, online: online(m.id), seen: m.seen_at, avatar: m.avatar }));
  const s = p.state;
  const helps = (a.data.helps || []).filter((h) => h.player !== p.id && !h.helpers.includes(p.id) && h.n < h.max);
  const gifts = (a.data.gifts || []).filter((g) => g.ts + GIFT_TTL > now && !(s.allyGifts || []).includes(g.id));
  const chat = db.prepare('SELECT player, name, text, ts FROM ally_chat WHERE ally = ? ORDER BY id DESC LIMIT 50').all(a.id).reverse();
  const reqs = myRank(p) >= 3 ? db.prepare('SELECT r.player, r.ts, p.castle_name AS name, p.username AS owner, p.castle_level AS level, p.race FROM ally_req r JOIN players p ON p.id = r.player WHERE r.ally = ?').all(a.id) : [];
  return {
    ally: { ...brief(a, members.length), leader: a.leader, myRank: myRank(p), max: ALLY_MAX },
    members, helps, gifts, chat, requests: reqs,
    myHelps: (a.data.helps || []).filter((h) => h.player === p.id),
  };
}

function joinAlly(p, a) {
  if (q.count.get(a.id).n >= ALLY_MAX) fail('В союзе нет мест');
  q.setAlly.run(a.id, 1, p.id);
  p.ally = a.id; p.ally_rank = 1;
  db.prepare('DELETE FROM ally_req WHERE player = ?').run(p.id);
}

function leave(p) {
  const a = getAlly(p.ally) || fail('Вы не в союзе');
  const n = q.count.get(a.id).n;
  if (a.leader === p.id && n > 1) {
    // глава уходит — главой становится старший по рангу
    const next = q.members.all(a.id).find((m) => m.id !== p.id);
    db.prepare('UPDATE alliances SET leader = ? WHERE id = ?').run(next.id, a.id);
    q.setRank.run(4, next.id);
  }
  q.setAlly.run(null, 0, p.id);
  if (n <= 1) { db.prepare('DELETE FROM alliances WHERE id = ?').run(a.id); db.prepare('DELETE FROM ally_req WHERE ally = ?').run(a.id); }
  else { a.data.helps = (a.data.helps || []).filter((h) => h.player !== p.id); saveData(a); }
  p.ally = null; p.ally_rank = 0;
}

// --- Операции -------------------------------------------------------------------------
export function allyOp(p, body, { notify, allyBroadcast }) {
  const op = String(body.op || '');
  const s = p.state;
  const rank = myRank(p);
  const ally = () => getAlly(p.ally) || fail('Вы не в союзе');
  const target = () => { const t = getPlayer(Number(body.player)) || fail('Игрок не найден'); if (t.ally !== p.ally) fail('Игрок не в вашем союзе'); return t; };

  switch (op) {
    case 'create': {
      if (p.ally) fail('Сначала покиньте свой союз');
      const { name, tag } = checkName(body.name, body.tag);
      if (!ALLY_CRESTS.includes(body.crest)) fail('Выберите герб');
      if (db.prepare('SELECT 1 FROM alliances WHERE name = ? OR tag = ?').get(name, tag)) fail('Такое название или тег уже заняты');
      if (castleLevelOf(s) < 3) {
        if (s.res.gems < ALLY_COST) fail(`Нужно ${ALLY_COST} самоцветов (или Цитадель 3 ур. — бесплатно)`);
        s.res.gems -= ALLY_COST;
      }
      const motto = String(body.motto || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (hasProfanity(motto)) fail('Недопустимые слова в девизе');
      const r = db.prepare('INSERT INTO alliances (name, tag, crest, motto, open, leader, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(name, tag, body.crest, motto, body.open === false ? 0 : 1, p.id, Date.now());
      q.setAlly.run(Number(r.lastInsertRowid), 4, p.id);
      p.ally = Number(r.lastInsertRowid); p.ally_rank = 4;
      db.prepare('DELETE FROM ally_req WHERE player = ?').run(p.id);
      return;
    }
    case 'join': {
      if (p.ally) fail('Вы уже в союзе');
      const a = getAlly(Number(body.id)) || fail('Союз не найден');
      if (a.open) { joinAlly(p, a); allyBroadcast(a.id, { type: 'ally', what: 'join', name: p.castle_name }); return; }
      db.prepare('INSERT OR REPLACE INTO ally_req (ally, player, ts) VALUES (?, ?, ?)').run(a.id, p.id, Date.now());
      allyBroadcast(a.id, { type: 'ally', what: 'request', name: p.castle_name });
      return { requested: true };
    }
    case 'leave': leave(p); return;
    case 'accept': case 'decline': {
      if (rank < 3) fail('Только глава и офицеры принимают заявки');
      const pid = Number(body.player);
      const ok = db.prepare('SELECT 1 FROM ally_req WHERE ally = ? AND player = ?').get(p.ally, pid) || fail('Заявка не найдена');
      void ok;
      if (op === 'decline') { db.prepare('DELETE FROM ally_req WHERE ally = ? AND player = ?').run(p.ally, pid); return; }
      const t = getPlayer(pid) || fail('Игрок не найден');
      if (t.ally) { db.prepare('DELETE FROM ally_req WHERE player = ?').run(pid); fail('Игрок уже в другом союзе'); }
      joinAlly(t, ally());
      notify(pid, { type: 'ally', what: 'accepted' });
      return;
    }
    case 'kick': {
      const t = target();
      if (t.id === p.id || rank < 3 || t.ally_rank >= rank) fail('Недостаточно прав');
      q.setAlly.run(null, 0, t.id);
      notify(t.id, { type: 'ally', what: 'kicked' });
      return;
    }
    case 'promote': case 'demote': {
      if (rank < 4) fail('Ранги меняет только глава');
      const t = target();
      if (t.id === p.id) fail('Нельзя менять свой ранг');
      const to = Math.max(1, Math.min(3, t.ally_rank + (op === 'promote' ? 1 : -1)));
      q.setRank.run(to, t.id);
      return;
    }
    case 'transfer': {
      if (rank < 4) fail('Только глава');
      const t = target();
      db.prepare('UPDATE alliances SET leader = ? WHERE id = ?').run(t.id, p.ally);
      q.setRank.run(4, t.id); q.setRank.run(3, p.id); p.ally_rank = 3;
      return;
    }
    case 'settings': {
      if (rank < 4) fail('Только глава');
      const motto = String(body.motto ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (hasProfanity(motto)) fail('Недопустимые слова в девизе');
      db.prepare('UPDATE alliances SET motto = ?, open = ? WHERE id = ?').run(motto, body.open ? 1 : 0, p.ally);
      return;
    }
    case 'chat': {
      const a = ally();
      const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!text) return;
      const now = Date.now();
      db.prepare('INSERT INTO ally_chat (ally, player, name, text, ts) VALUES (?, ?, ?, ?, ?)').run(a.id, p.id, p.castle_name, text, now);
      allyBroadcast(a.id, { type: 'achat', player: p.id, name: p.castle_name, text, ts: now });
      return;
    }
    // Попросить союзников ускорить стройку
    case 'askHelp': {
      const a = ally();
      const b = s.buildings.find((v) => v.id === Number(body.id)) || fail('Здание не найдено');
      if (!b.up) fail('Здание не строится');
      a.data.helps ||= [];
      if (a.data.helps.some((h) => h.player === p.id && h.bId === b.id && h.to === b.up.to)) fail('Помощь уже запрошена');
      const max = Math.min(HELP_MAX, 5 + Math.floor(q.count.get(a.id).n / 4));
      a.data.helps.push({ id: `${Date.now().toString(36)}${p.id}`, player: p.id, name: p.castle_name, bId: b.id, type: b.type, to: b.up.to, n: 0, max, helpers: [] });
      a.data.helps = a.data.helps.slice(-200);
      saveData(a);
      allyBroadcast(a.id, { type: 'ally', what: 'help' });
      return;
    }
    // Помочь всем сразу
    case 'helpAll': {
      const a = ally();
      let done = 0;
      for (const h of a.data.helps || []) {
        if (h.player === p.id || h.helpers.includes(p.id) || h.n >= h.max) continue;
        const t = getPlayer(h.player);
        const b = t?.state.buildings.find((v) => v.id === h.bId);
        h.helpers.push(p.id);
        if (!b?.up || b.up.to !== h.to) { h.n = h.max; continue; }
        tick(t.state);
        b.up.end = Math.max(Date.now(), b.up.end - helpCut(b.up.total) * 1000);
        h.n++;
        savePlayer(t, false);
        done++;
      }
      a.data.helps = (a.data.helps || []).filter((h) => h.n < h.max);
      saveData(a);
      if (!done) fail('Сейчас некому помогать');
      // честь за помощь: немного золота (до 30 раз в день)
      const day = Math.floor(Date.now() / 864e5);
      if (s.helpDay !== day) { s.helpDay = day; s.helpN = 0; }
      const paid = Math.max(0, Math.min(done, 30 - s.helpN));
      s.helpN += paid;
      const got = paid ? grant(s, { gold: 50 * paid * castleLevelOf(s) }) : {};
      s.stats.allyHelps = (s.stats.allyHelps || 0) + done;
      return { helped: done, got };
    }
    case 'claimGifts': {
      const a = ally();
      const now = Date.now();
      s.allyGifts ||= [];
      const list = (a.data.gifts || []).filter((g) => g.ts + GIFT_TTL > now && !s.allyGifts.includes(g.id));
      if (!list.length) fail('Подарков нет');
      const total = {};
      for (const g of list) { for (const [k, v] of Object.entries(g.reward)) total[k] = (total[k] || 0) + v; s.allyGifts.push(g.id); }
      s.allyGifts = s.allyGifts.slice(-300);
      return { got: grant(s, total), n: list.length };
    }
    default: fail('Неизвестное действие');
  }
}

// Подарок всему союзу (победа участника над сильным врагом)
export function allyGift(pid, from, level) {
  const row = db.prepare('SELECT ally FROM players WHERE id = ?').get(pid);
  const a = getAlly(row?.ally);
  if (!a) return;
  a.data.gifts ||= [];
  const gold = level >= 8, silver = level >= 5;
  a.data.gifts.push({ id: `${Date.now().toString(36)}${pid}${Math.floor(Math.random() * 99)}`, ts: Date.now(), from, chest: gold ? 'ch_gold' : silver ? 'ch_silver' : 'ch_iron',
    reward: gold ? { gems: 10, wood: 2000, stone: 1500 } : silver ? { gems: 5, wood: 1000, stone: 600 } : { gems: 2, food: 600, wood: 400 } });
  a.data.gifts = a.data.gifts.filter((g) => g.ts + GIFT_TTL > Date.now()).slice(-80);
  saveData(a);
}

export const allyOf = (pid) => db.prepare('SELECT ally FROM players WHERE id = ?').get(pid)?.ally || null;
export const allyTags = () => new Map(db.prepare('SELECT id, tag FROM alliances').all().map((a) => [a.id, a.tag]));
export { RANKS };
