// Почтовый ящик игрока (чистые функции, без зависимостей — подключается отовсюду).
// Разделы: msg — сообщения, ally — отчёт союза, battle — боевой отчёт,
// event — событие, notice — игровое уведомление, report — игровой отчёт.
export const MAIL_CATS = ['msg', 'ally', 'battle', 'event', 'notice', 'report'];
export const MAIL_MAX = 80;

// Положить письмо: { title, text, gift?, battle?, from?, fromId?, race? }
export function mail(s, cat, m) {
  s.mail ||= [];
  s.mailSeq = (s.mailSeq || 0) + 1;
  s.mail.unshift({ id: s.mailSeq, cat, ts: Date.now(), read: false, ...m });
  while (s.mail.length > MAIL_MAX) {
    // первыми уходят старые прочитанные письма без невзятых подарков
    let i = -1;
    for (let k = s.mail.length - 1; k >= 0; k--) { const x = s.mail[k]; if (x.read && (!x.gift || x.claimed)) { i = k; break; } }
    s.mail.splice(i >= 0 ? i : s.mail.length - 1, 1);
  }
}

// Приветственные письма новому (и старому — при первом заходе после обновления) игроку
export function migrateMail(s, mentor) {
  if (s.mail) return;
  s.mail = [];
  mail(s, 'notice', { title: 'Добро пожаловать в Пепел Короны!', text: 'Правитель, королевство в руинах, но корона ещё не потеряна. Примите дары на первые шаги: самоцветы и ускорения стройки.\n\nСовет: держите строителей занятыми, отстраивайте Цитадель — от её уровня зависит всё остальное.', gift: { gems: 100, sp_5m: 3, spb_5m: 2 } });
  mail(s, 'msg', { title: 'Письмо наставника', from: mentor || 'Наставник', text: 'Милорд, я буду рядом. Слева под вашим гербом — очереди строителей, обучения, науки и походов: зелёный круг значит, что кто-то бездельничает.\n\nМеню справа скрывает остальное: сумку, почту, союз и рейтинги. А компас внизу ведёт на карту мира.' });
}
