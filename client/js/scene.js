// Изометрическая сцена: камера, ввод, отрисовка города, юнитов и эффектов.
import { BUILDINGS, GRID } from '/shared/config.js';
import { img, CITY, cityImg } from './assets.js';

export const TW = 64, TH = 32;
export const iso = (gx, gy) => ({ x: (gx - gy) * TW / 2, y: (gx + gy) * TH / 2 });
// совместимость со старым кодом (панорама убрана)
export const setPanorama = () => {};
export const panoramaOn = () => false;
// старые виды декора (базы NPC) → природа нового набора
const DECOR_MAP = { oak: 'oak', pine: 'pine', bush: 'bush', rock_big: 'rock', rocks: 'rock2', stump: 'logs', mushrooms: 'flowers', log: 'logs', flowers: 'flowers' };
const RUINS = new Set(['rubble', 'ruin_hut', 'logs', 'fence', 'stones', 'deadtree']);

export class Scene {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: GRID * TH / 2, z: 0.6 };
    this.bounds = null; // { x0, y0, x1, y1 } в клетках — куда можно смотреть
    this.handlers = {};
    this.particles = [];
    this.pointers = new Map();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.w = this.cv.clientWidth; this.h = this.cv.clientHeight;
    this.cv.width = Math.round(this.w * dpr); this.cv.height = Math.round(this.h * dpr);
    this.fitZoom();
  }

  get portrait() { return this.h > this.w; }

  fitZoom() {
    // в портрете на экран помещается ~13 клеток в ширину, отдалить можно до ~26
    const minZ = this.portrait ? this.w / (TW * 26) : Math.max(this.w / (GRID * TW * 0.9), this.h / (GRID * TH * 1.1));
    this.minZ = Math.max(0.16, minZ);
    this.maxZ = 1.5;
    this.cam.z = Math.max(this.minZ, Math.min(this.maxZ, this.cam.z));
  }

  defaultZoom(kind) {
    if (this.portrait) return Math.max(this.minZ, Math.min(1, this.w / (TW * (kind === 'battle' ? 15 : 9))));
    return Math.max(this.minZ, kind === 'battle' ? 0.85 : 0.75);
  }

  toScreen(wx, wy) { return { x: (wx - this.cam.x) * this.cam.z + this.w / 2, y: (wy - this.cam.y) * this.cam.z + this.h / 2 }; }
  toWorld(sx, sy) { return { x: (sx - this.w / 2) / this.cam.z + this.cam.x, y: (sy - this.h / 2) / this.cam.z + this.cam.y }; }
  toGrid(sx, sy) {
    const w = this.toWorld(sx, sy);
    return { gx: w.y / TH + w.x / TW, gy: w.y / TH - w.x / TW };
  }

  clampCam() {
    const B = this.bounds || { x0: 0, y0: 0, x1: GRID, y1: GRID };
    // ромб области в мировых координатах
    const left = iso(B.x0, B.y1).x, right = iso(B.x1, B.y0).x, top = iso(B.x0, B.y0).y - TH * 4, bot = iso(B.x1, B.y1).y + TH;
    const vw = this.w / 2 / this.cam.z, vh = this.h / 2 / this.cam.z;
    const cx = (left + right) / 2, cy = (top + bot) / 2;
    this.cam.x = vw * 2 >= right - left ? cx : Math.max(left + vw, Math.min(right - vw, this.cam.x));
    this.cam.y = vh * 2 >= bot - top ? cy : Math.max(top + vh, Math.min(bot - vh, this.cam.y));
  }

  zoomAt(sx, sy, factor) {
    const before = this.toWorld(sx, sy);
    this.cam.z = Math.max(this.minZ, Math.min(this.maxZ, this.cam.z * factor));
    const after = this.toWorld(sx, sy);
    this.cam.x += before.x - after.x; this.cam.y += before.y - after.y;
    this.clampCam();
  }

  // --- Ввод -----------------------------------------------------------------
  on(name, fn) { this.handlers[name] = fn; }
  bindInput() {
    const cv = this.cv;
    let start = null, mode = null, pinch = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      const p = pos(e);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.cam.z };
        mode = 'pinch';
        this.handlers.hold?.(null);
        return;
      }
      start = { ...p, cam: { ...this.cam }, t: performance.now() };
      mode = null;
      if (this.handlers.down?.(p, this.toGrid(p.x, p.y))) mode = 'drag';
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
      this.handlers.hover?.(p, this.toGrid(p.x, p.y));
      if (mode === 'pinch' && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const target = Math.max(this.minZ, Math.min(this.maxZ, pinch.z * d / pinch.d));
        this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, target / this.cam.z);
        return;
      }
      if (!start) return;
      if (mode === 'drag') { this.handlers.drag?.(p, this.toGrid(p.x, p.y)); return; }
      if (mode === 'pan' || Math.hypot(p.x - start.x, p.y - start.y) > 8) {
        if (mode !== 'pan') this.handlers.hold?.(null);
        mode = 'pan';
        this.cam.x = start.cam.x - (p.x - start.x) / this.cam.z;
        this.cam.y = start.cam.y - (p.y - start.y) / this.cam.z;
        this.clampCam();
      }
    });
    const up = (e) => {
      const p = pos(e);
      this.pointers.delete(e.pointerId);
      if (mode === 'pinch') { if (this.pointers.size === 0) mode = null; start = null; return; }
      if (!start) return;
      if (mode === 'drag') this.handlers.drop?.(p, this.toGrid(p.x, p.y));
      else if (mode !== 'pan') this.handlers.tap?.(p, this.toGrid(p.x, p.y));
      this.handlers.up?.();
      start = null; mode = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      this.zoomAt(p.x, p.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
  }

  // --- Отрисовка ----------------------------------------------------------------
  shake(power) { this.shakeP = Math.max(this.shakeP || 0, power); }

  begin() {
    const c = this.ctx;
    let sx = 0, sy = 0;
    if (this.shakeP > 0.2) {
      sx = (Math.random() - 0.5) * this.shakeP; sy = (Math.random() - 0.5) * this.shakeP;
      this.shakeP *= 0.86;
    } else this.shakeP = 0;
    c.setTransform(1, 0, 0, 1, 0, 0);
    const g = c.createLinearGradient(0, 0, 0, this.cv.height);
    g.addColorStop(0, '#3e5426'); g.addColorStop(1, '#2c3f1c');
    c.fillStyle = g;
    c.fillRect(0, 0, this.cv.width, this.cv.height);
    c.setTransform(this.dpr * this.cam.z, 0, 0, this.dpr * this.cam.z,
      this.dpr * (this.w / 2 - this.cam.x * this.cam.z + sx), this.dpr * (this.h / 2 - this.cam.y * this.cam.z + sy));
    c.imageSmoothingQuality = 'high';
  }

  // Земля: бесшовная трава, спроецированная в изометрию (1 текстура = 4×4 клетки)
  drawBackground() {
    const c = this.ctx, tex = cityImg('tex_grass');
    if (!tex) { c.fillStyle = '#5d7d34'; c.fillRect(-1e4, -1e4, 2e4, 2e4); return; }
    if (!this.grassPat) this.grassPat = c.createPattern(tex, 'repeat');
    c.save();
    c.transform(TW / 2, TH / 2, -TW / 2, TH / 2, 0, 0);
    c.scale(4 / tex.width, 4 / tex.height);
    c.fillStyle = this.grassPat;
    const k = tex.width / 4;
    c.fillRect(-24 * k, -24 * k, 92 * k, 92 * k);
    c.restore();
  }

  // Спрайт города на плите: footprint sx×sy клеток от (gx, gy). Возвращает прямоугольник в мире
  drawSlab(name, gx, gy, sx, sy, o = {}) {
    const m = CITY[name], im = cityImg(name);
    if (!m || !im || m.sa == null) return null;
    const c = this.ctx, ctr = iso(gx + sx / 2, gy + sy / 2);
    const k = ((sx + sy) * TW / 2) / (m.sa + m.sb) * (o.scale || 1);
    const r = { x: ctr.x - m.ax * k, y: ctr.y - m.ay * k + (o.lift || 0), w: m.w * k, h: m.h * k };
    if (o.alpha != null || o.filter) {
      c.save();
      if (o.alpha != null) c.globalAlpha = o.alpha;
      if (o.filter) c.filter = o.filter;
      c.drawImage(im, r.x, r.y, r.w, r.h);
      c.restore();
    } else c.drawImage(im, r.x, r.y, r.w, r.h);
    return r;
  }

  // Предмет «стоит ногами» в точке мира; width — ширина в мировых пикселях
  drawFoot(name, wx, wy, width, o = {}) {
    const m = CITY[name], im = cityImg(name);
    if (!m || !im) return null;
    const k = width / m.w;
    const r = { x: wx - m.ax * k, y: wy - m.ay * k, w: m.w * k, h: m.h * k };
    if (o.alpha != null) { this.ctx.save(); this.ctx.globalAlpha = o.alpha; this.ctx.drawImage(im, r.x, r.y, r.w, r.h); this.ctx.restore(); }
    else this.ctx.drawImage(im, r.x, r.y, r.w, r.h);
    return r;
  }

  // Спрайт здания по состоянию: захвачено / стройка / обычное
  spriteName(b, race) {
    if (b.captured) return 'captured';
    if (b.type === 'castle') return `castle_${race || this.race || 'humans'}_${b.level >= 6 ? 2 : 1}`;
    if (b.level === 0 && b.up) return 'scaffold';
    return CITY[b.type] ? b.type : 'scaffold';
  }

  // Подсветка ячеек/дорог в режиме выбора места
  highlight(cells, color, t) {
    const c = this.ctx;
    c.save();
    c.globalAlpha = 0.35 + 0.2 * Math.sin(t * 6);
    for (const [x, y, size] of cells) this.diamond(x, y, size, size, color, '#fff');
    c.restore();
  }

  drawGrid(alpha = 0.12, from = 0, to = GRID) {
    const c = this.ctx;
    c.save();
    c.strokeStyle = `rgba(255,255,255,${alpha})`;
    c.lineWidth = 1 / this.cam.z;
    c.beginPath();
    for (let i = from; i <= to; i++) {
      let a = iso(i, from), b = iso(i, to); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y);
      a = iso(from, i); b = iso(to, i); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y);
    }
    c.stroke();
    c.restore();
  }

  diamond(gx, gy, sw, sh, fill, stroke) {
    const c = this.ctx;
    const a = iso(gx, gy), b = iso(gx + sw, gy), d = iso(gx + sw, gy + sh), e = iso(gx, gy + sh);
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(d.x, d.y); c.lineTo(e.x, e.y); c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = 2 / this.cam.z; c.stroke(); }
  }

  drawBuilding(b, o = {}) {
    const def = BUILDINGS[b.type];
    const size = def.size;
    if (def.cat === 'wall') return this.drawWallTile(b, o);
    if (o.dead) return this.drawSlab('rubble', b.x + 0.2, b.y + 0.2, size - 0.4, size - 0.4);
    const name = this.spriteName(b, o.race);
    // отвоёванное, но ещё не починенное здание — серое
    const ruined = b.level === 0 && !b.up && !b.captured;
    let filter = ruined ? 'grayscale(0.85) brightness(0.8)' : null;
    if (o.flash) filter = 'brightness(1.5)';
    if (o.frozen) filter = 'hue-rotate(160deg) saturate(1.6) brightness(1.15)';
    const r = this.drawSlab(name, b.x, b.y, size, size, { alpha: o.alpha, filter, lift: o.lift, scale: o.scale });
    if (!r) this.diamond(b.x, b.y, size, size, '#8a6d4a', '#3a2a18');
    if (o.tint) { this.ctx.save(); this.ctx.globalAlpha = 0.35; this.diamond(b.x, b.y, size, size, o.tint); this.ctx.restore(); }
    return r;
  }

  // Стена набега: сегмент на каждой третьей клетке, ориентация — по соседям
  drawWallTile(b, o = {}) {
    if (o.dead) return null;
    const w = o.walls;
    const has = (x, y) => w?.has(x * 100 + y);
    const f = o.flash ? 'brightness(1.5)' : null;
    if (has(b.x - 1, b.y) || has(b.x + 1, b.y)) return b.x % 3 ? null : this.drawSlab('wall_l', b.x, b.y, 3, 1, { filter: f });
    return b.y % 3 ? null : this.drawSlab('wall_r', b.x, b.y, 1, 3, { filter: f });
  }

  drawDecor(d) {
    if (RUINS.has(d.kind)) return this.drawSlab(d.kind, d.x, d.y, 2, 2);
    const name = DECOR_MAP[d.kind];
    if (!name) return null;
    const p = iso(d.x + 0.5, d.y + 0.5);
    const big = name === 'oak' || name === 'pine';
    return this.drawFoot(name, p.x, p.y + TH * 0.4, TW * (big ? 1.6 : 1.1));
  }

  // Полоса над объектом: прогресс/здоровье
  bar(wx, wy, w, frac, color, back = 'rgba(0,0,0,0.6)') {
    const c = this.ctx, z = this.cam.z;
    const W = w / z, H = 7 / z;
    c.fillStyle = back;
    c.fillRect(wx - W / 2 - 1 / z, wy - 1 / z, W + 2 / z, H + 2 / z);
    c.fillStyle = color;
    c.fillRect(wx - W / 2, wy, W * Math.max(0, Math.min(1, frac)), H);
  }

  label(text, wx, wy, { size = 13, color = '#fff', bg = 'rgba(20,24,40,0.75)', icon } = {}) {
    const c = this.ctx, z = this.cam.z;
    c.save();
    c.font = `700 ${size / z}px Rubik, sans-serif`;
    const tw = c.measureText(text).width + (icon ? (size + 4) / z : 0);
    const pad = 6 / z, h = (size + 8) / z;
    c.fillStyle = bg;
    roundRect(c, wx - tw / 2 - pad, wy - h, tw + pad * 2, h, 6 / z);
    c.fill();
    let x = wx - tw / 2;
    if (icon) { const im = img(icon); if (im) c.drawImage(im, x, wy - h + 4 / z, size / z, size / z); x += (size + 4) / z; }
    c.fillStyle = color;
    c.textBaseline = 'middle';
    c.fillText(text, x, wy - h / 2);
    c.restore();
  }

  // --- Частицы ------------------------------------------------------------------
  emit(wx, wy, n, kind) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random();
      const p = { x: wx, y: wy, vx: Math.cos(a) * s * 60, vy: Math.sin(a) * s * 30 - 30, life: 0.6 + Math.random() * 0.6, t: 0, kind, size: 4 + Math.random() * 6 };
      if (kind === 'smoke') { p.vy = -25 - Math.random() * 25; p.vx *= 0.3; p.size = 10 + Math.random() * 14; p.life = 1.2 + Math.random(); }
      if (kind === 'spark') { p.vx *= 2.5; p.vy = p.vy * 2.5 - 40; p.size = 2 + Math.random() * 3; }
      if (kind === 'coin') { p.vy = -120 - Math.random() * 60; p.vx *= 1.2; p.life = 0.9; p.size = 14; }
      if (kind === 'heal') { p.vy = -40; p.vx *= 0.4; p.life = 1; p.size = 6; }
      if (kind === 'confetti') { p.vx *= 3; p.vy = -160 - Math.random() * 140; p.life = 1.6 + Math.random() * 0.6; p.size = 4 + Math.random() * 3; p.col = ['#ffd84a', '#ff5a5a', '#5ad1ff', '#7fe03c', '#c08bff'][i % 5]; p.rot = Math.random() * 6; }
      this.particles.push(p);
    }
  }

  fxSprite(name, wx, wy, w, life = 0.8, additive = true) {
    this.particles.push({ kind: 'sprite', name, x: wx, y: wy, w, t: 0, life, additive, vx: 0, vy: 0 });
  }

  drawParticles(dt) {
    const c = this.ctx;
    for (const p of this.particles) {
      p.t += dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.kind === 'dust' || p.kind === 'spark' || p.kind === 'coin') p.vy += 160 * dt;
      if (p.kind === 'confetti') { p.vy += 140 * dt; p.vx *= 0.985; p.rot += dt * 8; }
      const k = 1 - p.t / p.life;
      if (k <= 0) continue;
      c.save();
      if (p.kind === 'sprite') {
        const im = img(p.name);
        if (im) {
          if (p.additive) c.globalCompositeOperation = 'lighter';
          c.globalAlpha = Math.min(1, k * 2);
          const s = 0.8 + 0.4 * (1 - k);
          const w = p.w * s, h = im.height * w / im.width;
          c.drawImage(im, p.x - w / 2, p.y - h * 0.75, w, h);
        }
      } else if (p.kind === 'confetti') {
        c.globalAlpha = Math.min(1, k * 2);
        c.fillStyle = p.col;
        c.translate(p.x, p.y); c.rotate(p.rot);
        c.fillRect(-p.size / 2, -p.size, p.size, p.size * 2 * Math.abs(Math.cos(p.rot)) + 1);
      } else if (p.kind === 'coin') {
        const im = img('ui/icon_gold');
        c.globalAlpha = k;
        if (im) c.drawImage(im, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else {
        c.globalAlpha = k * (p.kind === 'smoke' ? 0.45 : 0.9);
        c.fillStyle = p.kind === 'smoke' ? '#555' : p.kind === 'spark' ? '#ffcc44' : p.kind === 'heal' ? '#8f6' : p.kind === 'ice' ? '#bdf' : '#b9a27c';
        c.beginPath();
        c.arc(p.x, p.y, p.size * (p.kind === 'smoke' ? 1 + (1 - k) : k), 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }
    this.particles = this.particles.filter((p) => p.t < p.life);
  }

  end() {}
}

export function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// Порядок отрисовки по глубине (сумма координат нижней точки)
export const depthOf = (gx, gy) => gx + gy;
