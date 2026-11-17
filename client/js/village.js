// Экран поселения: отрисовка своей базы, выбор/перенос/постройка зданий.
import { BUILDINGS, BUILD_MIN, BUILD_MAX, collectorCap, RACES } from '/shared/config.js';
import { iso, TW, TH } from './scene.js';
import { img } from './assets.js';

export class Village {
  constructor(scene, app) {
    this.scene = scene;
    this.app = app;
    this.me = null;
    this.sel = null;        // { kind: 'b'|'d', id }
    this.ghost = null;      // { type, x, y, id?, move? }
    this.hits = [];
    this.t = 0;
  }

  setMe(me) {
    this.me = me;
    this.offset = me.now - Date.now();
    const base = this.visit || me;
    this.walls = new Set(base.buildings.filter((b) => b.type === 'wall').map((b) => b.x * 100 + b.y));
    if (this.sel && !this.findSel()) this.sel = null;
  }

  now() { return Date.now() + this.offset; }
  findSel() {
    if (!this.sel) return null;
    return this.sel.kind === 'b' ? this.me.buildings.find((b) => b.id === this.sel.id) : this.me.decor.find((d) => d.id === this.sel.id);
  }

  enter() {
    const s = this.scene;
    s.on('tap', (p, g) => this.tap(p, g));
    s.on('down', (p, g) => this.down(p, g));
    s.on('drag', (p, g) => this.dragTo(g));
    s.on('drop', (p, g) => this.drop(g));
    s.on('hover', null); s.on('hold', null); s.on('up', null);
  }

  // --- Попадание по объектам -------------------------------------------------
  hitTest(p) {
    const w = this.scene.toWorld(p.x, p.y);
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (w.x >= h.x && w.x <= h.x + h.w && w.y >= h.y && w.y <= h.y + h.h) return h;
    }
    return null;
  }

  tileFree(type, x, y, ignoreId) {
    const size = BUILDINGS[type].size;
    if (x < BUILD_MIN || y < BUILD_MIN || x + size > BUILD_MAX || y + size > BUILD_MAX) return false;
    for (const b of this.me.buildings) {
      if (b.id === ignoreId) continue;
      const s = BUILDINGS[b.type].size;
      if (x < b.x + s && x + size > b.x && y < b.y + s && y + size > b.y) return false;
    }
    for (const d of this.me.decor) if (d.x >= x && d.x < x + size && d.y >= y && d.y < y + size) return false;
    return true;
  }

  tap(p, g) {
    if (this.visit) return;
    if (this.ghost && !this.ghost.move) { this.moveGhost(g); return; }
    const h = this.hitTest(p);
    if (h?.bubble) { this.app.collect(h.b.id); return; }
    if (h) {
      this.sel = h.b ? { kind: 'b', id: h.b.id } : { kind: 'd', id: h.d.id };
      this.app.ui.select(this.findSel(), this.sel.kind);
      this.app.sfx('click');
      return;
    }
    this.sel = null;
    this.app.ui.select(null);
  }

  down(p, g) {
    if (this.visit) return false;
    if (this.ghost) {
      const size = BUILDINGS[this.ghost.type].size;
      if (g.gx >= this.ghost.x - 1 && g.gx < this.ghost.x + size + 1 && g.gy >= this.ghost.y - 1 && g.gy < this.ghost.y + size + 1) {
        this.dragOff = { dx: g.gx - this.ghost.x, dy: g.gy - this.ghost.y };
        return true;
      }
      return false;
    }
    const b = this.sel?.kind === 'b' && this.findSel();
    if (!b) return false;
    const size = BUILDINGS[b.type].size;
    if (g.gx >= b.x && g.gx < b.x + size && g.gy >= b.y && g.gy < b.y + size) {
      this.ghost = { type: b.type, x: b.x, y: b.y, id: b.id, level: b.level, move: true };
      this.dragOff = { dx: g.gx - b.x, dy: g.gy - b.y };
      return true;
    }
    return false;
  }

  dragTo(g) {
    if (!this.ghost) return;
    const x = Math.floor(g.gx - this.dragOff.dx + 0.5), y = Math.floor(g.gy - this.dragOff.dy + 0.5);
    this.ghost.x = x; this.ghost.y = y;
  }

  async drop() {
    const gh = this.ghost;
    if (!gh?.move) return;
    const b = this.me.buildings.find((v) => v.id === gh.id);
    this.ghost = null;
    if (!b || (b.x === gh.x && b.y === gh.y)) return;
    if (!this.tileFree(b.type, gh.x, gh.y, b.id)) { this.app.ui.toast('Здесь нельзя поставить'); return; }
    const ox = b.x, oy = b.y;
    b.x = gh.x; b.y = gh.y; // оптимистично
    this.setMe(this.me);
    try { await this.app.act('move', { id: b.id, x: gh.x, y: gh.y }); } catch { b.x = ox; b.y = oy; }
  }

  moveGhost(g) {
    const size = BUILDINGS[this.ghost.type].size;
    this.ghost.x = Math.floor(g.gx - size / 2 + 0.5);
    this.ghost.y = Math.floor(g.gy - size / 2 + 0.5);
  }

  startPlacing(type) {
    const size = BUILDINGS[type].size;
    const c = this.scene.toGrid(this.scene.w / 2, this.scene.h / 2);
    let best = null, bd = 1e9;
    for (let y = BUILD_MIN; y <= BUILD_MAX - size; y++) for (let x = BUILD_MIN; x <= BUILD_MAX - size; x++) {
      const d = (x - c.gx) ** 2 + (y - c.gy) ** 2;
      if (d < bd && this.tileFree(type, x, y)) { bd = d; best = { x, y }; }
    }
    if (!best) { this.app.ui.toast('Нет свободного места'); return; }
    this.sel = null;
    this.app.ui.select(null);
    this.ghost = { type, ...best, level: 1 };
    this.app.ui.placing(true);
  }

  cancelPlacing() { this.ghost = null; this.app.ui.placing(false); }

  async confirmPlacing() {
    const gh = this.ghost;
    if (!gh || gh.move) return;
    if (!this.tileFree(gh.type, gh.x, gh.y)) { this.app.ui.toast('Место занято'); return; }
    try {
      await this.app.act('place', { type: gh.type, x: gh.x, y: gh.y });
      this.app.sfx('build');
      const iso2 = iso(gh.x + 1, gh.y + 1);
      this.scene.emit(iso2.x, iso2.y, 14, 'dust');
      if (gh.type === 'wall') {
        // стены удобно ставить цепочкой
        const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
        const prev = this.lastWall;
        let nx = null;
        if (prev) { const d = [gh.x - prev.x, gh.y - prev.y]; if (Math.abs(d[0]) + Math.abs(d[1]) === 1) nx = { x: gh.x + d[0], y: gh.y + d[1] }; }
        this.lastWall = { x: gh.x, y: gh.y };
        if (!nx || !this.tileFree('wall', nx.x, nx.y)) nx = dirs.map(([dx, dy]) => ({ x: gh.x + dx, y: gh.y + dy })).find((p) => this.tileFree('wall', p.x, p.y));
        if (nx && this.app.ui.canBuildMore('wall')) { this.ghost = { type: 'wall', ...nx, level: 1 }; return; }
      }
      this.cancelPlacing();
    } catch { /* тост уже показан */ }
  }

  // --- Кадр ----------------------------------------------------------------------
  frame(dt) {
    const s = this.scene, c = s.ctx;
    const me = this.visit || this.me;
    if (!me) return;
    this.t += dt;
    const now = this.now();
    s.begin();
    s.drawBackground();
    if (this.ghost) s.drawGrid(0.18, BUILD_MIN, BUILD_MAX);
    // список для сортировки по глубине
    const items = [];
    for (const b of me.buildings) {
      if (this.ghost?.move && this.ghost.id === b.id) continue;
      const size = BUILDINGS[b.type].size;
      items.push({ d: b.x + b.y + size * 2 - (BUILDINGS[b.type].cat === 'wall' ? 0.5 : 0), b });
    }
    for (const d of me.decor) items.push({ d: d.x + d.y + 2, dec: d });
    if (this.ghost) items.push({ d: this.ghost.x + this.ghost.y + BUILDINGS[this.ghost.type].size * 2 + 0.1, ghost: this.ghost });
    items.sort((a, b) => a.d - b.d);

    this.hits = [];
    const selObj = this.visit ? null : this.findSel();
    for (const it of items) {
      if (it.b) this.drawB(it.b, now, selObj === it.b);
      else if (it.dec) {
        if (selObj === it.dec) s.diamond(it.dec.x, it.dec.y, 1, 1, 'rgba(255,255,255,0.25)', '#fff');
        s.drawDecor(it.dec);
        const bot = iso(it.dec.x + 1, it.dec.y + 1);
        this.hits.push({ d: it.dec, x: bot.x - TW * 0.6, y: bot.y - TH * 3, w: TW * 1.2, h: TH * 3 });
      } else if (it.ghost) {
        const gh = it.ghost;
        const ok = this.tileFree(gh.type, gh.x, gh.y, gh.id);
        const size = BUILDINGS[gh.type].size;
        s.diamond(gh.x, gh.y, size, size, ok ? 'rgba(80,255,120,0.35)' : 'rgba(255,60,60,0.45)', ok ? '#5f5' : '#f44');
        s.drawBuilding({ type: gh.type, level: gh.level || 1, x: gh.x, y: gh.y }, { alpha: 0.85, lift: -6 - Math.sin(this.t * 6) * 3, walls: this.walls });
        if (!gh.move) {
          const top = iso(gh.x + size / 2, gh.y + size / 2);
          s.label(BUILDINGS[gh.type].name, top.x, top.y - size * TH * 1.6, { size: 14 });
        }
      }
    }
    // пузыри сбора и подписи поверх
    if (!this.visit) for (const b of me.buildings) this.drawOverlay(b, now);
    s.drawParticles(dt);
    if (!this.visit) this.app.ui.tick(now);
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
      noPad: def.cat === 'wall',
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
