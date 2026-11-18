// Вовлечение: советник с обучением, стрелка-подсказка, ежедневные награды,
// анимированные счётчики, полёт монет, праздник улучшений, красные точки, музыка.
import { BUILDINGS, HEROES, fmt, fmtTime, upgradeCost, armyUsed, TROOPS, castleLevelOf } from '/shared/config.js';
import { TUTORIAL, STREAK, DAILY_BONUS_GEMS, questCtx, today } from '/shared/quests.js';
import { url } from './assets.js';
import { iso, TW, TH } from './scene.js';
import { esc } from './world.js';

const $ = (s) => document.querySelector(s);
const ico = (r) => `<img class="ri" src="${url({ gold: 'ui/icon_gold', food: 'ui/icon_food', gems: 'ui/icon_gem' }[r])}" alt="">`;
const rewardHtml = (r) => ['gems', 'gold', 'food'].filter((k) => r[k]).map((k) => `${ico(k)} ${fmt(r[k])}`).join(' &nbsp;');

export class Engage {
  constructor(app) {
    this.app = app;
    this.counters = new Map();
    this.collapsed = false;
    $('#advisor .adv-body').onclick = () => { this.collapsed = !this.collapsed; $('#advisor').classList.toggle('collapsed', this.collapsed); };
    $('#advisor .adv-claim').onclick = (e) => { e.stopPropagation(); this.claimTutorial(); };
    $('#btn-daily').onclick = () => this.openDaily();
    requestAnimationFrame(() => this.loop());
  }

  ctx(me) {
    return questCtx({ buildings: me.buildings, stats: me.stats, story: me.story, achClaimed: (me.achievements || []).reduce((a, x) => a + x.claimed, 0), wallLevel: me.wallLevel });
  }

  // --- Плавные счётчики ---------------------------------------------------------
  count(el, value, format = fmt) {
    if (!el) return;
    const c = this.counters.get(el) || { shown: null, from: value, to: value, t0: 0 };
    if (c.to !== value) {
      c.from = c.shown; c.to = value; c.t0 = performance.now();
      if (value > c.from && this.counters.has(el)) { el.parentElement?.classList.remove('bump'); void el.offsetWidth; el.parentElement?.classList.add('bump'); }
    }
    c.format = format;
    this.counters.set(el, c);
  }

  loop() {
    const t = performance.now();
    for (const [el, c] of this.counters) {
      const k = Math.min(1, (t - c.t0) / 700);
      const e = 1 - Math.pow(1 - k, 3);
      const v = Math.round(c.from + (c.to - c.from) * e);
      if (v !== c.shown || !el.textContent) { c.shown = v; el.textContent = c.format(v); }
    }
    this.pointerFrame();
    requestAnimationFrame(() => this.loop());
  }

  // --- Советник и обучение -------------------------------------------------------
  update(me, prev) {
    this.me = me;
    const adv = $('#advisor');
    const q = TUTORIAL[me.tutorial];
    if (!q) { adv.classList.add('hidden'); this.target = null; }
    else {
      const done = q.done(this.ctx(me));
      adv.classList.remove('hidden');
      adv.classList.toggle('done', done);
      adv.querySelector('.adv-step').textContent = `${me.tutorial + 1}/${TUTORIAL.length}`;
      adv.querySelector('.adv-title').textContent = q.title;
      adv.querySelector('.adv-text').textContent = done ? 'Отлично, милорд! Заберите награду.' : q.text;
      adv.querySelector('.adv-reward').innerHTML = rewardHtml(q.reward);
      adv.querySelector('.adv-claim').classList.toggle('hidden', !done);
      this.target = done ? null : q.target;
      if (done && prev && TUTORIAL[prev.tutorial] === q && !q.done(this.ctx(prev))) {
        this.app.sfx('quest');
        adv.classList.remove('pop'); void adv.offsetWidth; adv.classList.add('pop');
        this.collapsed = false; adv.classList.remove('collapsed');
      }
    }
    // красные точки «здесь можно что-то сделать»
    const queued = me.training.reduce((a, x) => a + TROOPS[x.k].space, 0);
    dot('#btn-army', armyUsed(me.army) + queued < me.armyCap && !me.training.length);
    dot('#btn-shop', this.canBuildSomething(me));
    const d = me.daily;
    const dailyClaim = me.dailyReady || d.quests.some((x, i) => !d.claimed[i] && (d.c[x.counter] || 0) >= x.goal) || (d.claimed.every(Boolean) && !d.bonus);
    dot('#btn-daily', dailyClaim);
    $('#builders').classList.toggle('idle', me.builders.busy < me.builders.total);
    // празднуем завершённые стройки
    if (prev) this.celebrate(prev, me);
  }

  canBuildSomething(me) {
    const cl = castleLevelOf(me);
    for (const [type, def] of Object.entries(BUILDINGS)) {
      if (['castle', 'builderhut', 'wall'].includes(type) || def.cat === 'trap') continue;
      const n = me.buildings.filter((b) => b.type === type).length;
      if (n < def.countByCastle[cl - 1] && upgradeCost(type, 1) <= me.res[def.res]) return true;
    }
    return false;
  }

  async claimTutorial() {
    try {
      const r = await this.app.act('claimQuest');
      this.rewardFx(r.got);
      if (r.next >= TUTORIAL.length) {
        this.app.ui.modal('Путь правителя пройден!', `<div class="center"><img class="big-portrait" src="${url('heroes/knight_portrait')}" alt="">
          <p>Вы готовы править сами, милорд. Валория ждёт своего короля — а Морвейн уже собирает армию.</p></div>`,
        [{ label: 'За Валорию!', cls: 'green', onClick: () => this.app.ui.closeModal() }]);
        this.app.sfx('win');
      }
    } catch { /* тост показан */ }
  }

  // Стрелка, указывающая, куда нажать
  pointerFrame() {
    const p = $('#pointer');
    const app = this.app;
    const t = this.target;
    const modalOpen = $('#modal-bg').classList.contains('show') || $('#dialog').classList.contains('show');
    if (!t || !this.me || app.mode !== 'village' || app.world?.open || modalOpen || app.village?.ghost) { p.classList.remove('show'); return; }
    let x, y;
    if (t.ui) {
      const el = $(t.ui);
      if (!el || !el.offsetParent) { p.classList.remove('show'); return; }
      const r = el.getBoundingClientRect();
      x = r.left + r.width / 2; y = r.top;
    } else {
      const b = t.building === '@upgrading' ? this.me.buildings.find((v) => v.up) : this.me.buildings.find((v) => v.type === t.building && v.level > 0);
      if (!b) { p.classList.remove('show'); return; }
      // точные координаты берём из последнего кадра сцены
      const hits = app.village?.hits || [];
      const h = (t.bubble && hits.find((v) => v.bubble && v.b.id === b.id)) || hits.find((v) => !v.bubble && v.b?.id === b.id);
      if (!h) { p.classList.remove('show'); return; }
      const s = app.scene.toScreen(h.x + h.w / 2, h.y + (t.bubble ? 0 : h.h * 0.25));
      x = s.x; y = s.y - 4;
    }
    if (x < 20 || x > innerWidth - 20 || y < 90 || y > innerHeight - 80) { p.classList.remove('show'); return; } // цель за краем экрана
    p.style.transform = `translate(${x}px, ${y}px)`;
    p.classList.add('show');
  }

  // --- Ежедневно: календарь входа + задания ---------------------------------------
  openDaily() {
    const me = this.app.me;
    const ui = this.app.ui;
    ui.modalKind = 'daily';
    ui.modalRefresh = () => this.openDaily();
    const d = today();
    const next = me.dailyReady ? (me.streak.last === d - 1 ? me.streak.count % 7 + 1 : 1) : 0;
    const cl = castleLevelOf(me);
    const cells = STREAK.map((r, i) => {
      const day = i + 1;
      const got = me.dailyReady ? day < next : day <= me.streak.count;
      const now = day === next;
      const rr = { gems: r.gems, gold: (r.gold || 0) * cl, food: (r.food || 0) * cl };
      return `<div class="cal ${got ? 'got' : ''} ${now ? 'now' : ''} ${r.big ? 'big' : ''}">
        <div class="cal-day">День ${day}</div><img class="cal-ico" src="${url(r.img)}" alt=""><div class="cal-lbl">${r.label}</div>
        <div class="cal-rw">${rewardHtml(rr)}</div>${got ? '<div class="cal-ok">✔</div>' : ''}</div>`;
    }).join('');
    const dq = me.daily;
    const quests = dq.quests.map((q, i) => {
      const v = Math.min(q.goal, dq.c[q.counter] || 0);
      const ok = v >= q.goal;
      return `<div class="dq ${dq.claimed[i] ? 'claimed' : ''}"><div class="dq-body"><b>${esc(q.text)}</b>
        <div class="ach-bar"><div style="width:${v / q.goal * 100}%"></div><span>${fmt(v)} / ${fmt(q.goal)}</span></div></div>
        ${dq.claimed[i] ? '<span class="ach-ok">✔</span>' : `<button class="btn sm ${ok ? 'green' : ''}" data-dq="${i}" ${ok ? '' : 'disabled'}>${rewardHtml(q.reward)}</button>`}</div>`;
    }).join('');
    const reset = (d + 1) * 86400e3 - Date.now();
    const allDone = dq.claimed.every(Boolean);
    const box = ui.modal('Ежедневные награды', `
      <h3>Календарь входа <span class="muted">— заходите каждый день, на 7-й ждёт королевский сундук</span></h3>
      <div class="calendar">${cells}</div>
      <h3>Задания дня <span class="muted">обновятся через ${fmtTime(reset / 1000)}</span></h3>
      ${quests}
      <div class="dq bonus ${dq.bonus ? 'claimed' : ''}"><img class="dq-chest" src="${url('rewards/chest_gold')}" alt=""><div class="dq-body"><b>Сундук усердия</b><div class="muted">Выполните все три задания</div></div>
        ${dq.bonus ? '<span class="ach-ok">✔</span>' : `<button class="btn sm gem" id="dq-bonus" ${allDone ? '' : 'disabled'}>${ico('gems')} ${DAILY_BONUS_GEMS}</button>`}</div>`,
    me.dailyReady ? [{ label: `Забрать награду дня ${next}`, cls: 'green', onClick: () => this.claimStreak() }] : [], 'wide');
    box.querySelectorAll('[data-dq]').forEach((b) => { b.onclick = () => this.app.act('claimDaily', { i: +b.dataset.dq }).then((r) => this.rewardFx(r.got)); });
    const bb = box.querySelector('#dq-bonus');
    if (bb) bb.onclick = () => this.app.act('claimDailyBonus').then((r) => this.rewardFx(r.got));
  }

  async claimStreak() {
    try {
      const r = await this.app.act('daily');
      this.rewardFx(r.got);
      if (r.day === 7) this.app.ui.toast('👑 Королевский сундук! Серия начинается заново — не пропускайте дни!', 'good');
    } catch { /* */ }
  }

  // --- Эффекты наград -------------------------------------------------------------
  rewardFx(got, from) {
    if (!got) return;
    const start = from || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    for (const k of ['gold', 'food', 'gems']) if (got[k] > 0) this.fly(start, k, Math.min(10, 3 + Math.round(Math.log10(got[k] + 1) * 2)));
    this.app.sfx('coin');
    const parts = ['gems', 'gold', 'food'].filter((k) => got[k] > 0).map((k) => `+${fmt(got[k])} ${k === 'gems' ? '💎' : k === 'gold' ? 'золота' : 'зерна'}`);
    if (parts.length) this.app.ui.toast(parts.join(', '), 'good');
  }

  fly(from, res, n) {
    const target = $(`#r-${res} img`);
    if (!target || !target.offsetParent) return;
    const tr = target.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const el = document.createElement('img');
      el.src = url({ gold: 'ui/icon_gold', food: 'ui/icon_food', gems: 'ui/icon_gem' }[res]);
      el.className = 'fly';
      document.body.appendChild(el);
      const sx = from.x + (Math.random() - 0.5) * 60, sy = from.y + (Math.random() - 0.5) * 40;
      const mx = sx + (Math.random() - 0.5) * 160, my = sy - 80 - Math.random() * 80;
      const anim = el.animate([
        { transform: `translate(${sx}px, ${sy}px) scale(.4)`, opacity: 0 },
        { transform: `translate(${mx}px, ${my}px) scale(1.1)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${tr.left + tr.width / 2 - 16}px, ${tr.top + tr.height / 2 - 16}px) scale(.7)`, opacity: 1 },
      ], { duration: 750 + i * 60, easing: 'cubic-bezier(.5,0,.6,1)', delay: i * 40 });
      anim.onfinish = () => {
        el.remove();
        const bar = target.closest('.rbar');
        bar?.classList.remove('bump'); void bar?.offsetWidth; bar?.classList.add('bump');
      };
    }
  }

  // Завершение строек и подъём уровня Цитадели
  celebrate(prev, me) {
    const before = new Map(prev.buildings.map((b) => [b.id, b.level]));
    for (const b of me.buildings) {
      const was = before.get(b.id);
      if (was == null || b.level <= was || b.level < 1) continue;
      const def = BUILDINGS[b.type];
      if (def.cat === 'wall') continue;
      this.app.village.celebrate(b);
      this.app.sfx('levelup');
      if (b.type === 'castle') this.castleUp(b.level);
      else this.app.ui.toast(was === 0 ? `🏗 ${def.name} построено!` : `⬆ ${def.name}: уровень ${b.level}!`, 'good');
    }
    for (const [k, h] of Object.entries(me.heroes || {})) {
      const p = prev.heroes?.[k];
      if (p && h.level > p.level) this.app.ui.toast(`⭐ ${HEROES[k].name} достиг ${h.level} уровня!`, 'good');
    }
  }

  castleUp(level) {
    const opened = Object.entries(BUILDINGS).filter(([, d]) => d.countByCastle[level - 1] > (d.countByCastle[level - 2] || 0)).map(([, d]) => d.name);
    const heroes = Object.values(HEROES).filter((h) => h.castle === level).map((h) => h.name);
    this.app.ui.modal(`Цитадель — уровень ${level}!`, `
      <div class="castle-up"><div class="rays"></div><img class="fx-screen" src="${url('fx/fx_levelup')}" alt=""><img src="${url('buildings/castle_' + Math.min(6, level))}" alt="">
      <p>Королевство растёт! Открыто:</p>
      <ul>${heroes.map((h) => `<li>⭐ Герой: <b>${h}</b></li>`).join('')}${opened.map((n) => `<li>${n}</li>`).join('')}<li>Новые уровни зданий и войск</li></ul></div>`,
    [{ label: 'Великолепно!', cls: 'green', onClick: () => this.app.ui.closeModal() }], 'result-modal');
    this.app.sfx('win');
  }

  // --- Музыка (файлы кладутся в client/assets/audio/*.mp3) ------------------------
  music(track) {
    if (this.track === track) return;
    this.track = track;
    if (!this.tracks) {
      this.tracks = fetch('/api/audio').then((r) => r.json()).catch(() => []);
    }
    this.tracks.then((list) => this.playTrack(track, list));
  }

  playTrack(track, list) {
    if (this.track !== track) return;
    const old = this.audio;
    if (old) { const a = old; let v = a.volume; const t = setInterval(() => { v -= 0.05; if (v <= 0) { a.pause(); clearInterval(t); } else a.volume = v; }, 60); }
    this.audio = null;
    if (!this.app.musicOn || !track || !list.includes(track)) return;
    const a = new Audio(`/assets/audio/${track}.mp3`);
    a.loop = true; a.volume = 0;
    a.addEventListener('canplay', () => {
      if (this.audio !== a) return;
      a.play().then(() => { let v = 0; const t = setInterval(() => { v += 0.03; a.volume = Math.min(0.35, v); if (v >= 0.35) clearInterval(t); }, 80); }).catch(() => {});
    }, { once: true });
    a.addEventListener('error', () => {}, { once: true });
    this.audio = a;
  }
}

function dot(sel, on) {
  const el = $(sel);
  if (!el) return;
  let d = el.querySelector('.rdot');
  if (on && !d) { d = document.createElement('span'); d.className = 'rdot'; el.appendChild(d); }
  if (!on && d) d.remove();
}
