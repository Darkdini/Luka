// Изометрическая сцена: камера, ввод, отрисовка базы, юнитов и эффектов.
import { BUILDINGS, GRID, spriteFor } from '/shared/config.js';
import { img } from './assets.js';
import { PLOTS, PLOT, PLAZA, RING_UNLOCK, ringOpen, cityRect, isRoad, inPlot, maxRing, PANO, CASTLE_POS } from '/shared/city.js';

export const TW = 64, TH = 32;
const isoFlat = (gx, gy) => ({ x: (gx - gy) * TW / 2, y: (gx + gy) * TH / 2 });

// --- Панорама города: каждая ячейка сетки «переносится» на свою нарисованную
// площадку. Внутри ячейки геометрия та же, поэтому весь код отрисовки работает как есть.
export const PANO_K = 1.2;                       // масштаб картинки: площадка ≈ 3 клетки
const PANO_ANCH = [];
for (const p of PLOTS) {
  const pad = PANO.pads[p.i];
  if (pad) PANO_ANCH.push({ x0: p.x, y0: p.y, size: PLOT, cx: pad[0] * PANO_K, cy: pad[1] * PANO_K });
}
PANO_ANCH.push({ x0: CASTLE_POS.x, y0: CASTLE_POS.y, size: CASTLE_POS.size, cx: PANO.plaza[0] * PANO_K, cy: PANO.plaza[1] * PANO_K });
let PANO_ON = false;
export function setPanorama(on) { PANO_ON = on; }
export const panoramaOn = () => PANO_ON;
function anchorOf(gx, gy) {
  for (const a of PANO_ANCH) if (gx >= a.x0 - 0.6 && gx <= a.x0 + a.size + 0.6 && gy >= a.y0 - 0.6 && gy <= a.y0 + a.size + 0.6) return a;
  return null;
}
export const iso = (gx, gy) => {
  if (!PANO_ON) return isoFlat(gx, gy);
  const a = anchorOf(gx, gy);
  if (!a) return { x: -99999, y: -99999 };
  const o = isoFlat(gx - a.x0 - a.size / 2, gy - a.y0 - a.size / 2);
  return { x: a.cx + o.x, y: a.cy + o.y };
};

// Положение нарисованного плато на фоне base.jpg (в пикселях исходника)
const BG = { cx: 793, cy: 527, halfW: 700 };

export class Scene {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 0, y: GRID * TH / 2, z: 0.6 };
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
    if (PANO_ON) {
      // картинка всегда заполняет экран по высоте (на широком экране — по ширине)
      this.minZ = Math.max(this.h / (PANO.h * PANO_K), this.w / (PANO.w * PANO_K));
      this.maxZ = this.minZ * 2;
      this.cam.z = Math.max(this.minZ, Math.min(this.maxZ, this.cam.z));
      return;
    }
    // в портрете база шире экрана: разрешаем отдалить до ~3/4 ширины базы
    const minZ = this.portrait ? this.w / (GRID * TW * 0.72) : Math.max(this.w / (GRID * TW * 1.15), this.h / (GRID * TH * 1.35));
    this.minZ = Math.max(0.18, minZ);
    this.maxZ = 1.6;
    this.cam.z = Math.max(this.minZ, Math.min(this.maxZ, this.cam.z));
  }

  // Удобный стартовый масштаб: на телефоне база видна целиком по ширине ядра
  defaultZoom(kind) {
    if (PANO_ON && kind !== 'battle') return this.minZ * (this.portrait ? 1.1 : 1);
    if (this.portrait) return Math.max(this.minZ, Math.min(0.7, this.w / (TW * (kind === 'battle' ? 20 : 16))));
    return Math.max(this.minZ, kind === 'battle' ? 0.85 : 0.62);
  }

  toScreen(wx, wy) { return { x: (wx - this.cam.x) * this.cam.z + this.w / 2, y: (wy - this.cam.y) * this.cam.z + this.h / 2 }; }
  toWorld(sx, sy) { return { x: (sx - this.w / 2) / this.cam.z + this.cam.x, y: (sy - this.h / 2) / this.cam.z + this.cam.y }; }
  toGrid(sx, sy) {
    const w = this.toWorld(sx, sy);
    if (PANO_ON) {
      // ближайшая площадка, в ромб которой попали
      for (const a of PANO_ANCH) {
        const dx = (w.x - a.cx) / (a.size * TW / 2), dy = (w.y - a.cy) / (a.size * TH / 2);
        if (Math.abs(dx) + Math.abs(dy) <= 1.15) {
          const ox = w.x - a.cx, oy = w.y - a.cy;
          return { gx: a.x0 + a.size / 2 + oy / TH + ox / TW, gy: a.y0 + a.size / 2 + oy / TH - ox / TW };
        }
      }
      return { gx: -100, gy: -100 };
    }
    return { gx: w.y / TH + w.x / TW, gy: w.y / TH - w.x / TW };
  }

  clampCam() {
    if (PANO_ON) {
      const W = PANO.w * PANO_K, H = PANO.h * PANO_K;
      const vw = this.w / 2 / this.cam.z, vh = this.h / 2 / this.cam.z;
      this.cam.x = vw * 2 >= W ? W / 2 : Math.max(vw, Math.min(W - vw, this.cam.x));
      this.cam.y = vh * 2 >= H ? H / 2 : Math.max(vh, Math.min(H - vh, this.cam.y));
      return;
    }
    const halfW = GRID * TW / 2 * 1.05, top = -GRID * TH * 0.1, bot = GRID * TH * 1.1;
    const vw = this.w / 2 / this.cam.z, vh = this.h / 2 / this.cam.z;
    this.cam.x = Math.max(-halfW + vw, Math.min(halfW - vw, this.cam.x));
    if (vw > halfW) this.cam.x = 0;
    this.cam.y = Math.max(top + vh, Math.min(bot - vh, this.cam.y));
    if (vh * 2 > bot - top) this.cam.y = (top + bot) / 2;
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
    g.addColorStop(0, '#8fc3ea'); g.addColorStop(0.5, '#4f8f3a'); g.addColorStop(1, '#2a76b8');
    c.fillStyle = g;
    c.fillRect(0, 0, this.cv.width, this.cv.height);
    c.setTransform(this.dpr * this.cam.z, 0, 0, this.dpr * this.cam.z,
      this.dpr * (this.w / 2 - this.cam.x * this.cam.z + sx), this.dpr * (this.h / 2 - this.cam.y * this.cam.z + sy));
    c.imageSmoothingQuality = 'high';
  }

  drawBackground() {
    if (PANO_ON) {
      const t = img(PANO.src);
      if (t) this.ctx.drawImage(t, 0, 0, PANO.w * PANO_K, PANO.h * PANO_K);
      return;
    }
    const c = this.ctx, bg = img('bg/base');
    const half = GRID * TW / 2;
    if (bg) {
      const k = half / BG.halfW;
      c.drawImage(bg, -BG.cx * k, GRID * TH / 2 - BG.cy * k, bg.width * k, bg.height * k);
    }
  }

  // --- Город: дороги, ячейки, площадь (рисуется один раз в кэш) ---------------
  // occupied — Set "x,y" ячеек, где стоят здания (под ними — каменный фундамент)
  drawCity(castleLevel, own = true, occupied = new Set()) {
    const key = castleLevel + (own ? 'o' : 'e') + [...occupied].sort().join('|');
    if (!this.cityCache || this.cityCache.key !== key) this.cityCache = { key, cv: this.renderCity(castleLevel, own, occupied) };
    const cc = this.cityCache.cv;
    this.ctx.drawImage(cc.cv, cc.left, cc.top);
  }

  renderCity(cl, own, occupied) {
    const left = -GRID * TW / 2 - TW, top = -TH * 2;
    const cv = document.createElement('canvas');
    cv.width = GRID * TW + TW * 2; cv.height = GRID * TH + TH * 4;
    const c = cv.getContext('2d');
    c.translate(-left, -top);
    const R = cityRect(cl);
    const rnd = (x, y, k) => { let h = (x * 374761393 + y * 668265263 + k * 97) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    const tile = (x, y, fill) => {
      const a = iso(x, y), b = iso(x + 1, y), d = iso(x + 1, y + 1), e = iso(x, y + 1);
      c.beginPath(); c.moveTo(a.x, a.y - 0.5); c.lineTo(b.x + 0.7, b.y); c.lineTo(d.x, d.y + 0.5); c.lineTo(e.x - 0.7, e.y); c.closePath();
      c.fillStyle = fill; c.fill();
    };
    // мощёные дороги
    for (let y = R.y0; y <= R.y1; y++) for (let x = R.x0; x <= R.x1; x++) {
      if (!isRoad(x, y, cl)) continue;
      const v = rnd(x, y, 1);
      tile(x, y, v > 0.5 ? '#b9aa90' : '#b2a389');
      const o = iso(x + 0.5, y + 0.5);
      for (let k = 0; k < 6; k++) {
        const dx = (rnd(x, y, k + 2) - 0.5) * TW * 0.62, dy = (rnd(x, y, k + 9) - 0.5) * TH * 0.62;
        if (Math.abs(dx) / (TW / 2) + Math.abs(dy) / (TH / 2) > 0.8) continue;
        c.fillStyle = rnd(x, y, k + 20) > 0.5 ? '#9a8b72' : '#c8bba2';
        c.beginPath(); c.ellipse(o.x + dx, o.y + dy, 6 + rnd(x, y, k) * 4, 3 + rnd(x, y, k + 5) * 2, 0, 0, Math.PI * 2); c.fill();
      }
    }
    // бордюр по краю дорог
    c.strokeStyle = 'rgba(80,66,48,0.55)'; c.lineWidth = 2;
    for (let y = R.y0 - 1; y <= R.y1 + 1; y++) for (let x = R.x0 - 1; x <= R.x1 + 1; x++) {
      if (!isRoad(x, y, cl)) continue;
      const edge = (nx, ny, p1, p2) => { if (!isRoad(nx, ny, cl)) { c.beginPath(); c.moveTo(p1.x, p1.y); c.lineTo(p2.x, p2.y); c.stroke(); } };
      edge(x - 1, y, iso(x, y), iso(x, y + 1)); edge(x + 1, y, iso(x + 1, y), iso(x + 1, y + 1));
      edge(x, y - 1, iso(x, y), iso(x + 1, y)); edge(x, y + 1, iso(x, y + 1), iso(x + 1, y + 1));
    }
    // площадь Цитадели
    const plaza = img('city/plaza') || img('pads/pad_l');
    const drawPad = (im, x, y, size, k = 1.1) => {
      if (!im) return;
      const t = iso(x, y), w = size * TW * k, h = im.height * w / im.width;
      c.drawImage(im, t.x - w / 2, t.y + size * TH / 2 - h * 0.43, w, h);
    };
    drawPad(plaza, PLAZA.x, PLAZA.y, PLAZA.size, 1.12);
    // ячейки: открытые — каменные площадки, закрытые — заросшие с замком
    const pad = img('city/plot') || img('pads/pad_m');
    const locked = img('city/plot_locked');
    for (const p of PLOTS) {
      if (ringOpen(p.ring, cl)) {
        if (occupied.has(p.x + ',' + p.y)) drawPad(pad, p.x, p.y, PLOT, 1.1);
        else {
          // свободная ячейка — едва заметная утоптанная площадка, без столбиков
          const a = iso(p.x, p.y), b2 = iso(p.x + PLOT, p.y), d = iso(p.x + PLOT, p.y + PLOT), e = iso(p.x, p.y + PLOT);
          c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b2.x, b2.y); c.lineTo(d.x, d.y); c.lineTo(e.x, e.y); c.closePath();
          c.fillStyle = 'rgba(150,125,80,0.22)'; c.fill();
          c.setLineDash([7, 6]); c.strokeStyle = 'rgba(255,245,210,0.45)'; c.lineWidth = 2; c.stroke(); c.setLineDash([]);
        }
      }
      else if (own && p.ring === maxRing(cl) + 1) {
        // замок только на следующем кольце — понятно, что откроется дальше
        if (locked) { c.globalAlpha = 0.55; drawPad(locked, p.x, p.y, PLOT, 1.0); c.globalAlpha = 1; }
      }
    }
    return { cv, left, top };
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

  // Каменный фундамент под зданием
  drawPad(b, size) {
    if (size < 2 || b.type.startsWith('trap')) return;
    const name = b.type === 'castle' ? (b.level >= 5 ? 'pads/pad_marble' : 'pads/pad_l')
      : b.type === 'armycamp' || b.type === 'builderhut' ? 'pads/pad_wood'
        : size >= 4 ? 'pads/pad_l' : size === 3 ? 'pads/pad_m' : 'pads/pad_s';
    const im = img(name);
    if (!im) { this.diamond(b.x, b.y, size, size, 'rgba(120,110,95,0.85)'); return; }
    const top = iso(b.x, b.y), w = size * TW * 1.12, h = im.height * w / im.width;
    this.ctx.drawImage(im, top.x - w / 2, top.y + size * TH / 2 - h * 0.43, w, h);
  }

  spriteFor(b, walls) {
    const def = BUILDINGS[b.type];
    if (def.cat === 'wall') {
      const has = (x, y) => walls?.has(x * 100 + y);
      const ax = has(b.x - 1, b.y) || has(b.x + 1, b.y);
      const ay = has(b.x, b.y - 1) || has(b.x, b.y + 1);
      const tier = spriteFor(b.type, Math.max(1, b.level));
      return { name: `buildings/${tier}${ax && ay ? 'c' : ''}`, flip: ax && !ay };
    }
    return { name: `buildings/${spriteFor(b.type, Math.max(1, b.level))}`, flip: false };
  }

  drawBuilding(b, o = {}) {
    const c = this.ctx;
    const def = BUILDINGS[b.type];
    const size = def.size;
    const bot = iso(b.x + size, b.y + size);
    const midX = bot.x, botY = bot.y;
    if (o.dead) {
      const rn = size >= 4 ? 'rubble_3' : size >= 3 ? 'rubble_2' : 'rubble_1';
      const im = img(`buildings/${def.cat === 'wall' ? 'rubble_1' : rn}`);
      if (im) {
        const w = size * TW * (def.cat === 'wall' ? 0.8 : 0.95), h = im.height * w / im.width;
        c.drawImage(im, midX - w / 2, botY - h + size * TH * 0.08, w, h);
      }
      return;
    }
    if (!o.noPad) this.drawPad(b, size);
    const sp = this.spriteFor(b, o.walls);
    const im = img(sp.name);
    const scale = (def.cat === 'wall' ? 1.25 : def.cat === 'trap' ? 0.9 : 1) * (o.scale || 1);
    c.save();
    if (o.alpha != null) c.globalAlpha = o.alpha;
    if (o.flash) c.filter = 'brightness(1.6)';
    if (o.frozen) c.filter = 'hue-rotate(160deg) saturate(1.6) brightness(1.15)';
    if (im) {
      const w = size * TW * scale, h = im.height * w / im.width;
      const y = botY - h + size * TH * (def.cat === 'wall' ? 0.22 : 0.1) + (o.lift || 0);
      if (sp.flip) { c.translate(midX, 0); c.scale(-1, 1); c.drawImage(im, -w / 2, y, w, h); }
      else c.drawImage(im, midX - w / 2, y, w, h);
    } else {
      this.diamond(b.x, b.y, size, size, '#8a6d4a', '#3a2a18');
    }
    c.restore();
    if (o.tint) { c.save(); c.globalAlpha = 0.35; this.diamond(b.x, b.y, size, size, o.tint); c.restore(); }
  }

  drawDecor(d) {
    const im = img(`decor/${d.kind}`);
    if (!im) return;
    const bot = iso(d.x + 1, d.y + 1);
    const big = d.kind === 'oak' || d.kind === 'pine';
    const w = TW * (big ? 1.6 : 1.2), h = im.height * w / im.width;
    this.ctx.drawImage(im, bot.x - w / 2, bot.y - h + TH * 0.25, w, h);
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
