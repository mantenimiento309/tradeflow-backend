const DEMO_EMAIL = 'alimentos@tradeflow.sv';
const DEMO_COMPANY = 'Consulta rápida FDA';
const DEMO_IOR = 'Sin registrar';
const DEMO_PROMPT_MIN_UNIQUE_PAGES = 1;
const DEMO_PROMPT_TIME_MS = 16000;
const DEMO_PROMPT_COOLDOWN_MS = 22000;
const DEMO_PROMPT_NAV_INTERVAL = 2;
const DEMO_PROMPT_MAX_PER_SESSION = 12;
const DEMO_RESTRICTED_PAGES = new Set(['mi-fda', 'referencia', 'perfil']);
const DEMO_RESTRICTED_SUBS = new Set(['intel-rechazos', 'intel-alerts']);
let demoPromptIntervalId = null;

(function redirectResetLinksAwayFromDashboard() {
  const params = new URLSearchParams(window.location.search || '');
  const requested = String(params.get('tab') || '').toLowerCase();
  const token = params.get('token') || '';
  if (requested === 'reset' || token) {
    const qs = new URLSearchParams();
    qs.set('auth', '1');
    qs.set('tab', 'reset');
    if (token) qs.set('token', token);
    window.location.replace('index.html?' + qs.toString());
  }
})();

function isDemoMode() {
  const user = getUser && getUser();
  return localStorage.getItem('tf_demo_mode') === '1' || (user && user.email === DEMO_EMAIL);
}

function currentCompany() {
  const user = getUser && getUser();
  return isDemoMode() ? 'Consulta rápida FDA' : (user?.company || '');
}


let lastFdaSignature = null;
let fdaMonitorId = null;

function fdaSignatureFromStatus(status = {}) {
  if (status.dataVersion) return String(status.dataVersion);
  const counts = status.counts || {};
  return [
    counts.filteredCountryRefusals ?? counts.totalRefusals ?? '',
    counts.alerts ?? '',
    counts.charges ?? ''
  ].join('|');
}

function rememberFdaSignature(status = {}) {
  const sig = fdaSignatureFromStatus(status);
  if (sig.replace(/\|/g, '')) lastFdaSignature = sig;
}

function activePageName() {
  const active = document.querySelector('.page.active');
  return active ? String(active.id || '').replace(/^page-/, '') : 'mi-dashboard';
}

function clearFdaLoadedFlags() {
  const dash = document.getElementById('dash-content');
  if (dash) delete dash.dataset.loaded;
  const tbody = document.getElementById('rf-tbody');
  if (tbody) delete tbody.dataset.loaded;
  const alerts = document.getElementById('alerts-content');
  if (alerts) delete alerts.dataset.loaded;
}

async function refreshCurrentFdaView(reason = '') {
  clearFdaLoadedFlags();
  const page = activePageName();
  if (page === 'mi-dashboard') await loadMyDashboard();
  else if (page === 'mi-fda') await loadMyFDA();
  else if (page === 'inteligencia') {
    const activeSub = document.querySelector('#page-inteligencia .sub-pane.active');
    const subId = activeSub ? activeSub.id.replace(/^sub-/, '') : 'intel-dash';
    if (subId === 'intel-rechazos') await loadRefusals();
    else if (subId === 'intel-alerts') await loadAlerts();
    else await loadIntelDash();
  } else if (page === 'referencia') await loadReferencia();
  if (reason) toast(reason, 'ok');
}

window.forceRefreshFdaViews = async function forceRefreshFdaViews() {
  lastFdaSignature = null;
  await checkFdaFreshness(true);
};

async function checkFdaFreshness(force = false) {
  if (!getToken()) return;
  const status = await API.fdaStatus({ country: 'El Salvador', t: Date.now() });
  if (!status || !status.ok) return;
  const sig = fdaSignatureFromStatus(status);
  if (!lastFdaSignature) {
    lastFdaSignature = sig;
    if (force) await refreshCurrentFdaView('Datos FDA actualizados en pantalla.');
    return;
  }
  if (force || (sig && sig !== lastFdaSignature)) {
    const prev = lastFdaSignature;
    lastFdaSignature = sig;
    if (sig !== prev || force) await refreshCurrentFdaView('Datos FDA actualizados en pantalla.');
  }
}

function startFdaMonitor() {
  if (fdaMonitorId) return;
  fdaMonitorId = window.setInterval(() => checkFdaFreshness(false), 10000);
  window.addEventListener('focus', () => checkFdaFreshness(false));
}

async function refreshLoggedUserFromServer() {
  if (!getToken() || isDemoMode()) return;
  const data = await API.me();
  if (!data || !data.ok || !data.user) return;
  localStorage.setItem('tf_user', JSON.stringify(data.user));
  const companyEl = document.getElementById('ub-company');
  if (companyEl) companyEl.textContent = data.user.company || 'Empresa';
  const iorEl = document.getElementById('ub-ior');
  if (iorEl) iorEl.textContent = data.user.ior_number || 'No registrado';
}

async function bootApp() {
  await refreshLoggedUserFromServer();
  showPage('mi-dashboard', { initial: true });
  startFdaMonitor();
  setTimeout(() => checkFdaFreshness(false), 1200);
}

function goAuth(tab = 'register') {
  localStorage.removeItem('tf_token');
  localStorage.removeItem('tf_user');
  localStorage.removeItem('tf_demo_mode');
  window.location.href = 'index.html?tab=' + encodeURIComponent(tab === 'login' ? 'login' : 'register');
}

function setAuthUiMode(demo) {
  const demoTop = document.getElementById('demo-auth-actions');
  const accountTop = document.getElementById('account-actions');
  const mobileDemo = document.getElementById('mobile-demo-actions');
  const mobileAccount = document.getElementById('mobile-account-actions');

  if (demoTop) demoTop.style.display = demo ? 'flex' : 'none';
  if (accountTop) accountTop.style.display = demo ? 'none' : 'flex';
  if (mobileDemo) mobileDemo.style.display = demo ? 'flex' : 'none';
  if (mobileAccount) mobileAccount.style.display = demo ? 'none' : 'flex';
  if (document.body) document.body.classList.toggle('demo-mode', !!demo);
  if (demo) startDemoPromptLoop();
  else stopDemoPromptLoop();
}

function startDemoPromptLoop() {
  if (demoPromptIntervalId) return;
  demoPromptIntervalId = window.setInterval(() => {
    maybeShowDemoAuthPrompt('', { time: true });
  }, 36000);
}
function stopDemoPromptLoop() {
  if (!demoPromptIntervalId) return;
  window.clearInterval(demoPromptIntervalId);
  demoPromptIntervalId = null;
}

function promptShownCount() {
  return Number(sessionStorage.getItem('tf_demo_auth_prompt_count') || '0') || 0;
}
function incrementPromptShownCount() {
  sessionStorage.setItem('tf_demo_auth_prompt_count', String(promptShownCount() + 1));
}
function setPromptCooldown(ms = DEMO_PROMPT_COOLDOWN_MS) {
  sessionStorage.setItem('tf_demo_auth_prompt_next_at', String(Date.now() + ms));
}
function promptCooldownReady() {
  const nextAt = Number(sessionStorage.getItem('tf_demo_auth_prompt_next_at') || '0') || 0;
  return Date.now() >= nextAt;
}
function setAuthPromptCopy(kind = 'default', feature = '') {
  const kicker = document.getElementById('demo-signup-kicker');
  const title = document.getElementById('demo-signup-title');
  const text = document.getElementById('demo-signup-text');
  const foot = document.getElementById('demo-signup-footnote');
  if (kind === 'restricted') {
    if (kicker) kicker.textContent = 'Cuenta requerida';
    if (title) title.textContent = '¿Te está gustando lo que ves?';
    if (text) text.textContent = `${feature || 'Esta sección'} está disponible para usuarios registrados. Crea una cuenta o inicia sesión para desbloquear la vista completa con tu empresa real.`;
    if (foot) foot.textContent = 'La consulta rápida sigue abierta; las vistas completas, perfil y seguimiento por empresa se activan con cuenta.';
    return;
  }
  if (kicker) kicker.textContent = 'Vista demo';
  if (title) title.textContent = '¿Te está gustando lo que ves?';
  if (text) text.textContent = 'La consulta rápida de invitado te deja buscar en la información FDA SV sin registrar empresa. Crea una cuenta para guardar tu empresa, ver historial completo y desbloquear herramientas avanzadas.';
  if (foot) foot.textContent = 'Invitado no crea empresa ni carga datos ficticios: solo consulta la información pública FDA de El Salvador.';
}

function openAuthPrompt(opts = {}) {
  const modal = document.getElementById('demo-signup-modal');
  if (!modal) return;
  setAuthPromptCopy(opts.kind || 'default', opts.feature || '');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  if (!opts.manual) incrementPromptShownCount();
}

function closeAuthPrompt(setCooldown = true) {
  const modal = document.getElementById('demo-signup-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  if (setCooldown) setPromptCooldown();
}

function openDemoSignupModal() {
  openAuthPrompt({ manual: true });
}

function closeDemoSignupModal(setCooldown = true) {
  closeAuthPrompt(setCooldown);
}

function continueDemo() {
  closeAuthPrompt(true);
}

function openRestrictedPrompt(feature) {
  setPromptCooldown(Math.min(DEMO_PROMPT_COOLDOWN_MS, 12000));
  openAuthPrompt({ kind: 'restricted', feature, manual: false });
}

function maybeShowDemoAuthPrompt(pageName = '', opts = {}) {
  if (!isDemoMode()) return;
  if (document.getElementById('demo-signup-modal')?.classList.contains('open')) return;
  if (!opts.force && promptShownCount() >= DEMO_PROMPT_MAX_PER_SESSION) return;

  let visited = [];
  try { visited = JSON.parse(sessionStorage.getItem('tf_demo_pages_visited') || '[]'); }
  catch (_) { visited = []; }

  if (pageName && !visited.includes(pageName)) {
    visited.push(pageName);
    sessionStorage.setItem('tf_demo_pages_visited', JSON.stringify(visited.slice(-10)));
  }

  if (pageName) {
    const navCount = (Number(sessionStorage.getItem('tf_demo_nav_count') || '0') || 0) + 1;
    sessionStorage.setItem('tf_demo_nav_count', String(navCount));
  }

  if (opts.force) {
    openAuthPrompt({ kind: opts.kind || 'default', feature: opts.feature || '' });
    return;
  }

  if (opts.initial) {
    window.setTimeout(() => maybeShowDemoAuthPrompt('', { time: true }), DEMO_PROMPT_TIME_MS);
    return;
  }

  if (!promptCooldownReady()) return;
  if (visited.length < DEMO_PROMPT_MIN_UNIQUE_PAGES && !opts.time) return;
  const navCount = Number(sessionStorage.getItem('tf_demo_nav_count') || '0') || 0;
  const dueByNavigation = navCount > 0 && navCount % DEMO_PROMPT_NAV_INTERVAL === 0;
  const dueByTime = !!opts.time;
  if (!dueByNavigation && !dueByTime) return;
  if (sessionStorage.getItem('tf_demo_auth_prompt_pending') === '1') return;

  sessionStorage.setItem('tf_demo_auth_prompt_pending', '1');
  window.setTimeout(() => {
    sessionStorage.removeItem('tf_demo_auth_prompt_pending');
    if (isDemoMode() && promptCooldownReady() && promptShownCount() < DEMO_PROMPT_MAX_PER_SESSION) openAuthPrompt();
  }, 450);
}

function renderDemoLockedPanel(feature = 'Esta sección') {
  return `<div class="locked-demo-panel">
    <div class="locked-demo-icon">Cuenta</div>
    <div class="locked-demo-title">${esc(feature)} requiere iniciar sesión</div>
    <div class="locked-demo-text">La consulta rápida de invitado queda disponible sin crear empresa. Para historial completo, perfil guardado, variantes de razón social y herramientas avanzadas, crea una cuenta o inicia sesión.</div>
    <div class="locked-demo-actions">
      <button class="demo-signup-btn primary" type="button" onclick="goAuth('register')">Registrarse</button>
      <button class="demo-signup-btn" type="button" onclick="goAuth('login')">Iniciar sesión</button>
      <button class="demo-signup-btn ghost" type="button" onclick="openDemoSignupModal()">Ver opciones</button>
    </div>
  </div>`;
}


(function checkAuth() {
  if (!localStorage.getItem('tf_token')) {
    window.location.href = 'index.html';
    return;
  }
  const user = getUser();
  if (!user) return;
  if (isDemoMode()) {
    // Invitado = consulta rápida. No simulamos una empresa ni precargamos rechazos ficticios.
    localStorage.setItem('tf_demo_mode', '1');
  }
  const companyEl = document.getElementById('ub-company');
  if (companyEl) companyEl.textContent = currentCompany() || 'Empresa';
  const iorEl = document.getElementById('ub-ior');
  if (iorEl) iorEl.textContent = isDemoMode() ? DEMO_IOR : (user.ior_number || 'No registrado');
  const roleEl = document.getElementById('ub-role-badge');
  if (roleEl && user.role === 'admin') {
    roleEl.innerHTML = '<span class="tag blue" style="font-size:9px;margin-left:8px">ADMIN</span>';
  }
  setAuthUiMode(isDemoMode());
})();

function doLogout() {
  localStorage.clear();
  window.location.href = 'index.html';
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeAuthPrompt(true);
});
function fmt(n) { return Number(n || 0).toLocaleString('es-SV'); }
function fmtDate(d) { return d ? String(d).substring(0, 10) : '\u2014'; }
function esc(v) {
  return String(v ?? '').replace(/[&<>'"]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[ch]));
}
function tag(text, color) { return `<span class="tag ${color}">${esc(text)}</span>`; }
function catColor(cat = '') {
  const c = String(cat).toLowerCase();
  if (c.includes('food')) return 'red';
  if (c.includes('drug')) return 'amber';
  if (c.includes('cosmetic')) return 'blue';
  return 'neutral';
}
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show ' + type;
  setTimeout(() => el.classList.remove('show'), 3000);
}


function asNum(v) { return Number(v || 0) || 0; }
function percent(v, total) {
  const t = asNum(total);
  return t ? Math.round((asNum(v) / t) * 100) : 0;
}
function parseChargeList(value) {
  return String(value || '').split(',').map(x => x.trim()).filter(Boolean);
}
function countByYearFromRows(rows) {
  const out = {};
  for (const r of rows || []) {
    const year = String(r.RefusalDate || '').substring(0, 4);
    if (/^\d{4}$/.test(year)) out[year] = (out[year] || 0) + 1;
  }
  return out;
}
function countChargesFromRows(rows) {
  const out = {};
  for (const r of rows || []) {
    for (const ch of parseChargeList(r.RefusalCharges)) out[ch] = (out[ch] || 0) + 1;
  }
  return Object.entries(out).sort((a, b) => b[1] - a[1]);
}
function renderMiniBars(entries, opts = {}) {
  const rows = (entries || []).filter(Boolean).slice(0, opts.limit || 8);
  if (!rows.length) return `<div class="empty-viz">Sin datos suficientes.</div>`;
  const max = Math.max(...rows.map(r => asNum(Array.isArray(r) ? r[1] : r.cnt)), 1);
  const tone = opts.tone || 'red';
  return `<div class="dash-bar-list">${rows.map((row) => {
    const label = Array.isArray(row) ? row[0] : (row.name || row.key || 'N/A');
    const count = Array.isArray(row) ? row[1] : row.cnt;
    const w = Math.max(5, Math.round((asNum(count) / max) * 100));
    return `<div class="dash-bar-row">
      <div class="dash-bar-label" title="${esc(label)}">${esc(label)}</div>
      <div class="dash-bar-track"><div class="dash-bar-fill ${tone}" style="width:${w}%"><span>${fmt(count)}</span></div></div>
    </div>`;
  }).join('')}</div>`;
}
function renderYearBars(years, opts = {}) {
  const arr = Object.entries(years || {}).filter(([y]) => /^\d{4}$/.test(y)).sort((a, b) => a[0].localeCompare(b[0]));
  const rows = arr.slice(-(opts.limit || 8));
  if (!rows.length) return `<div class="empty-viz">Sin historial por año.</div>`;
  const max = Math.max(...rows.map(([, v]) => asNum(v)), 1);
  return `<div class="dash-year-chart">${rows.map(([yr, val], idx) => {
    const h = Math.max(6, Math.round((asNum(val) / max) * 100));
    const last = idx === rows.length - 1;
    return `<div class="dash-year-col"><div class="dash-year-val">${fmt(val)}</div><div class="dash-year-fill ${last ? 'current' : ''}" style="height:${h}%"></div><div class="dash-year-label">${esc(yr)}</div></div>`;
  }).join('')}</div>`;
}
function renderCategoryDonut(cats = {}) {
  const parts = [
    ['Human Foods', 'Alimentos', 'var(--red)'],
    ['Drugs and Biologics', 'Medicamentos', 'var(--blue)'],
    ['Cosmetics', 'Cosméticos', 'var(--amber)'],
    ['Other', 'Otros', 'var(--ink5)']
  ].map(([key, label, color]) => ({ key, label, color, value: asNum(cats[key]) }));
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (!total) return `<div class="empty-viz">Sin datos por categoría.</div>`;
  let cursor = 0;
  const gradient = parts.map(part => {
    const start = cursor;
    cursor += (part.value / total) * 100;
    return `${part.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  }).join(', ');
  return `<div class="donut-layout">
    <div class="donut" style="background:conic-gradient(${gradient})"><div class="donut-hole"><strong>${fmt(total)}</strong><span>SV</span></div></div>
    <div class="donut-legend">${parts.map(part => `<div class="donut-legend-row"><span class="legend-dot" style="background:${part.color}"></span><span>${esc(part.label)}</span><strong>${fmt(part.value)}</strong><em>${percent(part.value, total)}%</em></div>`).join('')}</div>
  </div>`;
}
function renderSyncStatus(statusData = {}) {
  const counts = statusData.counts || {};
  const filtered = asNum(counts.filteredCountryRefusals ?? counts.totalRefusals);
  return `<div class="fda-sync-card">
    <div class="sync-pill ok">FDA</div>
    <div class="sync-main">
      <div class="sync-title">Información FDA SV</div>
      <div class="sync-copy">${fmt(filtered)} rechazos · ${fmt(counts.alerts || 0)} alertas · ${fmt(counts.charges || 0)} códigos de referencia</div>
      <div class="sync-foot">Datos públicos filtrados para El Salvador.</div>
      <button type="button" class="tiny-action" onclick="forceRefreshFdaViews()">Actualizar datos en pantalla</button>
    </div>
  </div>`;
}
function renderDashboardVisuals({ cats, years, topCharges, topFirms, byDistrict, firmRefusals, statusData }) {
  const firmYears = countByYearFromRows(firmRefusals || []);
  const firmCharges = countChargesFromRows(firmRefusals || []);
  return `<div class="viz-grid">
    <div class="panel viz-card span-2">
      <div class="panel-header"><div class="panel-title">Mapa visual FDA SV</div><div class="panel-meta">categorías</div></div>
      <div class="panel-body viz-split">
        ${renderCategoryDonut(cats)}
        ${renderSyncStatus(statusData)}
      </div>
    </div>
    <div class="panel viz-card">
      <div class="panel-header"><div class="panel-title">Tendencia SV</div><div class="panel-meta">por año fiscal</div></div>
      <div class="panel-body">${renderYearBars(years, { limit: 9 })}</div>
    </div>
    <div class="panel viz-card">
      <div class="panel-header"><div class="panel-title">Causas frecuentes SV</div><div class="panel-meta">top cargos</div></div>
      <div class="panel-body">${renderMiniBars(topCharges, { limit: 7, tone: 'red' })}</div>
    </div>
    <div class="panel viz-card">
      <div class="panel-header"><div class="panel-title">Empresas con más rechazos SV</div><div class="panel-meta">contexto mercado</div></div>
      <div class="panel-body">${renderMiniBars(topFirms, { limit: 7, tone: 'amber' })}</div>
    </div>
    <div class="panel viz-card">
      <div class="panel-header"><div class="panel-title">Distritos FDA frecuentes</div><div class="panel-meta">puertos/distritos</div></div>
      <div class="panel-body">${renderMiniBars(byDistrict, { limit: 7, tone: 'blue' })}</div>
    </div>
    <div class="panel viz-card span-2">
      <div class="panel-header"><div class="panel-title">Historial de su empresa</div><div class="panel-meta">${firmRefusals?.length ? 'años con incidencia' : 'sin registros'}</div></div>
      <div class="panel-body">${firmRefusals?.length ? renderYearBars(firmYears, { limit: 6 }) + `<div class="mini-section-title">Cargos principales</div>${renderMiniBars(firmCharges, { limit: 4, tone: 'blue' })}` : '<div class="empty-viz">No hay rechazos para graficar en esta empresa.</div>'}</div>
    </div>
  </div>`;
}


function renderGuestDashboardVisuals({ cats, years, topCharges, topFirms, byDistrict, statusData }) {
  return `<div class="viz-grid">
    <div class="panel viz-card span-2">
      <div class="panel-header"><div class="panel-title">Mapa visual FDA SV</div><div class="panel-meta">categorías</div></div>
      <div class="panel-body viz-split">
        ${renderCategoryDonut(cats)}
        ${renderSyncStatus(statusData)}
      </div>
    </div>
    <div class="panel viz-card">
      <div class="panel-header"><div class="panel-title">Tendencia SV</div><div class="panel-meta">por año fiscal</div></div>
      <div class="panel-body">${renderYearBars(years, { limit: 9 })}</div>
    </div>
    <div class="panel viz-card">
      <div class="panel-header"><div class="panel-title">Causas frecuentes SV</div><div class="panel-meta">top cargos</div></div>
      <div class="panel-body">${renderMiniBars(topCharges, { limit: 7, tone: 'red' })}</div>
    </div>
    <div class="panel viz-card span-2">
      <div class="panel-header"><div class="panel-title">Empresas con más rechazos SV</div><div class="panel-meta">contexto mercado</div></div>
      <div class="panel-body">${renderMiniBars(topFirms, { limit: 8, tone: 'amber' })}</div>
    </div>
    <div class="panel viz-card span-2">
      <div class="panel-header"><div class="panel-title">Distritos FDA frecuentes</div><div class="panel-meta">puertos/distritos</div></div>
      <div class="panel-body">${renderMiniBars(byDistrict, { limit: 8, tone: 'blue' })}</div>
    </div>
  </div>`;
}

function guestResultKey(r = {}) {
  return [r.ShipmentID, r.FirmName, r.ProductCodeDescription, r.RefusalDate, r.RefusalCharges]
    .map(v => String(v || '').trim().toLowerCase()).join('|');
}

function mergeGuestResults(firmRows = [], broadRows = []) {
  const seen = new Set();
  const out = [];
  for (const row of [...firmRows, ...broadRows]) {
    const key = guestResultKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out.sort((a, b) => String(b.RefusalDate || '').localeCompare(String(a.RefusalDate || '')));
}

let _chargesRefCache = null;
async function getChargesRef() {
  if (_chargesRefCache) return _chargesRefCache;
  try {
    const d = await API.fdaCharges();
    const map = {};
    for (const c of (d?.data || [])) {
      if (!c.code) continue;
      map[String(c.code).trim().toUpperCase()] = c.desc_es || c.desc_en || '';
    }
    _chargesRefCache = map;
  } catch (_) {
    _chargesRefCache = {};
  }
  return _chargesRefCache;
}

function chargeTagWithDesc(ch, chargesMap) {
  const key = String(ch || '').trim().toUpperCase();
  const desc = chargesMap?.[key] || '';
  const color = /LISTERIA|SALMONELLA|FILTHY|INSANITARY|PESTICIDE|AFLATOXIN/.test(key) ? 'red' : 'amber';
  const short = desc.length > 72 ? desc.slice(0, 72) + '…' : desc;
  return `<div style="margin-bottom:5px">${tag(ch, color)}${desc ? `<div style="font-size:10px;color:var(--ink3);max-width:220px;line-height:1.35;margin-top:2px" title="${esc(desc)}">${esc(short)}</div>` : ''}</div>`;
}

function renderGuestSearchRows(rows = [], totalHint = 0, chargesMap = null) {
  if (!rows.length) {
    return `<div class="guest-empty-result">
      <strong>Sin coincidencias en la información FDA SV.</strong>
      <span>Prueba con la razón social completa, una palabra del producto, cargo FDA o Shipment ID.</span>
    </div>`;
  }
  const shown = rows.slice(0, 20);
  return `<div class="guest-result-head">
      <div><strong>${fmt(totalHint || rows.length)} coincidencia(s)</strong><span> · vista invitado muestra hasta 20 filas</span></div>
      <button type="button" class="tiny-action" onclick="openRestrictedPrompt('Resultados completos y seguimiento por empresa')">Ver todo</button>
    </div>
    <div class="table-scroll"><table class="data-table guest-results-table">
      <thead><tr><th>Shipment ID</th><th>Empresa</th><th>Producto</th><th>Cargos</th><th>Fecha</th></tr></thead>
      <tbody>${shown.map(r => {
        const refusalCharges = (r.RefusalCharges || '').split(',').map(x => x.trim()).filter(Boolean);
        return `<tr>
          <td style="font-family:var(--font-mono);font-size:11px">${esc(r.ShipmentID || '—')}</td>
          <td><div style="font-weight:700;font-size:12px">${esc(r.FirmName || '—')}</div><div style="font-size:11px;color:var(--ink3)">${esc(r.City || '')}</div></td>
          <td style="font-size:12px;max-width:260px"><div>${esc(r.ProductCodeDescription || '—')}</div><div style="margin-top:4px">${tag(r.ProductCategory || 'N/A', catColor(r.ProductCategory))}</div></td>
          <td>${refusalCharges.slice(0, 4).map(ch => chargesMap ? chargeTagWithDesc(ch, chargesMap) : tag(ch, /LISTERIA|SALMONELLA|FILTHY|INSANITARY|PESTICIDE|AFLATOXIN/.test(ch) ? 'red' : 'amber')).join('')}</td>
          <td style="font-family:var(--font-mono);font-size:11px">${fmtDate(r.RefusalDate)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    ${rows.length > shown.length ? `<div class="guest-limit-note">+${fmt(rows.length - shown.length)} fila(s) adicionales detectadas. Inicia sesión para historial completo, variantes de razón social y monitoreo de tu empresa.</div>` : ''}`;
}

function dispColor(d = '') {
  const s = String(d).toLowerCase();
  if (s.includes('refus') || s.includes('detain')) return 'red';
  if (s.includes('proceed') || s.includes('release')) return 'green';
  if (!s || s === 'pendiente') return 'amber';
  return 'blue';
}

function renderGuestEntriesRows(rows = [], total = 0) {
  if (!rows.length) return '';
  const shown = rows.slice(0, 20);
  return `<div class="guest-result-head" style="margin-top:18px">
      <div><strong>${fmt(total || rows.length)} entry(s) de importación</strong><span> · shipments FDA reales, vista invitado muestra hasta 20</span></div>
    </div>
    <div class="table-scroll"><table class="data-table guest-results-table">
      <thead><tr><th>Shipment ID</th><th>Empresa</th><th>Producto</th><th>Llegada</th><th>Disposición</th><th>Puerto</th></tr></thead>
      <tbody>${shown.map(r => `<tr>
          <td style="font-family:var(--font-mono);font-size:11px">${esc(r.shipment_id || '—')}</td>
          <td><div style="font-weight:700;font-size:12px">${esc(r.manufacturer_name || '—')}</div><div style="font-size:11px;color:var(--ink3)">${esc(r.manufacturer_city || '')}</div></td>
          <td style="font-size:12px;max-width:240px"><div>${esc(r.product_description || '—')}</div><div style="margin-top:4px">${tag(r.product_category || 'N/A', catColor(r.product_category))}</div></td>
          <td style="font-family:var(--font-mono);font-size:11px">${fmtDate(r.arrival_date)}</td>
          <td>${tag(r.final_disposition || 'Pendiente', dispColor(r.final_disposition))}</td>
          <td style="font-size:11px;color:var(--ink3)">${esc((r.port_division || '—').replace('Division of ', ''))}</td>
        </tr>`).join('')}</tbody>
    </table></div>
    ${rows.length > shown.length ? `<div class="guest-limit-note">+${fmt(rows.length - shown.length)} entry(s) adicionales. Inicia sesión para el historial completo de importaciones.</div>` : ''}`;
}

function renderProp65Rows(rows = []) {
  if (!rows.length) return '';
  const shown = rows.slice(0, 20);
  const chemColor = ch => /lead|cadmium|mercury|arsenic|pfoa|pfas|phthalate/i.test(ch) ? 'red' : 'amber';
  return `<div class="guest-result-head" style="margin-top:18px">
      <div><strong>${fmt(rows.length)} aviso(s) Prop 65</strong><span> · 60-Day Notices del Attorney General de California</span></div>
    </div>
    <div class="table-scroll"><table class="data-table guest-results-table">
      <thead><tr><th>AG Number</th><th>Empresa señalada</th><th>Químico</th><th>Producto</th><th>Fecha</th></tr></thead>
      <tbody>${shown.map(r => `<tr>
          <td style="font-family:var(--font-mono);font-size:11px">${esc(r.ag_number || '—')}</td>
          <td style="font-size:12px;max-width:240px"><div style="font-weight:700">${esc(r.alleged_violators || '—')}</div>${r.noticing_party ? `<div style="font-size:10px;color:var(--ink3)">demandante: ${esc(r.noticing_party)}</div>` : ''}</td>
          <td>${(r.chemical || '').split(',').map(c => c.trim()).filter(Boolean).slice(0, 3).map(c => tag(c, chemColor(c))).join(' ')}</td>
          <td style="font-size:12px;max-width:220px">${esc(r.product_source || '—')}</td>
          <td style="font-family:var(--font-mono);font-size:11px">${fmtDate(r.date_filed)}</td>
        </tr>`).join('')}</tbody>
    </table></div>`;
}

async function runGuestQuickSearch() {
  const input = document.getElementById('guest-search-q');
  const box = document.getElementById('guest-search-results');
  if (!input || !box) return;
  const q = input.value.trim();
  if (q.length < 2) {
    box.innerHTML = `<div class="guest-empty-result"><strong>Escribe al menos 2 caracteres.</strong><span>Ejemplo: nombre de empresa, producto, cargo FDA o Shipment ID.</span></div>`;
    input.focus();
    return;
  }
  sessionStorage.setItem('tf_guest_last_query', q);
  maybeShowDemoAuthPrompt('guest-search', { time: true });
  box.innerHTML = `<div class="loading"><div class="spinner"></div>Consultando información FDA SV para “${esc(q)}”...</div>`;
  const [firmData, broadData, entFirmData, entProdData, prop65Data] = await Promise.all([
    API.fdaFirm(q, { country: 'El Salvador' }),
    API.fdaRefusals({ country: 'El Salvador', search: q, limit: 120, offset: 0 }),
    API.fdaEntriesFirm(q),
    API.fdaEntries({ product: q, limit: 60, offset: 0 }),
    API.fdaProp65({ company: q, limit: 20 })
  ]);
  if (!firmData?.ok && !broadData?.ok) {
    box.innerHTML = `<div class="notice danger"><strong>No se pudo consultar.</strong> ${esc(firmData?.msg || broadData?.msg || 'Revise conexión con el backend.')}</div>`;
    return;
  }
  const firmRows = firmData?.data?.results || [];
  const broadRows = broadData?.data?.results || [];
  const merged = mergeGuestResults(firmRows, broadRows);
  const totalHint = Math.max(firmData?.data?.total || 0, broadData?.data?.total || 0, merged.length);
  const variants = firmData?.data?.variants || [];

  const entrySeen = new Set();
  const entryRows = [...(entFirmData?.data?.results || []), ...(entProdData?.data?.results || [])]
    .filter(r => {
      const k = String(r.shipment_id || '').toLowerCase();
      if (!k || entrySeen.has(k)) return false;
      entrySeen.add(k);
      return true;
    })
    .sort((a, b) => String(b.arrival_date || '').localeCompare(String(a.arrival_date || '')));
  const entriesTotal = Math.max(entFirmData?.data?.total || 0, entProdData?.data?.total || 0, entryRows.length);
  const rejectionRate = entriesTotal > 0 ? ((totalHint / entriesTotal) * 100) : null;

  const noRefusals = !merged.length;
  const noEntries = !entryRows.length;
  const prop65Rows = prop65Data?.data?.results || [];
  const noProp65 = !prop65Rows.length;
  const chargesMap = await getChargesRef();

  const refusalsPane = noRefusals
    ? (noEntries && noProp65 ? '' : `<div class="ok-banner" style="margin-top:12px"><strong>Sin rechazos FDA.</strong> Esta búsqueda no tiene refusals registrados.</div>`)
    : renderGuestSearchRows(merged, totalHint, chargesMap);
  const entriesPane = noEntries
    ? `<div class="guest-empty-result" style="margin-top:12px"><strong>Sin entries de importación para esta búsqueda.</strong><span>Los entries cubren shipments desde 2017 sincronizados semanalmente con la FDA.</span></div>`
    : renderGuestEntriesRows(entryRows, entriesTotal);
  const prop65Pane = noProp65
    ? `<div class="guest-empty-result" style="margin-top:12px"><strong>Sin avisos Prop 65 para esta búsqueda.</strong><span>Los avisos de California suelen nombrar al importador o retailer en EE.UU., no al exportador. Prueba buscando por producto o químico.</span></div>`
    : renderProp65Rows(prop65Rows);
  const defaultTab = !noRefusals ? 'refusals' : (!noEntries ? 'entries' : (!noProp65 ? 'prop65' : 'refusals'));

  const tabBtn = (id, label, active) =>
    `<button type="button" id="gtab-${id}" onclick="guestResultTab('${id}')" style="background:none;cursor:pointer;padding:10px 16px;font-size:12px;font-family:var(--font-mono);letter-spacing:.4px;border:none;border-bottom:2px solid ${active ? 'var(--ink)' : 'transparent'};font-weight:${active ? '700' : '400'};color:${active ? 'var(--ink)' : 'var(--ink3)'}">${label}</button>`;

  box.innerHTML = `<div class="guest-result-summary">
      <div class="guest-result-kpi"><span>Refusals</span><strong>${fmt(totalHint)}</strong></div>
      <div class="guest-result-kpi"><span>Entries de importación</span><strong>${fmt(entriesTotal)}</strong></div>
      <div class="guest-result-kpi"><span>Avisos Prop 65</span><strong>${fmt(prop65Rows.length)}</strong></div>
      <div class="guest-result-kpi"><span>Tasa de rechazo</span><strong>${rejectionRate === null ? '—' : (rejectionRate < 0.01 && totalHint === 0 ? '0%' : rejectionRate.toFixed(2) + '%')}</strong></div>
    </div>
    ${variants.length ? `<div class="guest-variants"><strong>Variantes detectadas:</strong> ${variants.slice(0, 6).map(v => `<span>${esc(v.name)} (${fmt(v.cnt)})</span>`).join('')}</div>` : ''}
    ${noRefusals && noEntries && noProp65
      ? `<div class="guest-empty-result"><strong>Sin coincidencias en refusals, entries ni avisos Prop 65.</strong><span>Prueba con la razón social completa, una palabra del producto, cargo FDA o Shipment ID.</span></div>`
      : `<div style="display:flex;gap:2px;border-bottom:1px solid var(--line,#e3e3dc);margin-top:16px;flex-wrap:wrap">
          ${tabBtn('refusals', `Refusals (${fmt(totalHint)})`, defaultTab === 'refusals')}
          ${tabBtn('entries', `Import Entries (${fmt(entriesTotal)})`, defaultTab === 'entries')}
          ${tabBtn('prop65', `Prop 65 (${fmt(prop65Rows.length)})`, defaultTab === 'prop65')}
        </div>
        <div id="gpane-refusals" style="display:${defaultTab === 'refusals' ? 'block' : 'none'}">${refusalsPane}</div>
        <div id="gpane-entries" style="display:${defaultTab === 'entries' ? 'block' : 'none'}">${entriesPane}</div>
        <div id="gpane-prop65" style="display:${defaultTab === 'prop65' ? 'block' : 'none'}">${prop65Pane}</div>`}
    <div class="guest-register-callout"><strong>¿Esta es tu empresa?</strong> Crea una cuenta para fijarla en tu dashboard, desbloquear el historial completo y recibir contexto de riesgo FDA. <button type="button" onclick="goAuth('register')">Crear cuenta</button></div>`;
}

function guestResultTab(which) {
  const ids = ['refusals', 'entries', 'prop65'];
  for (const key of ids) {
    const pane = document.getElementById('gpane-' + key);
    const tabEl = document.getElementById('gtab-' + key);
    const active = key === which;
    if (pane) pane.style.display = active ? 'block' : 'none';
    if (tabEl) {
      tabEl.style.borderBottom = `2px solid ${active ? 'var(--ink)' : 'transparent'}`;
      tabEl.style.fontWeight = active ? '700' : '400';
      tabEl.style.color = active ? 'var(--ink)' : 'var(--ink3)';
    }
  }
}

function clearGuestQuickSearch() {
  sessionStorage.removeItem('tf_guest_last_query');
  const input = document.getElementById('guest-search-q');
  const box = document.getElementById('guest-search-results');
  if (input) input.value = '';
  if (box) box.innerHTML = `<div class="guest-empty-result"><strong>Consulta rápida lista.</strong><span>Busca por empresa, producto, cargo FDA o Shipment ID.</span></div>`;
}

async function loadGuestDashboard() {
  const c = document.getElementById('mi-dash-content');
  const titleEl = document.getElementById('dash-company-title');
  if (titleEl) titleEl.textContent = 'Consulta rápida FDA El Salvador';
  const dateEl = document.getElementById('dash-date');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('es-SV', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }) + ' · modo invitado · sin empresa registrada';
  }
  c.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando consulta rápida...</div>`;

  const [alertsData, summaryData, chargesData, statusData, entriesStatus] = await Promise.all([
    API.fdaAlerts(),
    API.fdaSummary({ country: 'El Salvador' }),
    API.fdaCharges(),
    API.fdaStatus({ country: 'El Salvador' }),
    API.fdaEntriesStatus()
  ]);

  rememberFdaSignature(statusData);
  const alerts = alertsData.data || [];
  const summary = summaryData.ok ? summaryData : {};
  const cats = summary.byCategory || {};
  const charges = chargesData.data || [];
  const lastQuery = sessionStorage.getItem('tf_guest_last_query') || '';

  c.innerHTML = `<div class="fade-in">
    <div class="guest-hero">
      <div>
        <div class="guest-kicker">Invitado · consulta sin registro</div>
        <h2>Consulta información FDA antes de crear una cuenta</h2>
        <p>No se carga una empresa ficticia. Escribe una razón social, producto, cargo FDA o Shipment ID y consulta datos reales de El Salvador.</p>
      </div>
      <div class="guest-hero-actions">
        <button type="button" class="btn-primary" onclick="goAuth('register')">Crear cuenta</button>
        <button type="button" class="btn-cancel" onclick="goAuth('login')">Iniciar sesión</button>
      </div>
    </div>

    <div class="guest-search-card">
      <div class="guest-search-title">Consulta rápida</div>
      <div class="guest-search-row">
        <input id="guest-search-q" class="search-input" value="${esc(lastQuery)}" placeholder="Empresa, producto, cargo FDA o Shipment ID" onkeydown="if(event.key==='Enter') runGuestQuickSearch()">
        <button type="button" class="btn-primary" onclick="runGuestQuickSearch()">Buscar</button>
        <button type="button" class="btn-cancel" onclick="clearGuestQuickSearch()">Limpiar</button>
      </div>
      <div class="guest-search-help">Vista invitado: resultados rápidos y limitados. Cuenta registrada: historial completo, perfil, referencias y herramientas avanzadas.</div>
      <div id="guest-search-results" class="guest-search-results"><div class="guest-empty-result"><strong>Consulta rápida lista.</strong><span>Busca por empresa, producto, cargo FDA o Shipment ID.</span></div></div>
    </div>

    <div class="kpi-strip" style="grid-template-columns:repeat(5,1fr)">
      <div class="kpi-cell"><div class="kpi-label">Rechazos SV</div><div class="kpi-value" style="color:var(--red)">${fmt(summary.total || 0)}</div><div class="kpi-note">datos públicos</div></div>
      <div class="kpi-cell"><div class="kpi-label">Entries SV</div><div class="kpi-value" style="color:var(--ink)">${fmt(entriesStatus?.total || 0)}</div><div class="kpi-note">${entriesStatus?.total ? fmt(entriesStatus.firms || 0) + ' exportadores' : 'sincronizando...'}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Import Alerts SV</div><div class="kpi-value" style="color:var(--amber)">${fmt(alerts.length)}</div><div class="kpi-note">alertas activas</div></div>
      <div class="kpi-cell"><div class="kpi-label">Códigos FDA</div><div class="kpi-value" style="color:var(--blue)">${fmt(charges.length)}</div><div class="kpi-note">referencia FDA</div></div>
      <div class="kpi-cell"><div class="kpi-label">Modo invitado</div><div class="kpi-value" style="color:var(--green)">0</div><div class="kpi-note">empresas registradas</div></div>
    </div>

    ${renderGuestDashboardVisuals({ cats, years: summary.byYear || {}, topCharges: summary.topCharges || [], topFirms: summary.topFirms || [], byDistrict: summary.byDistrict || [], statusData })}
  </div>`;
  if (lastQuery) setTimeout(() => runGuestQuickSearch(), 120);
}

const pageLoaders = {
  'mi-dashboard': loadMyDashboard,
  'mi-fda': loadMyFDA,
  'inteligencia': loadInteligencia,
  'referencia': loadReferencia,
  'perfil': loadPerfil,
};

function showPage(name, opts = {}) {
  if (!pageLoaders[name]) name = 'mi-dashboard';
  const restrictedInDemo = isDemoMode() && DEMO_RESTRICTED_PAGES.has(name);
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.mobile-nav-link').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-' + name);
  if (page) page.classList.add('active');
  const nav = document.querySelector(`.nav-tab[data-page="${name}"]`);
  if (nav) nav.classList.add('active');
  const mobile = document.querySelector(`.mobile-nav-link[data-page="${name}"]`);
  if (mobile) mobile.classList.add('active');
  if (pageLoaders[name]) pageLoaders[name]();
  if (!opts.initial) setTimeout(() => checkFdaFreshness(false), 250);
  if (restrictedInDemo) {
    const label = name === 'mi-fda' ? 'Historial FDA de empresa' : (name === 'referencia' ? 'Referencia FDA completa' : 'Mi perfil');
    openRestrictedPrompt(label);
  } else {
    maybeShowDemoAuthPrompt(name, opts);
  }
}
function toggleMobileNav() {
  document.getElementById('mobile-nav')?.classList.toggle('open');
  document.getElementById('mobile-nav-overlay')?.classList.toggle('open');
}
function closeMobileNav() {
  document.getElementById('mobile-nav')?.classList.remove('open');
  document.getElementById('mobile-nav-overlay')?.classList.remove('open');
}
function mobileShowPage(name) {
  closeMobileNav();
  showPage(name);
}
function showSub(subId, btn) {
  const parent = btn.closest('.page-wrap');
  parent.querySelectorAll('.sub-pane').forEach(p => p.classList.remove('active'));
  parent.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
  const pane = document.getElementById('sub-' + subId);
  if (pane) pane.classList.add('active');
  btn.classList.add('active');

  if (isDemoMode() && DEMO_RESTRICTED_SUBS.has(subId)) {
    const label = subId === 'intel-rechazos' ? 'Rechazos SV detallados' : 'Import Alerts completos';
    if (pane) {
      pane.innerHTML = renderDemoLockedPanel(label);
      pane.dataset.locked = '1';
    }
    openRestrictedPrompt(label);
    return;
  }

  maybeShowDemoAuthPrompt(subId);
  if (subId === 'intel-dash') loadIntelDash();
  if (subId === 'intel-rechazos') loadRefusals();
  if (subId === 'intel-alerts') loadAlerts();
}

async function loadMyDashboard() {
  if (isDemoMode()) return loadGuestDashboard();
  const c = document.getElementById('mi-dash-content');
  const user = getUser();
  const company = currentCompany();
  const titleEl = document.getElementById('dash-company-title');
  if (titleEl) titleEl.textContent = company || 'Mi Dashboard';
  const dateEl = document.getElementById('dash-date');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('es-SV', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }) + ' · datos FDA';
  }
  c.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando su panel FDA...</div>`;

  const [alertsData, firmData, summaryData, chargesData, statusData, entFirmData] = await Promise.all([
    API.fdaAlerts(),
    API.fdaFirm(company),
    API.fdaSummary({ country: 'El Salvador' }),
    API.fdaCharges(),
    API.fdaStatus({ country: 'El Salvador' }),
    API.fdaEntriesFirm(company)
  ]);

  rememberFdaSignature(statusData);
  const alerts = alertsData.data || [];
  let firmRefusals = (firmData.data && firmData.data.results) ? firmData.data.results : [];
  let firmSource = 'FDA';
  const summary = summaryData.ok ? summaryData : {};
  const cats = summary.byCategory || {};
  const charges = chargesData.data || [];
  const onFdaList = firmRefusals.length > 0;
  const topCharges = summary.topCharges || [];
  const topFirms = summary.topFirms || [];
  const byDistrict = summary.byDistrict || [];
  const firmEntries = entFirmData?.data?.results || [];
  const firmEntriesTotal = entFirmData?.data?.total || 0;
  const firmRejectionRate = firmEntriesTotal > 0 ? ((firmRefusals.length / firmEntriesTotal) * 100) : null;

  c.innerHTML = `<div class="fade-in">
    ${onFdaList ? `
    <div class="alert-banner" style="border-left:4px solid var(--red);background:var(--red-light)">
      <div>
        <div class="ab-title">Atencion — Su empresa aparece en registros FDA</div>
        <div class="ab-text">${esc(company)} tiene ${firmRefusals.length} rechazo(s) registrado(s) por la FDA. Revise su historial para mas detalles.</div>
      </div>
      <a href="#" onclick="showPage('mi-fda')" class="ab-action">Ver historial FDA &rarr;</a>
    </div>` : `
    <div class="ok-banner"><strong>Sin rechazos FDA para su empresa.</strong> No se encontraron registros públicos asociados a ${esc(company) || 'su empresa'}.</div>`}

    <div class="kpi-strip" style="grid-template-columns:repeat(5,1fr)">
      <div class="kpi-cell"><div class="kpi-label">Rechazos de su empresa</div><div class="kpi-value" style="color:${onFdaList?'var(--red)':'var(--green)'}">${fmt(firmRefusals.length)}</div><div class="kpi-note">datos públicos</div></div>
      <div class="kpi-cell"><div class="kpi-label">Entries de su empresa</div><div class="kpi-value" style="color:var(--ink)">${fmt(firmEntriesTotal)}</div><div class="kpi-note">${firmRejectionRate === null ? 'shipments FDA' : 'tasa de rechazo ' + firmRejectionRate.toFixed(2) + '%'}</div></div>
      <div class="kpi-cell"><div class="kpi-label">Import Alerts SV</div><div class="kpi-value" style="color:var(--amber)">${fmt(alerts.length)}</div><div class="kpi-note">alertas activas</div></div>
      <div class="kpi-cell"><div class="kpi-label">Rechazos SV</div><div class="kpi-value" style="color:var(--red)">${fmt(summary.total || 0)}</div><div class="kpi-note">todos los exportadores</div></div>
      <div class="kpi-cell"><div class="kpi-label">Códigos FDA</div><div class="kpi-value" style="color:var(--blue)">${fmt(charges.length)}</div><div class="kpi-note">referencia FDA</div></div>
    </div>

    ${renderDashboardVisuals({ cats, years: summary.byYear || {}, topCharges, topFirms, byDistrict, firmRefusals, statusData })}

    <div class="my-dash-grid two">
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Estado FDA de su empresa</div><div class="panel-meta">${esc(firmSource)}</div></div>
        <div class="panel-body">
          ${firmRefusals.length ? `
            <div class="notice danger"><strong>${firmRefusals.length} rechazo(s) encontrados.</strong> Revise producto, cargos de refusal y fecha para preparar acciones correctivas.</div>
            <table class="data-table">
              <thead><tr><th>ID FDA</th><th>Producto</th><th>Cargos</th><th>Fecha</th></tr></thead>
              <tbody>${firmRefusals.slice(0, 6).map(r => {
                const refusalCharges = (r.RefusalCharges || '').split(',').map(x => x.trim()).filter(Boolean);
                return `<tr>
                  <td style="font-family:var(--font-mono);font-size:11px">${esc(r.ShipmentID || '\u2014')}</td>
                  <td style="font-size:12px">${esc(r.ProductCodeDescription || '\u2014')}</td>
                  <td>${refusalCharges.map(ch => tag(ch, /LISTERIA|SALMONELLA|FILTHY|INSANITARY|PESTICIDE|AFLATOXIN/.test(ch) ? 'red' : 'amber')).join(' ')}</td>
                  <td style="font-family:var(--font-mono);font-size:11px">${fmtDate(r.RefusalDate)}</td>
                </tr>`;
              }).join('')}</tbody>
            </table>
            ${firmRefusals.length > 6 ? `<div style="padding-top:10px;font-size:11px;color:var(--ink3);font-family:var(--font-mono)">+${firmRefusals.length - 6} mas &mdash; <a href="#" onclick="showPage('mi-fda')" style="color:var(--ink)">Ver historial completo</a></div>` : ''}` : `
            <div class="ok-banner"><strong>Sin registros.</strong> No aparece un historial de rechazos para esta empresa en la base pública consultada.</div>
            <div style="font-size:11px;color:var(--ink4);font-family:var(--font-mono)">Nota: los datos públicos FDA pueden tener retraso de publicación.</div>`}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="panel">
          <div class="panel-header"><div class="panel-title">Resumen FDA SV</div><div class="panel-meta">El Salvador</div></div>
          <div class="panel-body">
            <div class="cost-summary-row"><span class="csr-label">Alimentos humanos</span><span class="csr-value">${fmt(cats['Human Foods'] || 0)}</span></div>
            <div class="cost-summary-row"><span class="csr-label">Medicamentos</span><span class="csr-value">${fmt(cats['Drugs and Biologics'] || 0)}</span></div>
            <div class="cost-summary-row"><span class="csr-label">Cosmeticos</span><span class="csr-value">${fmt(cats['Cosmetics'] || 0)}</span></div>
            <div class="cost-summary-row"><span class="csr-label">Otros</span><span class="csr-value">${fmt(cats['Other'] || 0)}</span></div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><div class="panel-title">Acceso rapido</div><div class="panel-meta">FDA</div></div>
          <div class="panel-body">
            <a href="#" onclick="showPage('mi-fda')" style="display:block;font-size:12px;color:var(--ink);font-weight:600;padding:6px 0;border-bottom:1px solid var(--rule)">Ver mi historial FDA &rarr;</a>
            <a href="#" onclick="showPage('inteligencia')" style="display:block;font-size:12px;color:var(--ink);font-weight:600;padding:6px 0;border-bottom:1px solid var(--rule)">Ver rechazos de El Salvador &rarr;</a>
            <a href="#" onclick="showPage('referencia')" style="display:block;font-size:12px;color:var(--ink3);padding:6px 0">Ver códigos de refusal &rarr;</a>
          </div>
        </div>
        ${topCharges.length ? `<div class="panel"><div class="panel-header"><div class="panel-title">Cargos frecuentes SV</div></div><div class="panel-body"><div style="display:flex;flex-wrap:wrap;gap:6px">${topCharges.slice(0, 8).map(([code]) => tag(code, 'red')).join('')}</div></div></div>` : ''}
      </div>
    </div>

    ${firmEntries.length ? `<div class="panel" style="margin-top:16px">
      <div class="panel-header"><div class="panel-title">Entries de importación de su empresa</div><div class="panel-meta">${fmt(firmEntriesTotal)} shipments · FDA Import Entry Data</div></div>
      <div class="panel-body">
        <table class="data-table">
          <thead><tr><th>Shipment ID</th><th>Producto</th><th>Llegada</th><th>Disposición</th><th>Puerto</th></tr></thead>
          <tbody>${firmEntries.slice(0, 8).map(r => `<tr>
            <td style="font-family:var(--font-mono);font-size:11px">${esc(r.shipment_id || '—')}</td>
            <td style="font-size:12px;max-width:260px">${esc(r.product_description || '—')}</td>
            <td style="font-family:var(--font-mono);font-size:11px">${fmtDate(r.arrival_date)}</td>
            <td>${tag(r.final_disposition || 'Pendiente', dispColor(r.final_disposition))}</td>
            <td style="font-size:11px;color:var(--ink3)">${esc((r.port_division || '—').replace('Division of ', ''))}</td>
          </tr>`).join('')}</tbody>
        </table>
        ${firmEntriesTotal > 8 ? `<div style="padding-top:10px;font-size:11px;color:var(--ink3);font-family:var(--font-mono)">+${fmt(firmEntriesTotal - 8)} entries más en la base local (sincronizada semanalmente con la FDA).</div>` : ''}
      </div>
    </div>` : ''}
  </div>`;
}

async function loadMyFDA() {
  const c = document.getElementById('mi-fda-content');
  if (isDemoMode()) {
    c.innerHTML = renderDemoLockedPanel('Historial FDA de empresa');
    return;
  }
  const user = getUser();
  const company = currentCompany();
  c.innerHTML = `<div class="loading"><div class="spinner"></div>Buscando "${esc(company)}" en FDA...</div>`;
  const [firmData, alertsData] = await Promise.all([API.fdaFirm(company), API.fdaAlerts()]);
  const chargesRefMap = await getChargesRef();
  let refusals = (firmData.data && firmData.data.results) ? firmData.data.results : [];
  let firmSource = 'FDA';
  const alerts = alertsData.data || [];
  const myCodes = [...new Set(refusals.flatMap(r => (r.RefusalCharges || '').split(',').map(x => x.trim()).filter(Boolean)))];

  c.innerHTML = `<div class="fade-in">
    <div class="my-dash-grid">
      <div style="background:var(--white);border:1px solid var(--rule);border-radius:var(--radius-lg);padding:16px 18px;position:relative;overflow:hidden">
        <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${refusals.length ? 'var(--red)' : 'var(--green)'}"></div>
        <div class="kpi-label">Rechazos historicos</div>
        <div class="kpi-value" style="color:${refusals.length ? 'var(--red)' : 'var(--green)'}">${fmt(refusals.length)}</div>
        <div class="kpi-note">${esc(firmSource)}</div>
      </div>
      <div style="background:var(--white);border:1px solid var(--rule);border-radius:var(--radius-lg);padding:16px 18px;position:relative;overflow:hidden">
        <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${alerts.length ? 'var(--amber)' : 'var(--green)'}"></div>
        <div class="kpi-label">Import Alerts SV activos</div>
        <div class="kpi-value" style="color:${alerts.length ? 'var(--amber)' : 'var(--green)'}">${fmt(alerts.length)}</div>
        <div class="kpi-note">aplican a toda empresa SV</div>
      </div>
      <div style="background:var(--white);border:1px solid var(--rule);border-radius:var(--radius-lg);padding:16px 18px;position:relative;overflow:hidden">
        <div style="position:absolute;top:0;left:0;right:0;height:3px;background:var(--blue)"></div>
        <div class="kpi-label">Tipos de cargo</div>
        <div class="kpi-value" style="color:var(--blue)">${fmt(myCodes.length)}</div>
        <div class="kpi-note">códigos distintos</div>
      </div>
    </div>

    <div class="panel" style="margin-bottom:20px">
      <div class="panel-header"><div class="panel-title">Rechazos FDA &mdash; ${esc(company)}</div><div class="panel-meta">${esc(firmSource)}</div></div>
      ${refusals.length === 0 ? `
      <div class="panel-body">
        <div class="ok-banner"><strong>Sin rechazos encontrados.</strong> No se encontraron registros para "${esc(company)}" en la base pública de la FDA.</div>
        <div style="font-size:11px;color:var(--ink4);font-family:var(--font-mono)">Nota: los datos públicos de la FDA pueden tener un retraso de varias semanas.</div>
      </div>` : `
      <table class="data-table">
        <thead><tr><th>ID FDA</th><th>Producto</th><th>Puerto</th><th>Cargos de Refusal</th><th>Fecha</th></tr></thead>
        <tbody>${refusals.map(r => {
          const refusalCharges = (r.RefusalCharges || '').split(',').map(x => x.trim()).filter(Boolean);
          return `<tr>
            <td style="font-family:var(--font-mono);font-size:11px">${esc(r.ShipmentID || '\u2014')}</td>
            <td style="font-size:12px">${esc(r.ProductCodeDescription || '\u2014')}</td>
            <td style="font-size:11px;color:var(--ink3)">${esc(r.DistrictDescription || '\u2014')}</td>
            <td>${refusalCharges.map(ch => chargeTagWithDesc(ch, chargesRefMap)).join('')}</td>
            <td style="font-family:var(--font-mono);font-size:11px">${fmtDate(r.RefusalDate)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`}
    </div>

    <div class="panel" style="margin-bottom:20px">
      <div class="panel-header"><div class="panel-title">Import Alerts activos &mdash; El Salvador</div><div class="panel-meta">FDA Import Alerts</div></div>
      <div class="panel-body">
        <div class="notice warn" style="margin-bottom:12px">Estos ${alerts.length} Import Alerts aplican a <strong>todas las empresas de El Salvador</strong> que exporten los productos listados.</div>
        ${alerts.slice(0, 5).map(a => `
        <div style="padding:10px 0;border-bottom:1px solid var(--rule);display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
          <div>
            <div style="font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--ink);margin-bottom:3px">Alert ${esc(a.alertNumber)} &mdash; ${tag('DWPE', 'red')}</div>
            <div style="font-size:12px;color:var(--ink2);margin-bottom:3px">${esc((a.alertTitle || '').substring(0, 100))}${(a.alertTitle || '').length > 100 ? '...' : ''}</div>
            <div style="font-size:11px;color:var(--ink3)"><strong>Productos:</strong> ${esc(a.products || '')}</div>
          </div>
          <a href="${esc(a.url)}" target="_blank" style="font-family:var(--font-mono);font-size:10px;color:var(--ink);border:1px solid var(--rule);border-radius:var(--radius);padding:3px 8px;text-decoration:none;white-space:nowrap;background:var(--bg)">FDA &rarr;</a>
        </div>`).join('')}
        ${alerts.length > 5 ? `<div style="padding-top:10px;font-size:11px;color:var(--ink3);font-family:var(--font-mono)">+${alerts.length - 5} mas &mdash; <a href="#" onclick="showPage('inteligencia')" style="color:var(--ink)">Ver todos</a></div>` : ''}
      </div>
    </div>

    ${myCodes.length ? `<div class="panel"><div class="panel-header"><div class="panel-title">Códigos de refusal de su empresa</div><div class="panel-meta">${myCodes.length} códigos</div></div><div class="panel-body"><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">${myCodes.map(code => tag(code, 'red')).join('')}</div><div style="font-size:11px;color:var(--ink3)">Consulte <a href="#" onclick="showPage('referencia')" style="color:var(--ink);font-weight:600">Referencia</a> para la descripción legal completa.</div></div></div>` : ''}
  </div>`;
}

function loadInteligencia() {
  loadIntelDash();
}
async function loadIntelDash() {
  const c = document.getElementById('dash-content');
  c.dataset.loaded = '1';
  c.innerHTML = `<div class="loading"><div class="spinner"></div>Consultando FDA local...</div>`;
  const data = await API.fdaSummary({ country: 'El Salvador' });
  renderDashboard(data);
}
function renderDashboard(data) {
  const c = document.getElementById('dash-content');
  const cats = data.byCategory || {};
  const years = data.byYear || {};
  const charges = data.topCharges || [];
  const total = data.total || 0;
  const yearArr = Object.entries(years).sort((a, b) => a[0].localeCompare(b[0]));
  const maxY = Math.max(...yearArr.map(e => e[1]), 1);
  const topBase = charges.length ? (charges[0][1] || 1) : 1;

  c.innerHTML = `
  <div class="notice info" style="margin-top:4px">Datos generales de exportadores de El Salvador. Para ver solo su empresa, use <a href="#" onclick="showPage('mi-fda')">Mi Historial FDA</a>.</div>
  <div class="kpi-strip" style="grid-template-columns:repeat(5,1fr)">
    <div class="kpi-cell"><div class="kpi-label">Total rechazos SV</div><div class="kpi-value" style="color:var(--red)">${fmt(total)}</div><div class="kpi-note">${esc('FDA')}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Alimentos humanos</div><div class="kpi-value" style="color:var(--amber)">${fmt(cats['Human Foods'] || 0)}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Medicamentos</div><div class="kpi-value" style="color:var(--blue)">${fmt(cats['Drugs and Biologics'] || 0)}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Cosmeticos</div><div class="kpi-value">${fmt(cats['Cosmetics'] || 0)}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Otros</div><div class="kpi-value">${fmt(cats['Other'] || 0)}</div></div>
  </div>
  <div class="grid-2">
    <div class="panel"><div class="panel-header"><div class="panel-title">Principales causas de rechazo</div></div><div class="panel-body"><div class="hbar-list">
      ${charges.slice(0, 8).map(([code, count], i) => {
        const pct = Math.round((count / topBase) * 100);
        const cols = ['red', 'red', 'amber', 'amber', 'blue', 'blue', 'gray', 'gray'];
        return `<div class="hbar"><div class="hbar-label">${esc(code)}</div><div class="hbar-track"><div class="hbar-fill ${cols[i]}" data-w="${pct}%" style="width:0%">${fmt(count)}</div></div></div>`;
      }).join('') || '<div style="font-size:12px;color:var(--ink3)">Sin cargos disponibles.</div>'}
    </div></div></div>
    <div class="panel"><div class="panel-header"><div class="panel-title">Rechazos por año fiscal</div></div><div class="panel-body"><div class="col-chart">
      ${yearArr.map(([yr, val]) => {
        const h = Math.round((val / maxY) * 100);
        const isLast = yr === yearArr[yearArr.length - 1][0];
        return `<div class="col-wrap"><div class="col-fill ${isLast ? 'current' : ''}" style="height:${h}%"><span class="col-num">${fmt(val)}</span></div><div class="col-label">${esc(yr)}</div></div>`;
      }).join('') || '<div style="font-size:12px;color:var(--ink3)">Sin historial disponible.</div>'}
    </div></div></div>
  </div>
  <div style="font-size:10px;color:var(--ink4);text-align:right;font-family:var(--font-mono)">Datos FDA filtrados para El Salvador</div>`;
  setTimeout(() => document.querySelectorAll('.hbar-fill[data-w]').forEach(el => { el.style.width = el.dataset.w; }), 150);
}

let allRf = [], rfFilter = 'all', rfTotal = 0, rfTimer = null;
function rfServerCategory() {
  if (rfFilter === 'food') return 'food';
  if (rfFilter === 'drug') return 'drug';
  if (rfFilter === 'cosm') return 'cosm';
  return 'all';
}
async function loadRefusals() {
  const tbody = document.getElementById('rf-tbody');
  if (!tbody) return;
  tbody.dataset.loaded = '1';
  tbody.innerHTML = `<tr><td colspan="6"><div class="loading"><div class="spinner"></div>Consultando FDA local...</div></td></tr>`;
  const searchEl = document.getElementById('rf-search');
  const data = await API.fdaRefusals({
    country: 'El Salvador',
    category: rfServerCategory(),
    search: searchEl ? searchEl.value.trim() : '',
    limit: 500,
    offset: 0
  });
  allRf = (data.data && data.data.results) ? data.data.results : [];
  rfTotal = data.data ? (data.data.total || allRf.length) : allRf.length;
  document.getElementById('rf-source').textContent = 'FDA';
  renderRfTable(allRf, rfTotal);
}
function renderRfTable(rows, total) {
  document.getElementById('rf-count').textContent = (total !== undefined ? total : rows.length) + (rows.length && total > rows.length ? ` (${rows.length} mostrados)` : '');
  const tbody = document.getElementById('rf-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--ink3)">Sin resultados</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const refusalCharges = (r.RefusalCharges || '').split(',').map(x => x.trim()).filter(Boolean);
    return `<tr>
      <td style="font-family:var(--font-mono);font-size:11px">${esc(r.ShipmentID || '\u2014')}</td>
      <td><div style="font-weight:600;font-size:13px">${esc(r.FirmName || '\u2014')}</div><div style="font-size:11px;color:var(--ink3)">${esc(r.City || '')}</div></td>
      <td>${tag(r.ProductCategory || 'N/A', catColor(r.ProductCategory))}</td>
      <td style="font-size:12px;max-width:160px">${esc(r.ProductCodeDescription || '\u2014')}</td>
      <td>${refusalCharges.map(ch => tag(ch, /LISTERIA|SALMONELLA|FILTHY|INSANITARY|PESTICIDE|AFLATOXIN/.test(ch) ? 'red' : 'amber')).join(' ')}</td>
      <td style="font-family:var(--font-mono);font-size:11px">${fmtDate(r.RefusalDate)}</td>
    </tr>`;
  }).join('');
}
function filterRefusals() {
  clearTimeout(rfTimer);
  rfTimer = setTimeout(loadRefusals, 250);
}
function setRfFilter(btn, f) {
  rfFilter = f;
  document.querySelectorAll('#page-inteligencia .filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterRefusals();
}

async function loadAlerts() {
  const c = document.getElementById('alerts-content');
  c.dataset.loaded = '1';
  c.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando...</div>`;
  const data = await API.fdaAlerts();
  const alerts = data.data || [];
  c.innerHTML = `
    <div class="notice warn" style="margin-bottom:16px"><strong>DWPE &mdash; Detention Without Physical Examination.</strong> Empresas listadas son detenidas automaticamente en puerto de entrada. Fuente: <a href="https://www.fda.gov/industry/actions-enforcement/import-alerts" target="_blank">FDA.gov</a></div>
    <div class="count-row"><span style="font-weight:600;color:var(--ink)">${alerts.length} Import Alerts activos para El Salvador</span><a href="https://www.fda.gov/industry/actions-enforcement/import-alerts" target="_blank">Ver en FDA.gov</a></div>
    ${alerts.map(a => `
    <div class="alert-card">
      <div class="alert-card-head">
        <div class="alert-num">Import Alert ${esc(a.alertNumber)}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-family:var(--font-mono);font-size:10px;color:var(--ink4)">${esc(a.publishDate || '')}</span>
          ${tag('DWPE', 'red')}
          <a href="${esc(a.url)}" target="_blank" style="font-family:var(--font-mono);font-size:10px;color:var(--ink);border:1px solid var(--rule);border-radius:var(--radius);padding:2px 8px;text-decoration:none;background:var(--white)">FDA</a>
        </div>
      </div>
      <div class="alert-card-body">
        <div class="alert-title">${esc(a.alertTitle || '')}</div>
        <div class="alert-meta-row"><div><strong>Productos:</strong> ${esc(a.products || '')}</div><div><strong>Cargo:</strong> ${esc(a.charge || '')}</div></div>
        <div class="alert-reason"><strong>Razon:</strong> ${esc(a.reason || '')}</div>
      </div>
    </div>`).join('')}`;
}

let allCodes = [], codeFilter = 'all';
async function loadReferencia() {
  if (isDemoMode()) {
    const input = document.getElementById('cd-search');
    if (input) input.disabled = true;
    const count = document.getElementById('cd-count');
    if (count) count.textContent = 'bloqueado';
    const tbody = document.getElementById('cd-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5">${renderDemoLockedPanel('Referencia FDA completa')}</td></tr>`;
    return;
  }
  const input = document.getElementById('cd-search');
  if (input) input.disabled = false;
  if (allCodes.length) return;
  const data = await API.fdaCharges();
  allCodes = data.data || [];
  renderCodes(allCodes);
}
function renderCodes(rows) {
  document.getElementById('cd-count').textContent = rows.length;
  document.getElementById('cd-tbody').innerHTML = rows.map(r => `<tr>
    <td>${tag(r.code, r.category === 'ADULTERATION' ? 'red' : 'amber')}<div style="font-family:var(--font-mono);font-size:9px;color:var(--ink4);margin-top:3px">ID: ${esc(r.asc_id || '\u2014')}</div></td>
    <td style="font-family:var(--font-mono);font-size:10px;color:var(--red)">${esc(r.section || '')}</td>
    <td>${tag(r.category, r.category === 'ADULTERATION' ? 'red' : 'amber')}</td>
    <td><div style="font-size:12px;font-weight:600;color:var(--ink);margin-bottom:2px">${esc(r.desc_es || '')}</div><div style="font-size:11px;color:var(--ink3)">${esc(r.desc_en ? r.desc_en.substring(0, 90) + '...' : '')}</div></td>
    <td><a href="https://www.ecfr.gov/current/title-21" target="_blank" style="font-family:var(--font-mono);font-size:11px;color:var(--ink)">eCFR</a></td>
  </tr>`).join('');
}
function filterCodes() {
  const q = document.getElementById('cd-search').value.toLowerCase();
  let rows = allCodes;
  if (codeFilter !== 'all') rows = rows.filter(r => r.category === codeFilter);
  if (q) rows = rows.filter(r => String(r.code || '').toLowerCase().includes(q) || String(r.desc_es || '').toLowerCase().includes(q) || String(r.section || '').toLowerCase().includes(q));
  renderCodes(rows);
}
function setCodeFilter(btn, f) {
  codeFilter = f;
  document.querySelectorAll('#page-referencia .filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterCodes();
}


function profilePasswordIssues(pass) {
  const p = String(pass || '');
  const issues = [];
  if (p.length < 10) issues.push('mínimo 10 caracteres');
  if (!/[a-z]/.test(p)) issues.push('una minúscula');
  if (!/[A-Z]/.test(p)) issues.push('una mayúscula');
  if (!/[0-9]/.test(p)) issues.push('un número');
  if (!/[^A-Za-z0-9]/.test(p)) issues.push('un símbolo');
  if (/12345|23456|34567|45678|56789|abcde|qwert/i.test(p)) issues.push('no usar secuencias');
  if (/(.)\1{3,}/.test(p)) issues.push('no repetir caracteres');
  if (['123456','12345678','123456789','password','qwerty','admin123','tradeflow123'].includes(p.toLowerCase())) issues.push('no usar contraseñas comunes');
  return issues;
}
function toggleProfilePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.textContent = input.type === 'password' ? '👁' : '✕';
}
function updateProfilePasswordStrength() {
  const input = document.getElementById('p-new');
  const box = document.getElementById('p-strength');
  if (!input || !box) return false;
  const issues = profilePasswordIssues(input.value);
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(input.value)).length;
  const score = Math.max(0, Math.min(100, input.value.length * 5 + classes * 12 - issues.length * 12));
  const fill = box.querySelector('.password-strength-fill');
  const text = box.querySelector('.password-strength-text');
  fill.style.width = score + '%';
  fill.className = 'password-strength-fill' + (score >= 75 && !issues.length ? ' good' : score >= 45 ? ' mid' : '');
  if (!input.value) text.textContent = 'Use mayúscula, minúscula, número y símbolo.';
  else if (issues.length) text.textContent = 'Falta: ' + issues.slice(0, 4).join(', ') + (issues.length > 4 ? '...' : '');
  else text.textContent = 'Contraseña fuerte.';
  return issues.length === 0;
}

async function loadPerfil() {
  const c = document.getElementById('perfil-content');
  if (!c) return;
  if (isDemoMode()) {
    c.innerHTML = renderDemoLockedPanel('Mi perfil');
    return;
  }
  const data = await API.me();
  if (!data.ok) return;
  const u = data.user;
  c.innerHTML = `<div style="max-width:700px">
    <div class="grid-2">
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Información de cuenta</div></div>
        <div class="panel-body">
          <form onsubmit="updatePerfil(event)">
            <div class="form-group"><label class="form-label">Nombre</label><input class="form-input" id="p-name" value="${esc(u.name)}"></div>
            <div class="form-group"><label class="form-label">Empresa</label><input class="form-input" id="p-company" value="${esc(u.company)}"></div>
            <div class="form-group"><label class="form-label">Correo</label><input class="form-input" value="${esc(u.email)}" disabled></div>
            <div class="form-group"><label class="form-label">Número IOR</label><input class="form-input" id="p-ior" value="${esc(u.ior_number || '')}"><div class="form-hint">Importer of Record asignado por CBP</div></div>
            <div class="form-group"><label class="form-label">Tipo de cuenta</label><div class="form-input" style="background:var(--bg);cursor:default">${u.role === 'admin' ? 'Administrador' : u.role === 'broker' ? 'Broker aduanal' : 'Importador'}</div></div>
            <button type="submit" class="btn-primary" style="width:100%;margin-top:4px">Guardar cambios</button>
          </form>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Cambiar contraseña</div></div>
        <div class="panel-body">
          <form onsubmit="changePassword(event)">
            <div class="security-note">Use una contraseña fuerte. Ya no se aceptan claves tipo <strong>123456</strong>, secuencias ni datos de la empresa.</div>
            <div class="form-group"><label class="form-label">Contraseña actual</label><div class="password-wrap"><input type="password" class="form-input" id="p-cur" autocomplete="current-password"><button type="button" class="password-toggle" onclick="toggleProfilePassword('p-cur', this)" aria-label="Mostrar contraseña">👁</button></div></div>
            <div class="form-group"><label class="form-label">Nueva contraseña</label><div class="password-wrap"><input type="password" class="form-input" id="p-new" autocomplete="new-password" oninput="updateProfilePasswordStrength()" placeholder="Mínimo 10 caracteres"><button type="button" class="password-toggle" onclick="toggleProfilePassword('p-new', this)" aria-label="Mostrar contraseña">👁</button></div><div class="password-strength" id="p-strength"><div class="password-strength-bar"><div class="password-strength-fill"></div></div><div class="password-strength-text">Use mayúscula, minúscula, número y símbolo.</div></div></div>
            <div class="form-group"><label class="form-label">Confirmar nueva</label><div class="password-wrap"><input type="password" class="form-input" id="p-new2" autocomplete="new-password"><button type="button" class="password-toggle" onclick="toggleProfilePassword('p-new2', this)" aria-label="Mostrar contraseña">👁</button></div></div>
            <button type="submit" class="btn-primary" style="width:100%;margin-top:4px">Actualizar contraseña</button>
          </form>
        </div>
      </div>
    </div>
  </div>`;
}
async function updatePerfil(e) {
  e.preventDefault();
  const data = await API.updateMe({
    name: document.getElementById('p-name').value,
    company: document.getElementById('p-company').value,
    ior_number: document.getElementById('p-ior').value
  });
  if (data.ok) {
    toast('Perfil actualizado.');
    const user = getUser();
    user.name = document.getElementById('p-name').value;
    user.company = document.getElementById('p-company').value;
    user.ior_number = document.getElementById('p-ior').value;
    localStorage.setItem('tf_user', JSON.stringify(user));
    document.getElementById('ub-company').textContent = user.company;
    document.getElementById('ub-ior').textContent = user.ior_number || 'No registrado';
  } else {
    toast(data.msg || 'Error al actualizar perfil.', 'err');
  }
}
async function changePassword(e) {
  e.preventDefault();
  const np = document.getElementById('p-new').value;
  const np2 = document.getElementById('p-new2').value;
  if (np !== np2) {
    toast('Las contraseñas no coinciden.', 'err');
    return;
  }
  if (!updateProfilePasswordStrength()) {
    toast('La nueva contraseña es débil. Use mínimo 10 caracteres, mayúscula, minúscula, número y símbolo.', 'err');
    return;
  }
  const data = await API.password({ current: document.getElementById('p-cur').value, newpass: np });
  if (data.ok) {
    toast('Contraseña actualizada.');
    e.target.reset();
  } else {
    toast(data.msg || 'Error al actualizar contraseña.', 'err');
  }
}

document.addEventListener('DOMContentLoaded', bootApp);
