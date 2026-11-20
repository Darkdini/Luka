// Экраны героев: коллекция, карточка героя, отряд 2+3, таверна (найм), поход
// (кампания с пассивным доходом) и просмотр автобоя.
import {
  HERO, HERO_DEFS, RARITY, RARITY_ORDER, ROLES, TROOP_TYPES, heroStats, heroPower, heroSkills,
  raceSynergy, maxHeroLevel, expToNext, SUMMON, stageName, stageEnemies, stageReward, CHAPTER_NAMES,
  STAGES_PER_CHAPTER, skillCost, SKILL_MAX, AWAKEN_STARS, defaultSkills,
} from '/shared/heroes.js';
import { RACES, fmt, fmtTime } from '/shared/config.js';

const $ = (s, r = document) => r.querySelector(s);
const A = '/assets/realm/';
const P = (id) => `${A}heroes/${id}_p.png`;
const F = (id) => `${A}heroes/${id}.png`;
const ICON = (n) => `${A}icons/${n}.png`;
const ROLE_ICON = { tank: 'infantry', dmg: 'dmg', aoe: 'aoe', heal: 'heal', support: 'support' };
const TROOP_ICON = { infantry: 'infantry', archer: 'archer', cavalry: 'cavalry' };
const RACE_ORDER = ['humans', 'elves', 'dwarves', 'orcs'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stars = (n) => `<span class="h-stars">${'★'.repeat(n)}<i>${'★'.repeat(5 - n)}</i></span>`;

export class Heroes {
  constructor(app) {
    this.app = app;
    this.root = document.createElement('div');
    this.root.id = 'heroes';
    this.root.innerHTML = `
      <div class="hs-top"><button class="hs-back" aria-label="Назад">‹</button><b class="hs-title">Герои</b>
        <div class="hs-res"><span><img src="${ICON('book')}" alt=""><b data-i="book"></b></span><span><img src="${ICON('ticket')}" alt=""><b data-i="ticket"></b></span><span>💎<b data-i="gems"></b></span></div></div>
      <div class="hs-body"></div>
      <nav class="hs-tabs">
        <button data-t="list"><img src="${ICON('infantry')}" alt=""><span>Герои</span></button>
        <button data-t="team"><img src="${ICON('support')}" alt=""><span>Отряд</span></button>
        <button data-t="tavern"><img src="${ICON('ticket')}" alt=""><span>Таверна</span></button>
        <button data-t="campaign"><img src="${ICON('star')}" alt=""><span>Поход</span></button>
      </nav>`;
    document.body.appendChild(this.root);
    this.root.querySelector('.hs-back').onclick = () => (this.detail ? this.show(this.tab) : this.close());
    this.root.querySelectorAll('.hs-tabs button').forEach((b) => { b.onclick = () => this.show(b.dataset.t); });
    this.filter = 'all';
    this.battle = new HeroBattle(app);
  }

  get me() { return this.app.me; }
  open(tab = 'list') { this.root.classList.add('show'); this.show(tab); this.app.sfx('click'); }
  close() { this.root.classList.remove('show'); this.detail = null; }
  refresh() { if (this.root.classList.contains('show')) (this.detail ? this.openHero(this.detail) : this.show(this.tab)); this.badges(); }

  async act(type, args) {
    try { return await this.app.act(type, args); } catch { return null; }
  }

  header(title) {
    this.root.querySelector('.hs-title').textContent = title;
    const it = this.me.items || {};
    this.root.querySelector('[data-i=book]').textContent = fmt(it.book || 0);
    this.root.querySelector('[data-i=ticket]').textContent = fmt(it.ticket || 0);
    this.root.querySelector('[data-i=gems]').textContent = fmt(this.me.res.gems);
  }

  // Красные точки: можно собрать героя / бесплатный найм / накопился доход похода
  badges() {
    const me = this.me;
    if (!me?.roster) return;
    const canAssemble = HERO_DEFS.some((h) => !me.roster[h.id] && (me.frags[h.id] || 0) >= RARITY[h.rarity].frags);
    const canStar = Object.entries(me.roster).some(([id, h]) => h.stars < 5 && (me.frags[id] || 0) >= RARITY[HERO[id].rarity].starFrags[h.stars] && (h.stars < 2 || me.items.statue >= h.stars - 1));
    const free = me.summon?.free > 0;
    const idle = (me.campaign?.idle?.hours || 0) >= 1;
    setDot(document.querySelector('#btn-heroes'), canAssemble || canStar || free);
    setDot(document.querySelector('#btn-campaign'), idle);
    const tabs = this.root.querySelectorAll('.hs-tabs button');
    setDot(tabs[0], canAssemble || canStar);
    setDot(tabs[2], free);
    setDot(tabs[3], idle);
  }

  show(tab) {
    this.tab = tab;
    this.detail = null;
    this.root.querySelectorAll('.hs-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    this.root.dataset.tab = tab;
    ({ list: () => this.renderList(), team: () => this.renderTeam(), tavern: () => this.renderTavern(), campaign: () => this.renderCampaign() })[tab]();
    this.badges();
  }

  // --- Коллекция ---------------------------------------------------------------
  renderList() {
    this.header('Герои');
    const me = this.me;
    const owned = HERO_DEFS.filter((h) => me.roster[h.id]);
    const sortKey = (h) => -heroPower(h.id, me.roster[h.id].level, me.roster[h.id].stars);
    owned.sort((a, b) => sortKey(a) - sortKey(b));
    const locked = HERO_DEFS.filter((h) => !me.roster[h.id])
      .sort((a, b) => ((me.frags[b.id] || 0) / RARITY[b.rarity].frags) - ((me.frags[a.id] || 0) / RARITY[a.rarity].frags) || RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));
    const pass = (h) => this.filter === 'all' || h.race === this.filter;
    const card = (h, own) => {
      const st = me.roster[h.id];
      const fr = me.frags[h.id] || 0, need = RARITY[h.rarity].frags;
      const ready = !own && fr >= need;
      const up = own && st.stars < 5 && fr >= RARITY[h.rarity].starFrags[st.stars];
      return `<button class="h-card r-${h.rarity} ${own ? '' : 'locked'} ${ready ? 'ready' : ''}" data-h="${h.id}">
        <img class="h-face" src="${P(h.id)}" alt="" loading="lazy">
        <img class="h-crest" src="${A}races/crest_${h.race}.png" alt="">
        ${own ? `<span class="h-lv">Ур. ${st.level}</span>${stars(st.stars)}${up ? '<span class="h-up">⬆</span>' : ''}` : `<span class="h-frag"><i style="width:${Math.min(100, fr / need * 100)}%"></i><b>${fr}/${need}</b></span>`}
        <span class="h-name"><img src="${ICON(ROLE_ICON[h.role])}" alt="">${esc(h.name)}</span>
        ${ready ? '<span class="h-ready">Собрать!</span>' : ''}
      </button>`;
    };
    const chips = ['all', ...RACE_ORDER].map((r) => `<button class="hf ${this.filter === r ? 'on' : ''}" data-f="${r}">${r === 'all' ? 'Все' : `<img src="${A}races/crest_${r}.png" alt="">`}</button>`).join('');
    const body = this.root.querySelector('.hs-body');
    body.innerHTML = `<div class="hf-row">${chips}</div>
      <div class="h-grid">${owned.filter(pass).map((h) => card(h, true)).join('')}</div>
      <div class="h-sep">Не наняты</div>
      <div class="h-grid">${locked.filter(pass).map((h) => card(h, false)).join('')}</div>`;
    body.querySelectorAll('.hf').forEach((b) => { b.onclick = () => { this.filter = b.dataset.f; this.renderList(); }; });
    body.querySelectorAll('.h-card').forEach((b) => { b.onclick = () => this.openHero(b.dataset.h); });
  }

  // --- Карточка героя: экран во весь рост, вкладки, навыки ------------------------
  heroList() {
    const me = this.me;
    return HERO_DEFS.filter((h) => (this.filter === 'all' || h.race === this.filter))
      .sort((a, b) => (me.roster[b.id] ? 1 : 0) - (me.roster[a.id] ? 1 : 0)
        || (me.roster[a.id] && me.roster[b.id] ? heroPower(b.id, me.roster[b.id].level, me.roster[b.id].stars) - heroPower(a.id, me.roster[a.id].level, me.roster[a.id].stars) : 0))
      .map((h) => h.id);
  }

  openHero(id, tab) {
    this.detail = id;
    this.heroTab = tab || this.heroTab || 'params';
    const me = this.me, d = HERO[id], st = me.roster[id];
    const own = !!st;
    const lvl = st?.level || 1, sts = st?.stars || 0, sk = st?.skills || defaultSkills();
    const s = heroStats(id, lvl, sts, sk);
    const fr = me.frags[id] || 0;
    const rr = RARITY[d.rarity];
    const cap = maxHeroLevel(me.buildings.find((b) => b.type === 'castle')?.level || 1);
    const inTeam = (me.formation || []).includes(id);
    const skills = heroSkills(id, sk);
    const skIcon = (k) => ICON(k.kind === 'ult' ? 'rune' : k.kind === 'passive' ? 'star' : k.kind === 'awaken' ? 'upgrade' : ROLE_ICON[d.role]);
    this.header(d.name);
    this.root.dataset.tab = 'hero';
    const body = this.root.querySelector('.hs-body');
    const needStar = rr.starFrags[sts];
    const starReady = own && sts < 5 && fr >= needStar && me.items.statue >= (sts >= 2 ? sts - 1 : 0);
    const tabParams = own ? `
        <div class="hp-lvl"><div class="hp-big">${lvl}<small>/${cap}</small></div>
          <div class="hp-exp"><span>Опыт до следующего уровня <b><img src="${ICON('book')}" alt="">${fmt(me.items.book)}</b></span>
            <div class="hd-bar"><i style="width:${lvl >= cap ? 100 : Math.min(100, st.exp / expToNext(lvl) * 100)}%"></i><span>${lvl >= cap ? 'Максимум' : `${fmt(st.exp)} / ${fmt(expToNext(lvl))}`}</span></div></div>
          <div class="hp-btns"><button class="nbtn sm steel" data-a="lv1" ${lvl >= cap ? 'disabled' : ''}>+1</button><button class="nbtn sm" data-a="lvmax" ${lvl >= cap ? 'disabled' : ''}>Улучшить</button></div></div>
        <div class="hp-cols">
          <div class="hp-box"><div class="hd-sub">Параметры героя</div>
            <div class="hp-stat">⚔ <b>${fmt(s.atk)}</b></div><div class="hp-stat">🛡 <b>${fmt(s.def)}</b></div><div class="hp-stat">❤ <b>${fmt(s.hp)}</b></div><div class="hp-stat">➶ <b>${s.spd}</b></div></div>
          <div class="hp-box"><div class="hd-sub">Навыки героя</div>
            <div class="hp-skills">${skills.map((k, i) => `<button class="sk-ic ${k.locked ? 'off' : ''}" data-sk="${i}"><img src="${skIcon(k)}" alt=""><span>Ур. ${k.lvl}</span></button>`).join('')}</div></div>
        </div>
        <p class="hd-lore">${esc(d.lore)}</p>` : `
        <div class="hd-frag big"><img src="${P(id)}" alt=""><div class="hd-bar"><i style="width:${Math.min(100, fr / rr.frags * 100)}%"></i><span>Фрагменты ${fr}/${rr.frags}</span></div>
          <button class="nbtn sm" data-a="assemble" ${fr >= rr.frags ? '' : 'disabled'}>Нанять</button></div>
        <p class="muted small">Фрагменты выпадают в таверне, в походе и в наборах.</p>
        <div class="hp-skills wide">${skills.map((k, i) => `<button class="sk-ic" data-sk="${i}"><img src="${skIcon(k)}" alt=""><span>${esc(k.name)}</span></button>`).join('')}</div>
        <p class="hd-lore">${esc(d.lore)}</p>`;
    const tabSkills = `<div class="hd-sub">О навыках</div><div class="sk-grid">${skills.map((k, i) => `
        <div class="sk-card ${k.locked ? 'off' : ''}"><button class="sk-ic" data-sk="${i}"><img src="${skIcon(k)}" alt=""><span>Ур. ${k.lvl}</span></button>
          <b>${esc(k.name)}</b>
          ${!own || k.locked ? `<em class="bad">${k.locked ? `${AWAKEN_STARS}★` : 'Не нанят'}</em>` : k.lvl >= SKILL_MAX ? '<em>Максимум</em>' : `<button class="nbtn xs steel" data-sk="${i}">Улучшить</button>`}</div>`).join('')}</div>`;
    const tabGear = '<div class="gear-lock"><img src="' + ICON('rune') + '" alt=""><b>Снаряжение</b><p class="muted">Оружие, доспехи и руны героя откроются с Кузницей (Цитадель 5).</p></div>';
    body.innerHTML = `
      <div class="hv r-${d.rarity}" style="--rc:${rr.color}">
        <div class="hv-stage" style="background-image:url(${A}races/bg_${d.race}.jpg)">
          <img class="hv-full" src="${F(id)}" alt="">
          <div class="hv-power"><img src="${ICON('dmg')}" alt="">${fmt(heroPower(id, lvl, sts, sk))}</div>
          <div class="hv-tags">${inTeam ? '<div class="hv-team">◆ В отряде</div>' : ''}
            <span><img src="${ICON(ROLE_ICON[d.role])}" alt="">${ROLES[d.role].name}</span>
            <span><img src="${ICON(TROOP_ICON[d.troop])}" alt="">${TROOP_TYPES[d.troop]}</span>
            <span><img src="${A}races/crest_${d.race}.png" alt="">${RACES[d.race].name}</span></div>
          <button class="hv-nav prev" aria-label="Предыдущий">‹</button><button class="hv-nav next" aria-label="Следующий">›</button>
          <div class="hv-name"><div><img src="${A}races/crest_${d.race}.png" alt=""><b>${esc(d.name)}</b></div>
            <span><span class="hd-rar">${rr.short}</span> ${esc(d.title)}</span>
            ${own ? `<div class="hv-stars">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < sts ? 'on' : ''}">★</i>`).join('')}<button class="hv-up ${starReady ? 'ready' : ''}" data-a="starview" ${sts >= 5 ? 'disabled' : ''}>⬆</button></div>` : ''}</div>
        </div>
        <nav class="hv-tabs"><button data-ht="params" class="${this.heroTab === 'params' ? 'on' : ''}">Параметры</button><button data-ht="skills" class="${this.heroTab === 'skills' ? 'on' : ''}">Навыки</button><button data-ht="gear" class="${this.heroTab === 'gear' ? 'on' : ''}">Снаряжение 🔒</button></nav>
        <div class="hv-panel">${this.heroTab === 'skills' ? tabSkills : this.heroTab === 'gear' ? tabGear : tabParams}</div>
      </div>`;
    body.querySelectorAll('[data-ht]').forEach((b) => { b.onclick = () => this.openHero(id, b.dataset.ht); });
    body.querySelectorAll('[data-sk]').forEach((b) => { b.onclick = () => this.skillModal(id, +b.dataset.sk); });
    const list = this.heroList(), at = list.indexOf(id);
    body.querySelector('.hv-nav.prev').onclick = () => this.openHero(list[(at - 1 + list.length) % list.length]);
    body.querySelector('.hv-nav.next').onclick = () => this.openHero(list[(at + 1) % list.length]);
    let sx = null;
    const stage = body.querySelector('.hv-stage');
    stage.ontouchstart = (e) => { sx = e.touches[0].clientX; };
    stage.ontouchend = (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 60) this.openHero(list[(at + (dx < 0 ? 1 : -1) + list.length) % list.length]); };
    const on = (a, fn) => { const b = body.querySelector(`[data-a=${a}]`); if (b) b.onclick = fn; };
    on('lv1', async () => { const r = await this.act('heroLevelUp', { id }); if (r) { this.app.sfx('levelup'); this.openHero(id); } });
    on('lvmax', async () => { const r = await this.act('heroLevelUp', { id, max: true }); if (r) { this.app.sfx('levelup'); this.app.ui.toast(`${d.name}: уровень ${r.level}`, 'good'); this.openHero(id); } });
    on('starview', () => this.starModal(id));
    on('assemble', async () => { const r = await this.act('heroAssemble', { id }); if (r) { this.newHero(id); this.openHero(id); } });
  }

  // Окно навыка: теги, описание, «эффект следующего уровня», фрагменты, «Улучшить»
  skillModal(id, i) {
    const me = this.me, d = HERO[id], st = me.roster[id];
    const k = heroSkills(id, st?.skills || defaultSkills())[i];
    const fr = me.frags[id] || 0, need = skillCost(k.lvl);
    const can = st && !k.locked && k.lvl < SKILL_MAX;
    const tagCls = (t) => (/Урон|AoE|Убийца|Одиночная/.test(t) ? 'red' : /Лечение|Поддержка|Отряд|Бафф/.test(t) ? 'green' : /Защита|Контроль/.test(t) ? 'blue' : 'gold');
    const box = this.app.ui.modal(esc(k.name), `
      <div class="skm"><img class="skm-ic" src="${ICON(k.kind === 'ult' ? 'rune' : k.kind === 'passive' ? 'star' : k.kind === 'awaken' ? 'upgrade' : ROLE_ICON[d.role])}" alt="">
        <div><b>${esc(k.name)} · Уровень ${k.lvl}/${SKILL_MAX}</b><div class="skm-tags">${k.tags.map((t, j) => `<span class="${j === 0 ? 'gold' : tagCls(t)}">${esc(t)}</span>`).join('')}</div></div></div>
      <p class="skm-desc">${esc(k.desc)}</p>
      ${can ? `<div class="skm-next"><div class="hd-sub">Эффект следующего уровня</div>${k.next.map(([n, a, b]) => `<div class="skm-row"><span>${n}</span><b>${a}</b><i>➜</i><em>${b}</em></div>`).join('')}</div>
        <div class="skm-cost"><img src="${P(id)}" alt=""><b class="${fr >= need ? 'ok' : 'bad'}">${fr}/${need}</b><span class="muted">фрагментов героя</span></div>` : `<p class="muted">${k.locked ? `Откроется, когда герой получит ${AWAKEN_STARS} звезды.` : !st ? 'Сначала наймите героя.' : 'Навык улучшен до максимума.'}</p>`}`,
    can ? [{ label: 'Улучшить', cls: 'green', disabled: fr < need, onClick: async () => { const r = await this.act('skillUp', { id, i }); if (r) { this.app.sfx('levelup'); this.app.ui.closeModal(); this.openHero(id, 'skills'); } } }] : []);
    void box;
  }

  // «Обзор повышения разряда»: было → станет
  starModal(id) {
    const me = this.me, d = HERO[id], st = me.roster[id], rr = RARITY[d.rarity];
    const cur = heroStats(id, st.level, st.stars, st.skills), nx = heroStats(id, st.level, st.stars + 1, st.skills);
    const pw = heroPower(id, st.level, st.stars, st.skills), pw2 = heroPower(id, st.level, st.stars + 1, st.skills);
    const need = rr.starFrags[st.stars], statues = st.stars >= 2 ? st.stars - 1 : 0, fr = me.frags[id] || 0;
    const row = (n, a, b) => `<div class="skm-row"><span>${n}</span><b>${fmt(a)}</b><i>➜</i><em>${fmt(b)}</em></div>`;
    const ok = fr >= need && me.items.statue >= statues;
    this.app.ui.modal('Обзор повышения разряда', `
      <div class="skm-next"><div class="skm-row"><span>Разряд</span><span class="hv-stars">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < st.stars + 1 ? 'on' : ''}">★</i>`).join('')}</span></div>
        ${row('Сила', pw, pw2)}${row('Атака', cur.atk, nx.atk)}${row('Здоровье', cur.hp, nx.hp)}${row('Защита', cur.def, nx.def)}${row('Скорость', cur.spd, nx.spd)}</div>
      ${st.stars + 1 === AWAKEN_STARS ? `<div class="skm"><img class="skm-ic" src="${ICON('upgrade')}" alt=""><div><b><span class="new">NEW</span> Пробуждение · Уровень 1/${SKILL_MAX}</b><div class="skm-tags"><span class="gold">Открывается</span></div></div></div>` : ''}
      <div class="skm-cost"><img src="${P(id)}" alt=""><b class="${fr >= need ? 'ok' : 'bad'}">${fr}/${need}</b><span class="muted">фрагментов</span>
        ${statues ? `<img src="${ICON('statue')}" alt=""><b class="${me.items.statue >= statues ? 'ok' : 'bad'}">${me.items.statue}/${statues}</b><span class="muted">статуй</span>` : ''}</div>`,
    [{ label: 'Повысить разряд', cls: 'green', disabled: !ok, onClick: async () => { const r = await this.act('heroStarUp', { id }); if (r) { this.app.ui.closeModal(); this.app.sfx('win'); this.app.ui.toast(`${d.name}: ${'★'.repeat(r.stars)}`, 'good'); this.openHero(id); } } }]);
  }

  // Экран «Новый герой»
  newHero(id) {
    const d = HERO[id], rr = RARITY[d.rarity];
    const el = document.createElement('div');
    el.className = 'new-hero';
    el.style.setProperty('--rc', rr.color);
    el.innerHTML = `<div class="nh-title">НОВЫЙ ГЕРОЙ</div><img src="${F(id)}" alt="">
      <div class="nh-info"><span class="hd-rar">${rr.short}</span> <i>${esc(d.title)}</i><b>${esc(d.name)}</b>
      <div class="hd-tags"><span><img src="${ICON(ROLE_ICON[d.role])}" alt="">${ROLES[d.role].name}</span><span><img src="${ICON(TROOP_ICON[d.troop])}" alt="">${TROOP_TYPES[d.troop]}</span></div>
      <p>${esc(d.lore)}</p><div class="muted">Нажмите, чтобы продолжить</div></div>`;
    el.onclick = () => el.remove();
    document.body.appendChild(el);
    this.app.sfx('win');
  }

  // --- Отряд 2+3 ---------------------------------------------------------------------
  renderTeam() {
    this.header('Отряд');
    const me = this.me;
    const f = me.formation || [null, null, null, null, null];
    const syn = raceSynergy(f);
    const slot = (i) => {
      const id = f[i];
      if (!id) return `<button class="fs empty" data-s="${i}"><span>+</span></button>`;
      const d = HERO[id], st = me.roster[id];
      return `<button class="fs r-${d.rarity} ${this.pickSlot === i ? 'sel' : ''}" data-s="${i}"><img src="${P(id)}" alt=""><span class="h-lv">Ур. ${st.level}</span><img class="h-crest" src="${A}races/crest_${d.race}.png" alt=""><span class="fs-name">${esc(d.name)}</span></button>`;
    };
    const power = f.reduce((t, id) => t + (id ? heroPower(id, me.roster[id].level, me.roster[id].stars) : 0), 0);
    const pool = HERO_DEFS.filter((h) => me.roster[h.id] && !f.includes(h.id))
      .sort((a, b) => heroPower(b.id, me.roster[b.id].level, me.roster[b.id].stars) - heroPower(a.id, me.roster[a.id].level, me.roster[a.id].stars));
    const body = this.root.querySelector('.hs-body');
    const synRing = [0, 1, 2, 3, 4].map((i) => `<i class="${i < syn.count ? 'on' : ''}" ${syn.race ? `style="--c:${RACES[syn.race].color}"` : ''}></i>`).join('');
    body.innerHTML = `
      <div class="team-head"><div class="tp"><img src="${ICON('dmg')}" alt="">Сила отряда <b>${fmt(power)}</b></div>
        <div class="syn" title="Бонус за героев одной расы">${synRing}<span>${syn.bonus ? `${RACES[syn.race].name}: +${Math.round(syn.bonus * 100)}%` : 'Нет бонуса расы'}</span></div></div>
      <div class="team-board" style="background-image:url(${A}arenas/1.jpg)">
        <div class="row-l">⚔ Передний ряд — к врагу</div><div class="row front">${slot(0)}${slot(1)}</div>
        <div class="row-l">Задний ряд</div><div class="row back">${slot(2)}${slot(3)}${slot(4)}</div>
      </div>
      <p class="muted small center">${this.pickSlot != null ? 'Выберите героя для этого места или нажмите на него ещё раз, чтобы убрать.' : 'Нажмите на место, чтобы поставить героя. Танков — вперёд, стрелков и лекарей — назад. 3+ героя одной расы дают бонус.'}</p>
      <div class="h-grid small">${pool.map((h) => `<button class="h-card r-${h.rarity}" data-h="${h.id}"><img class="h-face" src="${P(h.id)}" alt=""><img class="h-crest" src="${A}races/crest_${h.race}.png" alt=""><span class="h-lv">Ур. ${me.roster[h.id].level}</span><span class="h-name"><img src="${ICON(ROLE_ICON[h.role])}" alt="">${esc(h.name)}</span></button>`).join('')}</div>`;
    body.querySelectorAll('.fs').forEach((b) => {
      b.onclick = async () => {
        const i = +b.dataset.s;
        if (this.pickSlot === i && f[i]) { // повторное нажатие — убрать
          const nf = [...f]; nf[i] = null;
          this.pickSlot = null;
          if (nf.some(Boolean)) await this.act('setFormation', { slots: nf });
          this.renderTeam();
          return;
        }
        this.pickSlot = i;
        this.renderTeam();
      };
    });
    body.querySelectorAll('.h-grid .h-card').forEach((b) => {
      b.onclick = async () => {
        const nf = [...f];
        let i = this.pickSlot;
        if (i == null) { i = nf.findIndex((x) => !x); if (i < 0) { this.app.ui.toast('Сначала выберите место в отряде'); return; } }
        nf[i] = b.dataset.h;
        this.pickSlot = null;
        if (await this.act('setFormation', { slots: nf })) this.app.sfx('build');
        this.renderTeam();
      };
    });
  }

  // --- Таверна (найм) -------------------------------------------------------------------
  renderTavern() {
    this.header('Таверна героев');
    const me = this.me, sm = me.summon;
    const giftPct = Math.min(100, ((sm.total - sm.giftAt) / SUMMON.pityGift) * 100);
    const body = this.root.querySelector('.hs-body');
    body.innerHTML = `
      <div class="tv-gift"><img src="${ICON('ticket')}" alt=""><div class="hd-bar"><i style="width:${giftPct}%"></i><span>${sm.total - sm.giftAt}/${SUMMON.pityGift}</span></div>
        <button class="tv-box ${giftPct >= 100 ? 'ready' : ''}" id="tv-gift">🎁</button></div>
      <div class="tv-cards">
        <div class="tv-card" style="background-image:url(${F('mira')})">
          <div class="tv-in"><b>Обычный найм</b><span>В основном фрагменты обычных и редких героев, книги опыта</span>
          <div class="tv-meta">Бесплатно сегодня: <b>${sm.free}/${SUMMON.normal.freePerDay}</b> · Билеты: <b>${me.items.ticket}</b></div>
          <div class="hd-btns"><button class="nbtn steel" data-k="normal" data-n="1">${sm.free > 0 ? 'Бесплатно' : `×1 <img src="${ICON('ticket')}" alt=""> 1`}</button><button class="nbtn" data-k="normal" data-n="10">×10 <img src="${ICON('ticket')}" alt=""> ${Math.max(0, 10 - sm.free)}</button></div></div>
        </div>
        <div class="tv-card adv" style="background-image:url(${F('aerith')})">
          <div class="tv-in"><b>Продвинутый найм</b><span>Шанс эпических и легендарных героев. <em>Каждые 10 наймов — гарантия эпика!</em></span>
          <div class="tv-meta">До гарантии: <b>${Math.max(0, SUMMON.advanced.pity - sm.pity)}</b></div>
          <div class="hd-btns"><button class="nbtn steel" data-k="advanced" data-n="1">×1 💎 ${SUMMON.advanced.gems}</button><button class="nbtn" data-k="advanced" data-n="10">×10 💎 ${fmt(SUMMON.advanced.gems10)}</button></div></div>
        </div>
      </div>`;
    body.querySelectorAll('[data-k]').forEach((b) => {
      b.onclick = async () => {
        const r = await this.act('summon', { kind: b.dataset.k, count: +b.dataset.n });
        if (r) this.reveal(r.results);
      };
    });
    $('#tv-gift', body).onclick = async () => { const r = await this.act('summonGift'); if (r) this.reveal(r.results); };
  }

  // Карты лежат рубашкой вверх и переворачиваются по одной
  reveal(results) {
    const el = document.createElement('div');
    el.className = 'reveal';
    const face = (it) => {
      if (it.type === 'frag' || it.type === 'hero') {
        const d = HERO[it.hero];
        return `<div class="rv-face r-${d.rarity}"><img src="${P(it.hero)}" alt="">${it.type === 'hero' ? '<em>ГЕРОЙ!</em>' : `<b>×${it.n}</b><img class="rv-ic" src="${ICON('frag')}" alt="">`}<span>${esc(d.name)}</span></div>`;
      }
      const map = { book: ['book', 'Книга опыта'], statue: ['statue', 'Звёздная статуя'], ticket: ['ticket', 'Билет найма'], gold: ['star', 'Золото'], gems: ['upgrade', 'Самоцветы'] };
      const [ic, name] = map[it.type] || ['star', it.type];
      return `<div class="rv-face r-common"><img class="rv-item" src="${ICON(ic)}" alt=""><b>×${fmt(it.n)}</b><span>${name}</span></div>`;
    };
    el.innerHTML = `<div class="rv-grid n${results.length}">${results.map((it) => `<div class="rv-card"><div class="rv-back"></div>${face(it)}</div>`).join('')}</div>
      <div class="hd-btns"><button class="nbtn steel" id="rv-flip">Открыть все</button><button class="nbtn" id="rv-ok" hidden>Готово</button></div>`;
    document.body.appendChild(el);
    const cards = [...el.querySelectorAll('.rv-card')];
    let i = 0;
    const flipNext = () => {
      if (i >= cards.length) { $('#rv-flip', el).hidden = true; $('#rv-ok', el).hidden = false; return; }
      const c = cards[i++];
      c.classList.add('open');
      const rare = c.querySelector('.r-epic, .r-legendary, em');
      this.app.sfx(rare ? 'star' : 'click');
      if (rare) c.classList.add('shine');
    };
    cards.forEach((c, k) => { c.onclick = () => { if (!c.classList.contains('open')) { cards.slice(i, k + 1).forEach(() => flipNext()); } }; });
    $('#rv-flip', el).onclick = () => { const t = setInterval(() => { if (i >= cards.length) { clearInterval(t); flipNext(); return; } flipNext(); }, 140); };
    $('#rv-ok', el).onclick = () => {
      el.remove();
      const newHero = results.find((it) => it.type === 'hero' && !it.dup);
      if (newHero) this.newHero(newHero.hero);
      this.refresh();
    };
    setTimeout(flipNext, 400);
  }

  // --- Поход (кампания) -------------------------------------------------------------------
  renderCampaign() {
    this.header('Поход');
    const me = this.me, c = me.campaign;
    const n = c.stage;
    const ch = Math.floor((n - 1) / STAGES_PER_CHAPTER);
    const en = stageEnemies(n);
    const rw = stageReward(n);
    const enemyPower = en.reduce((t, u) => t + (u ? heroPower(u.id, u.level, u.stars) : 0), 0);
    const nodes = Array.from({ length: STAGES_PER_CHAPTER }, (_, i) => {
      const k = ch * STAGES_PER_CHAPTER + i + 1;
      return `<i class="${k < n ? 'done' : k === n ? 'cur' : ''} ${(k % 5 === 0) ? 'boss' : ''}">${k === n ? `<img src="${P(me.formation.find(Boolean) || 'rowan')}" alt="">` : ''}</i>`;
    }).join('');
    const idle = c.idle;
    const body = this.root.querySelector('.hs-body');
    body.innerHTML = `
      <div class="cp-map" style="background-image:url(${A}arenas/${1 + (ch % 8)}.jpg)">
        <div class="cp-ch">Глава ${ch + 1}<b>${CHAPTER_NAMES[ch % CHAPTER_NAMES.length]}</b><span>Этап ${stageName(n)}</span></div>
        <div class="cp-path">${nodes}</div>
      </div>
      <div class="cp-card">
        <div class="cp-row"><b>Враг · этап ${stageName(n)}${n % 5 === 0 ? ' · БОСС' : ''}</b><span>Сила ${fmt(enemyPower)} <em class="${me.teamPower >= enemyPower ? 'ok' : 'bad'}">ваша ${fmt(me.teamPower)}</em></span></div>
        <div class="cp-enemies">${en.filter(Boolean).map((u) => `<div class="cp-e r-${HERO[u.id].rarity}"><img src="${P(u.id)}" alt=""><span>Ур. ${u.level}</span></div>`).join('')}</div>
        <div class="cp-row"><b>Награда</b><span class="cp-rw"><img src="${ICON('book')}" alt="">×${rw.books} · 💎 ${rw.gems} · 🪙 ${fmt(rw.gold)}${rw.fragment ? ` · <img src="${ICON('frag')}" alt="">эпик` : ''}</span></div>
        <button class="nbtn big" id="cp-fight">⚔ В бой</button>
      </div>
      <div class="cp-idle">
        <div><b>Добыча похода</b><span class="muted">${fmt(idle.rate.exp)} опыта и ${fmt(idle.rate.gold)} золота в час · до 12 ч</span>
          <div class="cp-acc"><img src="${ICON('book')}" alt="">${fmt(idle.exp)} опыта · 🪙 ${fmt(idle.gold)} <span class="muted">(${fmtTime(idle.hours * 3600)})</span></div></div>
        <button class="nbtn sm" id="cp-idle" ${idle.exp + idle.gold > 0 ? '' : 'disabled'}>Забрать</button>
      </div>`;
    $('#cp-fight', body).onclick = async () => {
      const r = await this.act('campaignFight');
      if (r) this.battle.play(r, () => this.refresh());
    };
    $('#cp-idle', body).onclick = async () => {
      const r = await this.act('campaignIdle');
      if (r) { this.app.engage?.rewardFx({ gold: r.got.gold }); this.app.ui.toast(`Книги опыта: +${r.got.books}`, 'good'); this.refresh(); }
    };
  }
}

// ============================================================================
//  Просмотр автобоя: проигрывает журнал событий с сервера
// ============================================================================
class HeroBattle {
  constructor(app) {
    this.app = app;
    this.el = document.createElement('div');
    this.el.id = 'hbattle';
    document.body.appendChild(this.el);
  }

  pos(side, slot) {
    // наш отряд снизу, враг сверху; передний ряд ближе к центру
    const xs = { 0: 33, 1: 67, 2: 18, 3: 50, 4: 82 };
    const y = side === 'a' ? (slot < 2 ? 60 : 80) : (slot < 2 ? 36 : 18);
    return { x: xs[slot], y };
  }

  play(res, done) {
    const { battle } = res;
    const arena = 1 + ((res.stage - 1) % 8);
    this.speed = 1;
    this.skip = false;
    this.el.innerHTML = `<div class="hb-arena" style="background-image:url(${A}arenas/${arena}.jpg)"></div>
      <div class="hb-top"><b>Этап ${stageName(res.stage)}</b><span class="hb-round">Раунд 1</span>
        <button class="hb-speed">×1</button><button class="hb-skip">⏭</button></div>
      <div class="hb-field"></div><div class="hb-cards"></div><div class="hb-ult"></div>`;
    this.el.classList.add('show');
    const field = this.el.querySelector('.hb-field');
    this.units = {};
    for (const u of battle.units) {
      const p = this.pos(u.side, u.slot);
      const d = document.createElement('div');
      d.className = `hb-u ${u.side} r-${HERO[u.id].rarity}`;
      d.style.left = p.x + '%'; d.style.top = p.y + '%'; d.style.zIndex = Math.round(p.y);
      d.innerHTML = `<img src="${F(u.id)}" alt=""><div class="hb-hp"><i></i></div><div class="hb-en"><i></i></div>`;
      field.appendChild(d);
      this.units[u.uid] = { el: d, hp: u.maxHp, max: u.maxHp, side: u.side, id: u.id };
    }
    const cards = this.el.querySelector('.hb-cards');
    cards.innerHTML = battle.units.filter((u) => u.side === 'a').map((u) => `<div class="hb-c r-${HERO[u.id].rarity}" data-u="${u.uid}"><img src="${P(u.id)}" alt=""><div class="hb-hp"><i></i></div><div class="hb-en"><i></i></div></div>`).join('');
    this.el.querySelector('.hb-speed').onclick = (e) => { this.speed = this.speed === 1 ? 2 : 1; e.target.textContent = '×' + this.speed; };
    this.el.querySelector('.hb-skip').onclick = () => { this.skip = true; };
    this.app.sfx('horn');
    this.run(battle.log).then(() => this.finish(res, done));
  }

  wait(ms) { return this.skip ? Promise.resolve() : new Promise((r) => setTimeout(r, ms / this.speed)); }

  setBars(uid, energy) {
    const u = this.units[uid];
    const hpPct = Math.max(0, u.hp / u.max * 100);
    for (const el of [u.el, this.el.querySelector(`.hb-c[data-u="${uid}"]`)]) {
      if (!el) continue;
      el.querySelector('.hb-hp i').style.width = hpPct + '%';
      if (energy != null) el.querySelector('.hb-en i').style.width = energy + '%';
      el.classList.toggle('dead', u.hp <= 0);
      if (energy != null) el.classList.toggle('full', energy >= 100);
    }
  }

  num(uid, text, cls) {
    if (this.skip) return;
    const u = this.units[uid];
    const n = document.createElement('div');
    n.className = 'hb-num ' + cls;
    n.textContent = text;
    n.style.left = u.el.style.left; n.style.top = `calc(${u.el.style.top} - 13vh)`;
    this.el.querySelector('.hb-field').appendChild(n);
    setTimeout(() => n.remove(), 900);
  }

  async run(log) {
    for (const ev of log) {
      if (ev.k === 'round') { this.el.querySelector('.hb-round').textContent = 'Раунд ' + ev.r; continue; }
      const a = this.units[ev.a];
      if (ev.ult && !this.skip) await this.ult(a, ev.name);
      // рывок к первой цели
      const t = ev.hits[0] && this.units[ev.hits[0].to];
      if (t && !ev.hits[0].heal && !this.skip) {
        const dx = (parseFloat(t.el.style.left) - parseFloat(a.el.style.left)) * 0.35;
        const dy = (parseFloat(t.el.style.top) - parseFloat(a.el.style.top)) * 0.35;
        a.el.style.transform = `translate(calc(-50% + ${dx}vw), calc(-100% + ${dy}vh))`;
        a.el.classList.add('acting');
        await this.wait(ev.ult ? 260 : 200);
      }
      for (const h of ev.hits) {
        const u = this.units[h.to];
        if (h.heal) { u.hp = Math.min(u.max, u.hp + h.v); this.num(h.to, '+' + fmt(h.v), 'heal'); }
        else {
          u.hp = Math.max(0, u.hp - h.v);
          this.num(h.to, '-' + fmt(h.v), u.side === 'a' ? 'hurt' : 'dmg');
          if (!this.skip) { u.el.classList.remove('hit'); void u.el.offsetWidth; u.el.classList.add('hit'); }
          if (h.kill) this.app.sfx('destroy');
        }
        this.setBars(h.to);
      }
      if (!this.skip) this.app.sfx(ev.ult ? 'boom' : 'tap');
      this.setBars(ev.a, ev.e);
      a.el.style.transform = '';
      a.el.classList.remove('acting');
      await this.wait(ev.ult ? 520 : 380);
    }
  }

  async ult(a, name) {
    const box = this.el.querySelector('.hb-ult');
    box.innerHTML = `<img src="${F(a.id)}" alt=""><div><i>${esc(HERO[a.id].name)}</i><b>${esc(name)}</b></div>`;
    box.className = `hb-ult show ${a.side}`;
    this.app.sfx('spell');
    await this.wait(950);
    box.className = 'hb-ult';
  }

  finish(res, done) {
    const { battle, reward } = res;
    const win = battle.winner === 'a';
    const mvp = battle.mvp;
    const box = document.createElement('div');
    box.className = `hb-end ${win ? 'win' : 'lose'}`;
    box.innerHTML = `<img class="hb-end-hero" src="${F(mvp.id)}" alt="">
      <div class="hb-end-in"><div class="hb-end-t">${win ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ'}</div>
      ${win ? `<div class="hb-stars">${[0, 1, 2].map((i) => `<span class="${i < battle.stars ? 'on' : ''}">★</span>`).join('')}</div>` : ''}
      <div class="hb-mvp">MVP · <b>${esc(HERO[mvp.id].name)}</b> · ${fmt(mvp.v)} (${mvp.pct}%)</div>
      ${win && reward ? `<div class="hb-rw"><span><img src="${ICON('book')}" alt="">×${reward.books}</span><span>💎 ${reward.gems}</span><span>🪙 ${fmt(reward.gold)}</span><span>Опыт отряду +${fmt(reward.exp)}</span>${reward.frag ? `<span><img src="${P(reward.frag.hero)}" alt="">×${reward.frag.n}</span>` : ''}</div>` : `<p>Усильте героев: книги опыта, звёзды и найм в таверне. Танков ставьте вперёд.</p>`}
      <div class="muted">Нажмите, чтобы продолжить</div></div>`;
    this.el.appendChild(box);
    this.app.sfx(win ? 'win' : 'lose');
    box.onclick = () => { this.el.classList.remove('show'); this.el.innerHTML = ''; done?.(); };
  }
}

function setDot(el, on) {
  if (!el) return;
  let d = el.querySelector('.rdot');
  if (on && !d) { d = document.createElement('span'); d.className = 'rdot'; el.appendChild(d); }
  if (!on && d) d.remove();
}
