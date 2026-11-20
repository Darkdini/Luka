// Лавка (наборы, самоцветы, VIP, боевой пропуск) и Академия (технологии).
import { fmt, fmtTime, gemsForTime, canAfford } from '/shared/config.js';
import {
  TECHS, TECH, BRANCHES, techCost, techTime, techMax, VIP_PTS, vipLines, vipChest, PASS_LEVELS, PASS_XP_LEVEL, passReward, OFFERS, GEM_PACKS, MONTH_DAILY,
} from '/shared/meta.js';
import { api } from './api.js';
import { resIcon, short } from './cityui.js';

const A = '/assets/realm/';
const M = (n) => `${A}meta/${n}.png`;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const rewardChips = (r) => Object.entries(r).filter(([k, v]) => v && !['frag', 'fragN'].includes(k)).map(([k, v]) => `<span class="ms-chip"><img src="${k === 'book' ? A + 'kit/book.png' : k === 'ticket' ? A + 'kit/ticket.png' : resIcon(k)}" alt="">${short(v)}</span>`).join('')
  + (r.frag ? `<span class="ms-chip"><img src="${A}kit/frag.png" alt="">${r.fragN} ${r.frag === 'legendary' ? 'легенды' : 'эпика'}</span>` : '');

function screen(id, title) {
  const root = document.createElement('div');
  root.id = id;
  root.className = 'meta-screen';
  root.innerHTML = `<div class="hs-top"><button class="hs-back" aria-label="Назад"><img src="${A}kit/back.png" alt=""></button><b class="hs-title">${title}</b>
    <div class="hs-res"><span><img src="${A}kit/gems.png" alt=""><b data-g></b></span></div></div><div class="hs-body"></div><nav class="hs-tabs"></nav>`;
  document.body.appendChild(root);
  root.querySelector('.hs-back').onclick = () => root.classList.remove('show');
  return root;
}

class Base {
  get me() { return this.app.me; }
  async act(type, args, ok) {
    try { const r = await this.app.act(type, args); if (ok) this.app.ui.toast(typeof ok === 'function' ? ok(r) : ok, 'good'); return r; } catch { return null; }
  }
  tabs(list) {
    const nav = this.root.querySelector('.hs-tabs');
    nav.innerHTML = list.map(([id, icon, name, dot]) => `<button data-t="${id}" class="${id === this.tab ? 'on' : ''}"><img src="${icon}" alt=""><span>${name}</span>${dot ? '<span class="rdot"></span>' : ''}</button>`).join('');
    nav.querySelectorAll('button').forEach((b) => { b.onclick = () => this.show(b.dataset.t); });
    this.root.querySelector('[data-g]').textContent = fmt(this.me.res.gems);
  }
  body() { return this.root.querySelector('.hs-body'); }
}

// ===========================================================================
export class Store extends Base {
  constructor(app) { super(); this.app = app; this.root = screen('store', 'Лавка'); this.tab = 'offers'; }
  open(tab) { this.root.classList.add('show'); this.app.sfx('click'); this.show(tab || this.tab); }
  refresh() { if (this.root.classList.contains('show')) this.show(this.tab); this.badge(); }
  badge() {
    const me = this.me;
    if (!me?.vip) return;
    const passReady = this.passReady();
    setDot(document.querySelector('#btn-shop'), me.vip.dailyReady || me.month?.ready || passReady);
  }
  passReady() {
    const p = this.me.pass, lvl = Math.floor(p.xp / PASS_XP_LEVEL);
    for (let l = 1; l <= lvl; l++) if (!p.free.includes(l) || (p.gold && !p.paid.includes(l))) return true;
    return false;
  }
  show(tab) {
    this.tab = tab;
    const me = this.me;
    this.tabs([['offers', M('ch_royal'), 'Наборы', me.month?.ready], ['gems', M('gems2'), 'Самоцветы'], ['vip', M(`vip${me.vip.level}`), 'VIP', me.vip.dailyReady], ['pass', M('p_trophy'), 'Пропуск', this.passReady()]]);
    ({ offers: () => this.renderOffers(), gems: () => this.renderGems(), vip: () => this.renderVip(), pass: () => this.renderPass() })[tab]();
  }

  async buy(id) {
    try {
      const r = await api.buy(id);
      this.app.setMe(r.me);
      this.app.sfx('win');
      this.app.engage.rewardFx(r.got);
      this.app.ui.toast('Покупка зачислена', 'good');
      this.show(this.tab);
    } catch (e) { this.app.ui.toast(e.message, 'bad'); }
  }

  renderOffers() {
    const me = this.me;
    const month = me.month ? `<div class="tr-box st-month"><img src="${M('o_month')}" alt=""><div><b>Королевская грамота</b><span>до ${new Date(me.month.until).toLocaleDateString('ru-RU')} · по ${MONTH_DAILY} самоцветов в день</span>
      <button class="nbtn sm" data-month ${me.month.ready ? '' : 'disabled'}>${me.month.ready ? 'Забрать' : 'Завтра'}</button></div></div>` : '';
    const cards = OFFERS.filter((o) => !(o.pass && me.pass.gold) && !(o.month && me.month)).map((o) => {
      const bought = o.once && me.purchased[o.id];
      return `<div class="st-card ${bought ? 'sold' : ''}"><img class="st-img" src="${M(o.img)}" alt="">
        ${o.tag ? `<i class="st-tag">${o.tag}</i>` : ''}
        <div class="st-in"><b>${o.label}</b><span>${o.text}</span>
        ${o.gems ? `<em><img class="ic" src="${A}kit/gems.png" alt="">${fmt(o.gems)}</em>` : ''}
        <button class="nbtn sm" data-buy="${o.id}" ${bought ? 'disabled' : ''}>${bought ? 'Куплено' : `${o.price} ₽`}</button></div></div>`;
    }).join('');
    this.body().innerHTML = `${month}<div class="st-grid">${cards}</div><p class="muted small">Оплата подключается отдельно; сейчас покупки работают в тестовом режиме.</p>`;
    this.body().querySelectorAll('[data-buy]').forEach((b) => { b.onclick = () => this.buy(b.dataset.buy); });
    const mb = this.body().querySelector('[data-month]');
    if (mb) mb.onclick = async () => { const r = await this.act('monthClaim'); if (r) { this.app.engage.rewardFx(r.got); this.show('offers'); } };
  }

  renderGems() {
    this.body().innerHTML = `<div class="st-gems">${GEM_PACKS.map((g) => `<button class="st-gem" data-buy="${g.id}">${g.tag ? `<i class="st-tag">${g.tag}</i>` : ''}<img src="${M(g.img)}" alt=""><b>${fmt(g.gems)}</b><span>${g.label}</span><em>${g.price} ₽</em></button>`).join('')}</div>
      <p class="muted small">Каждая покупка приносит очки VIP.</p>`;
    this.body().querySelectorAll('[data-buy]').forEach((b) => { b.onclick = () => this.buy(b.dataset.buy); });
  }

  renderVip() {
    const v = this.me.vip, l = v.level, next = VIP_PTS[l] ?? null;
    const prev = VIP_PTS[l - 1];
    this.body().innerHTML = `<div class="st-vip"><img src="${M('vip' + l)}" alt=""><div><b>VIP ${ROMAN[l - 1]}</b>
        <div class="hd-bar"><i style="width:${next ? Math.min(100, (v.pts - prev) / (next - prev) * 100) : 100}%"></i><span>${next ? `${fmt(v.pts)} / ${fmt(next)}` : 'Высший уровень'}</span></div>
        <span class="muted">Очки VIP — за ежедневный сундук и покупки</span></div></div>
      <div class="tr-box"><div class="hd-sub">Ваши привилегии</div>${vipLines(l).map((t) => `<div class="ms-row"><span>✦ ${t}</span></div>`).join('')}</div>
      <div class="tr-box st-chest"><img src="${M(l >= 7 ? 'ch_royal' : l >= 4 ? 'ch_gold' : 'ch_silver')}" alt=""><div><b>Ежедневный сундук VIP</b><div class="ms-chips">${rewardChips(vipChest(l))}</div></div>
        <button class="nbtn sm" data-vip ${v.dailyReady ? '' : 'disabled'}>${v.dailyReady ? 'Открыть' : 'Завтра'}</button></div>
      ${next ? `<div class="tr-box"><div class="hd-sub">VIP ${ROMAN[l]}</div>${vipLines(l + 1).map((t) => `<div class="ms-row"><span class="muted">✦ ${t}</span></div>`).join('')}</div>` : ''}`;
    const b = this.body().querySelector('[data-vip]');
    if (b) b.onclick = async () => { const r = await this.act('vipDaily'); if (r) { this.app.engage.rewardFx(r.got); if (r.up) this.app.ui.toast('Новый уровень VIP!', 'good'); this.show('vip'); } };
  }

  renderPass() {
    const p = this.me.pass, lvl = Math.floor(p.xp / PASS_XP_LEVEL);
    const rows = Array.from({ length: PASS_LEVELS }, (_, i) => {
      const l = i + 1, reached = l <= lvl;
      const cell = (gold) => {
        const got = (gold ? p.paid : p.free).includes(l);
        const lock = gold && !p.gold;
        return `<button class="ps-cell ${gold ? 'gold' : ''} ${got ? 'got' : reached && !lock ? 'ready' : ''}" data-l="${l}" data-g="${gold ? 1 : 0}" ${got || !reached || lock ? 'disabled' : ''}>
          <div class="ms-chips">${rewardChips(passReward(l, gold))}</div>${got ? `<img class="ps-st" src="${M('p_claimed')}" alt="">` : lock ? `<img class="ps-st" src="${M('p_locked')}" alt="">` : ''}</button>`;
      };
      return `<div class="ps-row ${reached ? 'on' : ''}"><b class="ps-l">${l}</b>${cell(false)}${cell(true)}</div>`;
    }).join('');
    const left = Math.max(0, (p.ends - this.me.now) / 1000);
    this.body().innerHTML = `<div class="ps-head"><img src="${M('p_trophy')}" alt=""><div><b>Сезон · ступень ${lvl}/${PASS_LEVELS}</b>
        <div class="hd-bar"><i style="width:${lvl >= PASS_LEVELS ? 100 : (p.xp % PASS_XP_LEVEL)}%"></i><span>${lvl >= PASS_LEVELS ? 'Пройден' : `${Math.floor(p.xp % PASS_XP_LEVEL)} / ${PASS_XP_LEVEL}`}</span></div>
        <span class="muted">До конца сезона ${fmtTime(left)} · очки — за стройку, походы, обучение и помощь</span></div></div>
      <div class="ps-cols"><span></span><img src="${M('p_free')}" alt=""><img src="${M('p_gold')}" alt=""></div>
      ${p.gold ? '' : `<button class="nbtn st-gold" data-buy="pass"><img class="ic" src="${M('p_gold')}" alt=""> Золотой пропуск — 399 ₽</button>`}
      <div class="ps-list">${rows}</div>`;
    this.body().querySelectorAll('.ps-cell:not([disabled])').forEach((b) => { b.onclick = async () => { const r = await this.act('passClaim', { level: +b.dataset.l, gold: b.dataset.g === '1' }); if (r) { this.app.engage.rewardFx(r.got); this.show('pass'); } }; });
    const gb = this.body().querySelector('[data-buy]');
    if (gb) gb.onclick = () => this.buy('pass');
  }
}

// ===========================================================================
export class Academy extends Base {
  constructor(app) { super(); this.app = app; this.root = screen('academy', 'Академия'); this.tab = 'eco'; }
  open(tab) { this.root.classList.add('show'); this.app.sfx('click'); this.show(tab || this.tab); clearInterval(this.timer); this.timer = setInterval(() => this.tickQ(), 500); }
  refresh() { if (this.root.classList.contains('show')) this.show(this.tab); }
  show(tab) {
    this.tab = tab;
    this.tabs([['eco', M('t_farm'), 'Экономика'], ['war', M('t_atk'), 'Армия'], ['hero', M('t_book'), 'Герои']]);
    const me = this.me, al = me.academy;
    const q = me.research;
    const head = q ? `<div class="tr-box tr-q" data-qend="${q.end + (this.app.fetchedAt - me.now)}" data-qtotal="${q.total}"><img src="${M(TECH[q.id].icon)}" alt=""><div class="tq-in"><b>${TECH[q.id].name} → ${q.to}</b>
        <div class="hd-bar"><i></i><span class="tq-time"></span></div><div class="hd-btns"><button class="nbtn sm gem" data-speed><img src="${A}kit/gems.png" alt=""> ${gemsForTime((q.end - me.now) / 1000)}</button></div></div></div>`
      : !al ? '<div class="tr-box tr-note">Постройте Академию (Цитадель 3 ур.), чтобы открыть исследования.</div>' : '';
    const cards = TECHS.filter((t) => t.branch === tab).map((t) => {
      const lv = me.tech[t.id] || 0, max = techMax(t.id, al), lock = al < t.req;
      return `<button class="tc ${lock ? 'lock' : ''} ${q?.id === t.id ? 'busy' : ''}" data-id="${t.id}"><img src="${M(t.icon)}" alt=""><b>${t.name}</b>
        <span>${lock ? `Академия ${t.req}` : `${lv}/${t.max}`}</span><i><u style="width:${lv / t.max * 100}%"></u></i>${lv < max && !lock ? '<em></em>' : ''}</button>`;
    }).join('');
    this.body().innerHTML = `${head}<div class="hd-sub">${BRANCHES[tab]}</div><div class="tc-grid">${cards}</div>`;
    this.body().querySelectorAll('.tc').forEach((b) => { b.onclick = () => this.techModal(b.dataset.id); });
    const sp = this.body().querySelector('[data-speed]');
    if (sp) sp.onclick = () => { const g = gemsForTime((q.end - me.now) / 1000); this.app.ui.confirmGems(g, async () => { if (await this.act('speedupResearch')) this.show(this.tab); }); };
    this.tickQ();
  }
  tickQ() {
    const el = this.root.querySelector('[data-qend]');
    if (!el) return;
    const left = Math.max(0, (+el.dataset.qend - Date.now()) / 1000), total = +el.dataset.qtotal;
    el.querySelector('.tq-time').textContent = left > 0 ? fmtTime(left) : 'готово';
    el.querySelector('.hd-bar i').style.width = Math.min(100, (1 - left / total) * 100) + '%';
    if (left <= 0 && !this.app.busy && !this.loading) { this.loading = true; this.app.refresh().finally(() => { this.loading = false; this.refresh(); }); }
  }
  techModal(id) {
    const me = this.me, t = TECH[id], lv = me.tech[id] || 0, al = me.academy, max = techMax(id, al);
    const pct = (n) => `+${Math.round(t.per * n * 100)}%`;
    const can = lv < t.max && lv < max && !me.research;
    const cost = lv < t.max ? techCost(id, lv + 1) : null;
    const time = lv < t.max ? Math.round(techTime(id, lv + 1) * (1 - (me.mods?.research || 0))) : 0;
    const note = lv >= t.max ? 'Изучено полностью' : al < t.req ? `Откроется на Академии ${t.req} ур.` : lv >= max ? `Следующий уровень — на Академии ${t.req + lv} ур.` : me.research ? 'Академия занята другим исследованием' : '';
    this.app.ui.modal(t.name, `<div class="bw-head"><img src="${M(t.icon)}" alt=""><div><div class="bw-lv">Уровень ${lv} <span>→</span> <b>${Math.min(t.max, lv + 1)}</b></div><p>${t.desc}</p></div></div>
      <div class="bw-box"><div class="bw-row"><span>${t.desc}</span><b>${pct(lv)}</b>${lv < t.max ? `<em>${pct(lv + 1)}</em>` : ''}</div></div>
      ${cost ? `<div class="bw-box"><div class="hd-sub">Стоимость</div>${Object.entries(cost).map(([r, v]) => `<div class="bw-req ${(me.res[r] || 0) >= v ? 'ok' : 'no'}"><span><img class="ic" src="${resIcon(r)}" alt="">${short(me.res[r] || 0)} / ${short(v)}</span><i>${(me.res[r] || 0) >= v ? '✔' : '✖'}</i></div>`).join('')}
        <div class="ms-row"><span>⏱ Время</span><b>${fmtTime(time)}</b></div></div>` : ''}
      ${note ? `<p class="muted">${note}</p>` : ''}`,
    can ? [{ label: 'Исследовать', cls: 'green', disabled: !canAfford(me.res, cost), onClick: async () => { this.app.ui.closeModal(); if (await this.act('research', { id }, 'Исследование началось')) this.show(this.tab); } }] : [], 'bw');
  }
}

function setDot(el, on) {
  if (!el) return;
  let d = el.querySelector('.rdot');
  if (on && !d) { d = document.createElement('span'); d.className = 'rdot'; el.appendChild(d); }
  if (!on && d) d.remove();
}
