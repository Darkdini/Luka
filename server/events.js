// Рейтинговое событие недели: очки, рубежи, награды по месту.
import { db } from './db.js';
import { week, weekEnd, themeOf, MILESTONES, rankReward } from '../shared/events.js';
import { HERO_DEFS } from '../shared/heroes.js';

export class EventError extends Error {}
const fail = (m) => { throw new EventError(m); };

db.exec('CREATE TABLE IF NOT EXISTS event_scores (week INTEGER, player INTEGER, pts INTEGER, PRIMARY KEY (week, player))');
db.exec('CREATE INDEX IF NOT EXISTS event_scores_w ON event_scores(week, pts DESC)');

export function migrateEvent(s, now = Date.now()) {
  const w = week(now);
  if (!s.event) s.event = { week: w, pts: 0, claimed: [] };
  if (s.event.week !== w) {
    const old = s.event;
    s.event = { week: w, pts: 0, claimed: [], prev: old.pts > 0 ? { week: old.week, pts: Math.floor(old.pts), rewarded: false } : (old.prev && !old.prev.rewarded ? old.prev : null) };
  }
}
export function eventPts(s, key, n = 1) {
  migrateEvent(s);
  const k = themeOf(s.event.week).pts[key];
  if (k) s.event.pts += k * n;
}
const rankOf = (w, pts) => db.prepare('SELECT COUNT(*) AS n FROM event_scores WHERE week = ? AND pts > ?').get(w, pts).n + 1;

function grantFrag(s, r, grant) {
  const out = { ...r }; delete out.frag; delete out.fragN;
  const got = grant(s, out);
  if (r.frag) {
    const pool = HERO_DEFS.filter((h) => h.rarity === r.frag);
    const h = pool.find((x) => x.race === s.race && !s.roster[x.id]) || pool.find((x) => x.race === s.race) || pool[0];
    s.frags[h.id] = (s.frags[h.id] || 0) + r.fragN;
    got.frag = { hero: h.id, n: r.fragN };
  }
  return got;
}

export function eventActions({ grant }) {
  return {
    eventClaim(s, { i }) {
      migrateEvent(s);
      const m = MILESTONES[i | 0] || fail('Нет такого рубежа');
      if (s.event.pts < m.pts) fail('Рубеж ещё не достигнут');
      if (s.event.claimed.includes(i | 0)) fail('Уже получено');
      s.event.claimed.push(i | 0);
      return { got: grant(s, m.reward) };
    },
    eventRankClaim(s) {
      migrateEvent(s);
      const p = s.event.prev;
      if (!p || p.rewarded) fail('Наград за прошлую неделю нет');
      const rank = rankOf(p.week, p.pts);
      p.rewarded = true;
      p.rank = rank;
      return { rank, got: grantFrag(s, rankReward(rank), grant) };
    },
  };
}

export function eventBoard(pid) {
  const w = week();
  const top = db.prepare(`SELECT e.player, e.pts, p.castle_name AS name, p.race, a.tag FROM event_scores e JOIN players p ON p.id = e.player
    LEFT JOIN alliances a ON a.id = p.ally WHERE e.week = ? ORDER BY e.pts DESC, e.player ASC LIMIT 50`).all(w);
  const mine = db.prepare('SELECT pts FROM event_scores WHERE week = ? AND player = ?').get(w, pid);
  const total = db.prepare('SELECT COUNT(*) AS n FROM event_scores WHERE week = ?').get(w).n;
  return { week: w, theme: themeOf(w), ends: weekEnd(w), top, me: mine ? { pts: mine.pts, rank: rankOf(w, mine.pts) } : null, total };
}

export function eventView(s) {
  migrateEvent(s);
  const e = s.event;
  return { event: { week: e.week, pts: Math.floor(e.pts), claimed: e.claimed, theme: themeOf(e.week).id, ends: weekEnd(e.week), prev: e.prev || null } };
}
