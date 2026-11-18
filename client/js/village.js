// Экран поселения: город с ячейками и дорогами. Всё делается нажатиями —
// удобно пальцем на телефоне: ячейка → здание, «Переместить» → ячейка.
import { BUILDINGS, collectorCap, RACES } from '/shared/config.js';
import { PLOTS, PLOT, CASTLE_POS, ringOpen, inPlot, isRoad, wallTiles, isPlotType, RING_UNLOCK, cityRect, X0, PITCH } from '/shared/city.js';
import { iso, TW, TH } from './scene.js';
import { img } from './assets.js';

const castleLvl = (base) => base.buildings.find((b) => b.type === 'castle')?.level || 1;

export class Village {
  constructor(scene, app) {
    this.scene = scene;
    this.app = app;
    this.me = null;
    this.sel = null;        // { kind: 'b'|'d'|'w', id }
    this.placing = null;    // { mode: 'plot'|'road'|'move', type, id }
    this.hits = [];
    this.t = 0;
  }

  get ghost() { return this.placing; } // совместимость (стрелка советника)

  setMe(me) {
    this.me = me;
    this.offset = me.now - Date.now();
    const base = this.visit || me;
    const cl = castleLvl(base);
    const wl = this.visit ? (base.buildings.find((b) => b.type === 'wall')?.level || 0) : me.wallLevel;
    this.wallList = this.visit ? base.buildings.filter((b) => b.type === 'wall') : (wl ? wallTiles(cl).map(([x, y], i) => ({ id: 'w' + i, type: 'wall', level: wl, x, y })) : []);
    this.walls = new Set(this.wallList.map((b) => b.x * 100 + b.y));
    // ворота — посередине каждой стороны стены
    const r = cityRect(cl), mid = Math.round((r.x0 + r.x1) / 2);
    this.gates = this.wallList.length ? [[mid, r.y0 - 1], [mid, r.y1 + 1], [r.x0 - 1, mid], [r.x1 + 1, mid]] : [];
    this.gateSet = new Set(this.gates.map(([x, y]) => x * 100 + y));
    if (this.sel && !this.findSel()) this.sel = null;
  }

  now() { return Date.now() + this.offset; }
  findSel() {
    if (!this.sel) return null;
    if (this.sel.kind === 'w') return this.wallObj();
    return this.sel.kind === 'b' ? this.me.buildings.find((b) => b.id === this.sel.id) : this.me.decor.find((d) => d.id === this.sel.id);
  }
  wallObj() { return this.me.wallLevel ? { id: 'wall', type: 'wall', level: this.me.wallLevel, x: 0, y: 0 } : null; }

  enter() {
    const s = this.scene;
    s.on('tap', (p, g) => this.tap(p, g));
    s.on('down', null); s.on('drag', null); s.on('drop', null);
    s.on('hover', null); s.on('hold', null); s.on('up', null);
  }

  hitTest(p) {
    const w = this.scene.toWorld(p.x, p.y);
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (w.x >= h.x && w.x <= h.x + h.w && w.y >= h.y && w.y <= h.y + h.h) return h;
    }
    return null;
  }

  // --- Ячейки ------------------------------------------------------------------
  plotState(p) {
    const me = this.me, cl = castleLvl(me);
    if (!ringOpen(p.ring, cl)) return 'locked';
    if (me.buildings.some((b) => isPlotType(b.type) && b.x === p.x && b.y === p.y)) return 'built';
    if (me.decor.some((d) => d.x >= p.x && d.x < p.x + PLOT && d.y >= p.y && d.y < p.y + PLOT)) return 'overgrown';
    return 'free';
  }
  roadFree(x, y) {
    return isRoad(x, y, castleLvl(this.me)) && !this.me.buildings.some((b) => b.type.startsWith('trap_') && b.x === x && b.y === y);
  }

  tap(p, g) {
    if (this.visit) return;
    const gx = Math.floor(g.gx), gy = Math.floor(g.gy);
    const pl = this.placing;
    if (pl) {
      if (pl.mode === 'road') {
        if (this.roadFree(gx, gy)) this.place(pl.type, gx, gy);
        else this.app.ui.toast('Ловушку ставят на свободную дорогу');
        return;
      }
      const plot = inPlot(gx, gy) || this.plotByHit(p);
      if (!plot) return;
      const st = this.plotState(plot);
      if (st === 'locked') { this.app.ui.toast(`Ячейка откроется на Цитадели ${RING_UNLOCK[plot.ring]} ур.`); return; }
      if (st === 'overgrown') { this.app.ui.toast('Сначала расчистите заросли на ячейке'); return; }
      if (pl.mode === 'move') { this.move(pl.id, plot); return; }
      if (st === 'built') { this.app.ui.toast('Ячейка занята — выберите свободную'); return; }
      this.place(pl.type, plot.x, plot.y);
      return;
    }
    const h = this.hitTest(p);
    if (h?.bubble) { this.app.collect(h.b.id); return; }
    if (h?.wall) { this.sel = { kind: 'w' }; this.app.ui.select(this.wallObj(), 'b'); this.app.sfx('click'); return; }
    if (h && (h.b || h.d)) {
      this.sel = h.b ? { kind: 'b', id: h.b.id } : { kind: 'd', id: h.d.id };
      this.app.ui.select(this.findSel(), this.sel.kind);
      this.app.sfx('click');
      return;
    }
    // пустая ячейка → сразу магазин «построить здесь»
    const plot = inPlot(gx, gy);
    if (plot) {
      const st = this.plotState(plot);
      if (st === 'free') { this.sel = null; this.app.ui.select(null); this.app.ui.openShop('eco', plot); this.app.sfx('click'); return; }
      if (st === 'locked') { this.app.ui.toast(`🔒 Ячейка откроется на Цитадели ${RING_UNLOCK[plot.ring]} ур.`); return; }
    }
    this.sel = null;
    this.app.ui.select(null);
  }

  plotByHit(p) {
    const h = this.hitTest(p);
    if (h?.b && isPlotType(h.b.type)) return PLOTS.find((q) => q.x === h.b.x && q.y === h.b.y) || null;
    return null;
  }

  // Режим выбора места: подсвечиваем подходящие ячейки или дороги
  startPlacing(type, plot) {
    const def = BUILDINGS[type];
    this.sel = null;
    this.app.ui.select(null);
    if (plot && isPlotType(type)) { this.place(type, plot.x, plot.y); return; }
    this.placing = { mode: def.cat === 'trap' ? 'road' : 'plot', type };
    const free = PLOTS.filter((q) => this.plotState(q) === 'free');
    if (this.placing.mode === 'plot' && !free.length) { this.placing = null; this.app.ui.toast('Нет свободных ячеек — расчистите заросли или улучшите Цитадель'); return; }
    this.app.ui.placing(true, this.placing.mode === 'road' ? 'Нажмите на дорогу, чтобы поставить ловушку' : `Выберите ячейку для «${def.name}»`);
  }

  startMove(b) {
    this.placing = { mode: b.type.startsWith('trap_') ? 'road' : 'move', type: b.type, id: b.id };
    this.app.ui.placing(true, 'Выберите ячейку — здания поменяются местами');
  }

  cancelPlacing() { this.placing = null; this.app.ui.placing(false); }

  async place(type, x, y) {
    try {
      await this.app.act('place', { type, x, y });
      this.app.sfx('build');
      const size = BUILDINGS[type].size, c = iso(x + size / 2, y + size / 2);
      this.scene.emit(c.x, c.y, 16, 'dust');
      this.cancelPlacing();
    } catch { /* тост показан */ }
  }

  async move(id, plot) {
    const b = this.me.buildings.find((v) => v.id === id);
    if (!b) return this.cancelPlacing();
    if (this.placing.mode === 'road') return;
    try {
      await this.app.act('move', { id, x: plot.x, y: plot.y });
      this.app.sfx('build');
    } catch { /* */ }
    this.cancelPlacing();
  }

  // --- Кадр ----------------------------------------------------------------------
  frame(dt) {
    const s = this.scene;
    const me = this.visit || this.me;
    if (!me) return;
    this.t += dt;
    const now = this.now();
    const cl = castleLvl(me);
    s.begin();
    s.drawBackground();
    const occ = new Set(me.buildings.filter((b) => isPlotType(b.type)).map((b) => b.x + ',' + b.y));
    s.drawCity(cl, !this.visit, occ);
    // подсветка доступных мест
    const pl = this.placing;
    if (pl && !this.visit) {
      if (pl.mode === 'road') {
        const r = cityRect(cl), cells = [];
        for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (this.roadFree(x, y)) cells.push([x, y, 1]);
        s.highlight(cells, 'rgba(255,220,80,0.5)', this.t);
      } else {
        const cells = PLOTS.filter((q) => { const st = this.plotState(q); return st === 'free' || (pl.mode === 'move' && st === 'built'); }).map((q) => [q.x, q.y, PLOT]);
        s.highlight(cells, pl.mode === 'move' ? 'rgba(120,180,255,0.45)' : 'rgba(90,255,120,0.45)', this.t);
      }
    }
    const items = [];
    for (const b of me.buildings) {
      if (b.type === 'wall') continue;
      const size = BUILDINGS[b.type].size;
      items.push({ d: b.x + b.y + size * 2, b });
    }
    for (const w of this.wallList) items.push({ d: w.x + w.y + 1.5, wall: w });
    for (const d of me.decor) {
      const p = inPlot(d.x, d.y);
      if (p && !ringOpen(p.ring, cl)) continue; // закрытые ячейки уже нарисованы заросшими
      items.push({ d: d.x + d.y + 2, dec: d });
    }
    this.updateLife(dt, me);
    for (const w of this.walkers) items.push({ d: w.x + w.y + 0.3, walker: w });
    for (const b of me.buildings) if (b.up) {
      const size = BUILDINGS[b.type].size;
      items.push({ d: b.x + b.y + size * 2 + 0.6, worker: b });
    }
    items.sort((a, b) => a.d - b.d);

    this.hits = [];
    const selObj = this.visit ? null : this.findSel();
    for (const it of items) {
      if (it.walker) { this.drawWalker(it.walker); continue; }
      if (it.worker) { this.drawWorker(it.worker); continue; }
      if (it.wall) { this.drawWall(it.wall, this.sel?.kind === 'w'); continue; }
      if (it.b) this.drawB(it.b, now, selObj === it.b);
      else if (it.dec) {
        if (selObj === it.dec) s.diamond(it.dec.x, it.dec.y, 1, 1, 'rgba(255,255,255,0.25)', '#fff');
        s.drawDecor(it.dec);
        const bot = iso(it.dec.x + 1, it.dec.y + 1);
        this.hits.push({ d: it.dec, x: bot.x - TW * 0.6, y: bot.y - TH * 3, w: TW * 1.2, h: TH * 3 });
      }
    }
    // пузыри сбора и подписи поверх
    if (!this.visit) for (const b of me.buildings) this.drawOverlay(b, now);
    this.drawSky(dt);
    s.drawParticles(dt);
    this.drawFloats(dt);
    if (!this.visit) this.app.ui.tick(now);
  }

  drawWall(w, selected) {
    const s = this.scene;
    if (this.gateSet.has(w.x * 100 + w.y)) {
      const im = img('city/gate');
      if (im) {
        const bot = iso(w.x + 1, w.y + 1), wd = TW * 2.1, h = im.height * wd / im.width;
        s.ctx.drawImage(im, bot.x - wd / 2, bot.y - h + TH * 0.6, wd, h);
        this.hits.push({ wall: true, x: bot.x - wd / 2, y: bot.y - h, w: wd, h });
        return;
      }
    }
    s.drawBuilding(w, { walls: this.walls, noPad: true, flash: selected && Math.sin(this.t * 8) > 0.6 });
    const bot = iso(w.x + 1, w.y + 1);
    this.hits.push({ wall: true, x: bot.x - TW * 0.5, y: bot.y - TH * 2, w: TW, h: TH * 2 });
  }

  // --- Жизнь в поселении ---------------------------------------------------------
  updateLife(dt, me) {
    if (!this.walkers || this.walkersFor !== me) {
      this.walkersFor = me;
      const kinds = ['peasant', 'farmer', 'merchant', 'guard', 'monk', 'child', 'smith'];
      const n = Math.min(kinds.length, 3 + me.buildings.filter((b) => b.level > 0 && BUILDINGS[b.type].cat !== 'wall').length / 3 | 0);
      this.walkers = Array.from({ length: n }, (_, i) => {
        const p = this.randomSpot(me) || { x: 21, y: 25 };
        return { kind: kinds[i], x: p.x, y: p.y, tx: p.x, ty: p.y, wait: Math.random() * 3, dir: 1, ph: Math.random() * 6 };
      });
    }
    for (const w of this.walkers) {
      if (w.wait > 0) { w.wait -= dt; continue; }
      const dx = w.tx - w.x, dy = w.ty - w.y, d = Math.hypot(dx, dy);
      if (d < 0.05) {
        w.wait = 1 + Math.random() * 4;
        const p = this.randomSpot(me, w);
        if (p) { w.tx = p.x; w.ty = p.y; }
        continue;
      }
      const sp = 0.7 * dt;
      w.x += dx / d * Math.min(sp, d); w.y += dy / d * Math.min(sp, d);
      if (Math.abs(dx - dy) > 0.01) w.dir = dx - dy > 0 ? 1 : -1;
    }
  }

  // Жители ходят по дорогам: от перекрёстка к соседнему перекрёстку
  randomSpot(me, from) {
    const r = cityRect(castleLvl(me));
    const nodes = [];
    for (let k = -1; k < 8; k++) {
      const v = X0 + k * PITCH + PLOT;
      if (v >= r.x0 && v <= r.x1) nodes.push(v);
    }
    const ok = (x, y) => nodes.includes(x) && nodes.includes(y) && isRoad(x, y, castleLvl(me));
    if (!from) {
      for (let i = 0; i < 30; i++) {
        const x = nodes[Math.floor(Math.random() * nodes.length)], y = nodes[Math.floor(Math.random() * nodes.length)];
        if (ok(x, y)) return { x: x + 0.5, y: y + 0.5 };
      }
      return null;
    }
    const fx = Math.floor(from.x), fy = Math.floor(from.y);
    const dirs = [[PITCH, 0], [-PITCH, 0], [0, PITCH], [0, -PITCH]].filter(([dx, dy]) => {
      if (!ok(fx + dx, fy + dy)) return false;
      for (let k = 1; k < PITCH; k++) if (!isRoad(fx + Math.sign(dx) * k, fy + Math.sign(dy) * k, castleLvl(me))) return false;
      return true;
    });
    if (!dirs.length) return null;
    const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
    return { x: fx + dx + 0.5, y: fy + dy + 0.5 };
  }

  drawWalker(w) {
    const im = img('villagers/' + w.kind);
    if (!im) return;
    const c = this.scene.ctx, p = iso(w.x, w.y);
    const H = TH * 1.25, ww = im.width * H / im.height;
    const moving = w.wait <= 0;
    const bob = moving ? Math.abs(Math.sin(this.t * 9 + w.ph)) * 2.5 : 0;
    c.save();
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath(); c.ellipse(p.x, p.y, H * 0.22, H * 0.09, 0, 0, Math.PI * 2); c.fill();
    c.translate(p.x, p.y - bob);
    if (w.dir < 0) c.scale(-1, 1);
    c.drawImage(im, -ww / 2, -H, ww, H);
    c.restore();
  }

  // Гном-строитель стучит молотом у стройки
  drawWorker(b) {
    const im = img('villagers/builder');
    if (!im) return;
    const size = BUILDINGS[b.type].size;
    const p = iso(b.x + size + 0.35, b.y + size * 0.65);
    const c = this.scene.ctx;
    const H = TH * 1.35, w = im.width * H / im.height;
    const hit = Math.sin(this.t * 7 + b.id);
    c.save();
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath(); c.ellipse(p.x, p.y, H * 0.22, H * 0.09, 0, 0, Math.PI * 2); c.fill();
    c.translate(p.x, p.y);
    c.scale(-1, 1);
    c.rotate(hit > 0 ? -0.08 * hit : 0);
    c.drawImage(im, -w / 2, -H, w, H);
    c.restore();
    if (hit > 0.97 && Math.random() < 0.5) { this.scene.emit(p.x - 12, p.y - H * 0.4, 3, 'spark'); this.app.sfx?.('tap'); }
  }

  // Тени облаков и птицы
  drawSky(dt) {
    const c = this.scene.ctx;
    if (!this.clouds) {
      this.clouds = Array.from({ length: 4 }, (_, i) => ({ x: -1400 + i * 800 + Math.random() * 300, y: 200 + Math.random() * 1100, r: 260 + Math.random() * 220 }));
      this.birdT = 6;
    }
    c.save();
    for (const cl of this.clouds) {
      cl.x += 18 * dt; cl.y += 4 * dt;
      if (cl.x - cl.r > 1700) { cl.x = -1700 - cl.r; cl.y = 100 + Math.random() * 1200; }
      const g = c.createRadialGradient(cl.x, cl.y, cl.r * 0.2, cl.x, cl.y, cl.r);
      g.addColorStop(0, 'rgba(10,25,40,0.13)'); g.addColorStop(1, 'rgba(10,25,40,0)');
      c.fillStyle = g;
      c.beginPath(); c.ellipse(cl.x, cl.y, cl.r * 1.4, cl.r * 0.6, 0, 0, Math.PI * 2); c.fill();
    }
    this.birdT -= dt;
    if (this.birdT <= 0 && !this.birds) {
      const y = 100 + Math.random() * 700;
      this.birds = Array.from({ length: 4 + (Math.random() * 4 | 0) }, (_, i) => ({ x: -1600 - i * 40, y: y + (i % 2 ? 18 : -18) * Math.ceil(i / 2), ph: Math.random() * 6 }));
    }
    if (this.birds) {
      c.strokeStyle = 'rgba(30,30,30,0.8)'; c.lineWidth = 2.2; c.lineCap = 'round';
      for (const b of this.birds) {
        b.x += 160 * dt; b.y -= 12 * dt;
        const f = Math.sin(this.t * 10 + b.ph) * 6;
        c.beginPath(); c.moveTo(b.x - 9, b.y - f); c.quadraticCurveTo(b.x - 3, b.y - 4, b.x, b.y); c.quadraticCurveTo(b.x + 3, b.y - 4, b.x + 9, b.y - f); c.stroke();
      }
      if (this.birds.every((b) => b.x > 1700)) { this.birds = null; this.birdT = 15 + Math.random() * 20; }
    }
    c.restore();
  }

  // Праздник: стройка завершена
  celebrate(b) {
    const size = BUILDINGS[b.type].size;
    const p = iso(b.x + size / 2, b.y + size / 2);
    this.scene.fxSprite('fx/fx_levelup', p.x, p.y + TH * size * 0.6, TW * size * 1.5, 1.6);
    this.scene.fxSprite('fx/fx_rays', p.x, p.y - TH * size * 0.2, TW * size * 1.8, 1.2);
    setTimeout(() => this.scene.fxSprite('fx/fx_confetti', p.x, p.y - TH * size * 0.6, TW * size * 1.6, 1.3), 250);
    this.scene.emit(p.x, p.y - TH * size, 40, 'confetti');
    this.scene.emit(p.x, p.y - TH * size * 0.5, 16, 'spark');
    this.floatText(b, b.level > 1 ? `Уровень ${b.level}!` : 'Построено!', '#7fff6a', 1.8);
  }

  coinBurst(b) {
    const size = BUILDINGS[b.type].size;
    const p = iso(b.x + size / 2, b.y + size / 2);
    this.scene.fxSprite('fx/fx_coins', p.x, p.y - TH * size * 0.4, TW * size * 0.9, 0.9);
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
      c.font = `900 ${(22 * f.scale) / Math.max(0.6, z)}px Rubik, sans-serif`;
      c.textAlign = 'center';
      c.lineWidth = 5 / Math.max(0.6, z); c.strokeStyle = 'rgba(0,0,0,0.75)';
      const y = f.y - k * 70;
      c.strokeText(f.text, f.x, y); c.fillStyle = f.color; c.fillText(f.text, f.x, y);
      c.restore();
    }
    this.floats = this.floats.filter((f) => f.t < 1.6);
  }

  drawB(b, now, selected) {
    const s = this.scene, def = BUILDINGS[b.type];
    const size = def.size;
    if (selected) {
      s.diamond(b.x, b.y, size, size, null, '#ffe27a');
    }
    const building = b.level === 0;
    s.drawBuilding(b, {
      walls: this.walls,
      alpha: building ? 0.55 : 1,
      flash: selected && Math.sin(this.t * 8) > 0.6,
      lift: selected ? -4 : 0,
      noPad: true,
    });
    const im = img(s.spriteFor(b, this.walls).name);
    const bot = iso(b.x + size, b.y + size);
    const w = size * TW, h = im ? im.height * w / im.width : TH * 2;
    this.hits.push({ b, x: bot.x - w / 2, y: bot.y - h, w, h: h + 4 });
    // дымок у кузницы
    if (b.type === 'forge' && Math.random() < 0.05) s.emit(bot.x + 10, bot.y - h * 0.9, 1, 'smoke');
  }

  drawOverlay(b, now) {
    const s = this.scene, def = BUILDINGS[b.type], size = def.size;
    const top = iso(b.x + size / 2, b.y + size / 2);
    const im = img(s.spriteFor(b, this.walls).name);
    const h = im ? im.height * size * TW / im.width : TH * 2;
    const headY = iso(b.x + size, b.y + size).y - h;
    if (b.up) {
      const left = (b.up.end - now) / 1000;
      const frac = 1 - left / b.up.total;
      s.bar(top.x, headY - 6, 90, frac, '#ffcc33');
      s.label(left > 0 ? fmtShort(left) : 'Готово!', top.x, headY - 10, { size: 12, icon: 'ui/upgrade_arrow' });
      if (Math.random() < 0.08) s.emit(top.x + (Math.random() - 0.5) * 40, iso(b.x + size, b.y + size).y - 20, 2, 'dust');
      if (left <= 0 && !this.refreshing) { this.refreshing = true; this.app.refresh().finally(() => { this.refreshing = false; }); }
    }
    if (def.produces && b.level > 0 && !b.up) {
      const rate = def.rate[b.level - 1] * (def.produces === 'gold' ? 1 + (RACES[this.me.race]?.bonus.goldRate || 0) : 1);
      const cur = Math.min(collectorCap(b), (b.store || 0) + rate * (now - b.last) / 3600e3);
      b._cur = cur;
      if (cur >= Math.max(10, collectorCap(b) * 0.05)) {
        const bob = Math.sin(this.t * 3 + b.id) * 4;
        const R = 22 / s.cam.z;
        const by = headY - 10 + bob;
        const c = s.ctx;
        c.save();
        c.fillStyle = 'rgba(255,250,235,0.95)';
        c.strokeStyle = '#c8962b'; c.lineWidth = 3 / s.cam.z;
        c.beginPath(); c.arc(top.x, by - R, R, 0, Math.PI * 2); c.fill(); c.stroke();
        const icon = img(def.produces === 'gold' ? 'ui/icon_gold' : 'ui/icon_food');
        if (icon) c.drawImage(icon, top.x - R * 0.75, by - R * 1.75, R * 1.5, R * 1.5);
        c.restore();
        this.hits.push({ b, bubble: true, x: top.x - R, y: by - 2 * R, w: 2 * R, h: 2 * R });
      }
    }
  }
}

function fmtShort(sec) {
  sec = Math.ceil(sec);
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  if (h) return `${h}ч ${m}м`;
  if (m) return `${m}м ${s}с`;
  return `${s}с`;
}
