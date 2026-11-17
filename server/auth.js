import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { secret } from './db.js';

const SECRET = secret();
const TTL = 30 * 24 * 3600 * 1000;

export const hashPassword = (p) => bcrypt.hashSync(p, 10);
export const checkPassword = (p, h) => bcrypt.compareSync(p, h);

const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');

export function makeToken(id) {
  const body = `${id}.${Date.now() + TTL}`;
  return `${body}.${sign(body)}`;
}

export function readToken(tok) {
  if (typeof tok !== 'string') return null;
  const parts = tok.split('.');
  if (parts.length !== 3) return null;
  const body = `${parts[0]}.${parts[1]}`;
  const expected = sign(body);
  if (expected.length !== parts[2].length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) return null;
  if (Date.now() > Number(parts[1])) return null;
  return Number(parts[0]);
}

// Простейший ограничитель частоты по ключу (IP) — защита от перебора паролей.
const hits = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length <= max;
}
