const API_BASE = window.API_BASE || '/api';

function getToken() { return localStorage.getItem('tf_token'); }
function getUser()  { return JSON.parse(localStorage.getItem('tf_user') || 'null'); }

async function api(method, endpoint, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  const token = getToken();
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  try {
    const r = await fetch(API_BASE + endpoint, opts);
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
  me: () => api('GET', '/auth/me'),
  updateMe: (b) => api('PUT', '/auth/me', b),
  password: (b) => api('PUT', '/auth/password', b),
  shipments: () => api('GET', '/shipments'),
  shipment: (id) => api('GET', '/shipments/' + id),
  createShipment: (b) => api('POST', '/shipments', b),
  updateShipment: (id, b) => api('PUT', '/shipments/' + id, b),
  deleteShipment: (id) => api('DELETE', '/shipments/' + id),
  addCost: (id, b) => api('POST', '/shipments/' + id + '/costs', b),
  addHold: (id, b) => api('POST', '/shipments/' + id + '/holds', b),
  saveITACS: (id, b) => api('PUT', '/shipments/' + id + '/itacs', b),
  fdaRefusals: (p) => api('GET', '/fda/refusals'),
  fdaSummary: () => api('GET', '/fda/summary'),
  fdaAlerts: () => api('GET', '/fda/alerts'),
  fdaFirm: (n) => api('GET', '/fda/firm?name=' + encodeURIComponent(n)),
  fdaCharges: () => api('GET', '/fda/charges'),
  tracking: (id) => api('GET', '/tracking/' + id),
  trackingRefresh: (id) => api('POST', '/tracking/' + id + '/refresh'),
  detectCarrier: (n) => api('GET', '/tracking/detect/' + n),
};
window.API = API;
window.getUser = getUser;
window.getToken = getToken;
