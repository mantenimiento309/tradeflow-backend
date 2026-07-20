const API_BASE = window.API_BASE || '/api';

function getToken() { return localStorage.getItem('tf_token'); }
function getUser()  { return JSON.parse(localStorage.getItem('tf_user') || 'null'); }

function qs(params) {
  const q = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== '') q.set(k, v);
  });
  const s = q.toString();
  return s ? '?' + s : '';
}

async function api(method, endpoint, body) {
  const opts = {
    method,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    }
  };
  const token = getToken();
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  try {
    let url = API_BASE + endpoint;
    if (method === 'GET') {
      url += (url.includes('?') ? '&' : '?') + '__ts=' + Date.now();
    }
    const r = await fetch(url, opts);
    const data = await r.json();
    if (r.status === 401) {
      localStorage.clear();
      window.location.href = 'index.html';
      return { ok: false, msg: 'Sesión expirada' };
    }
    return data;
  } catch (err) {
    return { ok: false, msg: 'Error de conexión: ' + err.message };
  }
}

const API = {
  register: (b) => api('POST', '/auth/register', b),
  login: (b) => api('POST', '/auth/login', b),
  guest: () => api('POST', '/auth/guest', {}),
  forgotPassword: (b) => api('POST', '/auth/forgot-password', b),
  resetPassword: (b) => api('POST', '/auth/reset-password', b),
  me: () => api('GET', '/auth/me'),
  updateMe: (b) => api('PUT', '/auth/me', b),
  password: (b) => api('PUT', '/auth/password', b),
  fdaRefusals: (p) => api('GET', '/fda/refusals' + qs(p || {})),
  fdaSummary: (p) => api('GET', '/fda/summary' + qs(p || {})),
  fdaStatus: (p) => api('GET', '/fda/status' + qs(p || {})),
  fdaAlerts: () => api('GET', '/fda/alerts'),
  fdaFirm: (n, p) => api('GET', '/fda/firm' + qs({ ...(p || {}), name: n })),
  fdaCharges: () => api('GET', '/fda/charges'),
  fdaEntries: (p) => api('GET', '/fda/entries' + qs(p || {})),
  fdaEntriesFirm: (n) => api('GET', '/fda/entries/firm' + qs({ name: n })),
  fdaEntriesSummary: (p) => api('GET', '/fda/entries/summary' + qs(p || {})),
  fdaEntriesStatus: () => api('GET', '/fda/entries/status'),
  fdaCompliance: (p) => api('GET', '/fda/compliance' + qs(p || {})),
  fdaInspections: (p) => api('GET', '/fda/inspections' + qs(p || {})),
  fdaProp65: (p) => api('GET', '/fda/prop65' + qs(p || {})),
  fdaProp65Status: () => api('GET', '/fda/prop65/status'),
};
window.API = API;
window.getUser = getUser;
window.getToken = getToken;
