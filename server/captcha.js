// Собственная капча без сторонних сервисов: SVG с искажённым кодом,
// одноразовая, живёт 5 минут. Вместе с лимитом регистраций по IP и
// скрытым полем-ловушкой защищает от массовой регистрации ботами.
import crypto from 'node:crypto';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // без 0/O, 1/I/L
const TTL = 5 * 60 * 1000;
const store = new Map();

const rnd = (a, b) => a + crypto.randomInt(0, 1000000) / 1000000 * (b - a);
const pick = (s) => s[crypto.randomInt(0, s.length)];

export function newCaptcha() {
  const now = Date.now();
  for (const [k, v] of store) if (v.exp < now) store.delete(k);
  if (store.size > 50000) store.clear();
  const code = Array.from({ length: 5 }, () => pick(ALPHABET)).join('');
  const id = crypto.randomUUID();
  store.set(id, { code, exp: now + TTL });
  const W = 200, H = 64;
  const colors = ['#2b4176', '#8a2a14', '#1f5a0c', '#5b2aa8', '#7a4f10'];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
  svg += `<rect width="${W}" height="${H}" rx="10" fill="#f3e2b8"/>`;
  for (let i = 0; i < 6; i++) {
    svg += `<path d="M${rnd(0, 40)} ${rnd(5, H - 5)} C ${rnd(40, 90)} ${rnd(0, H)}, ${rnd(100, 150)} ${rnd(0, H)}, ${rnd(160, W)} ${rnd(5, H - 5)}" stroke="${pick(colors)}" stroke-opacity=".45" stroke-width="${rnd(1, 2.5).toFixed(1)}" fill="none"/>`;
  }
  for (let i = 0; i < 40; i++) svg += `<circle cx="${rnd(0, W).toFixed(1)}" cy="${rnd(0, H).toFixed(1)}" r="${rnd(0.6, 1.8).toFixed(1)}" fill="${pick(colors)}" fill-opacity=".5"/>`;
  [...code].forEach((ch, i) => {
    const x = 22 + i * 36 + rnd(-4, 4), y = 44 + rnd(-6, 6), rot = rnd(-28, 28), sk = rnd(-12, 12);
    svg += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="Georgia, serif" font-size="${rnd(30, 38).toFixed(0)}" font-weight="900" fill="${pick(colors)}" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}) skewX(${sk.toFixed(1)})">${ch}</text>`;
  });
  svg += `<path d="M0 ${rnd(20, 44)} Q ${W / 2} ${rnd(0, H)} ${W} ${rnd(20, 44)}" stroke="#3b2a14" stroke-opacity=".6" stroke-width="2" fill="none"/></svg>`;
  return { id, svg, code };
}

// Проверка одноразовая: после любой попытки код сгорает
export function checkCaptcha(id, answer) {
  const c = store.get(String(id || ''));
  store.delete(String(id || ''));
  if (!c || c.exp < Date.now()) return false;
  return String(answer || '').trim().toUpperCase().replace(/O/g, '0') === c.code.replace(/O/g, '0');
}
