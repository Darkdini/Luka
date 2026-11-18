// HTTP-клиент к серверу + токен в localStorage (с защитой от приватного режима).
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } },
};

export let token = store.get('ck_token');
export function setToken(t) { token = t; store.set('ck_token', t); }

async function req(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await r.json(); } catch { data = { error: 'Нет связи с сервером' }; }
  if (!r.ok) {
    const e = new Error(data.error || 'Ошибка');
    e.status = r.status;
    throw e;
  }
  return data;
}

export const api = {
  register: (d) => req('POST', '/api/register', d),
  captcha: () => req('GET', '/api/captcha'),
  login: (d) => req('POST', '/api/login', d),
  me: () => req('GET', '/api/me'),
  act: (action, args = {}) => req('POST', '/api/action', { ...args, action }),
  region: (x0, y0, x1, y1) => req('GET', `/api/world/region?x0=${x0}&y0=${y0}&x1=${x1}&y1=${y1}`),
  find: (q) => req('GET', '/api/world/find?q=' + encodeURIComponent(q)),
  profile: (id) => req('GET', '/api/profile/' + id),
  saveProfile: (d) => req('POST', '/api/profile', d),
  player: (id) => req('GET', '/api/player/' + id),
  attackStart: (target) => req('POST', '/api/attack/start', { target }),
  attackFinish: (battleId, log) => req('POST', '/api/attack/finish', { battleId, log }),
  top: () => req('GET', '/api/top'),
  shop: () => req('GET', '/api/shop'),
  buy: (pack) => req('POST', '/api/shop/buy', { pack }),
};

export { store };
