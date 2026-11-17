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
  CREATE UNIQUE INDEX IF NOT EXISTS players_plot ON players(realm, plot);
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
  save: db.prepare('UPDATE players SET state = ?, trophies = ?, castle_level = ?, seen_at = ? WHERE id = ?'),
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
export function savePlayer(p, touch = true) {
  const castle = p.state.buildings.find((b) => b.type === 'castle');
  q.save.run(JSON.stringify(p.state), p.state.trophies, castle ? castle.level : 1, touch ? Date.now() : p.seen_at, p.id);
}
