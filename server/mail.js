// Почта: действия (прочитать, забрать подарки, удалить, написать игроку) и вид для клиента.
import { getPlayer, savePlayer } from './db.js';
import { actions, GameError, grant } from './game.js';
import { mail, MAIL_CATS, MAIL_MAX } from './mailbox.js';
import { censor } from '../shared/names.js';

const fail = (m) => { throw new GameError(m); };
const pick = (s, id, cat) => (s.mail || []).filter((m) => (id != null ? m.id === +id : MAIL_CATS.includes(cat) && m.cat === cat));

export function mailView(s) {
  return { mail: (s.mail || []).slice(0, MAIL_MAX) };
}

Object.assign(actions, {
  // { id } или { cat } — отметить прочитанным
  mailRead(s, { id, cat }) {
    for (const m of pick(s, id, cat)) m.read = true;
    return {};
  },
  // { id } или { cat } — забрать подарки
  mailClaim(s, { id, cat }) {
    const got = {};
    for (const m of pick(s, id, cat)) {
      if (!m.gift || m.claimed) continue;
      m.claimed = true; m.read = true;
      for (const [k, v] of Object.entries(grant(s, m.gift))) got[k] = (got[k] || 0) + v;
    }
    if (!Object.keys(got).length) fail('Подарков нет');
    return { got };
  },
  // { id } — удалить письмо; { cat } — удалить прочитанные письма раздела
  mailDel(s, { id, cat }) {
    const list = pick(s, id, cat);
    if (id != null && list.some((m) => m.gift && !m.claimed)) fail('Сначала заберите подарок из письма');
    const del = new Set(list.filter((m) => id != null || (m.read && (!m.gift || m.claimed))));
    s.mail = (s.mail || []).filter((m) => !del.has(m));
    return { n: del.size };
  },
  // { to, text } — личное письмо другому правителю
  mailSend(s, { to, text }) {
    const t = getPlayer(+to);
    if (!t || t.id === s._pid) fail('Получатель не найден');
    const body = censor(String(text || '').trim().slice(0, 500));
    if (body.length < 2) fail('Напишите хотя бы пару слов');
    const now = Date.now();
    s.mailOut = (s.mailOut || []).filter((ts) => now - ts < 3600e3);
    if (s.mailOut.length >= 15) fail('Слишком много писем за час — передохните');
    s.mailOut.push(now);
    mail(t.state, 'msg', { title: `Письмо от ${s._name}`, from: s._name, fromId: s._pid, race: s.race, text: body });
    savePlayer(t, false);
    mail(s, 'msg', { title: `Вы → ${t.castle_name}`, to: t.castle_name, toId: t.id, race: t.state.race, text: body, read: true, sent: true });
    return {};
  },
});
