// Правила имён и фильтр мата (общие для сервера и клиента).

export const USERNAME_RE = /^[A-Za-z0-9_]{5,16}$/;
export const PASSWORD_MIN = 5;

// Корни: русские (после приведения к кириллице) и латинские/транслит
const RU = ['хуй', 'хуе', 'хуё', 'хуя', 'хуи', 'пизд', 'пезд', 'ебат', 'ебан', 'ебал', 'ебун', 'ебл', 'уеб', 'заеб', 'наеб', 'выеб', 'отъеб', 'бля', 'сука', 'суки', 'сучк', 'мудак', 'мудил', 'пидор', 'пидар', 'педик', 'гандон', 'залуп', 'шлюх', 'дроч', 'манда', 'мандой', 'хер', 'жоп', 'говн', 'нахуй', 'шалав', 'чмо', 'даун', 'гитлер', 'нацист'];
const EN = ['fuck', 'fuk', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'nigger', 'nigga', 'faggot', 'whore', 'slut', 'asshole', 'bastard', 'rape', 'nazi', 'hitler', 'porn', 'penis', 'vagina', 'retard',
  'huy', 'hui', 'xuy', 'xui', 'huj', 'pizd', 'pisd', 'pezd', 'blya', 'blyat', 'blyad', 'bljad', 'suka', 'cyka', 'eban', 'ebat', 'yeban', 'ebal', 'mudak', 'mudil', 'pidor', 'pidar', 'pidr', 'gandon', 'zalup', 'shluh', 'shlyuh', 'droch', 'nahui', 'nahuy', 'zhop', 'govn', 'chmo'];
// Слова, которые содержат корень, но приличные
const SAFE = ['херсон', 'мандарин', 'команда', 'скипидар', 'хлебал', 'истребля', 'употребля', 'оскорбля', 'колеблю', 'корабля', 'рубля', 'дауншифт', 'peacock', 'hancock', 'scunthorpe', 'shitake', 'cocktail', 'dickens', 'grape', 'drape', 'therapist', 'sukhoi', 'shuisky', 'chui', 'schuh', 'hughes'];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 6: 'b', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i' };
// латиница/цифры, похожие на кириллицу
const TO_CYR = { a: 'а', b: 'б', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у', u: 'и', i: 'и', n: 'п', 3: 'з', 0: 'о', 6: 'б', '@': 'а' };
// кириллица -> латиница (для транслита и смешанных слов)
const TO_LAT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

const squeeze = (s) => s.replace(/(.)\1+/g, '$1');

function variants(text) {
  const low = String(text || '').toLowerCase().replace(/ё/g, 'е');
  const lat = squeeze([...low].map((ch) => LEET[ch] ?? TO_LAT[ch] ?? ch).join('').replace(/[^a-z]/g, ''));
  const cyr = squeeze([...low].map((ch) => (/[а-я]/.test(ch) ? ch : TO_CYR[ch] ?? (/[a-z]/.test(ch) ? '#' : ''))).join(''));
  return { lat, cyr, low };
}

export function hasProfanity(text) {
  const { lat, cyr, low } = variants(text);
  let l = lat, c = cyr;
  for (const w of SAFE) {
    if (!low.includes(w)) continue;
    const v = variants(w);
    l = l.split(v.lat).join('#'); c = c.split(v.cyr).join('#');
  }
  return RU.some((r) => c.includes(squeeze(r))) || EN.some((r) => l.includes(squeeze(r)));
}

// Для чата: заменяем «плохие» слова звёздочками, остальное оставляем
export function censor(text) {
  return String(text).split(/(\s+)/).map((w) => (/\S/.test(w) && hasProfanity(w) ? '★'.repeat(Math.min(6, w.length)) : w)).join('');
}

export function checkUsername(name) {
  if (typeof name !== 'string' || !USERNAME_RE.test(name)) return 'Ник: 5–16 символов, только английские буквы, цифры и _';
  if (hasProfanity(name)) return 'Такой ник недопустим — выберите приличный';
  return null;
}

export function checkPassword(p) {
  if (typeof p !== 'string' || p.length < PASSWORD_MIN || p.length > 72) return `Пароль: от ${PASSWORD_MIN} символов`;
  return null;
}

export function checkCastleName(n) {
  const v = String(n || '').trim();
  if (v.length < 3 || v.length > 24) return 'Название замка: от 3 до 24 символов';
  if (!/^[A-Za-zА-Яа-яЁё0-9 _'\-]+$/.test(v)) return 'Название замка: только буквы, цифры, пробел, дефис';
  if (hasProfanity(v)) return 'Такое название недопустимо';
  return null;
}
