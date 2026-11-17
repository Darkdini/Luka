import { RACES, GAME_TITLE, fmt } from '/shared/config.js';
import { api, token, setToken, store } from './api.js';
import { loadAll } from './assets.js';
import { Scene } from './scene.js';
import { Village } from './village.js';
import { Battle } from './battle.js';
import { WorldMap } from './world.js';
import { UI } from './ui.js';
import { Story } from './story.js';
import { CHAPTERS, chapterOpen } from '/shared/story.js';

const $ = (s) => document.querySelector(s);

class App {
  constructor() {
    this.api = api;
    this.me = null;
    this.mode = 'village';
    this.sound = store.get('ck_sound') !== '0';
    this.seenReports = +(store.get('ck_seen') || 0);
  }

  async boot() {
    document.title = GAME_TITLE;
    const bar = $('#load-fill');
    await loadAll((k) => { bar.style.width = Math.round(k * 100) + '%'; });
    this.scene = new Scene($('#cv'));
    this.village = new Village(this.scene, this);
    this.battle = new Battle(this.scene, this);
    this.world = new WorldMap(this);
    this.ui = new UI(this);
    this.story = new Story(this);
    $('#loading').classList.add('hide');
    if (token) {
      try { await this.refresh(); this.enterGame(); return; } catch { setToken(null); }
    }
    this.showAuth();
  }

  // --- Вход и регистрация ------------------------------------------------------------
  showAuth() {
    $('#auth').classList.add('show');
    const races = $('#race-list');
    races.innerHTML = Object.entries(RACES).map(([k, r], i) => `
      <label class="race" style="--c:${r.color}">
        <input type="radio" name="race" value="${k}" ${i === 0 ? 'checked' : ''}>
        <span class="race-name">${r.name}</span><span class="race-desc">${r.desc}</span>
      </label>`).join('');
    const tabs = document.querySelectorAll('#auth .auth-tab');
    tabs.forEach((t) => {
      t.onclick = () => {
        tabs.forEach((x) => x.classList.toggle('on', x === t));
        $('#auth').dataset.mode = t.dataset.mode;
        $('#auth-err').textContent = '';
      };
    });
    $('#auth-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const reg = $('#auth').dataset.mode === 'register';
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      $('#auth-err').textContent = '';
      try {
        const data = { username: f.username.value.trim(), password: f.password.value };
        const r = reg
          ? await api.register({ ...data, castleName: f.castle.value.trim(), race: f.race.value })
          : await api.login(data);
        setToken(r.token);
        await this.refresh();
        $('#auth').classList.remove('show');
        this.enterGame();
        if (reg) this.welcome();
      } catch (err) {
        $('#auth-err').textContent = err.message;
      } finally { btn.disabled = false; }
    };
  }

  welcome() {
    this.ui.modal('Добро пожаловать, правитель!', `
      <div class="welcome">
        <p>Ваш замок <b>${this.me.name}</b> основан на землях Валории (${this.me.x}:${this.me.y}).</p>
        <ul>
          <li>💰 Собирайте золото и зерно с рудников и мельниц — нажмите на значок над зданием.</li>
          <li>🏗 Улучшайте <b>Цитадель</b>, чтобы открыть новые здания, войска и героев.</li>
          <li>⚔ Обучайте армию в Казармах и атакуйте лагеря разбойников на карте мира.</li>
          <li>📜 Сюжет «Пепел Короны» раскроет тайну вашей крови — и щедро наградит.</li>
          <li>🛡 У вас 24 часа защитного щита новичка — успейте отстроить оборону!</li>
        </ul>
      </div>`, [{ label: 'Начать историю', cls: 'green', onClick: () => { this.ui.closeModal(); this.story.start(CHAPTERS[0]); } }]);
  }

  logout() {
    setToken(null);
    this.ws?.close();
    location.reload();
  }

  enterGame() {
    document.body.classList.add('in-game');
    this.village.setMe(this.me);
    this.goHome();
    this.connect();
    let last = performance.now();
    const loop = (t) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      if (this.world.open) { /* у карты мира свой цикл */ } else if (this.mode === 'battle') this.battle.frame(dt);
      else this.village.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    setInterval(() => { if (this.mode === 'village' && !this.busy) this.refresh().catch(() => {}); }, 30000);
  }

  goHome() {
    this.mode = 'village';
    document.body.dataset.mode = 'village';
    this.world.close();
    this.story.close();
    this.village.visit = null;
    this.village.enter();
    this.scene.cam = { x: 0, y: 22 * 32, z: Math.max(this.scene.minZ, 0.62) };
    this.scene.clampCam();
    this.setMe(this.me);
  }

  // --- Синхронизация с сервером ------------------------------------------------------
  setMe(me) {
    this.me = me;
    this.fetchedAt = Date.now();
    this.village.setMe(me);
    this.ui?.updateHud(me);
  }

  async refresh() {
    const me = await api.me();
    if (this.ui) this.setMe(me); else { this.me = me; this.fetchedAt = Date.now(); }
    return me;
  }

  async act(type, args) {
    this.busy = true;
    try {
      const r = await api.act(type, args);
      this.setMe(r.me);
      return r;
    } catch (e) {
      this.ui.toast(e.message, 'bad');
      this.sfx('error');
      throw e;
    } finally { this.busy = false; }
  }

  async collect(id) {
    try {
      const r = await this.act('collect', { id });
      const got = r.collected;
      if (got.gold + got.food > 0) {
        this.sfx('coin');
        const b = this.me.buildings.find((v) => v.id === id);
        if (b) {
          const p = { x: (b.x - b.y) * 32 + 48 * 0, y: (b.x + b.y + 3) * 16 - 60 };
          this.scene.emit(p.x, p.y, 8, 'coin');
        }
        this.ui.toast(`+${fmt(got.gold || got.food)} ${got.gold ? 'золота' : 'зерна'}`, 'good');
      } else this.ui.toast('Хранилище заполнено — улучшите Казну или Амбар');
    } catch { /* тост показан */ }
  }

  async daily() {
    try {
      const r = await this.act('daily');
      this.ui.toast(`Ежедневная награда: +${r.gems} 💎, +${fmt(r.gold)} золота, +${fmt(r.food)} зерна`, 'good');
      this.sfx('coin');
    } catch { /* */ }
  }

  async buyPack(id) {
    try {
      const r = await api.buy(id);
      this.setMe(r.me);
      this.ui.toast('Покупка зачислена! 💎', 'good');
      this.ui.openShop('gems');
    } catch (e) { this.ui.toast(e.message); }
  }

  // --- Мир и бой -----------------------------------------------------------------------
  openWorld(x, y) {
    this.village.cancelPlacing();
    this.ui.closeModal();
    this.world.show(x, y);
  }

  // Осмотр чужого замка
  async visit(id) {
    try {
      const d = await api.player(id);
      this.ui.closeModal();
      this.world.close();
      this.mode = 'visit';
      document.body.dataset.mode = 'visit';
      this.village.visit = d;
      this.village.setMe(this.me);
      $('#visit-name').textContent = d.name;
      $('#visit-sub').textContent = `${d.owner} · 🏆 ${d.trophies}`;
      $('#visit-attack').onclick = () => this.attack({ kind: 'player', id: d.id });
      $('#visit-profile').onclick = () => this.ui.openProfile(d.id);
      this.scene.cam = { x: 0, y: 22 * 32, z: Math.max(this.scene.minZ, 0.62) };
    } catch (e) { this.ui.toast(e.message, 'bad'); }
  }

  storyNext() {
    if (!this.me) return null;
    const st = { buildings: this.me.buildings, story: this.me.story || {} };
    return CHAPTERS.find((c) => !(st.story[c.id]?.stars > 0) && chapterOpen(st, c).open) || null;
  }

  async attack(target) {
    this.ui.closeModal();
    try {
      const data = await api.attackStart(target);
      this.world.close();
      this.story.close();
      if (target.kind !== 'story') this.story.pending = null;
      this.mode = 'battle';
      document.body.dataset.mode = 'battle';
      this.ui.cardsKey = null;
      this.battle.start(data);
      this.scene.cam = { x: 0, y: 22 * 32 - 20, z: Math.max(this.scene.minZ, 0.85) };
      this.scene.clampCam();
      this.sfx('horn');
    } catch (e) { this.ui.toast(e.message, 'bad'); }
  }

  // --- WebSocket: чат, уведомления ---------------------------------------------------
  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    this.ws = ws;
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'history') { $('#chat-log').innerHTML = ''; m.messages.forEach((x) => this.ui.chatMessage(x)); }
      if (m.type === 'chat') this.ui.chatMessage({ ...m, live: true });
      if (m.online != null) $('#online').textContent = m.online;
      if (m.type === 'attacked') {
        this.ui.toast(`⚔ ${m.by} атаковал ваш замок: ${'★'.repeat(m.stars)} ${m.pct}%`, 'bad');
        this.refresh().catch(() => {});
      }
    };
    ws.onclose = () => { setTimeout(() => { if (this.me) this.connect(); }, 4000); };
  }

  sendChat(text) {
    if (text.trim() && this.ws?.readyState === 1) this.ws.send(JSON.stringify({ type: 'chat', text }));
  }

  // --- Звуки (синтез WebAudio, без файлов) ---------------------------------------------
  setSound(on) { this.sound = on; store.set('ck_sound', on ? '1' : '0'); }
  sfx(kind) {
    if (!this.sound) return;
    try {
      this.ac = this.ac || new AudioContext();
      const ac = this.ac, t = ac.currentTime;
      const tone = (f, d, type = 'sine', vol = 0.08, f2) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type; o.frequency.setValueAtTime(f, t);
        if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d);
      };
      const noise = (d, vol = 0.15, freq = 800) => {
        const buf = ac.createBuffer(1, ac.sampleRate * d, ac.sampleRate), ch = buf.getChannelData(0);
        for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / ch.length);
        const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
        f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol;
        s.buffer = buf; s.connect(f).connect(g).connect(ac.destination); s.start(t);
      };
      ({
        click: () => tone(660, 0.06, 'triangle', 0.05),
        coin: () => { tone(988, 0.08, 'square', 0.04); setTimeout(() => tone(1318, 0.12, 'square', 0.04), 70); },
        build: () => { noise(0.15, 0.2, 1200); tone(220, 0.12, 'triangle', 0.08); },
        deploy: () => tone(330, 0.07, 'triangle', 0.05, 440),
        spell: () => tone(400, 0.4, 'sawtooth', 0.05, 1200),
        destroy: () => noise(0.5, 0.25, 500),
        boom: () => { noise(0.6, 0.35, 300); tone(90, 0.4, 'sine', 0.2, 40); },
        horn: () => { tone(196, 0.5, 'sawtooth', 0.05); setTimeout(() => tone(262, 0.6, 'sawtooth', 0.05), 250); },
        win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'triangle', 0.07), i * 140)),
        lose: () => [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'triangle', 0.07), i * 180)),
        error: () => tone(160, 0.15, 'square', 0.05),
      })[kind]?.();
    } catch { /* звук недоступен */ }
  }
}

window.app = new App();
window.app.boot();
