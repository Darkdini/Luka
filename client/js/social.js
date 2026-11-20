// Выдвижное меню, чат (Мир / Союз) с полоской последнего сообщения
// внизу города и рейтинги (игроки и союзы по силе, победам, Цитадели).
import { fmt, RACES } from '/shared/config.js';
import { avatarUrl } from './world.js';
import { resIcon, short } from './cityui.js';

const A = '/assets/realm/';
const M = (n) => `${A}meta/${n}.png`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s) => document.querySelector(s);
const crest = (race) => `${A}races/crest_${RACES[race] ? race : 'humans'}.png`;
const hhmm = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

function screen(id, title) {
  let root = document.getElementById(id);
  if (!root) {
    root = document.createElement('div');
    root.id = id;
    root.className = 'meta-screen';
    root.innerHTML = `<div class="hs-top"><button class="hs-back" aria-label="Назад"><img src="${A}kit/back.png" alt=""></button><b class="hs-title">${title}</b><div class="hs-res"></div></div><div class="hs-body"></div><nav class="hs-tabs"></nav>`;
    document.body.appendChild(root);
  }
  root.querySelector('.hs-back').onclick = () => root.classList.remove('show');
  return root;
}

// ============================================================================
// Выдвижное меню справа: «Меню» раскрывает вверх столбик разделов
export class Tray {
  constructor(app) {
    this.app = app;
    this.el = $('#tray');
    $('#btn-menu').onclick = (e) => { e.stopPropagation(); this.toggle(); };
    // пункт выбран — меню сворачивается (обработчики висят на самих кнопках)
    this.el.addEventListener('click', (e) => { if (e.target.closest('.tr-i')) this.toggle(false); });
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#tray, #btn-menu')) this.toggle(false); });
    setInterval(() => this.dot(), 700);
  }
  get open() { return this.el.classList.contains('show'); }
  toggle(on = !this.open) {
    if (on === this.open) return;
    this.el.classList.toggle('show', on);
    $('#btn-menu').classList.toggle('on', on);
    if (on) this.app.sfx('click');
  }
  // красная точка на «Меню», если внутри что-то ждёт
  dot() {
    const any = !!this.el.querySelector('.rdot, .badge:not(.hidden)');
    let d = $('#btn-menu .rdot');
    if (any && !d) { d = document.createElement('span'); d.className = 'rdot'; $('#btn-menu').appendChild(d); }
    if (!any && d) d.remove();
  }
}

// ============================================================================
export class Chat {
  constructor(app) {
    this.app = app;
    this.world = [];
    this.tab = 'world';
    this.root = screen('chatx', 'Чат');
    this.root.querySelector('.hs-body').innerHTML = '<div class="al-chat ch-log"></div>';
    const form = document.createElement('form');
    form.className = 'al-send ch-send';
    form.innerHTML = `<input maxlength="200" placeholder="Сообщение…" autocomplete="off"><button class="nbtn sm"><img class="ic" src="${M('ai_chat')}" alt=""></button>`;
    this.root.insertBefore(form, this.root.querySelector('.hs-tabs'));
    form.onsubmit = (e) => { e.preventDefault(); this.send(form.querySelector('input')); };
    $('#chatbar').onclick = () => this.open('world');
  }
  open(tab) { this.tab = tab || this.tab; this.root.classList.add('show'); this.app.sfx('click'); this.unread = 0; this.badge(); this.render(); }
  get visible() { return this.root.classList.contains('show'); }

  // сообщения мирового чата из WebSocket
  push(m, live) {
    this.world.push(m);
    if (this.world.length > 120) this.world.shift();
    this.bar(m);
    if (live && !(this.visible && this.tab === 'world')) { this.unread = (this.unread || 0) + 1; this.badge(); }
    if (this.visible && this.tab === 'world') this.render();
  }
  ally(m) { if (this.visible && this.tab === 'ally') this.render(); else this.bar({ ...m, ally: true }); }
  badge() { $('#chatbar').classList.toggle('new', !!this.unread); }
  bar(m) {
    const el = $('#chatbar');
    el.querySelector('.cb-ava').src = m.avatar ? avatarUrl(m.avatar) : m.race ? crest(m.race) : M('ai_chat');
    el.querySelector('.cb-who').textContent = `${m.tag ? `[${m.tag}]` : ''}${m.name} (${m.ally ? 'Союз' : 'Мир'})`;
    el.querySelector('.cb-text').textContent = m.text;
  }

  async render() {
    const nav = this.root.querySelector('.hs-tabs');
    nav.innerHTML = [['world', 'ai_territory', 'Мир'], ['ally', 'ai_members', 'Союз']].map(([id, ic, n]) => `<button data-t="${id}" class="${id === this.tab ? 'on' : ''}"><img src="${M(ic)}" alt=""><span>${n}</span></button>`).join('');
    nav.querySelectorAll('button').forEach((b) => { b.onclick = () => { this.tab = b.dataset.t; this.render(); }; });
    const log = this.root.querySelector('.ch-log');
    let list;
    if (this.tab === 'ally') {
      if (!this.app.me.allyId) { log.innerHTML = '<div class="tr-box tr-note">Вы не в союзе. Вступите или основайте свой — там свой чат.</div>'; return; }
      try { this.app.ally.v = await this.app.api.ally(); } catch { /* */ }
      list = (this.app.ally.v?.chat || []).map((c) => ({ ...c, race: this.app.ally.v.members?.find((m) => m.id === c.player)?.race }));
    } else list = this.world;
    const me = this.app.me.id;
    let lastDay = '';
    log.innerHTML = list.map((c) => {
      const day = new Date(c.ts).toLocaleDateString('ru-RU');
      const sep = day !== lastDay ? `<div class="ch-day">${day}</div>` : '';
      lastDay = day;
      return `${sep}<div class="ch-msg ${c.player === me ? 'mine' : ''}"><img class="${c.avatar ? 'ava' : ''}" src="${c.avatar ? avatarUrl(c.avatar) : crest(c.race)}" alt=""><div><b data-pid="${c.player}">${c.tag ? `[${esc(c.tag)}]` : ''}${esc(c.name)}</b><p>${esc(c.text)}<i>${hhmm(c.ts)}</i></p></div></div>`;
    }).join('') || '<p class="muted">Сообщений пока нет — напишите первым!</p>';
    log.querySelectorAll('b[data-pid]').forEach((b) => { b.onclick = () => this.app.ui.openProfile(+b.dataset.pid); });
    log.scrollTop = 1e6;
  }

  async send(inp) {
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    if (this.tab === 'ally') {
      try { await this.app.api.allyOp('chat', { text }); } catch (e) { this.app.ui.toast(e.message); }
    } else if (this.app.ws?.readyState === 1) this.app.ws.send(JSON.stringify({ type: 'chat', text }));
    else this.app.ui.toast('Нет связи с чатом');
  }
}

// ============================================================================
const KINDS = [
  ['power', 'Рейтинг по силе', 'power_ic', false],
  ['kills', 'Рейтинг по победам', 'atk', false],
  ['castle', 'Рейтинг по Цитадели', 'castle', false],
  ['ally_power', 'Рейтинг союзов по силе', 'ai_members', true],
  ['ally_kills', 'Рейтинг союзов по победам', 'ai_war', true],
];
const kindIcon = (ic) => (ic === 'power_ic' || ic === 'atk' ? `${A}kit/${ic}.png` : ic === 'castle' ? `${A}world/i_castle.png` : M(ic));
const MEDAL = ['e_gold', 'e_silver', 'e_bronze'];

export class Ranking {
  constructor(app) {
    this.app = app;
    this.root = screen('rank', 'Рейтинг');
    $('#btn-top').onclick = () => this.open();
  }
  open() { this.root.classList.add('show'); this.app.sfx('click'); this.list(); }
  list() {
    this.root.querySelector('.hs-title').textContent = 'Рейтинг';
    this.root.querySelector('.hs-tabs').innerHTML = '';
    this.root.querySelector('.hs-back').onclick = () => this.root.classList.remove('show');
    const body = this.root.querySelector('.hs-body');
    body.innerHTML = KINDS.map(([k, n, ic]) => `<button class="rk-cat" data-k="${k}"><img src="${kindIcon(ic)}" alt=""><span>${n}</span><img class="rk-go" src="${A}kit/chev_r.png" alt=""></button>`).join('');
    body.querySelectorAll('.rk-cat').forEach((b) => { b.onclick = () => this.board(b.dataset.k); });
  }
  async board(kind) {
    const [, title, , isAlly] = KINDS.find((x) => x[0] === kind);
    this.root.querySelector('.hs-title').textContent = title;
    this.root.querySelector('.hs-back').onclick = () => this.list();
    const body = this.root.querySelector('.hs-body');
    body.innerHTML = '<p class="muted">Загрузка…</p>';
    let d;
    try { d = await this.app.api.rank(kind); } catch (e) { body.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    const val = (v) => (kind === 'castle' ? `ур. ${v}` : fmt(v || 0));
    const row = (i, img, name, sub, v, me) => `<div class="al-row ${me ? 'me' : ''}">${i < 3 ? `<img class="ev-medal" src="${M(MEDAL[i])}" alt="">` : `<b class="ev-rank">${i + 1}</b>`}
      <img class="al-race" src="${img}" alt=""><div><b>${name}</b>${sub ? `<span>${sub}</span>` : ''}</div><span class="ev-pts">${val(v)}</span></div>`;
    const rows = d.top.map((r, i) => (isAlly
      ? row(i, `${A}meta/c_${r.crest || 'lion'}.png`, `[${esc(r.tag)}] ${esc(r.name)}`, `${r.members} участников`, r.value, r.id === this.app.me.allyId)
      : row(i, crest(r.race), `${r.tag ? `[${esc(r.tag)}] ` : ''}${esc(r.name)}`, esc(r.owner), r.value, r.id === this.app.me.id))).join('');
    const mine = d.me ? `<div class="rk-me"><span>${isAlly ? 'Ваш союз' : 'Вы'}: место <b>${d.me.rank}</b></span><b>${val(d.me.value)}</b></div>` : (isAlly ? '<div class="rk-me"><span>Вы не в союзе</span></div>' : '');
    body.innerHTML = `${mine}<div class="al-list">${rows || '<p class="muted">Пока пусто</p>'}</div>`;
  }
}

// ============================================================================
// Почта: разделы → список писем → письмо (подарок, запись боя, ответ)
const CATS = [
  ['msg', 'Сообщения', `${A}meta/ai_chat.png`],
  ['ally', 'Отчёт союза', `${A}meta/ai_rally.png`],
  ['battle', 'Боевой отчёт', `${A}world/i_attack.png`],
  ['event', 'Событие', `${A}meta/e_points.png`],
  ['notice', 'Игровое уведомление', `${A}meta/p_scroll.png`],
  ['report', 'Игровой отчёт', `${A}world/i_report.png`],
];
const catOf = (id) => CATS.find((c) => c[0] === id) || CATS[4];
const when = (ts) => {
  const d = new Date(ts), now = new Date();
  return d.toDateString() === now.toDateString() ? hhmm(ts) : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
};
const chips = (o, sign = '') => Object.entries(o || {}).filter(([, v]) => v > 0)
  .map(([k, v]) => `<span class="ml-chip"><img src="${resIcon(k)}" alt="">${sign}${short(v)}</span>`).join('');
const sum = (o) => Object.values(o || {}).reduce((a, v) => a + (v || 0), 0);

export class Mail {
  constructor(app) {
    this.app = app;
    this.root = screen('mail', 'Почта');
    this.root.classList.add('mail-screen');
    $('#btn-reports').onclick = () => this.open();
    this.view = 'cats';
  }
  get list() { return this.app.me?.mail || []; }
  unread(cat) { return this.list.filter((m) => !m.read && (!cat || m.cat === cat)).length; }
  open(cat) { this.root.classList.add('show'); this.app.sfx('click'); if (cat) this.cat(cat); else this.cats(); }
  // перерисовать открытый вид после обновления состояния
  refresh() { if (!this.root.classList.contains('show')) return; if (this.view === 'cats') this.cats(); else if (this.view === 'cat') this.cat(this.curCat, true); }
  head(title, back) {
    this.root.querySelector('.hs-title').textContent = title;
    this.root.querySelector('.hs-back').onclick = back;
    this.root.querySelector('.hs-tabs').innerHTML = '';
    return this.root.querySelector('.hs-body');
  }

  cats() {
    this.view = 'cats';
    const body = this.head('Почта', () => this.root.classList.remove('show'));
    body.innerHTML = `<div class="ml-cats">${CATS.map(([id, name, ic]) => {
      const last = this.list.find((m) => m.cat === id), n = this.unread(id);
      const gift = this.list.some((m) => m.cat === id && m.gift && !m.claimed);
      return `<button class="ml-cat" data-c="${id}"><i class="ml-ic"><img src="${ic}" alt=""></i><div><b>${name}</b><span>${last ? esc(last.title) : 'Писем нет'}</span></div>
        <div class="ml-side">${last ? `<small>${when(last.ts)}</small>` : ''}${gift ? `<img class="ml-gift" src="${A}meta/ai_gift.png" alt="Подарок">` : ''}${n ? `<em>${n}</em>` : ''}</div></button>`;
    }).join('')}</div>`;
    body.querySelectorAll('.ml-cat').forEach((b) => { b.onclick = () => this.cat(b.dataset.c); });
  }

  cat(id, keep) {
    this.view = 'cat'; this.curCat = id;
    const body = this.head(catOf(id)[1], () => this.cats());
    const scroll = keep ? body.scrollTop : 0;
    const list = this.list.filter((m) => m.cat === id);
    const gifts = list.some((m) => m.gift && !m.claimed), unread = list.some((m) => !m.read);
    body.innerHTML = `<div class="ml-list">${list.map((m) => `<button class="ml-row ${m.read ? '' : 'new'}" data-id="${m.id}">
        <i class="ml-env"><img src="${m.race && (m.from || m.to) ? crest(m.race) : catOf(m.cat)[2]}" alt=""></i>
        <div><b>${esc(m.title)}</b><span>${esc((m.text || '').split('\n')[0])}</span></div>
        <div class="ml-side"><small>${when(m.ts)}</small>${m.gift && !m.claimed ? `<img class="ml-gift" src="${A}meta/ai_gift.png" alt="">` : ''}${m.battle ? `<img class="ml-gift" src="${A}kit/atk.png" alt="">` : ''}</div></button>`).join('') || '<p class="muted center">Писем нет</p>'}</div>
      ${list.length ? `<div class="ml-foot">
        <button class="nbtn sm steel" data-a="read" ${unread ? '' : 'disabled'}>Прочитать все</button>
        ${gifts ? '<button class="nbtn sm gold" data-a="claim">Забрать все</button>' : '<button class="nbtn sm steel" data-a="del">Удалить прочитанные</button>'}</div>` : ''}`;
    body.scrollTop = scroll;
    body.querySelectorAll('.ml-row').forEach((b) => { b.onclick = () => this.letter(+b.dataset.id); });
    const act = (a, args) => this.app.act(a, args).then((r) => { if (r.got) this.app.engage.rewardFx(r.got); this.cat(id, true); }).catch(() => {});
    body.querySelector('[data-a=read]')?.addEventListener('click', () => act('mailRead', { cat: id }));
    body.querySelector('[data-a=claim]')?.addEventListener('click', () => act('mailClaim', { cat: id }));
    body.querySelector('[data-a=del]')?.addEventListener('click', () => act('mailDel', { cat: id }));
  }

  letter(id) {
    const m = this.list.find((x) => x.id === id);
    if (!m) { this.cat(this.curCat); return; }
    this.view = 'letter';
    const body = this.head(catOf(m.cat)[1], () => this.cat(m.cat));
    const who = m.from || m.to;
    const res = (title, o, sign) => (sum(o) ? `<div class="ml-sub">${title}</div><div class="ml-chips">${chips(o, sign)}</div>` : '');
    const troops = (title, o) => (sum(o) ? `<div class="ml-line"><span>${title}</span><b>${fmt(sum(o))}</b></div>` : '');
    body.innerHTML = `<article class="ml-letter">
      <header><b>${esc(m.title)}</b><small>${new Date(m.ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></header>
      ${who ? `<div class="ml-from"><img src="${crest(m.race)}" alt=""><span>${m.sent ? 'Кому' : 'От'}: <b ${m.fromId || m.toId ? `data-pid="${m.fromId || m.toId}"` : ''}>${esc(who)}</b></span></div>` : ''}
      ${m.win != null ? `<div class="ml-res ${m.win ? 'win' : 'lose'}">${m.win ? 'Победа' : 'Поражение'}</div>` : ''}
      <div class="ml-text">${esc(m.text || '').replace(/\n/g, '<br>')}</div>
      ${res('Добыча', m.got, '+')}${res('Потеряно', m.lost, '−')}
      ${troops('Ранено', m.wounded)}${troops('Погибло', m.died)}
      ${m.gift ? `<div class="ml-giftbox"><div class="ml-sub">Вложение</div><div class="ml-chips">${chips(m.gift)}</div>
        ${m.claimed ? '<div class="ml-got">Получено</div>' : '<button class="nbtn gold" data-a="claim">Забрать</button>'}</div>` : ''}
      <div class="ml-foot">
        ${m.battle ? '<button class="nbtn sm" data-a="watch">Смотреть бой</button>' : ''}
        ${m.cat === 'msg' && m.fromId && !m.sent ? '<button class="nbtn sm" data-a="reply">Ответить</button>' : ''}
        <button class="nbtn sm steel" data-a="del">Удалить</button>
      </div></article>`;
    body.scrollTop = 0;
    body.querySelector('[data-pid]')?.addEventListener('click', (e) => this.app.ui.openProfile(+e.target.dataset.pid));
    body.querySelector('[data-a=claim]')?.addEventListener('click', () => this.app.act('mailClaim', { id }).then((r) => { this.app.engage.rewardFx(r.got); this.letter(id); }).catch(() => {}));
    body.querySelector('[data-a=del]').onclick = () => this.app.act('mailDel', { id }).then(() => this.cat(m.cat)).catch(() => {});
    body.querySelector('[data-a=watch]')?.addEventListener('click', () => this.app.world.march.watch(m.battle));
    body.querySelector('[data-a=reply]')?.addEventListener('click', () => this.compose(m.fromId, m.from));
    if (!m.read) this.app.act('mailRead', { id }).catch(() => {});
  }

  // Письмо другому правителю
  compose(to, name) {
    const box = this.app.ui.modal(`Письмо: ${esc(name)}`, '<textarea class="ml-ta" maxlength="500" rows="6" placeholder="Текст письма…"></textarea><p class="muted ml-hint">До 500 знаков. Грубые слова скрываются.</p>',
      [{ label: 'Отправить', cls: 'gold', onClick: () => {
        const text = box.querySelector('textarea').value;
        this.app.act('mailSend', { to, text }).then(() => { this.app.ui.closeModal(); this.app.ui.toast('Письмо отправлено', 'good'); this.refresh(); }).catch(() => {});
      } }], 'bw');
    box.querySelector('textarea').focus();
  }
}
