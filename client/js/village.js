// Город «Пепла Короны»: площадка внутри стены, здания ставятся свободно по сетке.
// Нажатие на здание — меню-дуга; «Построить» — призрак здания, который можно
// перетаскивать пальцем, и кнопки ✔/✖. Руины расчищаются нажатием, захваченные
// здания отвоёвываются боем героев. За стеной — лес и туман следующей зоны.
import { BUILDINGS, collectorCap, RACES, rateOf, castleLevelOf, maxLevelOf, buildCost, canAfford, RES_GEN, fmt } from '/shared/config.js';
import { C, cityRect, nextZone, fits, RUIN_SIZE, ZONES, zoneIndex, autoPlace, inCity } from '/shared/city.js';
import { iso, TW, TH } from './scene.js';
import { CITY, cityImg, img } from './assets.js';

const A = '/assets/realm/';
const RES_ICON = { food: 'food', wood: 'wood', stone: 'stone', iron: 'iron', mana: 'mana', gold: 'collect' };
const TREES = ['pine', 'oak', 'pine2', 'oak2', 'pine', 'pine2', 'forest_pine', 'forest_mixed', 'bush', 'bush2', 'rock', 'flowers'];
const hash = (x, y, k = 0) => {
  let h = (x * 374761393 + y * 668265263 + k * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class Village {
  constructor(scene, app) {
    this.scene = scene;
    this.app = app;
    this.me = null;
    this.sel = null;        // { kind: 'b', id }
    this.placing = null;    // { mode: 'new'|'move', type, id, x, y, size }
    this.hits = [];
    this.t = 0;
    // меню-дуга и кнопки призрака — поверх канваса
    this.arc = document.createElement('div');
    this.arc.id = 'arc';
    this.ghostBar = document.createElement('div');
    this.ghostBar.id = 'ghostbar';
    this.ghostBar.innerHTML = `<button class="gb-no" aria-label="Отмена"><img src="${A}kit/close.png" alt=""></button><button class="gb-ok" aria-label="Построить"><img src="${A}kit/up.png" alt=""></button>`;
    this.ghostBar.querySelector('.gb-no').onclick = () => this.cancelPlacing();
    this.ghostBar.querySelector('.gb-ok').onclick = () => this.confirmPlacing();
    document.getElementById('hud').append(this.arc, this.ghostBar);
  }

  get ghost() { return this.placing; } // совместимость (стрелка советника)
  now() { return Date.now() + (this.offset || 0); }

  setMe(me) {
    this.me = me;
    this.offset = me.now - Date.now();
    const base = this.visit || me;
    this.cl = castleLevelOf(base);
    this.rect = cityRect(this.cl);
    if (this.forestFor !== this.cl) this.buildForest();
    // смотреть можно на открытую часть и чуть дальше — на лес следующей зоны
    const r = this.rect;
    this.scene.bounds = { x0: r.x0 - 4, y0: r.y0 - 4, x1: r.x1 + 4, y1: r.y1 + 4 };
    this.scene.race = base.race;
    if (this.sel && !this.findSel()) this.select(null);
  }

  findSel() {
    if (!this.sel) return null;
    return this.me.buildings.find((b) => b.id === this.sel.id) || null;
  }

  enter() {
    const s = this.scene;
    s.on('tap', (p, g) => this.tap(p, g));
    s.on('down', (p, g) => this.down(p, g));
    s.on('drag', (p, g) => this.dragGhost(g));
    s.on('drop', () => { this.dragOff = null; });
    s.on('hover', null); s.on('hold', null); s.on('up', null);
  }

  // Камера на Цитадель
  focusCastle() {
    const c = iso(C, C + 1);
    this.scene.cam = { x: c.x, y: c.y, z: this.scene.defaultZoom('village') };
    this.scene.clampCam();
  }

  // --- Лес и природа за стеной (детерминированно) ---------------------------------
  buildForest() {
    this.forestFor = this.cl;
    const r = this.rect, out = [];
    for (let y = -6; y < 50; y++) for (let x = -6; x < 50; x++) {
      if (x >= r.x0 - 1 && x <= r.x1 && y >= r.y0 - 1 && y <= r.y1) continue; // город и стена
      const near = Math.max(r.x0 - 1 - x, x - r.x1, r.y0 - 1 - y, y - r.y1); // клеток от стены
      const p = near <= 1 ? 0.18 : near <= 3 ? 0.42 : 0.55;
      if (hash(x, y) > p) continue;
      const kind = TREES[Math.floor(hash(x, y, 1) * TREES.length)];
      const big = kind.startsWith('forest');
      const w = TW * (big ? 2.6 : kind.startsWith('bush') || kind === 'rock' || kind === 'flowers' ? 1.1 : 1.5) * (0.85 + hash(x, y, 2) * 0.3);
      out.push({ kind, x: x + 0.2 + hash(x, y, 3) * 0.6, y: y + 0.2 + hash(x, y, 4) * 0.6, w });
    }
    this.forest = out;
  }

  // --- Ввод ---------------------------------------------------------------------
  hitTest(p) {
    const w = this.scene.toWorld(p.x, p.y);
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (w.x >= h.x && w.x <= h.x + h.w && w.y >= h.y && w.y <= h.y + h.h) return h;
    }
    return null;
  }

  down(p, g) {
    const pl = this.placing;
    if (!pl) return false;
    // палец на призраке — тащим его
    if (g.gx >= pl.x - 0.5 && g.gx <= pl.x + pl.size + 0.5 && g.gy >= pl.y - 0.5 && g.gy <= pl.y + pl.size + 0.5) {
      this.dragOff = { dx: g.gx - pl.x, dy: g.gy - pl.y };
      return true;
    }
    return false;
  }

  dragGhost(g) {
    const pl = this.placing;
    if (!pl || !this.dragOff) return;
    pl.x = Math.round(g.gx - this.dragOff.dx);
    pl.y = Math.round(g.gy - this.dragOff.dy);
  }

  tap(p, g) {
    if (this.visit) return;
    const pl = this.placing;
    if (pl) {
      // нажатие мимо призрака — переносим его туда
      pl.x = Math.floor(g.gx - pl.size / 2 + 0.5);
      pl.y = Math.floor(g.gy - pl.size / 2 + 0.5);
      return;
    }
    const h = this.hitTest(p);
    if (h?.bubble) { this.app.collect(h.b.id); return; }
    if (h?.d) { this.clearRuin(h.d); return; }
    if (h?.b) {
      const b = h.b;
      this.app.sfx('click');
      if (b.captured) { this.select(null); this.app.cityUi.captured(b); return; }
      if (this.sel?.id === b.id) { this.select(null); return; }
      this.select(b);
      return;
    }
    this.select(null);
  }

  select(b) {
    this.sel = b ? { kind: 'b', id: b.id } : null;
    this.app.ui.select?.(null);
    this.renderArc();
  }

  async clearRuin(d) {
    if (!inCity(d.x, d.y, RUIN_SIZE, this.cl)) { this.app.ui.toast('Эта земля ещё в тумане — улучшите Цитадель'); return; }
    try {
      const r = await this.app.act('removeDecor', { id: d.id });
      this.app.sfx('build');
      const p = iso(d.x + 1, d.y + 1);
      this.scene.emit(p.x, p.y - 10, 18, 'dust');
      const got = Object.entries(r.got || {}).filter(([k, v]) => v && k !== 'gems');
      got.forEach(([k, v], i) => (this.floats ||= []).push({ x: p.x, y: p.y - TH * 2 - i * 26, text: `+${fmt(v)} ${RES_GEN[k] || ''}`, color: k === 'wood' ? '#ffcf7a' : '#e6e1d6', t: 0, scale: 1 }));
    } catch { /* тост показан */ }
  }

  // --- Постройка и перенос: призрак здания ----------------------------------------
  startPlacing(type) {
    const def = BUILDINGS[type];
    this.select(null);
    const ctr = this.scene.toGrid(this.scene.w / 2, this.scene.h * 0.45);
    const spot = autoPlace(this.me, def.size, this.cl, { x: ctr.gx, y: ctr.gy }) || { x: C - 1, y: C + 3 };
    this.placing = { mode: 'new', type, x: spot.x, y: spot.y, size: def.size };
    const gp = iso(spot.x + def.size / 2, spot.y + def.size / 2);
    this.scene.cam.x = gp.x; this.scene.cam.y = gp.y + TH * 2; this.scene.clampCam();
    this.app.ui.placing(true, `${def.name}: перетащите на свободное место и нажмите ✔`);
  }

  startMove(b) {
    this.select(null);
    this.placing = { mode: 'move', type: b.type, id: b.id, x: b.x, y: b.y, size: BUILDINGS[b.type].size, from: { x: b.x, y: b.y } };
    this.app.ui.placing(true, 'Перетащите здание и нажмите ✔');
  }

  cancelPlacing() {
    this.placing = null;
    this.dragOff = null;
    this.app.ui.placing(false);
    this.ghostBar.classList.remove('show');
  }

  ghostOk() {
    const pl = this.placing;
    return pl && fits(this.me, pl.x, pl.y, pl.size, this.cl, pl.id ?? null);
  }

  async confirmPlacing() {
    const pl = this.placing;
    if (!pl) return;
    if (!this.ghostOk()) { this.app.ui.toast('Здесь строить нельзя — место занято или в тумане'); return; }
    try {
      if (pl.mode === 'move') await this.app.act('move', { id: pl.id, x: pl.x, y: pl.y });
      else await this.app.act('place', { type: pl.type, x: pl.x, y: pl.y });
      this.app.sfx('build');
      const c = iso(pl.x + pl.size / 2, pl.y + pl.size / 2);
      this.scene.emit(c.x, c.y, 16, 'dust');
      this.cancelPlacing();
    } catch { /* тост показан */ }
  }

  // --- Меню-дуга вокруг здания ----------------------------------------------------
  renderArc() {
    const b = this.findSel();
    if (!b || this.visit) { this.arc.classList.remove('show'); this.arc.innerHTML = ''; return; }
    const me = this.me, def = BUILDINGS[b.type], ui = this.app.cityUi;
    const btns = [];
    const add = (icon, label, fn, cls = '') => btns.push({ icon, label, fn, cls });
    const ruined = b.level === 0 && !b.up;
    add('info', 'Инфо', () => ui.openInfo(b));
    if (b.up) add('speedup', 'Ускорить', () => ui.speedup(b), 'gem');
    else if (ruined) add('repair', 'Починить', () => ui.openBuilding(b), 'hot');
    else if (b.level < maxLevelOf(b.type, this.cl)) add('upgrade', 'Улучшить', () => ui.openBuilding(b), this.canUpgrade(b) ? 'hot' : '');
    if (def.produces && b.level > 0) add(RES_ICON[def.produces], 'Собрать', () => this.app.collect(b.id));
    if (b.level > 0) {
      if (b.type === 'tavern') add('collect', 'Таверна', () => this.app.heroes.open('tavern'));
      if (b.type === 'altar') add('upgrade', 'Герои', () => this.app.heroes.open('list'));
      const camp = { barracks: 'infantry', range: 'archer', stables: 'cavalry', hospital: 'hospital' }[b.type];
      if (camp) add('train', camp === 'hospital' ? 'Лечение' : 'Обучить', () => this.app.troops.open(camp));
      if (b.type === 'forge') add('build', 'Кузница', () => this.app.ui.openArmy('forge'));
      if (b.type === 'academy') add('research', 'Наука', () => this.app.academy.open());
    }
    if (b.type !== 'castle') add('move', 'Переместить', () => this.startMove(b));
    this.arc.innerHTML = `<div class="arc-title"><b>${def.name}</b><span>${b.level ? `Ур. ${b.level}` : b.up ? 'Строится' : 'Разрушено'}</span></div>` +
      btns.map((a, i) => `<button class="arc-b ${a.cls}" data-i="${i}"><img src="${A}city/${a.icon}.png" alt=""><span>${a.label}</span></button>`).join('');
    this.arc.querySelectorAll('.arc-b').forEach((el) => {
      el.onclick = (e) => { e.stopPropagation(); this.app.sfx('click'); btns[+el.dataset.i].fn(); };
    });
    this.arcFor = b.id;
    this.arc.classList.add('show');
    this.placeArc();
  }

  placeArc() {
    const b = this.findSel();
    if (!b || !this.arc.classList.contains('show')) return;
    const size = BUILDINGS[b.type].size, s = this.scene;
    const top = s.toScreen(...Object.values(iso(b.x + size / 2, b.y + size / 2)));
    const n = this.arc.querySelectorAll('.arc-b').length;
    const R = Math.max(70, Math.min(110, size * TW * s.cam.z * 0.62));
    this.arc.querySelectorAll('.arc-b').forEach((el, i) => {
      // дуга снизу здания: от левого края к правому
      const a = Math.PI * (0.92 - (n === 1 ? 0.42 : i / (n - 1)) * 0.84);
      el.style.transform = `translate(${top.x + Math.cos(a) * R * 1.15 - 29}px, ${top.y + Math.sin(a) * R * 0.75 + 4}px)`;
    });
    const t = this.arc.querySelector('.arc-title');
    if (t) t.style.transform = `translate(${Math.max(70, Math.min(s.w - 70, top.x))}px, ${Math.max(150, top.y - size * TH * s.cam.z * 1.9)}px) translate(-50%, -100%)`;
  }

  canUpgrade(b) {
    const me = this.me;
    if (b.up || b.captured || b.level >= maxLevelOf(b.type, this.cl)) return false;
    if (me.builders.busy >= me.builders.total) return false;
    return canAfford(me.res, buildCost(b.type, b.level + 1));
  }

  // --- Кадр ----------------------------------------------------------------------
  frame(dt) {
    const s = this.scene;
    const me = this.visit || this.me;
    if (!me) return;
    this.t += dt;
    const now = this.now();
    const st = this.staticLayers();
    s.begin(true);
    s.ctx.drawImage(st.back, st.wx, st.wy, st.ww, st.wh);
    const items = [];
    for (const b of me.buildings) {
      if (b.type === 'wall') continue;
      if (this.placing?.mode === 'move' && this.placing.id === b.id) continue;
      const sz = BUILDINGS[b.type].size;
      items.push({ d: b.x + b.y + sz * 2, b });
    }
    for (const d of me.decor || []) {
      if (!inCity(d.x, d.y, RUIN_SIZE, this.cl)) continue; // руины закрытых зон — под лесом
      items.push({ d: d.x + d.y + RUIN_SIZE * 2, dec: d });
    }
    if (this.placing) items.push({ d: this.placing.x + this.placing.y + this.placing.size * 2 + 0.01, ghost: true });
    items.sort((a, b) => a.d - b.d);

    this.hits = [];
    const selObj = this.visit ? null : this.findSel();
    for (const it of items) {
      if (it.tree) { const p = iso(it.tree.x, it.tree.y); s.drawFoot(it.tree.kind, p.x, p.y, it.tree.w); continue; }
      if (it.wall) { s.drawSlab(it.wall, it.x, it.y, it.sx, it.sy); continue; }
      if (it.ghost) { this.drawGhost(); continue; }
      if (it.b) this.drawB(it.b, selObj === it.b);
      else if (it.dec) {
        const r = s.drawDecor(it.dec);
        if (r) this.hits.push({ d: it.dec, x: r.x + r.w * 0.15, y: r.y + r.h * 0.2, w: r.w * 0.7, h: r.h * 0.8 });
      }
    }
    s.ctx.drawImage(st.front, st.wx, st.wy, st.ww, st.wh);
    this.drawFog();
    // значки поверх
    if (!this.visit) for (const b of me.buildings) this.drawOverlay(b, now);
    s.drawParticles(dt);
    this.drawFloats(dt);
    this.placeArc();
    this.placeGhostBar();
    if (!this.visit) this.app.ui.tick(now);
  }

  // Неподвижные слои — трава, лес и стены — рисуются в кэш один раз и переиспользуются:
  // каждый кадр это одна картинка вместо травы и сотен деревьев. «Задний» слой под зданиями,
  // «передний» (ближняя стена и лес перед ней) — поверх.
  staticLayers() {
    const s = this.scene, z = s.cam.z, dpr = s.dpr;
    const W = Math.ceil(s.w * 1.4), H = Math.ceil(s.h * 1.4);
    const key = `${this.cl}|${z.toFixed(4)}|${dpr}|${W}x${H}|${this.placing ? 1 : 0}`;
    const halfW = W / 2 / z, halfH = H / 2 / z, vw = s.w / 2 / z, vh = s.h / 2 / z;
    const st = this.st;
    if (st && st.key === key && Math.abs(s.cam.x - st.cx) <= halfW - vw - 1 && Math.abs(s.cam.y - st.cy) <= halfH - vh - 1) return st;
    const mk = (old) => { const cv = old || document.createElement('canvas'); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); return cv; };
    const back = mk(st?.back), front = mk(st?.front);
    const cx = s.cam.x, cy = s.cam.y, wx = cx - halfW, wy = cy - halfH, ww = W / z, wh = H / z;
    const r = this.rect;
    const inView = (x, y) => { const p = iso(x, y); return p.x > wx - TW * 2 && p.x < wx + ww + TW * 2 && p.y > wy - TH * 2 && p.y < wy + wh + TH * 10; };
    const backItems = [], frontItems = [];
    for (const f of this.forest) {
      if (!inView(f.x, f.y)) continue;
      ((f.x >= r.x1 || f.y >= r.y1) ? frontItems : backItems).push({ d: f.x + f.y, tree: f });
    }
    for (const w of this.wallPieces()) (w.front ? frontItems : backItems).push(w);
    backItems.sort((a, b) => a.d - b.d); frontItems.sort((a, b) => a.d - b.d);
    const main = s.ctx;
    const draw = (cv, list, ground) => {
      const c = cv.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, cv.width, cv.height);
      c.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - cx * z), dpr * (H / 2 - cy * z));
      c.imageSmoothingQuality = 'medium';
      s.ctx = c;
      if (ground) { s.drawBackground(); this.drawCityGround(); }
      for (const it of list) {
        if (it.tree) { const p = iso(it.tree.x, it.tree.y); s.drawFoot(it.tree.kind, p.x, p.y, it.tree.w); } else s.drawSlab(it.wall, it.x, it.y, it.sx, it.sy);
      }
    };
    try { draw(back, backItems, true); draw(front, frontItems, false); } finally { s.ctx = main; }
    this.st = { key, cx, cy, back, front, wx, wy, ww, wh };
    return this.st;
  }

  viewRect() {
    const s = this.scene;
    const hw = s.w / 2 / s.cam.z + TW * 2, top = s.cam.y - s.h / 2 / s.cam.z - TH * 2, bot = s.cam.y + s.h / 2 / s.cam.z + TH * 8;
    const a = s.toGrid(0, 0), b = s.toGrid(s.w, 0), c = s.toGrid(0, s.h), d = s.toGrid(s.w, s.h);
    const xs = [a.gx, b.gx, c.gx, d.gx], ys = [a.gy, b.gy, c.gy, d.gy];
    return { x0: Math.min(...xs) - 3, x1: Math.max(...xs) + 6, y0: Math.min(...ys) - 3, y1: Math.max(...ys) + 6, hw, top, bot };
  }

  // Утоптанная земля города + лёгкая сетка в режиме стройки
  drawCityGround() {
    const s = this.scene, c = s.ctx, r = this.rect;
    c.save();
    const a = iso(r.x0, r.y0), b = iso(r.x1, r.y0), d = iso(r.x1, r.y1), e = iso(r.x0, r.y1);
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(d.x, d.y); c.lineTo(e.x, e.y); c.closePath();
    c.fillStyle = 'rgba(120, 96, 60, 0.10)'; c.fill();
    if (this.placing) {
      c.globalAlpha = 0.5;
      s.drawGrid(0.22, r.x0, r.x1);
    }
    c.restore();
  }

  // Стена по периметру открытой части: сегменты 3 клетки, башни по углам, ворота спереди
  wallPieces() {
    const r = this.rect, out = [];
    const gateX = Math.round((r.x0 + r.x1) / 2) - 1, gateY = Math.round((r.y0 + r.y1) / 2) - 1;
    for (let x = r.x0; x < r.x1; x += 3) {
      const len = Math.min(3, r.x1 - x);
      if (len < 1) continue;
      out.push({ wall: 'wall_l', x, y: r.y0 - 1, sx: len, sy: 1, d: x + len + r.y0 });
      if (x + 3 > gateX && x < gateX + 2) continue; // проём ворот
      out.push({ wall: 'wall_l', x, y: r.y1, sx: len, sy: 1, d: x + len + r.y1 + 1, front: true });
    }
    for (let y = r.y0; y < r.y1; y += 3) {
      const len = Math.min(3, r.y1 - y);
      out.push({ wall: 'wall_r', x: r.x0 - 1, y, sx: 1, sy: len, d: r.x0 + y + len });
      if (y + 3 > gateY && y < gateY + 2) continue;
      out.push({ wall: 'wall_r', x: r.x1, y, sx: 1, sy: len, d: r.x1 + 1 + y + len, front: true });
    }
    const T = (x, y, front) => out.push({ wall: 'tower', x: x - 0.5, y: y - 0.5, sx: 2, sy: 2, d: x + y + 3.2, front });
    T(r.x0 - 1, r.y0 - 1, false); T(r.x1, r.y0 - 1, true); T(r.x0 - 1, r.y1, true); T(r.x1, r.y1, true);
    out.push({ wall: 'gate', x: gateX, y: r.y1 - 0.5, sx: 2, sy: 2, d: gateX + r.y1 + 4, front: true });
    out.push({ wall: 'gate', x: r.x1 - 0.5, y: gateY, sx: 2, sy: 2, d: r.x1 + gateY + 4, front: true });
    return out;
  }

  // Туман над закрытыми землями: мягкие облака у края следующей зоны
  drawFog() {
    const s = this.scene, c = s.ctx, r = this.rect;
    const nz = nextZone(this.cl);
    c.save();
    const puff = (gx, gy, rad, a) => {
      const p = iso(gx, gy);
      const g = c.createRadialGradient(p.x, p.y, rad * 0.1, p.x, p.y, rad);
      g.addColorStop(0, `rgba(236,238,240,${a})`); g.addColorStop(1, 'rgba(236,238,240,0)');
      c.fillStyle = g;
      c.beginPath(); c.ellipse(p.x, p.y, rad, rad * 0.55, 0, 0, Math.PI * 2); c.fill();
    };
    const t = this.t * 0.15;
    for (let i = 0; i < 32; i++) {
      // облака по кольцу в 5–9 клетках от стены — над лесом, не над городом
      const side = i % 4, u = ((i * 0.37 + t * (side % 2 ? 1 : -1) * 0.05) % 1 + 1) % 1;
      const off = 5 + (i % 3) * 2;
      const L = r.x1 - r.x0 + off * 2;
      const gx = side === 0 ? r.x0 - off + u * L : side === 1 ? r.x1 + off : side === 2 ? r.x0 - off + u * L : r.x0 - off;
      const gy = side === 0 ? r.y0 - off : side === 1 ? r.y0 - off + u * L : side === 2 ? r.y1 + off : r.y0 - off + u * L;
      puff(gx, gy, TW * (1.6 + (i % 3) * 0.6), 0.3);
    }
    c.restore();
  }

  drawGhost() {
    const s = this.scene, pl = this.placing, ok = this.ghostOk();
    s.diamond(pl.x, pl.y, pl.size, pl.size, ok ? 'rgba(90,220,110,0.35)' : 'rgba(230,60,50,0.4)', ok ? '#9dff9a' : '#ff6a5a');
    const b = { type: pl.type, level: Math.max(1, this.me.buildings.find((v) => v.id === pl.id)?.level || 1), x: pl.x, y: pl.y };
    s.drawBuilding(b, { alpha: 0.82, lift: -6 - Math.abs(Math.sin(this.t * 3)) * 4, race: this.me.race });
  }

  placeGhostBar() {
    const pl = this.placing;
    if (!pl) { this.ghostBar.classList.remove('show'); return; }
    const s = this.scene, p = iso(pl.x + pl.size / 2, pl.y + pl.size / 2), sp = s.toScreen(p.x, p.y);
    const h = pl.size * TH * 2.2 * s.cam.z;
    this.ghostBar.style.transform = `translate(${sp.x}px, ${sp.y - h}px) translate(-50%, -100%)`;
    this.ghostBar.classList.add('show');
    this.ghostBar.querySelector('.gb-ok').disabled = !this.ghostOk();
  }

  drawB(b, selected) {
    const s = this.scene;
    const size = BUILDINGS[b.type].size;
    if (selected) s.diamond(b.x, b.y, size, size, 'rgba(255,226,122,0.25)', '#ffe27a');
    const r = s.drawBuilding(b, { flash: selected && Math.sin(this.t * 8) > 0.7, race: (this.visit || this.me).race });
    if (r) {
      // область нажатия — силуэт здания (без пустых краёв спрайта)
      this.hits.push({ b, x: r.x + r.w * 0.12, y: r.y + r.h * 0.12, w: r.w * 0.76, h: r.h * 0.86, r });
      b._r = r;
    }
    if (b.type === 'forge' && b.level > 0 && Math.random() < 0.05 && r) s.emit(r.x + r.w * 0.62, r.y + r.h * 0.15, 1, 'smoke');
  }

  // Значки над зданием: уровень, «можно улучшить», сбор, таймер, враг, починка
  drawOverlay(b, now) {
    const s = this.scene, def = BUILDINGS[b.type], size = def.size, r = b._r;
    if (!r) return;
    const c = s.ctx, z = s.cam.z;
    const cx = iso(b.x + size / 2, b.y + size / 2).x;
    const headY = r.y + r.h * 0.12;
    const icon = (name, x, y, R, bob = 0) => {
      const im = cityImg(name);
      if (im) c.drawImage(im, x - R, y - R + bob, R * 2, R * 2);
      return { x: x - R, y: y - R + bob, w: R * 2, h: R * 2 };
    };
    if (b.captured) {
      const R = 15 / z, bob = Math.sin(this.t * 2.5 + b.id) * 3 / z;
      const h = icon('enemy', cx, headY + R, R, bob);
      this.hits.push({ b, ...h });
      return;
    }
    // табличка уровня у левого угла плиты
    if (b.level > 0) {
      const lp = iso(b.x, b.y + size);
      if (this.scene.cam.z > 0.45) s.label(String(b.level), lp.x + TW * 0.35, lp.y - TH * 0.2, { size: 9, bg: 'rgba(22,18,13,0.8)', color: '#e9dcc0' });
      if (!b.up && this.canUpgrade(b)) icon('upgrade', lp.x + TW * 0.35 + 13 / z, lp.y - TH * 0.2 - 16 / z, 7 / z, Math.sin(this.t * 3) * 1.5 / z);
    }
    if (b.level === 0 && !b.up) {
      const R = 13 / z;
      const h = icon('repair', cx, headY + R, R, Math.sin(this.t * 2.5 + b.id) * 2 / z);
      this.hits.push({ b, ...h });
      return;
    }
    if (b.up) {
      const left = (b.up.end - now) / 1000;
      const frac = 1 - left / b.up.total;
      s.bar(cx, headY + 10 / z, 64, frac, '#e2bd72');
      s.label(left > 0 ? fmtShort(left) : 'Готово', cx, headY + 6 / z, { size: 10, bg: 'rgba(22,18,13,0.8)', color: '#e9dcc0' });
      if (Math.random() < 0.06) s.emit(cx + (Math.random() - 0.5) * 40, r.y + r.h * 0.7, 2, 'dust');
      if (left <= 0 && !this.refreshing) { this.refreshing = true; this.app.refresh().finally(() => { this.refreshing = false; }); }
      return;
    }
    if (def.produces && b.level > 0) {
      const rate = rateOf(b.type, b.level) * (1 + (RACES[this.me.race]?.bonus.goldRate || 0));
      const cap = collectorCap(b);
      const cur = Math.min(cap, (b.store || 0) + rate * (now - b.last) / 3600e3);
      b._cur = cur;
      if (cur >= Math.max(10, cap * 0.05)) {
        const R = 14 / z, bob = Math.sin(this.t * 2.5 + b.id) * 2.5 / z;
        const by = headY + R;
        c.save();
        c.fillStyle = 'rgba(20,16,12,0.55)';
        c.beginPath(); c.arc(cx, by + bob, R * 1.12, 0, Math.PI * 2); c.fill();
        c.restore();
        const h = icon(RES_ICON[def.produces], cx, by, R, bob);
        // полоска наполнения под значком
        c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(cx - R, by + R + bob + 2 / z, R * 2, 3 / z);
        c.fillStyle = cur >= cap ? '#e2a04a' : '#8fc85a'; c.fillRect(cx - R, by + R + bob + 2 / z, R * 2 * cur / cap, 3 / z);
        this.hits.push({ b, bubble: true, x: h.x - 6 / z, y: h.y - 6 / z, w: h.w + 12 / z, h: h.h + 16 / z });
      }
    }
  }

  // Над руинами — лопата-подсказка, пока их больше трёх
  drawRuinHints() {
    const me = this.me;
    const open = (me.decor || []).filter((d) => inCity(d.x, d.y, RUIN_SIZE, this.cl));
    if (!open.length || (me.stats?.ruinsCleared || 0) >= 6) return;
    const z = this.scene.cam.z;
    for (const d of open) {
      const p = iso(d.x + 1, d.y + 1);
      const im = cityImg('build');
      if (im) this.scene.ctx.drawImage(im, p.x - 12 / z, p.y - TH * 2.2 - 12 / z + Math.sin(this.t * 3 + d.id) * 3 / z, 24 / z, 24 / z);
    }
  }

  // --- Праздники и всплывающие числа ------------------------------------------
  celebrate(b) {
    const size = BUILDINGS[b.type].size;
    const p = iso(b.x + size / 2, b.y + size / 2);
    this.scene.fxSprite('fx/fx_rays', p.x, p.y - TH * size * 0.2, TW * size * 1.8, 1.2);
    this.scene.emit(p.x, p.y - TH * size, 30, 'confetti');
    this.scene.emit(p.x, p.y - TH * size * 0.5, 16, 'spark');
    this.floatText(b, b.level > 1 ? `Уровень ${b.level}!` : 'Построено!', '#7fff6a', 1.6);
  }

  coinBurst(b) {
    const size = BUILDINGS[b.type].size;
    const p = iso(b.x + size / 2, b.y + size / 2);
    this.scene.emit(p.x, p.y - TH * size, 8, 'spark');
  }

  floatText(b, text, color, scale = 1) {
    const size = BUILDINGS[b.type].size;
    const p = iso(b.x + size / 2, b.y + size / 2);
    (this.floats ||= []).push({ x: p.x, y: p.y - TH * size * 1.8, text, color, t: 0, scale });
  }

  drawFloats(dt) {
    if (!this.floats?.length) return;
    const c = this.scene.ctx, z = this.scene.cam.z;
    for (const f of this.floats) {
      f.t += dt;
      const k = f.t / 1.6;
      c.save();
      c.globalAlpha = Math.max(0, 1 - k * k);
      c.font = `900 ${(20 * f.scale) / Math.max(0.5, z)}px Rubik, sans-serif`;
      c.textAlign = 'center';
      c.lineWidth = 5 / Math.max(0.5, z); c.strokeStyle = 'rgba(0,0,0,0.75)';
      const y = f.y - k * 70;
      c.strokeText(f.text, f.x, y); c.fillStyle = f.color; c.fillText(f.text, f.x, y);
      c.restore();
    }
    this.floats = this.floats.filter((f) => f.t < 1.6);
  }
}

function fmtShort(sec) {
  sec = Math.ceil(sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  if (h) return `${h}ч ${m}м`;
  if (m) return `${m}м ${s}с`;
  return `${s}с`;
}
