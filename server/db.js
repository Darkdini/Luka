// Хранилище на встроенном SQLite (node:sqlite). Для продакшена схема легко
// переносится на PostgreSQL: состояние игрока хранится как JSON-документ.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'game.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    pass TEXT NOT NULL,
    castle_name TEXT NOT NULL,
    race TEXT NOT NULL,
    realm INTEGER NOT NULL,
    plot INTEGER NOT NULL,
    trophies INTEGER NOT NULL DEFAULT 0,
    castle_level INTEGER NOT NULL DEFAULT 1,
    state TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    seen_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS players_trophies ON players(trophies DESC);
  CREATE TABLE IF NOT EXISTS battles (
    id TEXT PRIMARY KEY,
    attacker INTEGER NOT NULL,
    defender INTEGER,
    npc TEXT,
    result TEXT,
    log TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player INTEGER, name TEXT, text TEXT, ts INTEGER
  );
  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player INTEGER, pack TEXT, gems INTEGER, price INTEGER, status TEXT, ts INTEGER
  );
`);

// --- Миграции ------------------------------------------------------------------
const cols = new Set(db.prepare('PRAGMA table_info(players)').all().map((c) => c.name));
for (const [name, def] of [['power', 'INTEGER NOT NULL DEFAULT 0'], ['kills', 'INTEGER NOT NULL DEFAULT 0'], ['wx', 'INTEGER'], ['wy', 'INTEGER'], ['motto', "TEXT NOT NULL DEFAULT ''"], ['avatar', "TEXT NOT NULL DEFAULT 'knight'"], ['title', "TEXT NOT NULL DEFAULT ''"]]) {
  if (!cols.has(name)) db.exec(`ALTER TABLE players ADD COLUMN ${name} ${def}`);
}
db.exec(`
  DROP INDEX IF EXISTS players_plot;
  CREATE INDEX IF NOT EXISTS players_pos ON players(wx, wy);
  CREATE INDEX IF NOT EXISTS players_seen ON players(seen_at DESC);
  CREATE INDEX IF NOT EXISTS players_power ON players(power DESC);
  CREATE INDEX IF NOT EXISTS players_kills ON players(kills DESC);
`);

export function secret() {
  if (process.env.SECRET) return process.env.SECRET;
  const row = db.prepare('SELECT v FROM meta WHERE k = ?').get('secret');
  if (row) return row.v;
  const s = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('secret', s);
  return s;
}

const q = {
  byId: db.prepare('SELECT * FROM players WHERE id = ?'),
  byName: db.prepare('SELECT * FROM players WHERE username = ?'),
  save: db.prepare('UPDATE players SET state = ?, trophies = ?, castle_level = ?, seen_at = ?, power = ?, kills = ? WHERE id = ?'),
};

export function getPlayer(id) {
  const row = q.byId.get(id);
  if (!row) return null;
  row.state = JSON.parse(row.state);
  return row;
}
export function getPlayerByName(name) {
  const row = q.byName.get(name);
  if (!row) return null;
  row.state = JSON.parse(row.state);
  return row;
}
let evUpsert = null;
export function savePlayer(p, touch = true) {
  const castle = p.state.buildings.find((b) => b.type === 'castle');
  const st = p.state.stats || {};
  q.save.run(JSON.stringify(p.state), p.state.trophies, castle ? castle.level : 1, touch ? Date.now() : p.seen_at,
    Math.round(p.state.power || 0), (st.npcWins || 0) + (st.wins || 0) + (st.liberated || 0), p.id);
  // очки события недели — в таблицу лидеров
  const ev = p.state.event;
  if (ev && ev.pts >= 1) {
    evUpsert ||= db.prepare('INSERT INTO event_scores (week, player, pts) VALUES (?, ?, ?) ON CONFLICT(week, player) DO UPDATE SET pts = excluded.pts');
    evUpsert.run(ev.week, p.id, Math.floor(ev.pts));
  }
}
