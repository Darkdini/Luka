// Карта континента: процедурный рельеф (кэш по чанкам), замки игроков
// (подгружаются по видимой области), лагеря NPC, миникарта и поиск.
import { RACES, fmtTime } from '/shared/config.js';
import { WORLD, CENTER, BIOMES, terrainAt, campAt, hash01, CAMP_TYPES } from '/shared/worldgen.js';
import { leagueOf } from '/shared/achievements.js';
import { img } from './assets.js';

const TW = 56, TH = 28;
const CH = 16;                      // клеток в чанке
const REG = 48;                     // клеток в запросе игроков
const isoX = (x, y) => (x - y) * TW / 2;
const isoY = (x, y) => (x + y) * TH / 2;

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export class WorldMap {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('world');
    this.cv = document.getElementById('wcv');
    this.ctx = this.cv.getContext('2d');
    this.cam = { x: 0, y: isoY(CENTER, CENTER), z: 1.1 };
    this.chunks = new Map();
    this.camps = new Map();
    this.regions = new Map();    // key -> { t, players }
    this.loading = new Set();
    this.sel = null;
    this.t = 0;
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
    document.getElementById('w-home').onclick = () => this.flyTo(app.me.x, app.me.y);
    document.getElementById('w-search').onsubmit = (e) => { e.preventDefault(); this.search(); };
    document.getElementById('mini').addEventListener('pointerdown', (e) => this.miniClick(e));
  }

  get open() { return this.el.classList.contains('show'); }

  show(x, y) {
    this.el.classList.add('show');
    this.resize();
    const me = this.app.me;
    this.flyTo(x ?? me.x, y ?? me.y, true);
    this.drawMini();
    if (!this.raf) { let last = performance.now(); const loop = (t) => { this.raf = this.open ? requestAnimationFrame(loop) : null; this.frame(Math.min(0.1, (t - last) / 1000)); last = t; }; this.raf = requestAnimationFrame(loop); }
  }
  close() { this.el.classList.remove('show'); this.hidePanel(); }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.w = this.el.clientWidth; this.h = this.el.clientHeight;
    this.cv.width = this.w * dpr; this.cv.height = this.h * dpr;
  }

  flyTo(x, y, instant) {
    const tx = isoX(x, y), ty = isoY(x, y) + TH / 2;
    if (instant) { this.cam.x = tx; this.cam.y = ty; this.fly = null; return; }
    this.fly = { x: tx, y: ty };
  }

  toWorld(sx, sy) { return { x: (sx - this.w / 2) / this.cam.z + this.cam.x, y: (sy - this.h / 2) / this.cam.z + this.cam.y }; }
  cellAt(sx, sy) {
    const w = this.toWorld(sx, sy);
    return { x: Math.floor(w.y / TH + w.x / TW), y: Math.floor(w.y / TH - w.x / TW) };
  }

  bindInput() {
    const cv = this.cv, ptrs = new Map();
    let st = null, pinch = null, moved = false;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, pos(e));
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.cam.z }; return; }
      const p = pos(e);
      st = { ...p, cx: this.cam.x, cy: this.cam.y }; moved = false; this.fly = null;
    });
    cv.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId)) { this.hover = pos(e); return; }
      ptrs.set(e.pointerId, pos(e));
      if (pinch && ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d / this.cam.z);
        return;
      }
      if (!st) return;
      const p = pos(e);
      if (Math.hypot(p.x - st.x, p.y - st.y) > 6) moved = true;
      if (moved) { this.cam.x = st.cx - (p.x - st.x) / this.cam.z; this.cam.y = st.cy - (p.y - st.y) / this.cam.z; this.clamp(); }
    });
    const up = (e) => {
      ptrs.delete(e.pointerId);
      if (pinch) { if (!ptrs.size) pinch = null; st = null; return; }
      if (st && !moved) this.tap(pos(e));
      st = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const p = pos(e); this.zoomAt(p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
  }

  zoomAt(sx, sy, f) {
    const b = this.toWorld(sx, sy);
    this.cam.z = Math.max(0.3, Math.min(1.6, this.cam.z * f));
    const a = this.toWorld(sx, sy);
    this.cam.x += b.x - a.x; this.cam.y += b.y - a.y;
    this.clamp();
  }

  clamp() {
    const half = WORLD * TW / 2;
    this.cam.x = Math.max(-half, Math.min(half, this.cam.x));
    this.cam.y = Math.max(0, Math.min(WORLD * TH, this.cam.y));
  }

  // --- Рельеф чанками ------------------------------------------------------------
  chunk(cx, cy) {
    const key = cx * 1000 + cy;
    let c = this.chunks.get(key);
    if (c) { this.chunks.delete(key); this.chunks.set(key, c); return c; } // LRU
    c = this.renderChunk(cx, cy);
    this.chunks.set(key, c);
    if (this.chunks.size > 60) this.chunks.delete(this.chunks.keys().next().value);
    return c;
  }

  renderChunk(cx, cy) {
    const x0 = cx * CH, y0 = cy * CH;
    const left = isoX(x0, y0 + CH) - TW / 2, top = isoY(x0, y0) - TH * 3;
    const w = CH * TW + TW, h = CH * TH + TH * 5;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.translate(-left, -top);
    const grass = img('bg/grass');
    const pat = grass ? c.createPattern(grass, 'repeat') : null;
    const deco = [];
    for (let s = 0; s <= 2 * (CH - 1); s++) {
      for (let i = 0; i < CH; i++) {
        const j = s - i;
        if (j < 0 || j >= CH) continue;
        const x = x0 + i, y = y0 + j;
        if (x >= WORLD || y >= WORLD) continue;
        const t = terrainAt(x, y);
        const px = isoX(x, y), py = isoY(x, y);
        c.beginPath();
        c.moveTo(px, py - 0.6); c.lineTo(px + TW / 2 + 0.8, py + TH / 2); c.lineTo(px, py + TH + 0.6); c.lineTo(px - TW / 2 - 0.8, py + TH / 2); c.closePath();
        const land = !(t === 'water' || t === 'deep');
        if (land && pat && t !== 'snow' && t !== 'desert') { c.fillStyle = pat; c.fill(); c.globalAlpha = t === 'grass' ? 0.25 : 0.55; }
        c.fillStyle = shade(BIOMES[t].color, (hash01(x, y, 3) - 0.5) * 0.12);
        c.fill();
        c.globalAlpha = 1;
        if (t === 'water' || t === 'deep') {
          if (hash01(x, y, 8) > 0.7) { c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(px - 8, py + TH / 2); c.quadraticCurveTo(px, py + TH / 2 - 4, px + 8, py + TH / 2); c.stroke(); }
          // берег
          for (const [dx, dy] of [[-1, 0], [0, -1]]) {
            const n = terrainAt(x + dx, y + dy);
            if (n !== 'water' && n !== 'deep') {
              c.strokeStyle = 'rgba(240,225,170,0.85)'; c.lineWidth = 3; c.beginPath();
              if (dx) { c.moveTo(px - TW / 2, py + TH / 2); c.lineTo(px, py); } else { c.moveTo(px, py); c.lineTo(px + TW / 2, py + TH / 2); }
              c.stroke();
            }
          }
        }
        deco.push({ t, x, y, px, py });
      }
    }
    for (const d of deco) drawDeco(c, d);
    return { cv, left, top };
  }

  campsIn(cx, cy) {
    const key = cx * 1000 + cy;
    let list = this.camps.get(key);
    if (list) return list;
    list = [];
    for (let y = cy * CH; y < (cy + 1) * CH; y++) for (let x = cx * CH; x < (cx + 1) * CH; x++) { const c = campAt(x, y); if (c) list.push(c); }
    this.camps.set(key, list);
    return list;
  }

  // --- Игроки по областям --------------------------------------------------------
  ensureRegion(rx, ry) {
    const key = rx * 1000 + ry;
    const r = this.regions.get(key);
    if ((r && Date.now() - r.t < 60000) || this.loading.has(key)) return r?.players || [];
    this.loading.add(key);
    this.app.api.region(rx * REG, ry * REG, rx * REG + REG - 1, ry * REG + REG - 1)
      .then((d) => this.regions.set(key, { t: Date.now(), players: d.players }))
      .catch(() => {})
      .finally(() => this.loading.delete(key));
    return r?.players || [];
  }

  // --- Кадр ---------------------------------------------------------------------------
  frame(dt) {
    this.t += dt;
    if (this.fly) {
      const k = Math.min(1, dt * 6);
      this.cam.x += (this.fly.x - this.cam.x) * k; this.cam.y += (this.fly.y - this.cam.y) * k;
      if (Math.hypot(this.fly.x - this.cam.x, this.fly.y - this.cam.y) < 2) this.fly = null;
    }
    const c = this.ctx, z = this.cam.z;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#1b4f86';
    c.fillRect(0, 0, this.cv.width, this.cv.height);
    c.setTransform(this.dpr * z, 0, 0, this.dpr * z, this.dpr * (this.w / 2 - this.cam.x * z), this.dpr * (this.h / 2 - this.cam.y * z));
    // видимые клетки -> видимые чанки
    const corners = [[0, 0], [this.w, 0], [0, this.h], [this.w, this.h]].map(([sx, sy]) => this.cellAt(sx, sy));
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    const cx0 = Math.max(0, Math.floor((Math.min(...xs) - 2) / CH)), cx1 = Math.min(Math.ceil(WORLD / CH) - 1, Math.floor((Math.max(...xs) + 2) / CH));
    const cy0 = Math.max(0, Math.floor((Math.min(...ys) - 2) / CH)), cy1 = Math.min(Math.ceil(WORLD / CH) - 1, Math.floor((Math.max(...ys) + 2) / CH));
    const ents = [];
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const ch = this.chunk(cx, cy);
      c.drawImage(ch.cv, ch.left, ch.top);
      for (const cp of this.campsIn(cx, cy)) ents.push({ kind: 'camp', ...cp });
    }
    const rx0 = Math.floor(cx0 * CH / REG), rx1 = Math.floor((cx1 * CH + CH - 1) / REG);
    const ry0 = Math.floor(cy0 * CH / REG), ry1 = Math.floor((cy1 * CH + CH - 1) / REG);
    const taken = new Set();
    for (let ry = ry0; ry <= ry1; ry++) for (let rx = rx0; rx <= rx1; rx++) {
      for (const p of this.ensureRegion(rx, ry)) { ents.push({ kind: 'player', ...p }); taken.add(p.x * 10000 + p.y); }
    }
    ents.sort((a, b) => (a.x + a.y) - (b.x + b.y));
    this.hits = [];
    const now = Date.now();
    for (const e of ents) {
      if (e.kind === 'camp' && taken.has(e.x * 10000 + e.y)) continue;
      this.drawEntity(c, e, now);
    }
    this.drawViewport();
  }

  drawEntity(c, e, now) {
    const px = isoX(e.x, e.y), py = isoY(e.x, e.y) + TH / 2;
    const z = this.cam.z;
    const me = this.app.me;
    const mine = e.kind === 'player' && e.id === me.id;
    const sel = this.sel && this.sel.kind === e.kind && (this.sel.id === e.id);
    let im, w, color, label, sub;
    if (e.kind === 'player') {
      im = img(`buildings/castle_${Math.min(6, Math.max(1, e.level))}`);
      w = TW * (1.05 + Math.min(6, e.level) * 0.1);
      color = RACES[e.race]?.color || '#888';
      label = e.name;
      sub = `🏆 ${e.trophies}`;
    } else {
      const ct = CAMP_TYPES[e.type];
      im = darkened(img(ct.sprite), ct.dark);
      w = TW * (e.type === 'darklord' ? 3.2 : e.type === 'fort' ? 1.5 : 1.15);
      color = e.type === 'darklord' || e.type === 'fort' ? '#5b1f7a' : '#6b4b2a';
      label = e.name;
      const resp = me.npc?.[e.id] || this.app.npcLocal?.[e.id];
      if (resp && resp > now) { e.respawn = resp; sub = `⏳ ${fmtTime((resp - now) / 1000)}`; }
    }
    if (sel || mine) {
      c.save();
      c.strokeStyle = mine ? '#ffd84a' : '#fff'; c.lineWidth = 3 / z;
      c.beginPath(); c.ellipse(px, py, w * 0.55, w * 0.27, 0, 0, Math.PI * 2); c.stroke();
      c.restore();
    }
    if (im) {
      const h = im.height * w / im.width;
      c.save();
      if (e.respawn > now) c.globalAlpha = 0.5;
      c.drawImage(im, px - w / 2, py - h + w * 0.12, w, h);
      c.restore();
      this.hits.push({ e, x: px - w / 2, y: py - h, w, h: h + 6 });
    }
    // флажок уровня
    const fy = py - (im ? im.height * w / im.width : TH) - 4;
    c.save();
    if (z < 0.6 && !mine && !sel) { c.restore(); return; } // издалека — только постройки
    c.fillStyle = color;
    c.strokeStyle = e.kind === 'camp' ? '#c33' : '#f2c14e';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(px - 9, fy - 20); c.lineTo(px + 9, fy - 20); c.lineTo(px + 9, fy - 4); c.lineTo(px, fy + 2); c.lineTo(px - 9, fy - 4); c.closePath();
    c.fill(); c.stroke();
    c.fillStyle = '#fff'; c.font = '900 12px Rubik, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(e.level, px, fy - 11);
    if (z >= 1.35 || mine || sel || (e.kind === 'camp' && e.type === 'darklord')) {
      c.font = `800 ${Math.max(10, 11 / z * 0.8)}px Rubik, sans-serif`;
      const t = (mine ? '★ ' : '') + label;
      const tw = c.measureText(t).width + 10;
      c.fillStyle = mine ? 'rgba(140,100,10,0.92)' : 'rgba(15,22,45,0.82)';
      c.fillRect(px - tw / 2, py + 4, tw, 16);
      c.fillStyle = '#fff'; c.fillText(t, px, py + 12);
      if (sub) { c.font = '700 10px Rubik, sans-serif'; c.fillStyle = '#ffe9a8'; c.fillText(sub, px, py + 27); }
      if (e.online) { c.fillStyle = '#5f5'; c.beginPath(); c.arc(px + tw / 2 + 5, py + 12, 4, 0, Math.PI * 2); c.fill(); }
    }
    c.restore();
  }

  tap(p) {
    const w = this.toWorld(p.x, p.y);
    for (let i = (this.hits?.length || 0) - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (w.x >= h.x && w.x <= h.x + h.w && w.y >= h.y && w.y <= h.y + h.h) { this.select(h.e); return; }
    }
    const cell = this.cellAt(p.x, p.y);
    const t = terrainAt(cell.x, cell.y);
    this.sel = null;
    this.panel(`<b>${BIOMES[t].name}</b><span class="muted">Клетка ${cell.x}:${cell.y}</span>`, []);
  }

  select(e) {
    this.sel = e;
    this.app.sfx('click');
    const me = this.app.me;
    const now = Date.now();
    if (e.kind === 'player') {
      const mine = e.id === me.id;
      const lg = leagueOf(e.trophies);
      this.panel(`<div class="wp-head"><img class="wp-ava" src="${avatarUrl(e.avatar)}" alt=""><div>
        <b>${esc(e.name)}</b> ${e.online ? '<span class="dot-on"></span>' : ''}<div class="muted">${esc(e.owner)}${e.title ? ' · ' + esc(e.title) : ''}</div>
        <div><span class="race-chip" style="--c:${RACES[e.race]?.color}">${RACES[e.race]?.name}</span> <span class="race-chip" style="--c:${lg.color}">${lg.icon} ${lg.name}</span> 🏆 ${e.trophies} · ур. ${e.level}</div></div></div>`,
      [
        { label: '👤 Профиль', cls: 'blue', fn: () => this.app.ui.openProfile(e.id) },
        ...(mine ? [{ label: '🏰 Домой', cls: 'green', fn: () => this.app.goHome() }] : [
          { label: '👁 Осмотреть', fn: () => this.app.visit(e.id) },
          { label: '⚔ Атаковать', cls: 'red', fn: () => this.app.attack({ kind: 'player', id: e.id }) },
        ]),
      ]);
    } else {
      const ct = CAMP_TYPES[e.type];
      const resp = e.respawn > now;
      this.panel(`<div class="wp-head"><img class="wp-ava camp" src="/assets/${ct.sprite}.png" alt=""><div><b>${esc(e.name)}</b>
        <div class="muted">Уровень ${e.level}${e.type === 'darklord' ? ' · главный враг Валории' : ''}</div>
        ${resp ? `<div class="tc-warn">Восстанавливается: ${fmtTime((e.respawn - now) / 1000)}</div>` : '<div class="muted">Победа приносит добычу. Чем ближе к центру — тем богаче лагеря.</div>'}</div></div>`,
      [{ label: '⚔ Атаковать', cls: 'red', disabled: resp, fn: () => this.app.attack({ kind: 'camp', id: e.id }) }]);
    }
  }

  panel(html, buttons) {
    const p = document.getElementById('w-panel');
    p.innerHTML = `<div class="wp-body">${html}</div><div class="wp-btns"></div>`;
    const wrap = p.querySelector('.wp-btns');
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'btn sm ' + (b.cls || '');
      el.innerHTML = b.label; el.disabled = !!b.disabled; el.onclick = b.fn;
      wrap.appendChild(el);
    }
    p.classList.add('show');
  }
  hidePanel() { document.getElementById('w-panel').classList.remove('show'); this.sel = null; }

  async search() {
    const inp = document.getElementById('w-q');
    try {
      const list = await this.app.api.find(inp.value);
      if (!list.length) { this.app.ui.toast('Никого не нашли'); return; }
      const box = document.getElementById('w-results');
      box.innerHTML = list.map((p, i) => `<button data-i="${i}">${esc(p.name)} <span class="muted">${esc(p.username)} · ур.${p.level} · 🏆${p.trophies}</span></button>`).join('');
      box.classList.add('show');
      box.querySelectorAll('button').forEach((b) => {
        b.onclick = () => {
          const p = list[+b.dataset.i];
          box.classList.remove('show');
          this.cam.z = Math.max(this.cam.z, 0.8);
          this.flyTo(p.x, p.y);
          this.regions.clear();
        };
      });
    } catch (e) { this.app.ui.toast(e.message); }
  }

  // --- Миникарта ----------------------------------------------------------------------
  drawMini() {
    const mv = document.getElementById('mini');
    if (!this.miniBase) {
      const S = 2, base = document.createElement('canvas');
      base.width = WORLD; base.height = WORLD;
      const c = base.getContext('2d'), im = c.createImageData(WORLD, WORLD);
      for (let y = 0; y < WORLD; y++) for (let x = 0; x < WORLD; x++) {
        const col = hexToRgb(BIOMES[terrainAt(x, y)].color), i = (y * WORLD + x) * 4;
        im.data[i] = col[0]; im.data[i + 1] = col[1]; im.data[i + 2] = col[2]; im.data[i + 3] = 255;
      }
      c.putImageData(im, 0, 0);
      this.miniBase = base;
      this.miniScale = S;
    }
    mv.width = 220; mv.height = 120;
  }

  miniXform() { return { k: 220 / (WORLD * 2), ox: 110, oy: 0 }; }

  drawViewport() {
    const mv = document.getElementById('mini');
    if (!this.miniBase) return;
    const c = mv.getContext('2d'), { k, ox } = this.miniXform();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, mv.width, mv.height);
    // ромб: клетка (x,y) -> ((x-y)*k + ox, (x+y)*k/2)
    c.setTransform(k, k / 2, -k, k / 2, ox, 0);
    c.imageSmoothingEnabled = false;
    c.drawImage(this.miniBase, 0, 0);
    c.setTransform(1, 0, 0, 1, 0, 0);
    const toMini = (x, y) => ({ x: (x - y) * k + ox, y: (x + y) * k / 2 });
    const me = this.app.me;
    const m = toMini(me.x, me.y);
    c.fillStyle = '#ffd84a'; c.strokeStyle = '#000'; c.lineWidth = 1;
    c.beginPath(); c.arc(m.x, m.y, 3.5, 0, Math.PI * 2); c.fill(); c.stroke();
    const d = toMini(CENTER, CENTER);
    c.fillStyle = '#b03cff'; c.beginPath(); c.arc(d.x, d.y, 3, 0, Math.PI * 2); c.fill();
    const pts = [[0, 0], [this.w, 0], [this.w, this.h], [0, this.h]].map(([sx, sy]) => { const cc = this.cellAt(sx, sy); return toMini(cc.x, cc.y); });
    c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); c.stroke();
  }

  miniClick(e) {
    const r = e.target.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (220 / r.width), sy = (e.clientY - r.top) * (120 / r.height);
    const { k, ox } = this.miniXform();
    const a = (sx - ox) / k, b = sy * 2 / k;  // a = x - y, b = x + y
    this.flyTo(Math.round((a + b) / 2), Math.round((b - a) / 2));
  }
}

// --- Отрисовка декора на клетке ------------------------------------------------
function drawDeco(c, { t, x, y, px, py }) {
  const r = hash01(x, y, 21);
  const put = (name, scale, dx = 0, dy = 0) => {
    const im = img(name);
    if (!im) return;
    const w = TW * scale, h = im.height * w / im.width;
    c.drawImage(im, px - w / 2 + dx, py + TH * 0.75 - h + dy, w, h);
  };
  if (t === 'forest') { put(r > 0.5 ? 'decor/oak' : 'decor/bush', r > 0.5 ? 1.0 : 0.7, (r - 0.5) * 12); if (r > 0.7) put('decor/pine', 0.75, 12, 4); }
  else if (t === 'pines') { put('decor/pine', 0.95, (r - 0.5) * 10); if (r > 0.4) put('decor/pine', 0.75, -12 + r * 6, 5); }
  else if (t === 'mountain') drawMountain(c, px, py, r);
  else if (t === 'hills') { if (r > 0.45) put(r > 0.8 ? 'decor/rock_big' : 'decor/rocks', 0.75, (r - 0.5) * 14); }
  else if (t === 'meadow') { if (r > 0.6) put('decor/flowers', 0.6); }
  else if (t === 'grass') { if (r > 0.94) put('decor/oak', 0.9); else if (r > 0.9) put('decor/bush', 0.6); }
  else if (t === 'snow') { if (r > 0.85) put('decor/pine', 0.8); }
  else if (t === 'swamp') {
    c.fillStyle = 'rgba(40,70,60,0.55)'; c.beginPath(); c.ellipse(px + (r - 0.5) * 10, py + TH / 2, 10, 4, 0, 0, Math.PI * 2); c.fill();
    if (r > 0.7) put('decor/stump', 0.5);
  } else if (t === 'desert') { if (r > 0.9) put('decor/rocks', 0.6); }
}

function drawMountain(c, px, py, r) {
  const h = TH * (2.2 + r * 1.6), w = TW * 0.62;
  const bx = px + (r - 0.5) * 8, by = py + TH * 0.85;
  c.fillStyle = '#7d7670';
  c.beginPath(); c.moveTo(bx - w, by); c.lineTo(bx - w * 0.05, by - h); c.lineTo(bx + w, by); c.closePath(); c.fill();
  c.fillStyle = '#a49c94';
  c.beginPath(); c.moveTo(bx - w, by); c.lineTo(bx - w * 0.05, by - h); c.lineTo(bx - w * 0.2, by); c.closePath(); c.fill();
  c.fillStyle = '#f4f7fb';
  c.beginPath(); c.moveTo(bx - w * 0.05, by - h); c.lineTo(bx - w * 0.32, by - h * 0.62); c.lineTo(bx - w * 0.1, by - h * 0.7); c.lineTo(bx + w * 0.12, by - h * 0.58); c.lineTo(bx + w * 0.3, by - h * 0.62); c.closePath(); c.fill();
}

function shade(hex, k) {
  const [r, g, b] = hexToRgb(hex);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 + k))));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

const darkCache = new Map();
function darkened(im, dark) {
  if (!im || !dark) return im;
  if (darkCache.has(im)) return darkCache.get(im);
  const cv = document.createElement('canvas');
  cv.width = im.width; cv.height = im.height;
  const c = cv.getContext('2d');
  c.filter = 'grayscale(1) brightness(.55) sepia(1) hue-rotate(230deg) saturate(3)';
  c.drawImage(im, 0, 0);
  darkCache.set(im, cv);
  return cv;
}

export function avatarUrl(id) {
  const map = { knight: 'heroes/knight_portrait', huntress: 'heroes/huntress_portrait', runesmith: 'heroes/runesmith_portrait', sorceress: 'heroes/sorceress_portrait' };
  return `/assets/${map[id] || 'troops/' + (id || 'swordsman')}.png`;
}
