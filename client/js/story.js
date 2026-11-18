// Сюжетная кампания: карта глав и диалоги в стиле визуальной новеллы.
import { CHAPTERS, CHARACTERS, chapterById, chapterOpen, HOME_POS } from '/shared/story.js';
import { fmt } from '/shared/config.js';
import { url } from './assets.js';
import { esc, avatarUrl } from './world.js';

const $ = (s) => document.querySelector(s);

export class Story {
  constructor(app) {
    this.app = app;
    $('#camp-back').onclick = () => this.close();
  }

  stateLike() { return { buildings: this.app.me.buildings, story: this.app.me.story }; }

  open() {
    $('#campaign').classList.add('show');
    this.render();
  }
  close() { $('#campaign').classList.remove('show'); this.app.ui.closeModal(); }

  render() {
    const map = $('#camp-map');
    map.querySelectorAll('.chapter, svg').forEach((n) => n.remove());
    const st = this.stateLike();
    const done = CHAPTERS.filter((c) => st.story[c.id]?.stars > 0).length;
    $('#camp-progress').textContent = `Глав пройдено: ${done} / ${CHAPTERS.length}`;
    // «вы здесь» — у родного хутора внизу карты
    const home = document.createElement('div');
    home.className = 'chapter home';
    home.style.left = HOME_POS[0] * 100 + '%'; home.style.top = HOME_POS[1] * 100 + '%';
    home.innerHTML = `<span class="ch-num">🏰</span><span class="ch-name">${esc(this.app.me.name)}</span>`;
    map.appendChild(home);
    let focus = null;
    for (const ch of CHAPTERS) {
      const s = st.story[ch.id] || { stars: 0 };
      const o = chapterOpen(st, ch);
      const el = document.createElement('button');
      el.className = `chapter ${s.stars ? 'done' : o.open ? 'open' : 'locked'}`;
      el.style.left = ch.pos[0] * 100 + '%';
      el.style.top = ch.pos[1] * 100 + '%';
      el.innerHTML = `<span class="ch-num">${o.open || s.stars ? ch.id : '🔒'}</span>
        <span class="ch-name">${esc(ch.title)}</span>
        <span class="ch-stars">${'★'.repeat(s.stars)}${'☆'.repeat(3 - s.stars)}</span>`;
      el.onclick = () => this.card(ch);
      map.appendChild(el);
      if (!focus && !s.stars) focus = el;
    }
    // прокручиваем к текущей главе (карта идёт снизу вверх)
    requestAnimationFrame(() => {
      const box = $('#campaign');
      const t = (focus || map.lastElementChild);
      box.scrollTop = Math.max(0, t.offsetTop - box.clientHeight * 0.55);
    });
  }

  card(ch) {
    const st = this.stateLike();
    const s = st.story[ch.id] || { stars: 0 };
    const o = chapterOpen(st, ch);
    const lock = !o.prevDone ? `Сначала пройдите главу ${ch.id - 1}` : !o.castleOk ? `Нужна Цитадель ${ch.castle} ур.` : '';
    const ui = this.app.ui;
    ui.modal(`Глава ${ch.id}. ${esc(ch.title)}`, `
      <div class="ch-card">
        <p class="muted">📍 ${esc(ch.place)} · Сложность: ${ch.level}</p>
        <p class="ch-teaser">${esc(fill(ch.intro[0][1], this.app.me))}</p>
        <div class="ch-rewards"><b>Награда за первое прохождение:</b><br>
          💎 ${ch.reward.gems} · <img class="ri" src="${url('ui/icon_gold')}" alt=""> ${fmt(ch.reward.gold)} · <img class="ri" src="${url('ui/icon_food')}" alt=""> ${fmt(ch.reward.food)}
          <br><b>За три звезды:</b> ещё 💎 ${ch.starGems}</div>
        <p>Ваш результат: <span class="stars">${'★'.repeat(s.stars)}${'☆'.repeat(3 - s.stars)}</span></p>
        ${lock ? `<div class="tc-warn">${lock}</div>` : ''}
      </div>`, [
      ...(s.stars ? [{ label: '📖 Перечитать', onClick: () => { ui.closeModal(); this.play([...ch.intro, ...ch.outro]); } }] : []),
      { label: s.stars ? '⚔ Переиграть' : '⚔ Начать главу', cls: 'green', disabled: !!lock, onClick: () => this.start(ch) },
    ]);
  }

  async start(ch) {
    this.app.ui.closeModal();
    await this.play(ch.intro);
    this.pending = ch.id;
    this.app.attack({ kind: 'story', id: ch.id });
  }

  // Вызывается после окна результата боя
  async afterBattle(result) {
    const id = this.pending;
    this.pending = null;
    if (!id || !result?.firstClear) return;
    const ch = chapterById(id);
    await this.play(ch.outro);
    if (ch.choice) {
      const idx = await this.choose(ch.choice);
      try { await this.app.act('storyChoice', { id: ch.id, option: idx }); } catch { /* */ }
      await this.play([...ch.choice.options[idx].lines, ...(ch.after || [])]);
    }
    const r = result.storyReward;
    if (r) this.app.ui.toast(`Награда главы: +${r.gems} 💎${r.gold ? `, +${fmt(r.gold)} золота` : ''}${r.food ? `, +${fmt(r.food)} зерна` : ''}`, 'good');
    if (id === CHAPTERS.length) this.app.ui.toast('Книга первая завершена! Вы — Носитель Короны 👑', 'good');
  }

  // --- Диалоги ----------------------------------------------------------------------
  play(lines) {
    return new Promise((resolve) => {
      const dlg = $('#dialog');
      dlg.classList.add('show');
      let i = 0, typing = null;
      const show = () => {
        if (i >= lines.length) { dlg.classList.remove('show'); dlg.onclick = null; resolve(); return; }
        const [who, raw] = lines[i];
        const ch = CHARACTERS[who] || CHARACTERS.narrator;
        const text = fill(raw, this.app.me);
        const port = $('#dlg-portrait');
        if (ch.img) {
          port.src = ch.img === 'avatar' ? avatarUrl(this.app.me.avatar) : url(ch.img);
          port.style.filter = ch.filter || '';
          port.className = 'show ' + (ch.side === 'right' ? 'right' : 'left');
        } else port.className = '';
        dlg.dataset.side = ch.side === 'right' ? 'right' : 'left';
        dlg.classList.toggle('narr', !ch.img);
        $('#dlg-name').textContent = fill(ch.name, this.app.me);
        $('#dlg-name').style.setProperty('--c', ch.color || '#3d4f80');
        const box = $('#dlg-text');
        box.textContent = '';
        let k = 0;
        clearInterval(typing);
        typing = setInterval(() => {
          k += 2;
          box.textContent = text.slice(0, k);
          if (k >= text.length) { clearInterval(typing); typing = null; }
        }, 22);
        dlg.onclick = () => {
          if (typing) { clearInterval(typing); typing = null; box.textContent = text; return; }
          i++; show();
        };
      };
      $('#dlg-skip').onclick = (e) => { e.stopPropagation(); clearInterval(typing); i = lines.length; show(); };
      show();
    });
  }

  choose(choice) {
    return new Promise((resolve) => {
      const dlg = $('#dialog');
      dlg.classList.add('show');
      dlg.classList.add('narr');
      $('#dlg-portrait').className = '';
      $('#dlg-name').textContent = 'Ваше решение';
      $('#dlg-text').textContent = choice.prompt;
      const box = $('#dlg-choices');
      box.innerHTML = '';
      dlg.onclick = null;
      choice.options.forEach((o, idx) => {
        const b = document.createElement('button');
        b.className = 'btn';
        const r = o.reward || {};
        b.innerHTML = `${esc(o.label)}<small>${r.gems ? `💎 ${r.gems}` : ''}${r.gold ? ` золото и зерно +${fmt(r.gold)}` : ''}</small>`;
        b.onclick = (e) => { e.stopPropagation(); box.innerHTML = ''; dlg.classList.remove('show'); resolve(idx); };
        box.appendChild(b);
      });
    });
  }
}

function fill(s, me) {
  return String(s).replaceAll('{name}', me?.username || 'правитель').replaceAll('{castle}', me?.name || '');
}
