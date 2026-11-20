// Карта континента: процедурный рельеф (кэш по чанкам), замки игроков
// (подгружаются по видимой области), лагеря NPC, миникарта и поиск.
import { RACES, fmt, fmtTime } from '/shared/config.js';
import { WORLD, CENTER, BIOMES, terrainAt, campAt, decorAt, hash01, SITE_TYPES } from '/shared/worldgen.js';
import { siteMight, siteAmount, troopMight, marchSlots } from '/shared/march.js';
import { FORT_MIGHT, FORT_BONUS } from '/shared/worldgen.js';
import { img } from './assets.js';
import { MarchUI } from './march.js';

const W = (n) => img('realm/world/' + n);
const WI = (n) => `/assets/realm/world/${n}.png`;

const TW = 96, TH = 48;
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
    this.cam = { x: 0, y: isoY(CENTER, CENTER), z: 0.75 };
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
    this.march = new MarchUI(app, this);
    this.fortOwners = new Map();
    setInterval(() => { if (this.open) this.loadForts(); }, 60000);
  }
  loadForts() { this.app.api.forts().then((l) => { this.fortOwners = new Map(l.map((f) => [f.site, f])); }).catch(() => {}); }

  get open() { return this.el.classList.contains('show'); }

  show(x, y) {
    this.el.classList.add('show');
    this.resize();
    const me = this.app.me;
    this.flyTo(x ?? me.x, y ?? me.y, true);
    this.drawMini();
    this.loadForts();
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
    this.cam.z = Math.max(0.25, Math.min(1.2, this.cam.z * f));
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
    const PAD = 2; // запас клеток: размытые края соседей ложатся одинаково во всех кусках
    const left = isoX(x0 - PAD, y0 + CH + PAD), top = isoY(x0 - PAD, y0 - PAD);
    const w = (CH + PAD * 2) * TW, h = (CH + PAD * 2) * TH;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.translate(-left, -top);
    const pats = {};
    for (const [k, b] of Object.entries(BIOMES)) {
      const t = W(b.tex);
      if (!t) continue;
      const p = c.createPattern(t, 'repeat');
      p.setTransform(new DOMMatrix().scale(1));
      pats[k] = p;
    }
    for (let j = -PAD; j < CH + PAD; j++) {
      for (let i = -PAD; i < CH + PAD; i++) {
        const x = x0 + i, y = y0 + j;
        const t = terrainAt(x, y);
        const px = isoX(x, y), py = isoY(x, y);
        c.beginPath();
        c.moveTo(px, py - 1); c.lineTo(px + TW / 2 + 1.5, py + TH / 2); c.lineTo(px, py + TH + 1); c.lineTo(px - TW / 2 - 1.5, py + TH / 2); c.closePath();
        c.fillStyle = pats[t] || BIOMES[t].color;
        c.fill();
        // лёгкая неровность освещения
        const v = hash01(x, y, 3) - 0.5;
        if (Math.abs(v) > 0.3) { c.fillStyle = v > 0 ? 'rgba(255,240,200,0.05)' : 'rgba(0,0,0,0.05)'; c.fill(); }
      }
    }
    // плавные переходы: у границы биома его земля «растекается» мягким пятном на соседей
    // (вложенные полупрозрачные эллипсы той же текстуры — мягкий край без масок)
    for (let j = -PAD; j < CH + PAD; j++) for (let i = -PAD; i < CH + PAD; i++) {
      const x = x0 + i, y = y0 + j;
      const t = terrainAt(x, y);
      if (terrainAt(x + 1, y) === t && terrainAt(x - 1, y) === t && terrainAt(x, y + 1) === t && terrainAt(x, y - 1) === t) continue;
      if (!pats[t]) continue;
      const cxp = isoX(x, y) + (hash01(x, y, 31) - 0.5) * TW * 0.25, cyp = isoY(x, y) + TH / 2 + (hash01(x, y, 32) - 0.5) * TH * 0.25;
      c.fillStyle = pats[t];
      for (const k of [1.05, 0.85, 0.66, 0.48]) {
        c.globalAlpha = 0.28;
        c.beginPath(); c.ellipse(cxp, cyp, TW * 0.78 * k, TH * 0.78 * k, 0, 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = 1;
    }
    return { cv, left, top };
  }

  campsIn(cx, cy) {
    const key = cx * 1000 + cy;
    let list = this.camps.get(key);
    if (list) return list;
    list = [];
    for (let y = cy * CH; y < (cy + 1) * CH; y++) for (let x = cx * CH; x < (cx + 1) * CH; x++) {
      const c = campAt(x, y);
      if (c) { list.push(c); continue; }
      const d = decorAt(x, y);
      if (d) list.push({ deco: d, x, y });
    }
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
    c.fillStyle = '#2f5a24'; // за краем мира — тёмный лес
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
      // кусок рисуется строго в границах своих клеток
      const X0 = cx * CH, Y0 = cy * CH;
      c.save();
      c.beginPath();
      // на 1–2 пикселя шире: соседние куски одинаковы в перекрытии, шва не видно
      c.moveTo(isoX(X0, Y0), isoY(X0, Y0) - 1.5); c.lineTo(isoX(X0 + CH, Y0) + 3, isoY(X0 + CH, Y0));
      c.lineTo(isoX(X0 + CH, Y0 + CH), isoY(X0 + CH, Y0 + CH) + 1.5); c.lineTo(isoX(X0, Y0 + CH) - 3, isoY(X0, Y0 + CH));
      c.closePath(); c.clip();
      c.drawImage(ch.cv, ch.left, ch.top);
      c.restore();
      for (const cp of this.campsIn(cx, cy)) ents.push(cp.deco ? { kind: 'deco', ...cp } : { kind: 'camp', ...cp });
    }
    const rx0 = Math.floor(cx0 * CH / REG), rx1 = Math.floor((cx1 * CH + CH - 1) / REG);
    const ry0 = Math.floor(cy0 * CH / REG), ry1 = Math.floor((cy1 * CH + CH - 1) / REG);
    const taken = new Set();
    for (let ry = ry0; ry <= ry1; ry++) for (let rx = rx0; rx <= rx1; rx++) {
      for (const p of this.ensureRegion(rx, ry)) { ents.push({ kind: 'player', ...p }); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) taken.add((p.x + dx) * 10000 + p.y + dy); }
    }
    this.hits = [];
    const now = Date.now();
    this.drawMarchPaths(c, now);
    for (const m of this.marchEnts(now)) ents.push(m);
    ents.sort((a, b) => (a.x + a.y) - (b.x + b.y));
    for (const e of ents) {
      if ((e.kind === 'camp' || e.kind === 'deco') && taken.has(e.x * 10000 + e.y)) continue;
      if (e.kind === 'deco') this.drawDeco(c, e);
      else if (e.kind === 'march') this.drawMarch(c, e, now);
      else if (e.kind === 'rallyWait') { const im = img('realm/meta/a_rally'); if (im) { const w = TW * 0.9, h = im.height * w / im.width, px = isoX(e.x, e.y), py = isoY(e.x, e.y) + TH / 2; c.drawImage(im, px - w / 2, py - h * 0.8, w, h); } }
      else this.drawEntity(c, e, now);
    }
    this.drawViewport();
    this.march.tick(now);
  }

  drawDeco(c, e) {
    const im = W(e.deco);
    if (!im) return;
    const px = isoX(e.x, e.y), py = isoY(e.x, e.y) + TH / 2;
    const big = e.deco === 'd_village' || e.deco === 'd_mount' || e.deco === 'd_stones';
    const w = TW * (big ? 1.6 : 1.3) * (0.9 + hash01(e.x, e.y, 12) * 0.2), h = im.height * w / im.width;
    c.drawImage(im, px - w / 2, py - h * 0.78, w, h);
  }

  drawEntity(c, e, now) {
    const px = isoX(e.x, e.y), py = isoY(e.x, e.y) + TH / 2;
    const z = this.cam.z;
    const me = this.app.me;
    const mine = e.kind === 'player' && e.id === me.id;
    const sel = this.sel && this.sel.kind === e.kind && (this.sel.id === e.id);
    let im, w, label;
    if (e.kind === 'player') {
      im = img(`realm/city/castle_${RACES[e.race] ? e.race : 'humans'}_${e.level >= 6 ? 2 : 1}`);
      w = TW * (1.12 + Math.min(10, e.level) * 0.03);
      label = (e.tag ? `[${e.tag}] ` : '') + e.name;
    } else if (e.fort) {
      im = img(`realm/meta/a_fort${e.level}`);
      w = TW * (1.3 + e.level * 0.2);
      const own = this.fortOwners.get(e.id);
      label = (own?.tag ? `[${own.tag}] ` : '') + e.name;
      e.ownAlly = own?.ally || null;
    } else {
      const st = SITE_TYPES[e.type];
      im = W(st.sprite);
      w = TW * (e.type === 'throne' ? 3 : st.res ? 1.1 : 1.2);
      label = e.name;
      const resp = me.npc?.[e.id];
      if (resp && resp > now) e.respawn = resp; else e.respawn = 0;
    }
    const friend = (e.kind === 'player' && !mine && e.ally && e.ally === me.allyId) || (e.fort && e.ownAlly && e.ownAlly === me.allyId);
    if (sel || mine || friend) {
      c.save();
      c.strokeStyle = mine ? 'rgba(255,216,74,0.9)' : friend ? 'rgba(120,220,110,0.85)' : 'rgba(255,255,255,0.9)'; c.lineWidth = 2.5 / z;
      c.beginPath(); c.ellipse(px, py, w * 0.5, w * 0.25, 0, 0, Math.PI * 2); c.stroke();
      c.restore();
    }
    let h = TH;
    if (im) {
      h = im.height * w / im.width;
      c.save();
      if (e.respawn > now) { c.globalAlpha = 0.45; c.filter = 'grayscale(.8)'; }
      c.drawImage(im, px - w / 2, py - h * 0.82, w, h);
      c.restore();
      this.hits.push({ e, x: px - w / 2, y: py - h * 0.82, w, h });
    }
    if (z < 0.4 && !mine && !sel) return;
    // табличка уровня
    const ty = py - h * 0.82 - 2;
    const enemy = e.kind === 'camp' && !SITE_TYPES[e.type].res && !(e.fort && e.ownAlly === me.allyId);
    c.save();
    c.font = '800 11px Rubik, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const lv = String(e.level);
    c.fillStyle = enemy ? 'rgba(120,24,18,0.9)' : e.kind === 'player' ? 'rgba(30,24,16,0.88)' : 'rgba(40,60,30,0.88)';
    c.strokeStyle = '#c9a25a'; c.lineWidth = 1.2;
    c.beginPath(); c.arc(px, ty, 9, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = '#f2e2bd'; c.fillText(lv, px, ty + 0.5);
    if (z >= 0.9 || mine || sel) {
      c.font = '700 10px Rubik, sans-serif';
      const t = (mine ? '★ ' : '') + label;
      const tw = c.measureText(t).width + 10;
      c.fillStyle = mine ? 'rgba(110,80,20,0.9)' : 'rgba(22,18,13,0.8)';
      c.fillRect(px - tw / 2, py + 2, tw, 14);
      c.fillStyle = '#f2e2bd'; c.fillText(t, px, py + 9.5);
      if (e.respawn > now) { c.fillStyle = '#d9ccb2'; c.fillText(fmtTime((e.respawn - now) / 1000), px, py + 23); }
    }
    c.restore();
  }

  // --- Походы на карте ------------------------------------------------------------------
  serverNow() { return Date.now() + (this.app.me.now - this.app.fetchedAt); }
  marchPos(m) {
    const t = this.serverNow();
    let k;
    if (m.phase === 'go') k = Math.min(1, (t - m.start) / Math.max(1, m.arrive - m.start));
    else if (m.phase === 'work') k = 1;
    else k = (m.backFrom ?? 1) * Math.max(0, Math.min(1, (m.backAt - t) / Math.max(1, m.backAt - (m.backStart || m.backAt - m.travel * 1000))));
    return { x: m.fx + (m.tx - m.fx) * k, y: m.fy + (m.ty - m.fy) * k, back: m.phase === 'back' };
  }
  marchEnts(now) {
    const t = this.serverNow();
    const out = (this.app.me.marches || []).map((m) => { const p = this.marchPos(m); return { kind: 'march', m, x: p.x, y: p.y, back: p.back }; });
    for (const r of this.app.me.rallies || []) {
      if (t < r.launch) { out.push({ kind: 'rallyWait', r, x: r.fx + 0.6, y: r.fy + 0.6 }); continue; }
      const k = Math.min(1, (t - r.launch) / Math.max(1, r.arrive - r.launch));
      out.push({ kind: 'march', m: { id: r.id, kind: 'attack', phase: 'go', fx: r.fx, fy: r.fy, tx: r.x, ty: r.y, rally: r }, x: r.fx + (r.x - r.fx) * k, y: r.fy + (r.y - r.fy) * k });
    }
    void now;
    return out;
  }
  drawMarchPaths(c) {
    const z = this.cam.z;
    c.save();
    c.setLineDash([8 / z, 6 / z]); c.lineWidth = 2.5 / z;
    for (const m of [...(this.app.me.marches || []), ...(this.app.me.rallies || []).map((r) => ({ kind: 'attack', fx: r.fx, fy: r.fy, tx: r.x, ty: r.y }))]) {
      c.strokeStyle = m.kind === 'gather' ? 'rgba(140,220,110,0.85)' : 'rgba(255,120,90,0.85)';
      c.beginPath();
      c.moveTo(isoX(m.fx, m.fy), isoY(m.fx, m.fy) + TH / 2);
      c.lineTo(isoX(m.tx, m.ty), isoY(m.tx, m.ty) + TH / 2);
      c.stroke();
    }
    c.restore();
  }
  drawMarch(c, e) {
    const m = e.m, race = this.app.me.race;
    const im = W(`m_${m.kind === 'gather' ? 'gather' : 'army'}_${race}`) || W('m_army_humans');
    const px = isoX(e.x, e.y), py = isoY(e.x, e.y) + TH / 2;
    if (m.phase === 'work') {
      // сбор: отряд стоит у объекта, кольцо прогресса
      const t = this.serverNow(), k = Math.min(1, (t - m.arrive) / Math.max(1, m.workEnd - m.arrive));
      c.save();
      c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 4; c.beginPath(); c.arc(px, py - TH * 2.4, 11, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = '#8fe05a'; c.beginPath(); c.arc(px, py - TH * 2.4, 11, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); c.stroke();
      c.restore();
      return;
    }
    if (!im) return;
    const w = TW * 0.75, h = im.height * w / im.width;
    // направление движения на экране
    const dx = isoX(m.tx, m.ty) - isoX(m.fx, m.fy);
    const right = e.back ? dx < 0 : dx >= 0;
    const bob = Math.sin(this.t * 10) * 1.2;
    c.save();
    c.translate(px, py + bob);
    if (!right) c.scale(-1, 1);
    c.drawImage(im, -w / 2, -h * 0.9, w, h);
    c.restore();
    this.hits.push({ e: { kind: 'march', id: m.id, m }, x: px - w / 2, y: py - h * 0.9, w, h });
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
    const tp = this.teleportMode;
    this.panel(`<b>${BIOMES[t].name}</b><span class="muted">Клетка ${cell.x}:${cell.y}</span>`, tp ? [
      { label: 'Отмена', cls: 'steel', fn: () => { this.teleportMode = null; this.hidePanel(); } },
      { label: '<img class="ic" src="/assets/realm/items/tp2.png" alt=""> Перенести замок сюда', cls: 'green', fn: async () => {
        try { const r = await this.app.act('teleport', { item: tp, x: cell.x, y: cell.y }); this.teleportMode = null; this.hidePanel(); this.regions.clear(); this.app.ui.toast('Замок перенесён', 'good'); this.flyTo(r.moveTo.x, r.moveTo.y); } catch { /* тост */ }
      } },
    ] : []);
  }

  select(e) {
    this.sel = e;
    this.app.sfx('click');
    const me = this.app.me;
    const now = Date.now();
    if (e.kind === 'march') { if (e.m.rally) this.app.ally.open('rally'); else this.march.openMarch(e.m); return; }
    if (e.kind === 'player') {
      const mine = e.id === me.id;
      this.panel(`<div class="wp-head"><img class="wp-ava" src="/assets/realm/city/castle_${RACES[e.race] ? e.race : 'humans'}_1.png" alt=""><div>
        <b>${e.tag ? `[${esc(e.tag)}] ` : ''}${esc(e.name)}</b> ${e.online ? '<span class="dot-on"></span>' : ''}<div class="muted">${esc(e.owner)}${e.title ? ' · ' + esc(e.title) : ''}</div>
        <div class="muted">${RACES[e.race]?.name || ''} · Цитадель ${e.level} · ${e.x}:${e.y}</div></div></div>`,
      [
        { label: 'Профиль', cls: 'steel', fn: () => this.app.ui.openProfile(e.id) },
        ...(mine ? [{ label: 'Домой', fn: () => this.app.goHome() }] : [
          { label: 'Осмотреть', cls: 'steel', fn: () => this.app.visit(e.id) },
          { label: `<img class="ic" src="${WI('i_attack')}" alt=""> Налёт`, cls: 'red', fn: () => this.march.open({ kind: 'attack', player: e }) },
        ]),
      ]);
      return;
    }
    if (e.fort) {
      const own = this.fortOwners.get(e.id);
      const mine = own && own.ally === me.allyId;
      const rally = (me.rallies || []).find((r) => r.siteId === e.id);
      const might = troopMight(me.troops, me.race, 'infantry', me.mods);
      this.panel(`<div class="wp-head"><img class="wp-ava camp" src="/assets/realm/meta/a_fort${e.level}.png" alt=""><div><b>${esc(e.name)}</b>
        <div class="muted">Крепость ${e.level} ур. · ${e.x}:${e.y} · ${own?.tag ? `владеет [${esc(own.tag)}]` : 'ничья'}</div>
        <div class="wp-info">Гарнизон <b>${fmt(FORT_MIGHT[e.level])}</b> · ваша армия <b>${fmt(might)}</b><br>Союзу-владельцу: +${Math.round(FORT_BONUS * 100)}% добычи</div></div></div>`,
      !me.allyId ? [{ label: 'Вступите в союз, чтобы штурмовать', cls: 'steel', fn: () => this.app.ally.open() }]
        : mine ? [{ label: 'Крепость наша', cls: 'steel', disabled: true, fn: () => {} }]
          : rally ? [{ label: `<img class="ic" src="${WI('i_rally')}" alt=""> К сбору`, cls: 'green', fn: () => this.app.ally.open('rally') }]
            : [{ label: `<img class="ic" src="${WI('i_rally')}" alt=""> Объявить сбор`, cls: 'red', fn: () => this.march.open({ kind: 'rally', site: e }) }]);
      return;
    }
    const st = SITE_TYPES[e.type];
    const resp = e.respawn > now;
    const going = (me.marches || []).some((m) => m.siteId === e.id);
    let info;
    if (st.res) info = `Запас: <b>${fmt(siteAmount(e.type, e.level))}</b> · отправьте отряд на сбор`;
    else {
      const mine = troopMight(me.troops, me.race, st.enemy);
      info = `Сила врага <b>${fmt(siteMight(e.level))}</b> · ваша армия <b class="${mine >= siteMight(e.level) ? 'ok' : 'bad'}">${fmt(mine)}</b>`;
    }
    this.panel(`<div class="wp-head"><img class="wp-ava camp" src="${WI(st.sprite)}" alt=""><div><b>${esc(e.name)}</b>
      <div class="muted">Уровень ${e.level} · ${e.x}:${e.y}</div>
      ${resp ? `<div class="tc-warn">Восстанавливается: ${fmtTime((e.respawn - now) / 1000)}</div>` : `<div class="wp-info">${info}</div>`}</div></div>`,
    [st.res
      ? { label: `<img class="ic" src="${WI('i_gather')}" alt=""> Собрать`, cls: 'green', disabled: resp || going, fn: () => this.march.open({ kind: 'gather', site: e }) }
      : { label: `<img class="ic" src="${WI('i_attack')}" alt=""> Атаковать`, cls: 'red', disabled: resp || going, fn: () => this.march.open({ kind: 'attack', site: e }) }]);
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
