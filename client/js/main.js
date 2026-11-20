import { RACES, GAME_TITLE, fmt } from '/shared/config.js';
import { api, token, setToken, store } from './api.js';
import { loadAll } from './assets.js';
import { agreement, intro, chooseFaction, showAuthScreen, hideScreens, loadingProgress, loadingTip } from './onboarding.js';
import { Scene, iso } from './scene.js';
import { CityUI } from './cityui.js';
import { RES_GEN } from '/shared/config.js';
import { Village } from './village.js';
import { Battle } from './battle.js';
import { WorldMap } from './world.js';
import { UI } from './ui.js';
import { Story } from './story.js';
import { Engage } from './engage.js';
import { Heroes } from './heroes.js';
import { CHAPTERS, chapterOpen } from '/shared/story.js';
import { checkUsername, checkPassword, checkCastleName } from '/shared/names.js';

const $ = (s) => document.querySelector(s);

class App {
  constructor() {
    this.api = api;
    this.me = null;
    this.mode = 'village';
    this.sound = store.get('ck_sound') !== '0';
    this.musicOn = store.get('ck_music') !== '0';
    this.seenReports = +(store.get('ck_seen') || 0);
  }

  async boot() {
    document.title = GAME_TITLE;
    loadingTip();
    const t0 = performance.now();
    await loadAll(loadingProgress);
    // заставка видна хотя бы 1.5 с, даже если всё уже в кэше
    await new Promise((r) => setTimeout(r, Math.max(0, 1500 - (performance.now() - t0))));
    this.scene = new Scene($('#cv'));
    this.village = new Village(this.scene, this);
    this.battle = new Battle(this.scene, this);
    this.world = new WorldMap(this);
    this.ui = new UI(this);
    this.story = new Story(this);
    this.engage = new Engage(this);
    this.heroes = new Heroes(this);
    this.cityUi = new CityUI(this);
    $('#btn-build').onclick = () => { this.village.cancelPlacing(); this.cityUi.openBuild(); };
    $('#btn-heroes').onclick = () => this.heroes.open('list');
    $('#btn-campaign').onclick = () => this.heroes.open('campaign');
    if (token) {
      try {
        await this.refresh();
        $('#loading').classList.add('hide');
        this.enterGame();
        if (this.me.dailyReady) setTimeout(() => this.engage.openDaily(), 900);
        return;
      } catch { setToken(null); }
    }
    $('#loading').classList.add('hide');
    await new Promise((r) => setTimeout(r, 450));
    await agreement();
    if (store.get('cl_intro') !== '1') await intro((k) => this.sfx(k));
    this.bindAuth();
    this.pickFaction();
  }

  // --- Выбор фракции, вход и регистрация ---------------------------------------------
  async pickFaction(initial) {
    const r = await chooseFaction(initial || this.faction, (k) => this.sfx(k));
    if (r.login) { showAuthScreen('login'); return; }
    this.faction = r.faction;
    showAuthScreen('register', r.faction);
    this.loadCaptcha();
  }

  async loadCaptcha() {
    try { const c = await api.captcha(); this.captchaId = c.id; $('#cap-img').innerHTML = c.svg; } catch (e) { $('#auth-err').textContent = e.message; }
    const f = $('#auth-form'); if (f.captcha) f.captcha.value = '';
  }

  bindAuth() {
    $('#cap-new').onclick = () => this.loadCaptcha();
    $('#fx-change').onclick = () => this.pickFaction(this.faction);
    $('#auth-form').username.addEventListener('input', (e) => {
      if ($('#auth').dataset.mode !== 'register') return;
      const v = e.target.value, clean = v.replace(/[^A-Za-z0-9_]/g, '');
      if (v !== clean) { e.target.value = clean; $('#auth-err').textContent = 'Ник — только английские буквы, цифры и _'; }
      else $('#auth-err').textContent = '';
    });
    document.querySelectorAll('#auth .auth-tab').forEach((t) => {
      t.onclick = () => {
        $('#auth-err').textContent = '';
        if (t.dataset.mode === 'register') this.pickFaction(this.faction);
        else showAuthScreen('login');
      };
    });
    $('#auth-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const reg = $('#auth').dataset.mode === 'register';
      const btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      $('#auth-err').textContent = '';
      if (reg) {
        const bad = checkUsername(f.username.value.trim()) || checkPassword(f.password.value) || checkCastleName(f.castle.value);
        if (bad) { $('#auth-err').textContent = bad; btn.disabled = false; return; }
      }
      try {
        const data = { username: f.username.value.trim(), password: f.password.value };
        const r = reg
          ? await api.register({ ...data, castleName: f.castle.value.trim(), race: f.race.value, agree: true, captchaId: this.captchaId, captcha: f.captcha.value, website: f.website.value })
          : await api.login(data);
        setToken(r.token);
        await this.refresh();
        hideScreens();
        this.enterGame();
        if (reg) this.welcome();
        else if (this.me.dailyReady) setTimeout(() => this.engage.openDaily(), 700);
      } catch (err) {
        $('#auth-err').textContent = err.message;
        if (reg) this.loadCaptcha();
      } finally { btn.disabled = false; }
    };
  }

  // Наставник фракции встречает игрока в новом квартале
  async welcome() {
    const f = Object.keys(RACES).find((k) => RACES[k] === RACES[this.me.race]) || 'humans';
    const lines = {
      humans: ['Вот она, наша крепость. Стены разбиты, но фундамент держит — как и люди этой земли.', 'Начнём с малого: накормить гарнизон и поднять ворота. Король бы этого хотел.'],
      elves: ['Лес помнит эти стены другими. Здесь пели, а теперь только ветер.', 'Сначала припасы и дозор. Морвейн не ждёт, пока мы будем готовы.'],
      dwarves: ['Хо! Кладка старая, но добрая — гномья, не иначе.', 'Разгребём завалы, разожжём горн, и через неделю тут будет крепость, а не руины!'],
      orcs: ['Мало стен. Много врагов. Хорошо.', 'Сначала мясо и топоры. Потом — те, кто посмел тронуть нашу землю.'],
    }[f];
    const who = 'mentor_' + f;
    document.body.style.setProperty('--dlg-bg', `url(/assets/realm/races/bg_${f}.jpg)`);
    await this.story.play(lines.map((t) => [who, t]));
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
    this.engage?.music('village');
    this.wipe();
    this.homeCamera();
    this.scene.clampCam();
    this.setMe(this.me);
  }

  // --- Синхронизация с сервером ------------------------------------------------------
  setMe(me) {
    const prev = this.me;
    this.me = me;
    this.fetchedAt = Date.now();
    this.village.setMe(me);
    this.ui?.updateHud(me);
    this.engage?.update(me, prev && prev.id === me.id ? prev : null);
    this.heroes?.badges();
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
    const b = this.me.buildings.find((v) => v.id === id);
    let from = null;
    if (b) {
      const p = iso(b.x + 1.5, b.y + 1.5), w = this.scene.toScreen(p.x, p.y - 70);
      from = { x: w.x, y: w.y };
    }
    try {
      const r = await this.act('collect', { id });
      const got = Object.entries(r.collected || {}).filter(([, v]) => v > 0);
      if (got.length) {
        for (const [k, v] of got) this.engage.fly(from, k, Math.min(9, 3 + Math.round(Math.log10(v + 1) * 1.5)));
        this.sfx('coin');
        if (b) { const [k, v] = got[0]; this.village.floatText(b, `+${fmt(v)} ${RES_GEN[k] || ''}`, k === 'gold' ? '#ffd84a' : '#ffe2a8'); this.village.coinBurst(b); }
      } else this.ui.toast('Склад заполнен — улучшите Склад или Цитадель');
    } catch { /* тост показан */ }
  }

  // Камера города: на Цитадель
  homeCamera() {
    this.scene.fitZoom();
    this.village.setMe(this.me);
    this.village.focusCastle();
  }

  wipe() {
    const w = $('#wipe');
    w.classList.remove('go'); void w.offsetWidth; w.classList.add('go');
  }

  setMusic(on) { this.musicOn = on; store.set('ck_music', on ? '1' : '0'); const t = this.engage.track; this.engage.track = null; this.engage.music(on ? t : null); }

  async daily() {
    try {
      const r = await this.act('daily');
      this.ui.toast(`Ежедневная награда: +${r.got?.gems || 0} самоцветов`, 'good');
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
    this.wipe();
    this.world.show(x, y);
    this.engage.music('world');
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
      this.homeCamera();
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
      this.scene.bounds = null; this.scene.fitZoom(); this.scene.cam = { x: 0, y: 22 * 32 - 20, z: this.scene.defaultZoom('battle') }; this.scene.clampCam();
      this.scene.clampCam();
      this.sfx('horn');
      this.engage.music('battle');
      this.wipe();
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
    const buzz = { coin: 12, levelup: [30, 40, 30], boom: 35, destroy: 18, star: [20, 30, 40], error: 25, quest: [15, 25, 15], win: [40, 60, 80] }[kind];
    if (buzz && this.sound && navigator.vibrate) { try { navigator.vibrate(buzz); } catch { /* */ } }
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
        quest: () => [659, 880, 1175].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.06), i * 90)),
        levelup: () => { [392, 523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'square', 0.035), i * 70)); setTimeout(() => noise(0.4, 0.08, 4000), 300); },
        star: () => { tone(880, 0.12, 'triangle', 0.08); setTimeout(() => tone(1320, 0.25, 'triangle', 0.08), 90); },
      })[kind]?.();
    } catch { /* звук недоступен */ }
  }
}

window.app = new App();
window.app.boot();
