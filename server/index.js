import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import { WebSocketServer } from 'ws';
import { RACES, DONATE_PACKS } from '../shared/config.js';
import { db, getPlayer, getPlayerByName, savePlayer } from './db.js';
import { newCaptcha, checkCaptcha } from './captcha.js';
import { checkUsername, checkPassword as checkPasswordRule, checkCastleName, hasProfanity, censor } from '../shared/names.js';
import { hashPassword, checkPassword, makeToken, readToken, rateLimit } from './auth.js';
import { newPlayerState, tick, actions, view, GameError, wallBuildings } from './game.js';
import { processMarches, marchView, battleLog } from './march.js';
import { allyView, allyList, allyOp } from './alliance.js';
import { findSpot, placeUnplaced, region, findPlayer, startAttack, finishAttack, leaderboard, profile } from './world.js';
import { AVATARS, avatarUnlocked, titlesOf } from '../shared/achievements.js';

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DEV_PURCHASES = process.env.DEV_PURCHASES === '1';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use(express.static(path.join(ROOT, 'client')));

const wrap = (fn) => (req, res) => {
  try {
    const out = fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (e) {
    if (e instanceof GameError) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
};

function auth(req) {
  const h = req.headers.authorization || '';
  const id = readToken(h.replace(/^Bearer /, ''));
  if (!id) throw new GameError('Требуется вход');
  const p = getPlayer(id);
  if (!p) throw new GameError('Игрок не найден');
  tick(p.state);
  // служебные поля для походов (не сохраняются)
  for (const [k, v] of Object.entries({ _pid: p.id, _x: p.wx, _y: p.wy, _name: p.castle_name })) Object.defineProperty(p.state, k, { value: v, enumerable: false, configurable: true });
  processMarches(p);
  return p;
}
const viewMe = (p) => ({ ...view(p), ...marchView(p.state), allyId: p.ally || null, allyRank: p.ally_rank || 0 });

// --- Регистрация и вход ---------------------------------------------------------
app.get('/api/captcha', wrap((req) => {
  if (!rateLimit('cap:' + req.ip, 40, 600e3)) throw new GameError('Слишком много запросов, подождите');
  const c = newCaptcha();
  // только для автотестов: CAPTCHA_TEST=1 отдаёт ответ (в бою не включать!)
  return process.env.CAPTCHA_TEST === '1' ? c : { id: c.id, svg: c.svg };
}));

app.post('/api/register', wrap((req) => {
  const { username, password, castleName, race, captchaId, captcha, website } = req.body || {};
  if (website) throw new GameError('Ошибка регистрации'); // поле-ловушка: люди его не видят
  if (!checkCaptcha(captchaId, captcha)) throw new GameError('Неверный код с картинки — попробуйте ещё раз');
  if (!rateLimit('reg:' + req.ip, 5, 3600e3)) throw new GameError('Слишком много регистраций, попробуйте позже');
  const bad = checkUsername(username) || checkPasswordRule(password) || checkCastleName(castleName);
  if (bad) throw new GameError(bad);
  const cname = String(castleName).trim().replace(/\s+/g, ' ');
  if (!Object.keys(RACES).includes(race)) throw new GameError('Выберите фракцию');
  if (!req.body?.agree) throw new GameError('Нужно принять условия использования');
  if (getPlayerByName(username)) throw new GameError('Имя уже занято');
  const now = Date.now();
  const spot = findSpot(now);
  const state = newPlayerState(race, (now ^ username.length * 7919) >>> 0);
  const r = db.prepare(`INSERT INTO players (username, pass, castle_name, race, realm, plot, wx, wy, trophies, state, created_at, seen_at)
    VALUES (?, ?, ?, ?, 1, 0, ?, ?, 0, ?, ?, ?)`).run(username, hashPassword(password), cname, race, spot.x, spot.y, JSON.stringify(state), now, now);
  const id = Number(r.lastInsertRowid);
  return { token: makeToken(id) };
}));

app.post('/api/login', wrap((req) => {
  if (!rateLimit('login:' + req.ip, 20, 600e3)) throw new GameError('Слишком много попыток, подождите');
  const { username, password } = req.body || {};
  const p = typeof username === 'string' && getPlayerByName(username);
  if (!p || !checkPassword(String(password || ''), p.pass)) throw new GameError('Неверное имя или пароль');
  return { token: makeToken(p.id) };
}));

// --- Состояние и действия -------------------------------------------------------
app.get('/api/me', wrap((req) => {
  const p = auth(req);
  savePlayer(p);
  return viewMe(p);
}));

app.post('/api/action', wrap((req) => {
  const p = auth(req);
  const { action, ...args } = req.body || {};
  const fn = Object.hasOwn(actions, action) ? actions[action] : null;
  if (typeof fn !== 'function') throw new GameError('Неизвестное действие');
  const extra = fn(p.state, args) || {};
  tick(p.state);
  savePlayer(p);
  return { ...extra, me: viewMe(p) };
}));

// --- Мир, атаки, рейтинг ----------------------------------------------------------
app.get('/api/world/region', wrap((req) => {
  auth(req);
  const { x0, y0, x1, y1 } = req.query;
  return { players: region(+x0, +y0, +x1, +y1, isOnline) };
}));

app.get('/api/world/find', wrap((req) => { auth(req); return findPlayer(req.query.q); }));

// Осмотр чужого замка (без ловушек)
app.get('/api/player/:id', wrap((req) => {
  auth(req);
  const d = getPlayer(Number(req.params.id));
  if (!d) throw new GameError('Игрок не найден');
  tick(d.state);
  const cl = d.state.buildings.find((b) => b.type === 'castle')?.level || 1;
  return { id: d.id, name: d.castle_name, owner: d.username, race: d.race, trophies: d.trophies,
    buildings: [...d.state.buildings.filter((b) => !b.type.startsWith('trap_')), ...wallBuildings(d.state.wallLevel, cl)], decor: d.state.decor };
}));

app.get('/api/profile/:id', wrap((req) => { auth(req); return profile(req.params.id, isOnline); }));

app.post('/api/profile', wrap((req) => {
  const p = auth(req);
  const { motto, avatar, title } = req.body || {};
  if (motto != null) {
    p.motto = String(motto).replace(/\s+/g, ' ').trim().slice(0, 80);
    if (hasProfanity(p.motto)) throw new GameError('Девиз содержит недопустимые слова');
    if (p.motto) { p.state.stats.mottoSet = 1; savePlayer(p); }
  }
  if (avatar != null) {
    const av = AVATARS.find((a) => a.id === avatar);
    if (!av || !avatarUnlocked(p.state, av)) throw new GameError('Аватар ещё не открыт');
    p.avatar = av.id;
  }
  if (title != null) {
    if (title && !titlesOf(p.state).includes(title)) throw new GameError('Титул ещё не получен');
    p.title = title;
  }
  db.prepare('UPDATE players SET motto = ?, avatar = ?, title = ? WHERE id = ?').run(p.motto, p.avatar, p.title, p.id);
  return { me: viewMe(p) };
}));

app.post('/api/attack/start', wrap((req) => {
  const p = auth(req);
  const t = req.body?.target || {};
  const kind = ['player', 'camp', 'story'].includes(t.kind) ? t.kind : 'camp';
  const out = startAttack(p, { kind, id: t.id });
  savePlayer(p);
  return out;
}));

app.post('/api/attack/finish', wrap((req) => {
  const p = auth(req);
  const out = finishAttack(p, String(req.body?.battleId || ''), req.body?.log || [], notify);
  savePlayer(p);
  return { result: out, me: viewMe(p) };
}));

// Музыка: какие треки лежат в client/assets/audio (клиент не запрашивает отсутствующие)
app.get('/api/audio', (req, res) => {
  let list = [];
  try { list = fs.readdirSync(path.join(ROOT, 'client/assets/audio')).filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4)); } catch { /* нет папки */ }
  res.json(list);
});

app.get('/api/battle/:id', wrap((req) => {
  const p = auth(req);
  return battleLog(p.state, String(req.params.id)) || (() => { throw new GameError('Запись боя не найдена'); })();
}));

// --- Союзы -----------------------------------------------------------------------------
app.get('/api/ally', wrap((req) => allyView(auth(req), isOnline)));
app.get('/api/ally/list', wrap((req) => allyList(auth(req), req.query.q)));
app.post('/api/ally', wrap((req) => {
  const p = auth(req);
  const out = allyOp(p, req.body || {}, { notify, allyBroadcast }) || {};
  tick(p.state);
  savePlayer(p);
  const fresh = getPlayer(p.id);
  Object.assign(p, { ally: fresh.ally, ally_rank: fresh.ally_rank });
  return { ...out, me: viewMe(p), view: allyView(p, isOnline) };
}));

app.get('/api/top', wrap((req) => { const p = auth(req); return leaderboard(p.id); }));

// --- Донат (витрина; платёжный шлюз подключается позже) ---------------------------
app.get('/api/shop', wrap(() => ({ packs: DONATE_PACKS, paymentsEnabled: DEV_PURCHASES })));
app.post('/api/shop/buy', wrap((req) => {
  const p = auth(req);
  const pack = DONATE_PACKS.find((x) => x.id === req.body?.pack);
  if (!pack) throw new GameError('Пакет не найден');
  if (!DEV_PURCHASES) throw new GameError('Оплата скоро появится');
  const s = p.state;
  s.purchased = s.purchased || {};
  if (pack.id === 'starter' && s.purchased.starter) throw new GameError('Набор уже куплен');
  s.res.gems += pack.gems;
  if (pack.bonus) { s.res.gold += pack.bonus.gold || 0; s.res.food += pack.bonus.food || 0; }
  s.purchased[pack.id] = (s.purchased[pack.id] || 0) + 1;
  db.prepare('INSERT INTO purchases (player, pack, gems, price, status, ts) VALUES (?, ?, ?, ?, ?, ?)').run(p.id, pack.id, pack.gems, pack.price, 'dev', Date.now());
  tick(s);
  savePlayer(p);
  return { me: viewMe(p) };
}));

// --- WebSocket: чат и уведомления -------------------------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const sockets = new Map(); // playerId -> Set<ws>
const isOnline = (id) => sockets.has(id);

function notify(playerId, msg) {
  for (const ws of sockets.get(playerId) || []) ws.send(JSON.stringify(msg));
}
function allyBroadcast(allyId, msg) {
  const data = JSON.stringify(msg);
  for (const { id } of db.prepare('SELECT id FROM players WHERE ally = ?').all(allyId)) for (const ws of sockets.get(id) || []) ws.send(data);
}
function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const set of sockets.values()) for (const ws of set) ws.send(data);
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const id = readToken(url.searchParams.get('token'));
  const p = id && getPlayer(id);
  if (!p) return ws.close();
  if (!sockets.has(id)) sockets.set(id, new Set());
  sockets.get(id).add(ws);
  const history = db.prepare('SELECT name, text, ts, player FROM chat ORDER BY id DESC LIMIT 40').all().reverse();
  ws.send(JSON.stringify({ type: 'history', messages: history, online: sockets.size }));
  broadcast({ type: 'online', online: sockets.size });
  let last = 0;
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.type !== 'chat') return;
    const text = censor(String(m.text || '').trim().slice(0, 200));
    const now = Date.now();
    if (!text || now - last < 1000) return;
    last = now;
    db.prepare('INSERT INTO chat (player, name, text, ts) VALUES (?, ?, ?, ?)').run(id, p.username, text, now);
    broadcast({ type: 'chat', name: p.username, player: id, text, ts: now });
  });
  ws.on('close', () => {
    sockets.get(id)?.delete(ws);
    if (!sockets.get(id)?.size) sockets.delete(id);
    broadcast({ type: 'online', online: sockets.size });
  });
});

placeUnplaced();
server.listen(PORT, () => console.log(`Сервер запущен: http://localhost:${PORT}`));
