// Сумка: предметы по вкладкам, окно предмета («Использовать»), общее окно ускорения
// (предметы-ускорения + «Сейчас за самоцветы») и выбор места для телепорта.
import { fmt, fmtTime, gemsForTime } from '/shared/config.js';
import { ITEMS, HERO_ITEMS, TABS, RARITY_COLOR } from '/shared/items.js';
import { itemUrl } from './cityui.js';

const A = '/assets/realm/';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ORDER = Object.keys(ITEMS);

export class Bag {
  constructor(app) {
    this.app = app;
    this.root = document.createElement('div');
    this.root.id = 'bag';
    this.root.className = 'meta-screen';
    this.root.innerHTML = `<div class="hs-top"><button class="hs-back" aria-label="Назад"><img src="${A}kit/back.png" alt=""></button><b class="hs-title">Сумка</b>
      <div class="hs-res"><span><img src="${A}kit/gems.png" alt=""><b data-g></b></span></div></div><div class="hs-body"></div><nav class="hs-tabs"></nav>`;
    document.body.appendChild(this.root);
    this.root.querySelector('.hs-back').onclick = () => this.root.classList.remove('show');
    this.tab = 'speed';
  }
  get me() { return this.app.me; }
  open(tab) { this.root.classList.add('show'); this.app.sfx('click'); this.show(tab || this.tab); }
  refresh() { if (this.root.classList.contains('show')) this.show(this.tab); }
  async act(type, args, ok) {
    try { const r = await this.app.act(type, args); if (ok) this.app.ui.toast(typeof ok === 'function' ? ok(r) : ok, 'good'); return r; } catch { return null; }
  }

  show(tab) {
    this.tab = tab;
    const nav = this.root.querySelector('.hs-tabs');
    const icons = { speed: 'sp4', res: 'rc_food', special: 'sh2', hero: 'book' };
    nav.innerHTML = TABS.map(([id, name]) => `<button data-t="${id}" class="${id === tab ? 'on' : ''}"><img src="${itemUrl(icons[id])}" alt=""><span>${name}</span></button>`).join('');
    nav.querySelectorAll('button').forEach((b) => { b.onclick = () => this.show(b.dataset.t); });
    this.root.querySelector('[data-g]').textContent = fmt(this.me.res.gems);
    const bag = this.me.bag || {};
    let cells;
    if (tab === 'hero') {
      cells = Object.entries(HERO_ITEMS).map(([k, h]) => ({ k, n: this.me.items?.[k] || 0, icon: k, name: h.name, rarity: 'rare' })).filter((c) => c.n > 0);
    } else {
      cells = ORDER.filter((k) => ITEMS[k].tab === tab && bag[k] > 0).map((k) => ({ k, n: bag[k], icon: ITEMS[k].icon, name: ITEMS[k].name, rarity: ITEMS[k].rarity }));
    }
    const boosts = tab === 'special' ? this.boostsHtml() : '';
    this.root.querySelector('.hs-body').innerHTML = `${boosts}${cells.length ? `<div class="bg-grid">${cells.map((c) => `<button class="bg-cell" data-k="${c.k}" style="--rc:${RARITY_COLOR[c.rarity]}">
        <img src="${itemUrl(c.icon)}" alt=""><b>${fmt(c.n)}</b><span>${esc(c.name)}</span></button>`).join('')}</div>`
      : `<div class="tr-box tr-note">Здесь пока пусто. Предметы дают за главы, походы, события, VIP и пропуск — или их можно купить в Лавке.<button class="nbtn sm" data-shop>В лавку</button></div>`}`;
    this.root.querySelectorAll('.bg-cell').forEach((b) => { b.onclick = () => (tab === 'hero' ? this.heroItem(b.dataset.k) : this.item(b.dataset.k)); });
    const sh = this.root.querySelector('[data-shop]');
    if (sh) sh.onclick = () => { this.root.classList.remove('show'); this.app.store.open('items'); };
  }

  boostsHtml() {
    const me = this.me, now = Date.now() + (me.now - this.app.fetchedAt);
    const rows = [];
    if (me.shieldUntil > now) rows.push(`<div class="ms-row"><span><img class="ic" src="${itemUrl('sh2')}" alt="">Щит мира</span><b>${fmtTime((me.shieldUntil - now) / 1000)}</b></div>`);
    for (const b of Object.values(me.boosts || {})) {
      const it = ITEMS[b.item];
      if (it) rows.push(`<div class="ms-row"><span><img class="ic" src="${itemUrl(it.icon)}" alt="">${it.name}</span><b>${fmtTime((b.until - now) / 1000)}</b></div>`);
    }
    return rows.length ? `<div class="tr-box"><div class="hd-sub">Действует сейчас</div>${rows.join('')}</div>` : '';
  }

  heroItem(k) {
    const h = HERO_ITEMS[k];
    this.app.ui.modal(h.name, `<div class="bw-head"><img src="${itemUrl(k)}" alt=""><div><p>${h.desc}</p><p class="muted">В сумке: ${fmt(this.me.items[k] || 0)}</p></div></div>`,
      [{ label: 'К героям', cls: 'green', onClick: () => { this.app.ui.closeModal(); this.root.classList.remove('show'); this.app.heroes.open(k === 'ticket' ? 'tavern' : 'list'); } }], 'bw');
  }

  // Окно предмета
  item(k) {
    const it = ITEMS[k], n = this.me.bag?.[k] || 0;
    const btns = [];
    let extra = '';
    if (it.kind === 'res') {
      extra = `<div class="tr-amt bg-amt"><button class="tr-pm" data-d="-1">−</button><input type="range" min="1" max="${n}" value="1"><button class="tr-pm" data-d="1">+</button><b class="tr-n">1</b></div>`;
      btns.push({ label: 'Открыть', cls: 'green', onClick: async () => { const v = +document.querySelector('.bg-amt input').value; this.app.ui.closeModal(); const r = await this.act('openChest', { item: k, n: v }); if (r) { this.app.engage.rewardFx(r.got); this.show(this.tab); } } });
      btns.push({ label: 'Все', cls: 'steel', onClick: async () => { this.app.ui.closeModal(); const r = await this.act('openChest', { item: k, n }); if (r) { this.app.engage.rewardFx(r.got); this.show(this.tab); } } });
    } else if (it.kind === 'shield') {
      btns.push({ label: 'Включить щит', cls: 'green', onClick: async () => { this.app.ui.closeModal(); if (await this.act('useShield', { item: k }, 'Щит мира поднят')) this.show(this.tab); } });
    } else if (it.kind === 'boost') {
      btns.push({ label: 'Применить', cls: 'green', onClick: async () => { this.app.ui.closeModal(); if (await this.act('useBoost', { item: k }, 'Бонус действует')) this.show(this.tab); } });
    } else if (it.kind === 'teleport') {
      if (it.rand) btns.push({ label: 'Переместить замок', cls: 'green', onClick: async () => { this.app.ui.closeModal(); const r = await this.act('teleport', { item: k }); if (r) { this.root.classList.remove('show'); this.app.ui.toast('Замок перенесён', 'good'); this.app.openWorld(r.moveTo.x, r.moveTo.y); } } });
      else btns.push({ label: 'Выбрать место на карте', cls: 'green', onClick: () => { this.app.ui.closeModal(); this.root.classList.remove('show'); this.app.world.teleportMode = k; this.app.openWorld(); this.app.ui.toast('Нажмите на свободную клетку карты'); } });
    } else if (it.kind === 'speed') {
      extra = `<p class="muted">Ускорение применяется в окне стройки, обучения, исследования, лечения или похода — кнопка «Ускорить».</p>`;
    }
    this.app.ui.modal(it.name, `<div class="bw-head"><img src="${itemUrl(it.icon)}" alt=""><div><p>${it.desc}</p><p class="muted">В сумке: ${fmt(n)}</p></div></div>${extra}`, btns, 'bw');
    const r = document.querySelector('.bg-amt input');
    if (r) {
      const set = (v) => { r.value = Math.max(1, Math.min(n, v)); document.querySelector('.bg-amt .tr-n').textContent = r.value; };
      r.oninput = () => set(+r.value);
      document.querySelectorAll('.bg-amt .tr-pm').forEach((b) => { b.onclick = () => set(+r.value + +b.dataset.d); });
    }
  }

  // Общее окно ускорения. target — { type, id|kind }, end — время окончания (по серверу),
  // gemAction/gemArgs — действие «сразу за самоцветы»
  speed(target, end, gemAction, gemArgs, title) {
    const me = this.me;
    const render = () => {
      const m = this.me;
      const live = this.endFor(target) ?? end;
      const left = Math.max(0, (live - m.now) / 1000 - (Date.now() - this.app.fetchedAt) / 1000);
      if (left <= 0) { this.app.ui.closeModal(); return; }
      const list = Object.keys(ITEMS).filter((k) => ITEMS[k].kind === 'speed' && (!ITEMS[k].for || ITEMS[k].for === target.type) && (m.bag?.[k] || 0) > 0);
      const gems = target.type === 'march' ? Math.max(1, Math.ceil(gemsForTime(left) / 2)) : gemsForTime(left);
      const box = this.app.ui.modal(`Ускорить: ${esc(title || '')}`, `
        <div class="bw-box"><div class="ms-row"><span><img class="ic" src="${itemUrl('sp4')}" alt="">Осталось</span><b data-left>${fmtTime(left)}</b></div></div>
        ${list.length ? `<div class="sp-list">${list.map((k) => {
          const it = ITEMS[k], need = Math.ceil(left / it.sec), have = m.bag[k];
          return `<div class="al-row"><img src="${itemUrl(it.icon)}" alt=""><div><b>${it.name}</b><span>в сумке ${fmt(have)}</span></div>
            <button class="nbtn xs" data-use="${k}" data-n="1">Исп.</button>${Math.min(need, have) > 1 ? `<button class="nbtn xs steel" data-use="${k}" data-n="${Math.min(need, have)}">×${Math.min(need, have)}</button>` : ''}</div>`;
        }).join('')}</div>` : '<p class="muted">Подходящих ускорений нет — купите их в Лавке или завершите сразу за самоцветы.</p>'}`,
      [{ label: `Сразу <img class="ic" src="${A}kit/gems.png" alt=""> ${gems}`, cls: 'gem', onClick: () => this.app.ui.confirmGems(gems, async () => { this.app.ui.closeModal(); await this.act(gemAction, gemArgs); this.after?.(); }) }], 'bw');
      box.querySelectorAll('[data-use]').forEach((b) => {
        b.onclick = async () => {
          const r = await this.act('useSpeed', { item: b.dataset.use, n: +b.dataset.n, target });
          if (r) { this.app.sfx('coin'); render(); }
        };
      });
    };
    void me;
    render();
  }

  // Текущее время окончания цели (после применения предметов)
  endFor(t) {
    const m = this.me;
    if (t.type === 'build') return m.buildings.find((b) => b.id === t.id)?.up?.end ?? 0;
    if (t.type === 'train') return m.trainQ?.[t.kind]?.end ?? 0;
    if (t.type === 'research') return m.research?.end ?? 0;
    if (t.type === 'heal') return m.healQ?.end ?? 0;
    if (t.type === 'march') { const x = (m.marches || []).find((v) => v.id === t.id); if (!x) return 0; return x.phase === 'go' ? x.arrive : x.phase === 'work' ? x.workEnd : x.backAt; }
    return null;
  }
}
