// Походы: окно отправки (герои + войска), список отрядов в пути (в городе и на карте),
// окно похода (ускорить, отозвать, посмотреть бой).
import { fmt, fmtTime, gemsForTime, castleLevelOf } from '/shared/config.js';
import { HERO, heroPower } from '/shared/heroes.js';
import { SITE_TYPES } from '/shared/worldgen.js';
import { parseKey, troopName, artGroup, ROMAN } from '/shared/troops.js';
import { troopMight, troopLoad, troopCount, travelSec, siteMight, siteAmount, gatherRate, MAX_HEROES } from '/shared/march.js';
import { api } from './api.js';
import { resIcon, short } from './cityui.js';

const A = '/assets/realm/';
const WI = (n) => `${A}world/${n}.png`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class MarchUI {
  constructor(app, world) {
    this.app = app;
    this.world = world;
    this.list = document.createElement('div');
    this.list.id = 'marches';
    document.body.appendChild(this.list);
    setInterval(() => this.tick(), 500);
  }
  get me() { return this.app.me; }
  serverNow() { return Date.now() + (this.me.now - this.app.fetchedAt); }

  // --- Окно отправки ---------------------------------------------------------------
  open(t) {
    const me = this.me;
    const cl = castleLevelOf(me);
    if ((me.marches || []).length >= me.marchSlots) { this.app.ui.toast(`Все отряды в походе (${me.marches.length}/${me.marchSlots})`); return; }
    const busy = new Set((me.marches || []).flatMap((m) => m.heroes));
    const free = Object.keys(me.roster || {}).filter((id) => !busy.has(id));
    this.t = t;
    this.heroes = t.kind === 'attack'
      ? (me.formation || []).filter((id) => id && free.includes(id)).slice(0, MAX_HEROES)
      : [];
    if (t.kind === 'attack' && !this.heroes.length) this.heroes = free.sort((a, b) => this.hp(b) - this.hp(a)).slice(0, MAX_HEROES);
    this.troops = this.auto(me.marchCap);
    void cl;
    this.render();
  }
  hp(id) { const h = this.me.roster[id]; return heroPower(id, h.level, h.stars, h.skills); }

  // лучшие ступени — первыми, до предела похода
  auto(cap) {
    const keys = Object.entries(this.me.troops || {}).filter(([, n]) => n > 0).sort((a, b) => parseKey(b[0]).tier - parseKey(a[0]).tier);
    const out = {};
    let left = cap;
    for (const [k, n] of keys) { const v = Math.min(n, left); if (v > 0) { out[k] = v; left -= v; } }
    return out;
  }

  target() {
    const t = this.t;
    if (t.player) return { x: t.player.x, y: t.player.y, name: t.player.name, level: t.player.level };
    return { x: t.site.x, y: t.site.y, name: t.site.name, level: t.site.level, type: t.site.type };
  }

  render() {
    const me = this.me, t = this.t, tg = this.target();
    const busy = new Set((me.marches || []).flatMap((m) => m.heroes));
    const roster = Object.keys(me.roster || {}).sort((a, b) => this.hp(b) - this.hp(a));
    const st = tg.type ? SITE_TYPES[tg.type] : null;
    const enemyKind = st?.enemy || null;
    const cnt = troopCount(this.troops);
    const might = troopMight(this.troops, me.race, enemyKind);
    const dist = Math.hypot(tg.x - me.x, tg.y - me.y);
    const travel = travelSec(dist, this.troops);
    const load = troopLoad(this.troops, me.race);
    let summary;
    if (t.kind === 'gather') {
      const amount = siteAmount(tg.type, tg.level), take = Math.min(amount, load);
      summary = `<div class="ms-row"><span><img class="ic" src="${resIcon(st.res)}" alt="">Соберут</span><b>${fmt(take)} / ${fmt(amount)}</b></div>
        <div class="ms-row"><span>Время сбора</span><b>${fmtTime(take / gatherRate(tg.level))}</b></div>`;
    } else {
      const enemy = t.player ? null : siteMight(tg.level);
      const hp = this.heroes.reduce((a, id) => a + this.hp(id), 0);
      summary = `<div class="ms-row"><span><img class="ic" src="${A}kit/power_ic.png" alt="">Сила героев</span><b>${fmt(hp)}</b></div>
        <div class="ms-row"><span><img class="ic" src="${A}kit/atk.png" alt="">Мощь войск</span><b class="${enemy && might < enemy ? 'bad' : 'ok'}">${fmt(might)}${enemy ? ` / ${fmt(enemy)}` : ''}</b></div>
        ${enemyKind ? `<div class="ms-hint">Враг — ${enemyKind === 'infantry' ? 'пехота: берите стрелков' : enemyKind === 'cavalry' ? 'конница: берите пехоту' : 'стрелки: берите конницу'}</div>` : ''}`;
    }
    const heroes = roster.map((id) => {
      const on = this.heroes.includes(id), b = busy.has(id), d = HERO[id];
      return `<button class="ms-h r-${d.rarity} ${on ? 'on' : ''} ${b ? 'busy' : ''}" data-h="${id}" ${b ? 'disabled' : ''}><img src="${A}heroes/${id}_p.png" alt=""><span>${b ? 'в походе' : 'ур. ' + me.roster[id].level}</span></button>`;
    }).join('');
    const rows = Object.entries(me.troops || {}).filter(([, n]) => n > 0).sort((a, b) => parseKey(b[0]).tier - parseKey(a[0]).tier).map(([k, n]) => {
      const { kind, tier } = parseKey(k), v = this.troops[k] || 0;
      return `<div class="ms-t"><img src="${A}troops/${me.race}_${kind}${artGroup(tier)}.png" alt=""><img class="ms-tier" src="${A}troops/tier${tier}.png" alt="${ROMAN[tier - 1]}">
        <div class="ms-tn"><b>${troopName(me.race, kind, tier)}</b><input type="range" min="0" max="${n}" value="${v}" data-k="${k}"></div><span class="ms-tv">${fmt(v)}<small>/${fmt(n)}</small></span></div>`;
    }).join('') || '<p class="muted">Войск нет — обучите их в «Армии».</p>';
    const box = this.app.ui.modal(`${t.kind === 'gather' ? 'Сбор' : t.player ? 'Налёт' : 'Атака'}: ${esc(tg.name)}`, `
      <div class="ms-sub">${t.kind === 'gather' ? 'Герои не обязательны' : `Герои ведут отряд · до ${MAX_HEROES}`}</div>
      <div class="ms-heroes">${heroes}</div>
      <div class="ms-head"><span>Войска <b>${fmt(cnt)}</b> / ${fmt(me.marchCap)}</span><button class="nbtn xs steel" data-auto>Авто</button><button class="nbtn xs steel" data-clear>Сброс</button></div>
      <div class="ms-troops">${rows}</div>
      <div class="bw-box">${summary}
        <div class="ms-row"><span><img class="ic" src="${WI('i_speed')}" alt="">В пути</span><b>${fmtTime(travel)}</b></div>
        <div class="ms-row"><span><img class="ic" src="${A}kit/chest.png" alt="">Груз</span><b>${fmt(load)}</b></div></div>`,
    [{ label: `<img class="ic" src="${WI(t.kind === 'gather' ? 'i_gather' : 'i_attack')}" alt=""> В поход`, cls: 'green', disabled: !cnt || (t.kind === 'attack' && !this.heroes.length), onClick: () => this.send() }], 'march-sheet');
    box.querySelectorAll('.ms-h').forEach((b) => {
      b.onclick = () => {
        const id = b.dataset.h;
        if (this.heroes.includes(id)) this.heroes = this.heroes.filter((v) => v !== id);
        else if (this.heroes.length < MAX_HEROES) this.heroes.push(id);
        else { this.app.ui.toast(`Не больше ${MAX_HEROES} героев`); return; }
        this.render();
      };
    });
    box.querySelectorAll('input[type=range]').forEach((r) => {
      r.oninput = () => {
        const k = r.dataset.k;
        const other = troopCount(this.troops) - (this.troops[k] || 0);
        this.troops[k] = Math.max(0, Math.min(+r.value, me.marchCap - other));
        if (!this.troops[k]) delete this.troops[k];
        r.value = this.troops[k] || 0;
        clearTimeout(this.rt); this.rt = setTimeout(() => this.render(), 120);
        r.closest('.ms-t').querySelector('.ms-tv').innerHTML = `${fmt(this.troops[k] || 0)}<small>/${fmt(me.troops[k])}</small>`;
      };
    });
    box.querySelector('[data-auto]').onclick = () => { this.troops = this.auto(me.marchCap); this.render(); };
    box.querySelector('[data-clear]').onclick = () => { this.troops = {}; this.render(); };
  }

  async send() {
    const t = this.t;
    const args = { kind: t.kind, heroes: this.heroes, troops: this.troops };
    if (t.player) args.playerId = t.player.id; else args.siteId = t.site.id;
    try {
      const r = await this.app.act('march', args);
      this.app.ui.closeModal();
      this.world.hidePanel?.();
      this.app.sfx('horn');
      this.app.ui.toast(`Отряд выступил · в пути ${fmtTime(r.travel)}`, 'good');
    } catch { /* тост показан */ }
  }

  // --- Список отрядов в пути --------------------------------------------------------
  phaseOf(m) {
    if (m.phase === 'go') return { icon: m.kind === 'gather' ? 'i_gather' : 'i_attack', text: 'В пути', end: m.arrive, start: m.start };
    if (m.phase === 'work') return { icon: 'i_gather', text: 'Сбор', end: m.workEnd, start: m.arrive };
    return { icon: 'i_return', text: m.result ? (m.result.win ? 'Победа · домой' : m.result.note ? 'Возврат' : 'Поражение · домой') : 'Возврат', end: m.backAt, start: m.backStart || m.backAt - m.travel * 1000 };
  }

  tick() {
    const me = this.me;
    if (!me) return;
    const mode = this.app.mode;
    const show = (mode === 'village' || this.world.open) && (me.marches || []).length;
    this.list.classList.toggle('show', !!show);
    this.list.classList.toggle('on-world', !!this.world.open);
    if (!show) return;
    const now = this.serverNow();
    let due = false;
    const key = me.marches.map((m) => m.id + m.phase).join('|');
    if (this.listKey !== key) {
      this.listKey = key;
      this.list.innerHTML = `<div class="mq-h">Походы ${me.marches.length}/${me.marchSlots}</div>` + me.marches.map((m) => `<button class="mq" data-id="${m.id}"><img src="${WI(this.phaseOf(m).icon)}" alt=""><div><b>${esc(this.phaseOf(m).text)}</b><span class="mq-t"></span><i><u></u></i></div></button>`).join('');
      this.list.querySelectorAll('.mq').forEach((b) => { b.onclick = () => { const m = this.me.marches.find((v) => v.id === b.dataset.id); if (m) this.openMarch(m); }; });
    }
    for (const m of me.marches) {
      const ph = this.phaseOf(m), el = this.list.querySelector(`.mq[data-id="${m.id}"]`);
      if (!el) continue;
      const left = (ph.end - now) / 1000;
      if (left <= 0) due = true;
      el.querySelector('.mq-t').textContent = left > 0 ? fmtTime(left) : '…';
      el.querySelector('u').style.width = Math.min(100, Math.max(0, (now - ph.start) / Math.max(1, ph.end - ph.start) * 100)) + '%';
    }
    if (due && !this.app.busy && !this.loading) {
      this.loading = true;
      this.app.refresh().catch(() => {}).finally(() => { setTimeout(() => { this.loading = false; }, 1500); });
    }
  }

  // --- Окно похода --------------------------------------------------------------------
  openMarch(m) {
    const me = this.me, ph = this.phaseOf(m);
    const left = Math.max(0, (ph.end - this.serverNow()) / 1000);
    const gems = Math.max(1, Math.ceil(gemsForTime(left) / 2));
    const troops = Object.entries(m.troops).map(([k, n]) => { const { kind, tier } = parseKey(k); return `<span class="ms-chip"><img src="${A}troops/tier${tier}.png" alt="">${troopName(me.race, kind, tier)} ×${fmt(n)}</span>`; }).join('');
    const heroes = m.heroes.map((id) => `<img class="ms-hp r-${HERO[id].rarity}" src="${A}heroes/${id}_p.png" alt="">`).join('');
    const loot = m.loot ? Object.entries(m.loot).filter(([k, v]) => v && k !== 'book').map(([k, v]) => `<span class="ms-chip"><img src="${resIcon(k)}" alt="">${short(v)}</span>`).join('') : '';
    const btns = [];
    if (m.result?.hasBattle) btns.push({ label: `<img class="ic" src="${WI('i_report')}" alt=""> Бой`, cls: 'steel', onClick: () => this.watch(m.id) });
    if (m.phase !== 'back') btns.push({ label: `<img class="ic" src="${WI('i_recall')}" alt=""> Отозвать`, cls: 'steel', onClick: () => this.act('recall', { id: m.id }) });
    if (left > 0) btns.push({ label: `<img class="ic" src="${A}kit/gems.png" alt=""> ${gems} Ускорить`, cls: 'gem', onClick: () => this.app.ui.confirmGems(gems, () => this.act('speedupMarch', { id: m.id })) });
    btns.push({ label: 'К отряду', onClick: () => { this.app.ui.closeModal(); if (!this.world.open) this.app.openWorld(); const p = this.world.marchPos(m); this.world.flyTo(Math.round(p.x), Math.round(p.y)); } });
    this.app.ui.modal(esc(m.targetName), `
      <div class="bw-box"><div class="ms-row"><span><img class="ic" src="${WI(ph.icon)}" alt="">${esc(ph.text)}</span><b>${left > 0 ? fmtTime(left) : 'сейчас'}</b></div>
        ${m.result?.note ? `<p class="muted">${esc(m.result.note)}</p>` : ''}</div>
      ${heroes ? `<div class="ms-sub">Герои</div><div class="ms-hrow">${heroes}</div>` : ''}
      <div class="ms-sub">Войска</div><div class="ms-chips">${troops}</div>
      ${loot ? `<div class="ms-sub">Несут домой</div><div class="ms-chips">${loot}</div>` : ''}`, btns, 'bw');
  }

  async act(type, args) {
    try { await this.app.act(type, args); this.app.ui.closeModal(); this.listKey = null; } catch { /* тост показан */ }
  }

  async watch(id) {
    try {
      const b = await api.battle(id);
      this.app.ui.closeModal();
      const rw = b.reward || {};
      const rewardHtml = Object.entries(rw).filter(([k, v]) => v && k !== 'book').map(([k, v]) => `<span><img src="${resIcon(k)}" alt="">${short(v)}</span>`).join('') + (rw.book ? `<span><img src="${A}kit/book.png" alt="">×${rw.book}</span>` : '');
      this.app.heroes.battle.play({ battle: b.battle, reward: b.win ? (b.reward || {}) : null, stage: 1, title: b.title, rewardHtml }, () => {});
    } catch (e) { this.app.ui.toast(e.message || 'Запись боя не найдена'); }
  }
}
