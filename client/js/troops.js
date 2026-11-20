// Экран «Армия»: три лагеря (пехота, стрелки, кавалерия) и госпиталь.
// Ступень выбирается медалью, количество — ползунком; у каждого лагеря своя очередь.
import { BUILDINGS, RES_NAMES, fmt, fmtTime, gemsForTime, gemsForResources, missingOf } from '/shared/config.js';
import {
  TROOP_KINDS, KIND_ORDER, TIER_CAMP, TIER_MAX, ROMAN, troopName, troopStats, troopCost, troopTime, batchMax, maxTierOf,
  troopPowerOf, artGroup, parseKey, healCost, healTime,
} from '/shared/troops.js';
import { resIcon, short } from './cityui.js';

const A = '/assets/realm/';
const T = (n) => `${A}troops/${n}.png`;
const ico = (r) => `<img class="ic" src="${resIcon(r)}" alt="">`;
const unitArt = (race, kind, tier) => T(`${race}_${kind}${artGroup(tier)}`);

export class Troops {
  constructor(app) {
    this.app = app;
    this.root = document.createElement('div');
    this.root.id = 'troops';
    this.root.innerHTML = `
      <div class="hs-top"><button class="hs-back" aria-label="Назад"><img src="${A}kit/back.png" alt=""></button><b class="hs-title">Армия</b>
        <div class="hs-res"><span><img src="${A}kit/power_ic.png" alt=""><b data-i="power"></b></span></div></div>
      <div class="hs-body"></div>
      <nav class="hs-tabs">
        ${KIND_ORDER.map((k) => `<button data-t="${k}"><img src="${T('type_' + k)}" alt=""><span>${TROOP_KINDS[k].name}</span></button>`).join('')}
        <button data-t="hospital"><img src="${T('wounded')}" alt=""><span>Госпиталь</span></button>
      </nav>`;
    document.body.appendChild(this.root);
    this.root.querySelector('.hs-back').onclick = () => this.close();
    this.root.querySelectorAll('.hs-tabs button').forEach((b) => { b.onclick = () => this.show(b.dataset.t); });
    this.sel = {};   // выбранная ступень по роду
    this.amount = {};
  }

  get me() { return this.app.me; }
  open(tab = this.tab || 'infantry') { this.root.classList.add('show'); this.show(tab); this.app.sfx('click'); }
  close() { this.root.classList.remove('show'); clearInterval(this.timer); }
  refresh() { if (this.root.classList.contains('show')) this.show(this.tab, true); this.badges(); }

  async act(type, args) { try { return await this.app.act(type, args); } catch { return null; } }

  camp(kind) {
    const type = TROOP_KINDS[kind].camp;
    return this.me.buildings.filter((b) => b.type === type).sort((a, b) => (a.captured - b.captured) || b.level - a.level)[0] || null;
  }

  badges() {
    const me = this.me;
    if (!me?.trainQ) return;
    const idle = KIND_ORDER.some((k) => { const c = this.camp(k); return c && !c.captured && c.level > 0 && !me.trainQ[k]; });
    setDot(document.querySelector('#btn-army'), idle);
    const tabs = this.root.querySelectorAll('.hs-tabs button');
    KIND_ORDER.forEach((k, i) => { const c = this.camp(k); setDot(tabs[i], !!(c && !c.captured && c.level > 0 && !me.trainQ[k])); });
    setDot(tabs[3], Object.values(me.wounded || {}).some((v) => v > 0) && !me.healQ);
  }

  show(tab, keep) {
    this.tab = tab;
    this.root.querySelectorAll('.hs-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    this.root.querySelector('[data-i=power]').textContent = fmt(this.me.troopPower || 0);
    const body = this.root.querySelector('.hs-body');
    const y = keep ? body.scrollTop : 0;
    if (tab === 'hospital') this.renderHospital(body); else this.renderCamp(body, tab);
    body.scrollTop = y;
    this.badges();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tickTimers(), 500);
  }

  // Таймеры очередей без перерисовки
  tickTimers() {
    const now = Date.now() - (this.app.fetchedAt - this.me.now);
    this.root.querySelectorAll('[data-qend]').forEach((el) => {
      const end = +el.dataset.qend, total = +el.dataset.qtotal;
      const left = Math.max(0, (end - now) / 1000);
      el.querySelector('.tq-time').textContent = left > 0 ? fmtTime(left) : 'готово';
      el.querySelector('.hd-bar i').style.width = Math.min(100, (1 - left / total) * 100) + '%';
      if (left <= 0 && !this.app.busy && !this.reloading) { this.reloading = true; this.app.refresh().finally(() => { this.reloading = false; this.refresh(); }); }
    });
  }

  renderCamp(body, kind) {
    const me = this.me, race = me.race;
    const camp = this.camp(kind);
    const campDef = BUILDINGS[TROOP_KINDS[kind].camp];
    const lvl = camp && !camp.captured ? camp.level : 0;
    const maxT = maxTierOf(lvl);
    const tier = this.sel[kind] || Math.max(1, maxT);
    this.sel[kind] = tier;
    const st = troopStats(kind, tier, race);
    const have = me.troops?.[kind + tier] || 0;
    const locked = tier > maxT;
    const q = me.trainQ?.[kind];
    const max = batchMax(lvl);
    // по умолчанию — сколько хватает ресурсов, но не больше партии
    const one = troopCost(kind, tier, 1);
    const afford = Math.max(0, Math.min(max, ...Object.entries(one).map(([r, v]) => Math.floor((me.res[r] || 0) / v))));
    let n = Math.min(this.amount[kind] ?? afford, max);
    if (!n && max) n = Math.min(max, Math.max(1, afford));
    this.amount[kind] = n;
    const cost = troopCost(kind, tier, n), time = Math.round(troopTime(tier, race) * n);
    const miss = missingOf(me.res, cost), missSum = Object.values(miss).reduce((a, v) => a + v, 0);
    const gems = gemsForTime(time) + gemsForResources(missSum);
    const noCamp = !camp ? `Постройте «${campDef.name}»` : camp.captured ? `«${campDef.name}» захвачены врагом — отвоюйте их в городе` : camp.level === 0 ? `Почините «${campDef.name}»` : '';
    const tiers = Array.from({ length: TIER_MAX }, (_, i) => {
      const t = i + 1, lk = t > maxT;
      return `<button class="tr-t ${t === tier ? 'on' : ''} ${lk ? 'lock' : ''}" data-tier="${t}"><img src="${T('tier' + t)}" alt="${ROMAN[i]}"><small>${me.troops?.[kind + t] ? short(me.troops[kind + t]) : lk ? `<img class="lk" src="${A}kit/padlock.png" alt="">` : '0'}</small></button>`;
    }).join('');
    const stat = (icon, label, v) => `<div class="tr-s"><img src="${A}kit/${icon}.png" alt=""><span>${label}</span><b>${fmt(v)}</b></div>`;
    let action;
    if (noCamp) action = `<div class="tr-box tr-note">${noCamp}.<button class="nbtn sm" data-go>В город</button></div>`;
    else if (q) {
      action = `<div class="tr-box tr-q" data-qend="${q.end + (this.app.fetchedAt - me.now)}" data-qtotal="${q.total}">
        <img src="${unitArt(race, kind, q.tier)}" alt=""><div class="tq-in"><b>Обучается ${fmt(q.n)} × ${troopName(race, kind, q.tier)}</b>
        <div class="hd-bar"><i></i><span class="tq-time"></span></div>
        <div class="hd-btns"><button class="nbtn sm steel" data-cancel>Отмена</button><button class="nbtn sm gem" data-speed><img src="${A}kit/gems.png" alt=""> ${gemsForTime((q.end - me.now) / 1000)}</button></div></div></div>`;
    } else if (locked) {
      action = `<div class="tr-box tr-note">Ступень ${ROMAN[tier - 1]} откроется на «${campDef.name}» ${TIER_CAMP[tier - 1]} ур. Сейчас: ${lvl} ур.</div>`;
    } else {
      action = `<div class="tr-box tr-train">
        <div class="tr-amt"><button class="tr-pm" data-d="-10">−</button><input type="range" min="1" max="${max}" value="${n}"><button class="tr-pm" data-d="10">+</button><b class="tr-n">${fmt(n)}</b></div>
        <div class="tr-cost">${Object.entries(cost).map(([r, v]) => `<i class="${(me.res[r] || 0) >= v ? '' : 'bad'}">${ico(r)}${short(v)}</i>`).join('')}<i class="tr-time">⏱ ${fmtTime(time)}</i></div>
        <div class="hd-btns"><button class="nbtn gem" data-now><img src="${A}kit/gems.png" alt=""> ${gems}</button><button class="nbtn" data-train ${missSum ? 'disabled' : ''}>Обучить</button></div></div>`;
    }
    body.innerHTML = `
      <div class="tr-stage">
        <img class="tr-unit ${(locked || noCamp) && !have ? 'dim' : ''}" src="${unitArt(race, kind, tier)}" alt="">
        <div class="tr-camp"><img src="${T('camp')}" alt="">${campDef.name}${lvl ? ` · ур. ${lvl}<span>партия до ${fmt(max)}</span>` : camp?.captured ? '<span>захвачено</span>' : '<span>не построено</span>'}</div>
        <div class="tr-name"><img src="${T('tier' + tier)}" alt=""><div><b>${troopName(race, kind, tier)}</b><span>${TROOP_KINDS[kind].name} · ступень ${ROMAN[tier - 1]} · в армии ${fmt(have)}</span></div></div>
      </div>
      <div class="tr-tiers">${tiers}</div>
      <div class="tr-box tr-stats">${stat('atk', 'Атака', st.atk)}${stat('def', 'Защита', st.def)}${stat('hp', 'Здоровье', st.hp)}${stat('chest', 'Груз', st.load)}${stat('power_ic', 'Сила', troopPowerOf(tier))}</div>
      <p class="tr-desc">${TROOP_KINDS[kind].desc}</p>
      ${action}`;
    body.querySelectorAll('.tr-t').forEach((b) => { b.onclick = () => { this.sel[kind] = +b.dataset.tier; this.amount[kind] = undefined; this.renderCamp(body, kind); this.app.sfx('click'); }; });
    const range = body.querySelector('input[type=range]');
    const setN = (v) => { this.amount[kind] = Math.max(1, Math.min(max, v)); this.renderCamp(body, kind); };
    if (range) range.oninput = () => setN(+range.value);
    body.querySelectorAll('.tr-pm').forEach((b) => { b.onclick = () => setN(n + +b.dataset.d); });
    const on = (sel, fn) => { const el = body.querySelector(sel); if (el) el.onclick = fn; };
    on('[data-train]', async () => { if (await this.act('trainTroops', { kind, tier, n })) { this.app.sfx('build'); this.app.ui.toast(`Обучение: ${fmt(n)} × ${troopName(race, kind, tier)}`, 'good'); this.refresh(); } });
    on('[data-now]', () => this.app.ui.confirmGems(gems, async () => { if (await this.act('trainNow', { kind, tier, n })) { this.app.sfx('levelup'); this.app.ui.toast(`В армии +${fmt(n)}: ${troopName(race, kind, tier)}`, 'good'); this.refresh(); } }));
    on('[data-speed]', () => { this.app.bag.after = () => this.refresh(); this.app.bag.speed({ type: 'train', kind }, q.end, 'speedupTrain', { kind }, `${fmt(q.n)} × ${troopName(race, kind, q.tier)}`); });
    on('[data-cancel]', async () => { if (await this.act('cancelTrain', { kind })) this.refresh(); });
    on('[data-go]', () => { this.close(); if (camp) this.app.village.select(camp); });
    this.tickTimers();
  }

  renderHospital(body) {
    const me = this.me, race = me.race;
    const hosp = me.buildings.find((b) => b.type === 'hospital' && !b.captured && b.level > 0);
    const list = Object.entries(me.wounded || {}).filter(([, v]) => v > 0);
    const total = list.reduce((a, [, v]) => a + v, 0), cap = me.hospitalCap || 0;
    const cost = {};
    let time = 0;
    for (const [k, cnt] of list) {
      const { kind, tier } = parseKey(k);
      for (const [r, v] of Object.entries(healCost(kind, tier, cnt))) cost[r] = (cost[r] || 0) + v;
      time += healTime(tier, cnt);
    }
    const rows = list.map(([k, cnt]) => {
      const { kind, tier } = parseKey(k);
      return `<div class="tr-w"><img src="${unitArt(race, kind, tier)}" alt=""><img class="tr-wt" src="${T('tier' + tier)}" alt=""><b>${troopName(race, kind, tier)}</b><span>${fmt(cnt)}</span></div>`;
    }).join('');
    const hq = me.healQ;
    body.innerHTML = `
      <div class="tr-stage hosp"><img class="tr-unit hosp-ic" src="${T('heal')}" alt="">
        <div class="tr-name"><img src="${T('wounded')}" alt=""><div><b>Госпиталь</b><span>${hosp ? `ур. ${hosp.level}` : 'не построен'} · мест ${fmt(cap)}</span></div></div></div>
      <div class="tr-box"><div class="hd-sub">Раненые ${fmt(total)} / ${fmt(cap)}</div>
        <div class="hd-bar"><i style="width:${cap ? Math.min(100, total / cap * 100) : 0}%"></i><span>${fmt(total)} / ${fmt(cap)}</span></div>
        <p class="tr-desc">Воины, раненые в боях на карте, попадают сюда. Если мест не хватит — лишние погибнут.</p></div>
      ${hq ? `<div class="tr-box tr-q" data-qend="${hq.end + (this.app.fetchedAt - me.now)}" data-qtotal="${hq.total}"><img src="${T('heal')}" alt=""><div class="tq-in"><b>Лечение ${fmt(Object.values(hq.list).reduce((a, v) => a + v, 0))} воинов</b>
          <div class="hd-bar"><i></i><span class="tq-time"></span></div>
          <div class="hd-btns"><button class="nbtn sm gem" data-hspeed><img src="${A}kit/gems.png" alt=""> ${gemsForTime((hq.end - me.now) / 1000)}</button></div></div></div>` : ''}
      ${list.length ? `<div class="tr-box">${rows}
          <div class="tr-cost">${Object.entries(cost).map(([r, v]) => `<i class="${(me.res[r] || 0) >= v ? '' : 'bad'}">${ico(r)}${short(v)}</i>`).join('')}<i class="tr-time">⏱ ${fmtTime(time)}</i></div>
          <div class="hd-btns"><button class="nbtn" data-heal ${hq || !hosp ? 'disabled' : ''}>Вылечить всех</button></div></div>`
    : `<div class="tr-box tr-note">Раненых нет. ${hosp ? '' : 'Постройте Госпиталь, чтобы спасать воинов после боёв.'}</div>`}`;
    const on = (sel, fn) => { const el = body.querySelector(sel); if (el) el.onclick = fn; };
    on('[data-heal]', async () => { if (await this.act('healAll')) { this.app.sfx('build'); this.refresh(); } });
    on('[data-hspeed]', () => { this.app.bag.after = () => this.refresh(); this.app.bag.speed({ type: 'heal' }, hq.end, 'speedupHeal', {}, 'лечение'); });
    this.tickTimers();
  }
}

function setDot(el, on) {
  if (!el) return;
  let d = el.querySelector('.rdot');
  if (on && !d) { d = document.createElement('span'); d.className = 'rdot'; el.appendChild(d); }
  if (!on && d) d.remove();
}
