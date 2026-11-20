// Первый запуск: экран загрузки, соглашение, вступление, выбор фракции.
import { RACES } from '/shared/config.js';
import { store } from './api.js';

const $ = (s) => document.querySelector(s);
const A = '/assets/realm/';

export const LOAD_TIPS = [
  'Совет: расчищайте руины — под ними прячутся ресурсы.',
  'Совет: герои одной расы в отряде получают общий бонус.',
  'Совет: улучшайте Стену, чтобы враг не застал вас врасплох.',
  'Совет: заходите каждый день — на седьмой ждёт королевский сундук.',
  'Говорят, седьмой осколок Короны так и не нашли…',
];
const STAGES = ['Разжигаем горн…', 'Читаем летописи…', 'Поднимаем знамёна…', 'Созываем героев…', 'Почти готово…'];

export const INTRO = [
  'Пятьсот лет люди, эльфы, гномы и орки жили в мире под властью Короны Семи Камней.',
  'Но король Аурел убит в собственном тронном зале. Корона расколота, семь осколков разлетелись по Валории.',
  'Из Пустошей поднялся некромант Морвейн. Мёртвые встают из могил под его знаменем.',
  'Союзы рушатся. Деревни горят. Каждое королевство теперь само за себя.',
  'Тебе досталась разорённая пограничная крепость — последний оплот на пути Тьмы.',
  'Подними её из руин. Найди осколки. Выбери, под чьим знаменем ты встанешь.',
];

export const FACTION_ORDER = ['humans', 'elves', 'dwarves', 'orcs'];

export function loadingProgress(k) {
  $('#load-fill').style.width = Math.round(k * 100) + '%';
  $('#load-stage').textContent = `${STAGES[Math.min(STAGES.length - 1, Math.floor(k * STAGES.length))]} ${Math.round(k * 100)}%`;
}
export function loadingTip() {
  $('#load-tip').textContent = LOAD_TIPS[Math.floor(Math.random() * LOAD_TIPS.length)];
}

function show(id) {
  document.querySelectorAll('.night-screen').forEach((el) => el.classList.toggle('show', el.id === id));
}

// Соглашение: показывается один раз на устройстве
export function agreement() {
  return new Promise((resolve) => {
    if (store.get('cl_agree') === '1') return resolve();
    show('agree');
    $('#agree-ok').onclick = () => { store.set('cl_agree', '1'); resolve(); };
    $('#agree-no').onclick = () => {
      $('.agree-text').insertAdjacentHTML('afterbegin', '<p class="agree-warn">Без согласия с условиями играть нельзя: игре нужен аккаунт, чтобы сохранять ваш прогресс.</p>');
      $('#agree-no').remove();
    };
  });
}

// Вступление: слайды с плавной сменой и печатающимся текстом
export function intro(sfx) {
  return new Promise((resolve) => {
    show('intro');
    const slide = $('.intro-slide'), text = $('.intro-text'), dots = $('.intro-dots');
    dots.innerHTML = INTRO.map(() => '<i></i>').join('');
    let i = -1, typing = null, done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(typing);
      store.set('cl_intro', '1');
      resolve();
    };
    const next = () => {
      if (typing) { clearInterval(typing); typing = null; text.textContent = INTRO[i]; return; }
      i++;
      if (i >= INTRO.length) return finish();
      slide.classList.remove('in'); void slide.offsetWidth;
      slide.style.backgroundImage = `url(${A}intro/${i + 1}.jpg)`;
      slide.classList.add('in');
      dots.querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === i));
      const t = INTRO[i];
      let k = 0;
      text.textContent = '';
      typing = setInterval(() => {
        k += 1;
        text.textContent = t.slice(0, k);
        if (k >= t.length) { clearInterval(typing); typing = null; }
      }, 32);
      sfx?.('click');
    };
    $('#intro').onclick = (e) => { if (e.target.id !== 'intro-skip') next(); };
    $('#intro-skip').onclick = finish;
    next();
  });
}

// Выбор фракции. Возвращает { faction } или { login: true }
export function chooseFaction(initial, sfx) {
  return new Promise((resolve) => {
    show('factions');
    const tabs = $('.fx-tabs');
    tabs.innerHTML = FACTION_ORDER.map((k) => `<button data-f="${k}" style="--c:${RACES[k].color}"><img src="${A}races/crest_${k}.png" alt=""><span>${RACES[k].name}</span></button>`).join('');
    let cur = null;
    const pick = (k) => {
      if (k === cur) return;
      cur = k;
      const r = RACES[k];
      const root = $('#factions');
      root.style.setProperty('--c', r.color);
      $('.fx-bg').style.backgroundImage = `url(${A}races/bg_${k}.jpg)`;
      const hero = $('.fx-hero');
      hero.classList.remove('in'); void hero.offsetWidth;
      hero.src = `${A}races/mentor_${k}.png`;
      hero.classList.add('in');
      $('.fx-crest-sm').src = `${A}races/crest_${k}.png`;
      $('.fx-name').textContent = r.name;
      $('.fx-house').textContent = r.house;
      $('.fx-hq').src = `${A}races/hq_${k}.png`;
      $('.fx-desc').textContent = r.desc;
      $('.fx-perks').innerHTML = r.perks.map((p) => p.replace(/(\+\d+%)/, '<em>$1</em>')).map((p) => `<div>${p}</div>`).join('');
      $('.fx-mentor').innerHTML = `Наставник: <b>${r.mentor}</b>`;
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.f === k));
      const card = $('.fx-sign');
      card.classList.remove('swing'); void card.offsetWidth; card.classList.add('swing');
      sfx?.('click');
    };
    tabs.querySelectorAll('button').forEach((b) => { b.onclick = () => pick(b.dataset.f); });
    // свайп влево-вправо по экрану
    let sx = null;
    const root = $('#factions');
    root.ontouchstart = (e) => { sx = e.touches[0].clientX; };
    root.ontouchend = (e) => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx;
      sx = null;
      if (Math.abs(dx) < 60) return;
      const i = FACTION_ORDER.indexOf(cur);
      pick(FACTION_ORDER[(i + (dx < 0 ? 1 : 3)) % 4]);
    };
    $('#fx-pick').onclick = () => resolve({ faction: cur });
    $('#fx-login').onclick = () => resolve({ login: true });
    pick(initial || 'humans');
  });
}

export function showAuthScreen(mode, faction) {
  show('auth');
  $('#auth').dataset.mode = mode;
  document.querySelectorAll('#auth .auth-tab').forEach((t) => t.classList.toggle('on', t.dataset.mode === mode));
  if (faction) {
    $('#auth-form').race.value = faction;
    const r = RACES[faction];
    $('.auth-faction img').src = `${A}races/crest_${faction}.png`;
    $('.auth-faction b').textContent = `${r.name} · ${r.house}`;
    $('#auth').style.setProperty('--c', r.color);
  }
}

export function hideScreens() { show(null); }
