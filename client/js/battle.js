// Экран атаки: живая симуляция боя (тот же код, что проверяет сервер).
import { BUILDINGS, TROOPS, HEROES, SPELLS, BATTLE, GRID, fmt } from '/shared/config.js';
import { createBattle, step, canDeployAt, percent } from '/shared/sim.js';
import { iso, TW, TH } from './scene.js';
import { img } from './assets.js';
import { inPlot, ringOpen } from '/shared/city.js';

const UNIT_H = { swordsman: 1.3, crossbowman: 1.3, thief: 1.25, shieldbearer: 1.75, sapper: 1.3, battlemage: 1.5, priest: 1.6, ram: 1.9, griffin: 2.3, knight: 2.1, huntress: 2.0, runesmith: 1.9, sorceress: 2.0 };
const TICK = 1 / BATTLE.tickRate;

export class Battle {
  constructor(scene, app) {
    this.scene = scene;
    this.app = app;
  }

  start(data) {
    this.data = data;
    this.S = createBattle({ base: data.base, defRace: data.defRace, attacker: data.attacker });
    this.log = [];
    this.queue = [];
    this.acc = 0;
    this.t = 0;
    this.started = false;
    this.scout = BATTLE.scoutTime;
    this.sel = null;
    this.prev = new Map();
    this.flash = new Map();
    this.burning = new Set();
    this.showZone = 0;
    this.finished = false;
    this.lootMax = { gold: 0, food: 0 };
    for (const b of data.base.buildings) if (b.loot) { this.lootMax.gold += b.loot.gold; this.lootMax.food += b.loot.food; }
    this.walls = new Set(this.S.bld.filter((b) => b.cat === 'wall').map((b) => b.x * 100 + b.y));
    this.castleLevel = this.S.bld.find((b) => b.cat === 'castle')?.level || 1;
    this.occupied = new Set(this.S.bld.filter((b) => b.cat !== 'wall' && b.cat !== 'trap' && b.cat !== 'castle').map((b) => b.x + ',' + b.y));
    const s = this.scene;
    s.on('drag', (p, g) => { this.holding = g; });
    s.on('drop', () => { this.holding = null; });
    s.on('up', () => { this.holding = null; });
    s.on('hover', null); s.on('hold', null);
    // если тянут без выбранной карточки — это панорамирование
    s.on('down', (p, g) => {
      if (!this.sel) return false;
      this.holding = g; this.holdT = 0; this.deploy(g); return true;
    });
    s.on('tap', (p, g) => { if (!this.sel) this.app.ui.toast('Выберите отряд внизу экрана'); });
    this.app.ui.battleHud(this);
  }

  lockedDecor(d) {
    const p = inPlot(d.x, d.y);
    return p && !ringOpen(p.ring, this.castleLevel);
  }

  select(card) { this.sel = card; this.app.ui.battleCards(this); }

  deploy(g) {
    if (!this.sel || this.S.over) return;
    const { kind, k } = this.sel;
    if (kind === 'ability') return;
    const x = Math.round(g.gx * 10) / 10, y = Math.round(g.gy * 10) / 10;
    if (kind !== 'spell' && !canDeployAt(this.S, x, y)) { this.showZone = 1.5; return; }
    if (kind === 'spell' && (x < 0 || y < 0 || x >= GRID || y >= GRID)) return;
    const left = kind === 'troop' ? this.S.left.troops[k] - this.queued('troop', k) : kind === 'hero' ? (this.S.left.heroes[k] && !this.queued('hero', k)) : this.S.left.spells[k] - this.queued('spell', k);
    if (!(left > 0 || left === true)) return;
    this.queue.push({ c: kind, k, x, y });
    this.started = true;
    if (kind !== 'troop') { this.holding = null; }
    this.app.sfx(kind === 'spell' ? 'spell' : 'deploy');
  }

  queued(c, k) { return this.queue.filter((q) => q.c === c && q.k === k).length; }

  ability(k) {
    this.queue.push({ c: 'ability', k, x: 0, y: 0 });
    this.app.sfx('spell');
  }

  surrender() {
    if (this.S.over) return;
    this.queue.push({ c: 'end', k: '', x: 0, y: 0 });
    this.started = true;
  }

  // --- Шаг ----------------------------------------------------------------------
  frame(dt) {
    this.t += dt;
    const S = this.S;
    if (this.holding && this.sel?.kind === 'troop') {
      this.holdT += dt;
      while (this.holdT > 0.12) { this.holdT -= 0.12; this.deploy(this.holding); }
    }
    if (!this.started && !S.over) {
      this.scout -= dt;
      if (this.scout <= 0) this.started = true;
    }
    if (this.started && !S.over) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= TICK && n++ < 5 && !S.over) {
        this.acc -= TICK;
        this.prev = new Map(S.units.map((u) => [u.id, { x: u.x, y: u.y }]));
        const cmds = this.queue.splice(0).map((c) => ({ ...c, t: S.tick }));
        for (const c of cmds) this.log.push(c);
        step(S, cmds);
        this.consumeFx();
      }
    }
    if (S.over && !this.finished) { this.finished = true; this.finish(); }
    this.draw(dt);
    this.app.ui.battleTick(this);
  }

  consumeFx() {
    const s = this.scene;
    for (const f of this.S.fx) {
      const p = iso(f.x, f.y);
      switch (f.k) {
        case 'destroy': {
          s.emit(p.x, p.y - 20, f.wall ? 6 : 26, 'dust');
          if (!f.wall) { s.emit(p.x, p.y - 30, 10, 'smoke'); s.fxSprite('buildings/rubble_fire', p.x, p.y + 10, TW * f.size * 0.9, 1.4, false); }
          this.burning.delete(f.i);
          if (!f.wall) s.shake(4 + f.size * 2);
          this.app.sfx('destroy');
          break;
        }
        case 'hit': s.emit(p.x, p.y - 20, f.small ? 2 : 6, 'spark'); this.flash.set('b' + f.i, 0.1); break;
        case 'impact': s.emit(p.x, p.y, 10, f.type === 'magetower' ? 'spark' : 'dust'); if (f.type === 'magetower') s.fxSprite('spells/fx_lightning', p.x, p.y, TW * 1.4, 0.4); break;
        case 'spell': {
          const map = { fireball: 'fx_fireball', lightning: 'fx_lightning', heal: 'fx_heal', rage: 'fx_rage', freeze: 'fx_freeze' };
          s.fxSprite('spells/' + map[f.spell], p.x, p.y + TH * 0.5, TW * f.r * 1.6, f.spell === 'fireball' ? 1 : 1.2);
          if (f.spell === 'fireball') { s.emit(p.x, p.y, 30, 'spark'); s.shake(10); }
          break;
        }
        case 'bolt': s.shake(6); s.fxSprite('spells/fx_lightning', p.x, p.y + TH * 0.4, TW * 2, 0.5); s.emit(p.x, p.y, 12, 'spark'); break;
        case 'meteor': s.fxSprite('spells/fx_fireball', p.x, p.y + TH * 0.4, TW * 2, 0.7); s.emit(p.x, p.y, 10, 'spark'); break;
        case 'boom': s.shake(9); s.fxSprite('spells/fx_fireball', p.x, p.y + TH * 0.3, TW * 2.2, 0.7); s.emit(p.x, p.y, 20, 'dust'); this.app.sfx('boom'); break;
        case 'trap': s.shake(8); s.fxSprite(f.type === 'trap_rune' ? 'spells/fx_lightning' : 'spells/fx_fireball', p.x, p.y + TH * 0.4, TW * f.r * 1.4, 0.7); s.emit(p.x, p.y, 16, 'dust'); this.app.sfx('boom'); break;
        case 'ability': s.fxSprite(f.hero === 'runesmith' ? 'spells/fx_quake' : f.hero === 'huntress' ? 'spells/fx_invis' : 'spells/fx_rage', p.x, p.y + TH * 0.5, TW * 3.5, 1.2); break;
        case 'healpulse': s.emit(p.x, p.y - 20, 3, 'heal'); break;
        case 'deploy': s.emit(p.x, p.y, 6, 'dust'); break;
        case 'die': s.emit(p.x, p.y - 10, 8, 'dust'); break;
        case 'fire': this.flash.set('f' + f.i, 0.12); break;
      }
    }
    this.S.fx.length = 0;
  }

  // --- Отрисовка ----------------------------------------------------------------
  draw(dt) {
    const s = this.scene, c = s.ctx, S = this.S;
    const alpha = this.started && !S.over ? Math.min(1, this.acc / TICK) : 1;
    s.begin();
    s.drawBackground();
    s.drawCity(this.castleLevel, false, this.occupied);
    for (const d of this.data.base.decor || []) if (!this.lockedDecor(d)) s.drawDecor(d);
    // зона высадки: подсвечиваем запретные клетки
    if (this.sel && this.sel.kind !== 'spell' && this.sel.kind !== 'ability' || this.showZone > 0) {
      this.showZone = Math.max(0, this.showZone - dt);
      c.save();
      c.globalAlpha = this.showZone > 0 ? 0.35 + 0.2 * Math.sin(this.t * 10) : 0.18;
      for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (S.forbid[y * GRID + x]) s.diamond(x, y, 1, 1, '#ff3030');
      c.restore();
    }
    for (const [k, v] of this.flash) { if (v <= 0) this.flash.delete(k); else this.flash.set(k, v - dt); }

    const items = [];
    for (const b of S.bld) {
      if (b.cat === 'trap' && !b.dead) continue; // ловушки скрыты
      if (b.cat === 'trap') continue;
      items.push({ d: b.x + b.y + b.size * 2 - (b.cat === 'wall' ? 0.5 : 0), b });
    }
    for (const u of S.units) {
      const pv = this.prev.get(u.id) || u;
      const x = pv.x + (u.x - pv.x) * alpha, y = pv.y + (u.y - pv.y) * alpha;
      items.push({ d: x + y + (u.air ? 3 : 0.2), u, x, y });
    }
    items.sort((a, b) => a.d - b.d);
    for (const it of items) {
      if (it.b) this.drawBld(it.b);
      else this.drawUnit(it.u, it.x, it.y);
    }
    this.drawProjectiles(alpha);
    // активные заклинания (круги)
    for (const sp of S.spells) {
      if (sp.k === 'meteor') continue;
      const colors = { heal: 'rgba(120,255,120,', rage: 'rgba(255,90,40,', freeze: 'rgba(150,220,255,', lightning: 'rgba(120,160,255,' };
      const col = colors[sp.k] || 'rgba(255,255,255,';
      c.save();
      c.fillStyle = col + '0.18)'; c.strokeStyle = col + '0.8)'; c.lineWidth = 3 / s.cam.z;
      const p = iso(sp.x, sp.y);
      c.beginPath(); c.ellipse(p.x, p.y, sp.r * TW * 0.71, sp.r * TH * 0.71, 0, 0, Math.PI * 2); c.fill(); c.stroke();
      c.restore();
      if (sp.k === 'freeze' && Math.random() < 0.3) s.emit(p.x + (Math.random() - 0.5) * sp.r * TW, p.y, 1, 'ice');
    }
    // HP-полоски зданий
    for (const b of S.bld) {
      if (b.dead || b.cat === 'trap' || b.hp >= b.maxHp) continue;
      const p = iso(b.x + b.size / 2, b.y + b.size / 2);
      s.bar(p.x, p.y - b.size * TH * 1.5, b.cat === 'wall' ? 30 : 56, b.hp / b.maxHp, b.cat === 'wall' ? '#ccc' : '#ffb21e');
      if (b.hp < b.maxHp * 0.5 && b.cat !== 'wall' && Math.random() < 0.15) s.emit(p.x + (Math.random() - 0.5) * TW * b.size * 0.4, p.y - b.size * TH, 1, 'smoke');
    }
    s.drawParticles(dt);
  }

  drawBld(b) {
    const s = this.scene;
    s.drawBuilding(b, {
      dead: b.dead, walls: this.walls, noPad: true,
      flash: this.flash.has('b' + b.i), frozen: b.frozen > 0,
      lift: this.flash.has('f' + b.i) ? 2 : 0,
    });
  }

  drawUnit(u, x, y) {
    const s = this.scene, c = s.ctx;
    const p = iso(x, y);
    const im = img(u.isHero ? `heroes/${u.kind}` : `troops/${u.kind}`);
    const H = (UNIT_H[u.kind] || 1.3) * TH * 1.35;
    const fly = u.air ? TH * 1.6 + Math.sin(this.t * 4 + u.id) * 4 : 0;
    // тень
    c.save();
    c.fillStyle = 'rgba(0,0,0,0.3)';
    c.beginPath(); c.ellipse(p.x, p.y, H * 0.28, H * 0.12, 0, 0, Math.PI * 2); c.fill();
    c.restore();
    const walk = u.state === 'walk' ? Math.abs(Math.sin(this.t * 10 + u.id)) * 3 : 0;
    const lunge = u.state === 'attack' && u.cool > u.interval * 0.7 ? 4 : 0;
    if (im) {
      const w = im.width * H / im.height;
      c.save();
      if (u.stealth > 0) c.globalAlpha = 0.45;
      if (u.stun > 0) c.filter = 'grayscale(0.8)';
      c.translate(p.x + lunge * u.dir, p.y - fly - walk);
      if (u.dir < 0) c.scale(-1, 1);
      c.drawImage(im, -w / 2, -H, w, H);
      c.restore();
    } else {
      c.fillStyle = '#3b6fd6'; c.beginPath(); c.arc(p.x, p.y - H / 2, H / 3, 0, Math.PI * 2); c.fill();
    }
    if (u.isHero) {
      s.bar(p.x, p.y - fly - H - 10, 44, u.hp / u.maxHp, '#45d9ff');
    } else if (u.hp < u.maxHp) s.bar(p.x, p.y - fly - H - 6, 26, u.hp / u.maxHp, '#4ce04c');
    if (u.aura > 0) {
      c.save(); c.strokeStyle = 'rgba(255,200,60,0.6)'; c.lineWidth = 3 / s.cam.z;
      c.beginPath(); c.ellipse(p.x, p.y, HEROES.knight.ability.radius * TW * 0.71, HEROES.knight.ability.radius * TH * 0.71, 0, 0, Math.PI * 2); c.stroke(); c.restore();
    }
  }

  drawProjectiles(alpha) {
    const c = this.scene.ctx;
    for (const pr of this.S.proj) {
      const k = 1 - (pr.t - alpha) / pr.t0;
      const fx = pr.x + (pr.tx - pr.x) * k, fy = pr.y + (pr.ty - pr.y) * k;
      const p = iso(fx, fy);
      const arc = pr.k === 'trebuchet' ? Math.sin(k * Math.PI) * 120 : pr.from === 'def' ? 40 * (1 - k) + 20 : 25;
      const y = p.y - arc;
      c.save();
      if (pr.k === 'archertower' || pr.k === 'bolt' || pr.k === 'ballista') {
        const p0 = iso(pr.x, pr.y), ang = Math.atan2(iso(pr.tx, pr.ty).y - p0.y, iso(pr.tx, pr.ty).x - p0.x);
        c.translate(p.x, y); c.rotate(ang);
        c.strokeStyle = pr.k === 'ballista' ? '#5a3a1a' : '#e8d9b0';
        c.lineWidth = pr.k === 'ballista' ? 5 : 2.5;
        c.beginPath(); c.moveTo(-14, 0); c.lineTo(10, 0); c.stroke();
      } else if (pr.k === 'trebuchet') {
        c.fillStyle = '#6d6a63'; c.beginPath(); c.arc(p.x, y, 9, 0, Math.PI * 2); c.fill();
      } else {
        c.globalCompositeOperation = 'lighter';
        const g = c.createRadialGradient(p.x, y, 0, p.x, y, 16);
        g.addColorStop(0, pr.k === 'magetower' ? '#cfe6ff' : '#ffe9a0');
        g.addColorStop(1, 'rgba(60,120,255,0)');
        c.fillStyle = g; c.beginPath(); c.arc(p.x, y, 16, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    }
  }

  async finish() {
    this.app.ui.battleEnding();
    try {
      const r = await this.app.api.attackFinish(this.data.battleId, this.log);
      this.app.me = r.me;
      this.app.ui.battleResult(this, r.result);
    } catch (e) {
      this.app.ui.toast(e.message);
      this.app.ui.battleResult(this, { ...this.S.result, got: this.S.result.loot, trophies: 0 });
    }
  }

  liveStats() {
    const S = this.S;
    let stars = 0;
    const pct = percent(S);
    if (pct >= 50) stars++;
    if (S.castleDown) stars++;
    if (pct >= 100) stars++;
    return { pct, stars, time: Math.max(0, (S.maxTick - S.tick) * TICK), loot: S.loot };
  }
}

export const unitInfo = (kind, k) => (kind === 'hero' ? HEROES[k] : kind === 'spell' ? SPELLS[k] : TROOPS[k]);
export { fmt, BUILDINGS };
