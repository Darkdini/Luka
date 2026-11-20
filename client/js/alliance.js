// Экран союза: поиск и создание, участники с рангами, чат, помощь, подарки, заявки.
import { fmt, fmtTime, RACES } from '/shared/config.js';
import { ALLY_CRESTS, ALLY_COST, RANKS, RANK_ICON } from '/shared/alliance.js';
import { BUILDINGS } from '/shared/config.js';
import { api } from './api.js';
import { resIcon, short } from './cityui.js';

const M = (n) => `/assets/realm/meta/${n}.png`;
const A = '/assets/realm/';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const crestUrl = (c) => M('c_' + (c || 'lion'));

export class Alliance {
  constructor(app) {
    this.app = app;
    this.root = document.createElement('div');
    this.root.id = 'ally';
    this.root.innerHTML = `
      <div class="hs-top"><button class="hs-back" aria-label="Назад"><img src="${A}kit/back.png" alt=""></button><b class="hs-title">Союз</b><div class="hs-res"></div></div>
      <div class="al-head"></div>
      <div class="hs-body"></div>
      <nav class="hs-tabs"></nav>`;
    document.body.appendChild(this.root);
    this.root.querySelector('.hs-back').onclick = () => this.close();
    this.tab = null;
    this.crest = 'lion';
    setInterval(() => { if (this.app.me?.allyId && !this.root.classList.contains('show')) this.poll(); }, 60000);
  }

  get me() { return this.app.me; }
  async open(tab) { this.root.classList.add('show'); this.app.sfx('click'); await this.load(); this.show(tab || this.tab || (this.v.ally ? 'members' : 'find')); }
  close() { this.root.classList.remove('show'); }
  async load() { try { this.v = await api.ally(); } catch (e) { this.v = { ally: null }; this.app.ui.toast(e.message); } this.badge(); }
  async poll() { try { this.v = await api.ally(); this.badge(); } catch { /* */ } }
  badge() {
    const v = this.v || {};
    const n = (v.helps?.length || 0) + (v.gifts?.length || 0) + (v.requests?.length || 0);
    setDot(document.querySelector('#btn-ally'), n > 0);
  }

  onEvent(m) {
    if (m.type === 'achat') {
      if (this.v?.chat) this.v.chat.push(m);
      if (this.root.classList.contains('show') && this.tab === 'chat') this.renderChat(true);
      else setDot(document.querySelector('#btn-ally'), true);
      return;
    }
    if (m.what === 'accepted') this.app.ui.toast('Вас приняли в союз!', 'good');
    if (m.what === 'kicked') this.app.ui.toast('Вас исключили из союза', 'bad');
    this.app.refresh().catch(() => {});
    (this.root.classList.contains('show') ? this.load().then(() => this.show(this.tab)) : this.poll());
  }

  async op(op, args = {}, okMsg) {
    try {
      const r = await api.allyOp(op, args);
      this.app.setMe(r.me);
      this.v = r.view;
      this.badge();
      if (okMsg) this.app.ui.toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'good');
      return r;
    } catch (e) { this.app.ui.toast(e.message, 'bad'); this.app.sfx('error'); return null; }
  }

  tabs(list) {
    const nav = this.root.querySelector('.hs-tabs');
    nav.innerHTML = list.map(([id, icon, name, dot]) => `<button data-t="${id}" class="${id === this.tab ? 'on' : ''}"><img src="${M(icon)}" alt=""><span>${name}</span>${dot ? '<span class="rdot"></span>' : ''}</button>`).join('');
    nav.querySelectorAll('button').forEach((b) => { b.onclick = () => this.show(b.dataset.t); });
  }

  show(tab) {
    this.tab = tab;
    const v = this.v, a = v.ally;
    const head = this.root.querySelector('.al-head');
    if (a) {
      head.innerHTML = `<img class="al-crest" src="${crestUrl(a.crest)}" alt=""><div><b>[${esc(a.tag)}] ${esc(a.name)}</b>
        <span><img class="ic" src="${M('ai_members')}" alt="">${a.members}/${a.max} · <img class="ic" src="${M('ai_territory')}" alt="">${(v.forts || []).length}${v.fortBonus ? ` · +${Math.round(v.fortBonus * 100)}% добычи` : ''}${a.open ? '' : ' · по заявкам'}</span>
        ${a.motto ? `<i>«${esc(a.motto)}»</i>` : ''}</div>`;
      head.style.display = '';
      this.tabs([['members', 'ai_members', 'Участники', (v.requests || []).length], ['chat', 'ai_chat', 'Чат'], ['rally', 'ai_rally', 'Сбор', (v.rallies || []).some((r) => !r.members.some((m) => m.pid === this.me.id))], ['help', 'ai_help', 'Помощь', (v.helps || []).length], ['gifts', 'ai_gift', 'Подарки', (v.gifts || []).length]]);
    } else {
      head.style.display = 'none';
      if (!['find', 'create'].includes(tab)) tab = this.tab = 'find';
      this.tabs([['find', 'ai_request', 'Найти'], ['create', 'ai_leader', 'Создать']]);
    }
    ({ rally: () => this.renderRally(), find: () => this.renderFind(), create: () => this.renderCreate(), members: () => this.renderMembers(), chat: () => this.renderChat(), help: () => this.renderHelp(), gifts: () => this.renderGifts() })[tab]();
  }
  body() { return this.root.querySelector('.hs-body'); }

  // --- Без союза ------------------------------------------------------------------
  async renderFind(q = '') {
    const body = this.body();
    body.innerHTML = `<form class="al-search"><input placeholder="Название или тег…" value="${esc(q)}"><button class="nbtn sm steel">Найти</button></form><div class="al-list"><p class="muted">Загрузка…</p></div>`;
    body.querySelector('form').onsubmit = (e) => { e.preventDefault(); this.renderFind(body.querySelector('input').value); };
    let list = [];
    try { list = await api.allyList(q); } catch (e) { this.app.ui.toast(e.message); }
    const box = body.querySelector('.al-list');
    box.innerHTML = list.length ? list.map((a) => `<div class="al-row"><img src="${crestUrl(a.crest)}" alt=""><div><b>[${esc(a.tag)}] ${esc(a.name)}</b>
      <span>${a.members}/40 · сила ${fmt(a.power)}${a.motto ? ' · ' + esc(a.motto) : ''}</span></div>
      <button class="nbtn xs ${a.open ? '' : 'steel'}" data-id="${a.id}" ${a.requested ? 'disabled' : ''}>${a.requested ? 'Заявка' : a.open ? 'Вступить' : 'Заявка'}</button></div>`).join('')
      : '<div class="tr-box tr-note">Союзов пока нет — создайте первый!</div>';
    box.querySelectorAll('[data-id]').forEach((b) => {
      b.onclick = async () => {
        const r = await this.op('join', { id: +b.dataset.id });
        if (!r) return;
        if (r.requested) { this.app.ui.toast('Заявка отправлена', 'good'); b.disabled = true; b.textContent = 'Заявка'; }
        else { this.app.sfx('levelup'); this.app.ui.toast('Добро пожаловать в союз!', 'good'); this.show('members'); }
      };
    });
  }

  renderCreate() {
    const free = (this.me.buildings.find((b) => b.type === 'castle')?.level || 1) >= 3;
    const body = this.body();
    body.innerHTML = `<div class="tr-box al-form">
      <label>Название<input name="name" maxlength="20" placeholder="Стражи Рассвета"></label>
      <label>Тег (2–4 знака)<input name="tag" maxlength="4" placeholder="СР"></label>
      <label>Девиз<input name="motto" maxlength="80" placeholder="Вместе — до последнего камня"></label>
      <label class="al-chk"><input type="checkbox" name="open" checked> Вступление без заявки</label>
      <div class="hd-sub">Герб</div>
      <div class="al-crests">${ALLY_CRESTS.map((c) => `<button class="${c === this.crest ? 'on' : ''}" data-c="${c}"><img src="${crestUrl(c)}" alt=""></button>`).join('')}</div>
      <button class="nbtn" data-create>${free ? 'Основать союз' : `Основать <img class="ic" src="${A}kit/gems.png" alt=""> ${ALLY_COST}`}</button>
      <p class="muted small">${free ? 'С Цитадели 3 ур. — бесплатно.' : 'С Цитадели 3 ур. основать союз можно бесплатно.'}</p></div>`;
    body.querySelectorAll('[data-c]').forEach((b) => { b.onclick = (e) => { e.preventDefault(); this.crest = b.dataset.c; body.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('on', x === b)); }; });
    body.querySelector('[data-create]').onclick = async () => {
      const f = (n) => body.querySelector(`[name=${n}]`);
      const r = await this.op('create', { name: f('name').value, tag: f('tag').value, motto: f('motto').value, open: f('open').checked, crest: this.crest }, 'Союз основан!');
      if (r) { this.app.sfx('win'); this.show('members'); }
    };
  }

  // --- Участники --------------------------------------------------------------------
  renderMembers() {
    const v = this.v, a = v.ally, my = a.myRank, meId = this.me.id;
    const reqs = (v.requests || []).map((r) => `<div class="al-row"><img class="al-race" src="${A}races/crest_${r.race}.png" alt=""><div><b>${esc(r.name)}</b><span>${esc(r.owner)} · Цитадель ${r.level}</span></div>
      <button class="nbtn xs" data-acc="${r.player}">Принять</button><button class="nbtn xs steel" data-dec="${r.player}">Нет</button></div>`).join('');
    const rows = v.members.map((m) => {
      const can = m.id !== meId && my >= 3 && m.rank < my;
      const ago = m.online ? '<span class="dot-on"></span> в сети' : `был ${fmtTime((Date.now() - m.seen) / 1000)} назад`;
      return `<div class="al-row ${m.id === meId ? 'me' : ''}"><img class="al-rank" src="${M(RANK_ICON[m.rank] || 'ai_recruit')}" alt="" title="${RANKS[m.rank]}">
        <div><b>${esc(m.name)}</b><span>${RANKS[m.rank]} · ${RACES[m.race]?.name || ''} · Цитадель ${m.level} · ${ago}</span></div>
        ${can ? `<button class="nbtn xs steel" data-menu="${m.id}">…</button>` : ''}</div>`;
    }).join('');
    const body = this.body();
    body.innerHTML = `${reqs ? `<div class="hd-sub">Заявки</div><div class="al-list">${reqs}</div>` : ''}
      <div class="hd-sub">Участники ${v.members.length}/${a.max}</div><div class="al-list">${rows}</div>
      <div class="hd-btns">${my >= 4 ? '<button class="nbtn sm steel" data-set>Настройки</button>' : ''}<button class="nbtn sm steel" data-leave><img class="ic" src="${M('ai_leave')}" alt=""> Покинуть</button></div>`;
    body.querySelectorAll('[data-acc]').forEach((b) => { b.onclick = () => this.op('accept', { player: +b.dataset.acc }, 'Принят в союз').then((r) => r && this.show('members')); });
    body.querySelectorAll('[data-dec]').forEach((b) => { b.onclick = () => this.op('decline', { player: +b.dataset.dec }).then((r) => r && this.show('members')); });
    body.querySelectorAll('[data-menu]').forEach((b) => { b.onclick = () => this.memberMenu(v.members.find((m) => m.id === +b.dataset.menu)); });
    body.querySelector('[data-leave]').onclick = () => this.app.ui.modal('Покинуть союз?', '<p>Вы потеряете подарки и помощь союзников.</p>', [{ label: 'Покинуть', cls: 'red', onClick: async () => { this.app.ui.closeModal(); if (await this.op('leave')) this.show('find'); } }], 'bw');
    const set = body.querySelector('[data-set]');
    if (set) set.onclick = () => {
      const box = this.app.ui.modal('Настройки союза', `<div class="al-form"><label>Девиз<input name="motto" maxlength="80" value="${esc(a.motto)}"></label>
        <label class="al-chk"><input type="checkbox" name="open" ${a.open ? 'checked' : ''}> Вступление без заявки</label></div>`,
      [{ label: 'Сохранить', cls: 'green', onClick: async () => { const f = (n) => box.querySelector(`[name=${n}]`); this.app.ui.closeModal(); if (await this.op('settings', { motto: f('motto').value, open: f('open').checked }, 'Сохранено')) this.show('members'); } }], 'bw');
    };
  }

  memberMenu(m) {
    const my = this.v.ally.myRank;
    const btns = [];
    if (my >= 4 && m.rank < 3) btns.push({ label: 'Повысить', cls: 'green', onClick: () => this.after('promote', m) });
    if (my >= 4 && m.rank > 1) btns.push({ label: 'Понизить', cls: 'steel', onClick: () => this.after('demote', m) });
    if (my >= 4) btns.push({ label: 'Сделать главой', cls: 'steel', onClick: () => this.after('transfer', m) });
    btns.push({ label: `<img class="ic" src="${M('ai_kick')}" alt=""> Исключить`, cls: 'red', onClick: () => this.after('kick', m) });
    this.app.ui.modal(esc(m.name), `<p class="muted">${RANKS[m.rank]} · Цитадель ${m.level}</p>`, btns, 'bw');
  }
  async after(op, m) { this.app.ui.closeModal(); if (await this.op(op, { player: m.id })) this.show('members'); }

  // --- Чат --------------------------------------------------------------------------
  renderChat(keep) {
    const body = this.body();
    const list = (this.v.chat || []).map((c) => `<div class="al-msg ${c.player === this.me.id ? 'mine' : ''}"><b>${esc(c.name)}</b><span>${esc(c.text)}</span><i>${new Date(c.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</i></div>`).join('') || '<p class="muted">Сообщений пока нет — поздоровайтесь с союзниками!</p>';
    if (keep && body.querySelector('.al-chat')) { body.querySelector('.al-chat').innerHTML = list; body.querySelector('.al-chat').scrollTop = 1e6; return; }
    body.innerHTML = `<div class="al-chat">${list}</div><form class="al-send"><input maxlength="200" placeholder="Сообщение союзу…"><button class="nbtn sm"><img class="ic" src="${M('ai_chat')}" alt=""></button></form>`;
    const chat = body.querySelector('.al-chat');
    chat.scrollTop = 1e6;
    body.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const inp = body.querySelector('input'), text = inp.value.trim();
      if (!text) return;
      inp.value = '';
      try { await api.allyOp('chat', { text }); } catch (er) { this.app.ui.toast(er.message); }
    };
  }

  // --- Сбор на крепости --------------------------------------------------------------
  renderRally() {
    const v = this.v, me = this.me, now = Date.now() + (me.now - this.app.fetchedAt);
    const rows = (v.rallies || []).map((r) => {
      const wait = r.launch > now, inside = r.members.some((m) => m.pid === me.id);
      const t = wait ? `сбор: ${fmtTime((r.launch - now) / 1000)}` : `в пути: ${fmtTime(((r.arrive || r.launch + r.travel * 1000) - now) / 1000)}`;
      return `<div class="tr-box al-rally"><div class="al-rh"><img src="${M('a_fort' + r.level)}" alt=""><div><b>${esc(r.name)} · ур. ${r.level}</b>
          <span>Ведёт ${esc(r.leaderName)} · ${t}</span>
          <span>Сила <b class="${r.might >= r.enemy ? 'ok' : 'bad'}">${fmt(r.might)}</b> / гарнизон ${fmt(r.enemy)}</span></div></div>
        <div class="ms-chips">${r.members.map((m) => `<span class="ms-chip">${esc(m.name)} · ${fmt(m.n)}</span>`).join('')}</div>
        ${wait && !inside ? `<div class="hd-btns"><button class="nbtn sm" data-join="${r.id}"><img class="ic" src="${M('ai_rally')}" alt=""> Присоединиться</button></div>` : inside ? '<p class="muted small">Ваши войска в этом сборе</p>' : ''}</div>`;
    }).join('');
    const forts = (v.forts || []).map((f) => `<div class="al-row"><img src="${M('a_fort' + f.level)}" alt=""><div><b>${esc(f.name)} · ур. ${f.level}</b><span>${f.x}:${f.y} · наша с ${new Date(f.since).toLocaleDateString('ru-RU')}</span></div><button class="nbtn xs steel" data-go="${f.x},${f.y}">На карту</button></div>`).join('');
    const log = (v.warlog || []).slice(0, 6).map((l) => `<div class="ms-row"><span>${l.win ? '⚔ Взята' : '✖ Отбиты у'} «${esc(l.name)}»${l.from ? ` у [${esc(l.from)}]` : ''}</span><b class="${l.win ? 'ok' : 'bad'}">${new Date(l.ts).toLocaleDateString('ru-RU')}</b></div>`).join('');
    this.body().innerHTML = `<div class="tr-box tr-note">Найдите крепость на карте и объявите сбор. Союзники за 5 минут добавят войска, затем отряд ударит вместе. Каждая крепость даёт союзу +5% добычи (до трёх).</div>
      ${rows || '<p class="muted">Активных сборов нет.</p>'}
      <div class="hd-sub">Крепости союза</div>${forts ? `<div class="al-list">${forts}</div>` : '<p class="muted">Пока ни одной.</p>'}
      ${log ? `<div class="hd-sub">Летопись битв</div><div class="tr-box">${log}</div>` : ''}`;
    this.body().querySelectorAll('[data-join]').forEach((b) => { b.onclick = () => { const r = v.rallies.find((x) => x.id === b.dataset.join); this.app.world.march.open({ kind: 'join', rally: { ...r, fx: r.x, fy: r.y } }); }; });
    this.body().querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => { const [x, y] = b.dataset.go.split(',').map(Number); this.close(); this.app.openWorld(x, y); }; });
  }

  // --- Помощь -----------------------------------------------------------------------
  renderHelp() {
    const v = this.v, me = this.me;
    const building = me.buildings.filter((b) => b.up && !(v.myHelps || []).some((h) => h.bId === b.id && h.to === b.up.to));
    const rows = (v.helps || []).map((h) => `<div class="al-row"><img src="${A}city/${h.type}.png" alt=""><div><b>${esc(h.name)}</b><span>${BUILDINGS[h.type]?.name || ''} → ур. ${h.to} · помощь ${h.n}/${h.max}</span></div></div>`).join('');
    const mine = (v.myHelps || []).map((h) => `<div class="al-row"><img src="${A}city/${h.type}.png" alt=""><div><b>${BUILDINGS[h.type]?.name || ''} → ур. ${h.to}</b><span>Помогли ${h.n} из ${h.max}</span></div></div>`).join('');
    const body = this.body();
    body.innerHTML = `<div class="tr-box"><div class="ms-row"><span><img class="ic" src="${M('ai_help')}" alt="">Каждая помощь ускоряет стройку на 1% (не меньше минуты)</span></div>
        <div class="hd-btns"><button class="nbtn" data-all ${rows ? '' : 'disabled'}><img class="ic" src="${M('ai_helped')}" alt=""> Помочь всем (${(v.helps || []).length})</button></div></div>
      ${rows ? `<div class="al-list">${rows}</div>` : '<p class="muted">Сейчас никто не просит помощи.</p>'}
      <div class="hd-sub">Мои стройки</div>
      ${building.map((b) => `<div class="al-row"><img src="${A}city/${b.type}.png" alt=""><div><b>${BUILDINGS[b.type].name} → ур. ${b.up.to}</b><span>осталось ${fmtTime((b.up.end - me.now) / 1000)}</span></div><button class="nbtn xs" data-ask="${b.id}">Попросить</button></div>`).join('')}
      ${mine}${!building.length && !mine ? '<p class="muted">Ничего не строится.</p>' : ''}`;
    const all = body.querySelector('[data-all]');
    if (all) all.onclick = async () => { const r = await this.op('helpAll', {}, (x) => `Вы помогли ${x.helped} раз${x.got?.gold ? ` · +${fmt(x.got.gold)} золота` : ''}`); if (r) { this.app.sfx('coin'); this.show('help'); } };
    body.querySelectorAll('[data-ask]').forEach((b) => { b.onclick = async () => { if (await this.op('askHelp', { id: +b.dataset.ask }, 'Союзники получили просьбу')) this.show('help'); }; });
  }

  // --- Подарки ------------------------------------------------------------------------
  renderGifts() {
    const v = this.v;
    const rows = (v.gifts || []).map((g) => `<div class="al-row"><img src="${M(g.chest)}" alt=""><div><b>Подарок от ${esc(g.from)}</b><span>${Object.entries(g.reward).map(([k, n]) => `<img class="ic" src="${resIcon(k)}" alt="">${short(n)}`).join(' ')}</span></div></div>`).join('');
    const body = this.body();
    body.innerHTML = `<div class="tr-box tr-note">Когда союзник побеждает сильного врага на карте (ур. 3+), каждый в союзе получает сундук. Сундуки хранятся сутки.</div>
      ${rows ? `<div class="al-list">${rows}</div><div class="hd-btns"><button class="nbtn" data-claim><img class="ic" src="${M('ai_gift')}" alt=""> Забрать все</button></div>` : '<p class="muted">Подарков пока нет.</p>'}`;
    const c = body.querySelector('[data-claim]');
    if (c) c.onclick = async () => { const r = await this.op('claimGifts', {}, (x) => `Открыто сундуков: ${x.n}`); if (r) { this.app.engage.rewardFx(r.got); this.show('gifts'); } };
  }
}

function setDot(el, on) {
  if (!el) return;
  let d = el.querySelector('.rdot');
  if (on && !d) { d = document.createElement('span'); d.className = 'rdot'; el.appendChild(d); }
  if (!on && d) d.remove();
}
