// Карта мира: участки игроков и NPC поверх нарисованной карты (DOM-слой).
import { RACES, fmtTime } from '/shared/config.js';

export class WorldMap {
  constructor(app) {
    this.app = app;
    this.el = document.getElementById('world');
    this.map = document.getElementById('world-map');
    this.realm = null;
    this.pan = { x: 0, y: 0 };
    this.bindPan();
  }

  async open(realm) {
    this.el.classList.add('show');
    this.realm = realm || this.realm || this.app.me.realm;
    try {
      this.data = await this.app.api.world(this.realm);
      this.render();
    } catch (e) { this.app.ui.toast(e.message); }
  }
  close() { this.el.classList.remove('show'); this.app.ui.closeModal(); }

  bindPan() {
    let st = null;
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.marker, button, .modal')) return;
      st = { x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y };
    });
    window.addEventListener('pointermove', (e) => {
      if (!st) return;
      this.pan.x = st.px + e.clientX - st.x; this.pan.y = st.py + e.clientY - st.y;
      this.applyPan();
    });
    window.addEventListener('pointerup', () => { st = null; });
    window.addEventListener('resize', () => this.applyPan());
  }

  applyPan() {
    const vw = this.el.clientWidth, vh = this.el.clientHeight;
    const k = Math.max(vw / 1672, vh / 941);
    const w = 1672 * k, h = 941 * k;
    this.pan.x = Math.min(0, Math.max(vw - w, this.pan.x));
    this.pan.y = Math.min(0, Math.max(vh - h, this.pan.y));
    this.map.style.width = w + 'px'; this.map.style.height = h + 'px';
    this.map.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px)`;
  }

  render() {
    const d = this.data, me = this.app.me;
    document.getElementById('realm-name').textContent = `Королевство ${d.realm}`;
    document.getElementById('realm-prev').disabled = d.realm <= 1;
    document.getElementById('realm-next').disabled = d.realm >= d.realms;
    this.map.querySelectorAll('.marker').forEach((m) => m.remove());
    const now = Date.now();
    for (const e of d.entries) {
      const m = document.createElement('div');
      const mine = e.kind === 'player' && e.id === me.id;
      m.className = `marker ${e.kind}${mine ? ' mine' : ''}${e.bandit ? ' bandit' : ''}`;
      m.style.left = e.pos[0] * 100 + '%';
      m.style.top = e.pos[1] * 100 + '%';
      const color = e.kind === 'player' ? RACES[e.race]?.color || '#888' : e.bandit ? '#6b4b2a' : '#5b2a6b';
      const status = e.respawn ? `<span class="m-status">⏳ ${fmtTime((e.respawn - now) / 1000)}</span>`
        : e.shield ? '<span class="m-status">🛡</span>' : '';
      m.innerHTML = `
        <div class="m-flag" style="--c:${color}"><span class="m-lvl">${e.level}</span></div>
        <div class="m-name">${mine ? '★ ' : ''}${esc(e.name)}${status}</div>
        ${e.kind === 'player' ? `<div class="m-sub">🏆 ${e.trophies}</div>` : `<div class="m-sub">${esc(e.owner)}</div>`}`;
      m.addEventListener('click', () => this.pick(e, mine));
      this.map.appendChild(m);
    }
    this.applyPan();
  }

  pick(e, mine) {
    const ui = this.app.ui;
    if (mine) { ui.toast('Это ваш замок'); return; }
    const now = Date.now();
    const blocked = e.respawn ? `Лагерь восстанавливается: ${fmtTime((e.respawn - now) / 1000)}`
      : e.shield ? `Под щитом ещё ${fmtTime((e.shield - now) / 1000)}` : '';
    const race = e.kind === 'player' ? RACES[e.race] : null;
    ui.modal(esc(e.name), `
      <div class="target-card">
        <div class="tc-row"><b>Владелец:</b> ${esc(e.owner)} ${race ? `<span class="race-chip" style="--c:${race.color}">${race.name}</span>` : ''}</div>
        <div class="tc-row"><b>Уровень:</b> ${e.level}</div>
        ${e.kind === 'player' ? `<div class="tc-row"><b>Кубки:</b> 🏆 ${e.trophies}</div>` : `<div class="tc-row">${e.bandit ? 'Разбойники захватили этот замок. Отбейте его и заберите добычу!' : 'Враждебная крепость. Чем выше уровень, тем богаче добыча.'}</div>`}
        ${blocked ? `<div class="tc-warn">${blocked}</div>` : ''}
      </div>`, [
      { label: '⚔ Атаковать', cls: 'green', disabled: !!blocked, onClick: () => this.app.attack({ kind: e.kind, id: e.id }) },
    ]);
  }
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
