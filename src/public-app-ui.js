function renderItacsPanel(s) {
  if (s.itacs_status) {
    try {
      const it = JSON.parse(s.itacs_status);
      const colorMap  = {green:'var(--green)', red:'var(--red)', amber:'var(--amber)', neutral:'var(--ink3)'};
      const bgMap     = {green:'var(--green-light)', red:'var(--red-light)', amber:'var(--amber-light)', neutral:'var(--bg2)'};
      const borderMap = {green:'var(--green-border)', red:'var(--red-border)', amber:'var(--amber-border)', neutral:'var(--rule)'};
      const col    = colorMap[it.color]  || 'var(--ink3)';
      const bg     = bgMap[it.color]     || 'var(--bg2)';
      const border = borderMap[it.color] || 'var(--rule)';
      return '<div style="background:' + bg + ';border:1px solid ' + border + ';border-left:4px solid ' + col + ';border-radius:var(--radius);padding:12px 14px;margin-bottom:10px">' +
        '<div style="font-size:13px;font-weight:700;color:' + col + ';margin-bottom:4px">' + it.label + '</div>' +
        '<div style="font-size:12px;color:var(--ink2);line-height:1.5">' + it.message + '</div>' +
        '<div style="font-size:10px;color:var(--ink4);margin-top:6px;font-family:var(--font-mono)">Consultado: ' + (it.updated ? it.updated.substring(0,10) : '—') + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button onclick="abrirITACS(\'' + s.entry_number + '\',' + s.id + ')" style="background:var(--ink);color:#fff;border:none;border-radius:var(--radius);padding:6px 14px;font-size:11px;cursor:pointer;font-family:var(--font-body)">Actualizar en ITACS</button>' +
        '<button onclick="mostrarOpcionesITACS(' + s.id + ')" style="background:none;border:1px solid var(--rule);border-radius:var(--radius);padding:6px 14px;font-size:11px;cursor:pointer;color:var(--ink2)">Cambiar estado</button>' +
        '</div>';
    } catch(e) {}
  }
  return '<div style="font-size:12px;color:var(--ink3);margin-bottom:12px;line-height:1.6">' +
    'Consulte el estado oficial de este entry en ITACS. Se abrirá la página de FDA con el entry number ya cargado — solo resuelva el reCAPTCHA y el estado aparecerá aquí.' +
    '</div>' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
    '<button onclick="abrirITACS(\'' + s.entry_number + '\',' + s.id + ')" style="background:var(--ink);color:#fff;border:none;border-radius:var(--radius);padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font-body)">Consultar en ITACS →</button>' +
    '<span style="font-size:11px;color:var(--ink4)">o ingrese el estado manualmente:</span>' +
    '<button onclick="mostrarOpcionesITACS(' + s.id + ')" style="background:none;border:1px solid var(--rule);border-radius:var(--radius);padding:7px 14px;font-size:11px;cursor:pointer;color:var(--ink2)">Registrar estado</button>' +
    '</div>';
}

(function checkAuth() {
  if (!localStorage.getItem('tf_token')) { window.location.href = 'index.html'; return; }
  const user = getUser();
  if (!user) return;
  const el = document.getElementById('ub-company');
  if (el) el.textContent = user.company;
  const ior = document.getElementById('ub-ior');
  if (ior) ior.textContent = user.ior_number || 'No registrado';
  const rb = document.getElementById('ub-role-badge');
  if (rb && user.role === 'admin') rb.innerHTML = '<span class="tag blue" style="font-size:9px;margin-left:8px">ADMIN</span>';
})();

function doLogout() { localStorage.clear(); }
function fmt(n) { return Number(n).toLocaleString('es-SV'); }
function fmtDate(d) { return d ? d.substring(0,10) : '\u2014'; }
function tag(text, color) { return `<span class="tag ${color}">${text}</span>`; }
function statusTag(s) {
  const m = { held:'FDA Hold', clear:'Liberado', transit:'En Tránsito', review:'CBP Review' };
  const c = { held:'red', clear:'green', transit:'blue', review:'amber' };
  return tag(m[s]||s, c[s]||'neutral');
}
function statusColor(s) {
  return { held:'var(--red)', clear:'var(--green)', transit:'var(--blue)', review:'var(--amber)' }[s] || 'var(--ink3)';
}
function catColor(cat='') {
  const c = cat.toLowerCase();
  if (c.includes('food')) return 'red';
  if (c.includes('drug')) return 'amber';
  return 'neutral';
}
function toast(msg, type='ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  setTimeout(() => el.classList.remove('show'), 3000);
}
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

const pageLoaders = {
  'mi-dashboard': loadMyDashboard, 'mis-envios': loadMisEnvios, 'mi-fda': loadMyFDA,
  'inteligencia': loadInteligencia, 'referencia': loadReferencia, 'perfil': loadPerfil,
};
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.mobile-nav-link').forEach(n => n.classList.remove('active'));
  const pg = document.getElementById('page-' + name);
  if (pg) pg.classList.add('active');
  const nb = document.querySelector(`.nav-tab[data-page="${name}"]`);
  if (nb) nb.classList.add('active');
  const mb = document.querySelector(`.mobile-nav-link[data-page="${name}"]`);
  if (mb) mb.classList.add('active');
  if (pageLoaders[name]) pageLoaders[name]();
}
function toggleMobileNav() {
  document.getElementById('mobile-nav').classList.toggle('open');
  document.getElementById('mobile-nav-overlay').classList.toggle('open');
}
function closeMobileNav() {
  document.getElementById('mobile-nav').classList.remove('open');
  document.getElementById('mobile-nav-overlay').classList.remove('open');
}
function mobileShowPage(name) {
  closeMobileNav();
  showPage(name);
}
function showSub(subId, btn) {
  const parent = btn.closest('.page-wrap');
  parent.querySelectorAll('.sub-pane').forEach(p => p.classList.remove('active'));
  parent.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
  document.getElementById('sub-' + subId).classList.add('active');
  btn.classList.add('active');
  if (subId === 'intel-dash' && !document.getElementById('dash-content').dataset.loaded) loadIntelDash();
  if (subId === 'intel-rechazos' && !document.getElementById('rf-tbody').dataset.loaded) loadRefusals();
  if (subId === 'intel-alerts' && !document.getElementById('alerts-content').dataset.loaded) loadAlerts();
}

async function loadMyDashboard() {
  const c = document.getElementById('mi-dash-content');
  const user = getUser();
  const titleEl = document.getElementById('dash-company-title');
  if (titleEl) titleEl.textContent = user ? user.company : 'Mi Dashboard';
  const dateEl = document.getElementById('dash-date');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('es-SV', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  c.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando su panel...</div>`;
  const [shipmentsData, alertsData, firmData, syncMeta] = await Promise.all([
    API.shipments(), API.fdaAlerts(), API.fdaFirm(user?.company || ''),
    fetch('/api/fda/sync/meta', { headers: { Authorization: 'Bearer ' + localStorage.getItem('tf_token') } }).then(r => r.json()).catch(() => ({}))
  ]);
  const shipments = shipmentsData.data || [];
  const alerts = alertsData.data || [];
  const firmRefusals = (firmData.data && firmData.data.results) ? firmData.data.results : [];
  const refusalsUpdatedAt = syncMeta?.refusals_updated_at || null;
  const refusalsSyncStatus = syncMeta?.refusals_sync_status || null;

  // Formatear fecha del último sync para mostrar en UI
  const fdaDataLabel = (() => {
    if (refusalsSyncStatus === 'running') return null; // null = mostramos cargando
    if (!refusalsUpdatedAt) return null;
    const d = new Date(refusalsUpdatedAt);
    return d.toLocaleDateString('es-SV', { day: 'numeric', month: 'long', year: 'numeric' });
  })();
  const counts = shipments.reduce((a,s) => { a[s.status] = (a[s.status]||0)+1; return a; }, {});
  const totalCost = shipments.reduce((sum, s) => {
    const base = { held:8500, clear:4000, transit:3500, review:4200 };
    return sum + (base[s.status] || 4000);
  }, 0);
  const myCompany = (user?.company || '').toLowerCase();
  const onFdaList = firmRefusals.length > 0;
  const heldShipments = shipments.filter(s => s.status === 'held');

  c.innerHTML = `<div class="fade-in">
    ${onFdaList ? `
    <div class="alert-banner" style="border-left:4px solid var(--red);background:var(--red-light)">
      <div>
        <div class="ab-title">Atencion — Su empresa aparece en registros FDA</div>
        <div class="ab-text">${user.company} tiene ${firmRefusals.length} rechazo(s) registrado(s) por la FDA. Revise su historial para mas detalles.</div>
      </div>
      <a href="#" onclick="showPage('mi-fda')" class="ab-action">Ver historial FDA &rarr;</a>
    </div>` : ''}
    ${heldShipments.length ? `
    <div class="alert-banner">
      <div>
        <div class="ab-title">Atencion — ${heldShipments.length} envío(s) con FDA Hold activo</div>
        <div class="ab-text">Tiene ${heldShipments.length} cargamento(s) detenido(s) por la FDA. Cuenta con 90 dias para responder o reexportar el producto.</div>
      </div>
      <a href="#" onclick="showPage('mis-envios')" class="ab-action">Ver mis envíos &rarr;</a>
    </div>` : ''}
    ${!onFdaList && !heldShipments.length ? `
    <div class="ok-banner"><strong>Sin alertas FDA.</strong> Su empresa no aparece en registros FDA y no tiene envíos detenidos.</div>` : ''}
    <div class="kpi-strip" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi-cell"><div class="kpi-label">FDA Hold</div><div class="kpi-value" style="color:var(--red)">${counts.held||0}</div><div class="kpi-note">envío(s) detenidos</div></div>
      <div class="kpi-cell"><div class="kpi-label">CBP Review</div><div class="kpi-value" style="color:var(--amber)">${counts.review||0}</div><div class="kpi-note">en revision aduanas</div></div>
      <div class="kpi-cell"><div class="kpi-label">En Tránsito</div><div class="kpi-value" style="color:var(--blue)">${counts.transit||0}</div><div class="kpi-note">navegando actualmente</div></div>
      <div class="kpi-cell"><div class="kpi-label">Liberados</div><div class="kpi-value" style="color:var(--green)">${counts.clear||0}</div><div class="kpi-note">entregados</div></div>
    </div>
    <div class="my-dash-grid two">
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Envíos Activos</div><a href="#" onclick="showPage('mis-envios')" style="font-family:var(--font-mono);font-size:10px;color:var(--ink3)">Ver todos &rarr;</a></div>
        <div class="panel-body">
          ${shipments.length === 0 ? `<div style="text-align:center;padding:24px;color:var(--ink3)"><div style="font-size:13px;margin-bottom:8px">Sin envíos registrados</div><button class="btn-primary" onclick="openModal('modal-add')">Registrar primer envío</button></div>` :
            shipments.slice(0,5).map(s => `
            <div class="shipment-row" onclick="showPage('mis-envios')">
              <div class="sr-status-bar" style="background:${statusColor(s.status)}"></div>
              <div class="sr-info">
                <div class="sr-entry">${s.entry_number}</div>
                <div class="sr-company">${s.product.substring(0,40)}${s.product.length>40?'...':''}</div>
                <div class="sr-product">${s.vessel||'\u2014'} &middot; ${s.dest_port ? s.dest_port.split(',')[0] : '\u2014'}</div>
              </div>
              <div class="sr-meta">${statusTag(s.status)}<div style="font-family:var(--font-mono);font-size:10px;color:var(--ink4)">${fmtDate(s.eta)}</div></div>
            </div>`).join('')}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="panel">
          <div class="panel-header"><div class="panel-title">Costos Estimados</div><div class="panel-meta">todos los envíos</div></div>
          <div class="panel-body">
            <div class="cost-summary-row"><span class="csr-label">Total envíos activos</span><span class="csr-value">$${fmt(totalCost)}</span></div>
            <div class="cost-summary-row"><span class="csr-label">Costo promedio / envio</span><span class="csr-value">$${shipments.length ? fmt(Math.round(totalCost/shipments.length)) : '0'}</span></div>
            <div class="cost-summary-row"><span class="csr-label">Costos adicionales FDA Hold</span><span class="csr-value" style="color:${heldShipments.length?'var(--red)':'var(--green)'}">${heldShipments.length ? '$' + fmt(heldShipments.length * 7430) : 'Sin costos adicionales'}</span></div>
            <div style="margin-top:10px;font-size:10px;color:var(--ink4);font-family:var(--font-mono)">Estimado basado en tarifas promedio de mercado</div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">Estado FDA</div>
            <div class="panel-meta">su empresa</div>
          </div>
          <div class="panel-body">
            <div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--rule)">
              ${fdaDataLabel
                ? `<div style="font-size:10px;color:var(--ink3)">datos FDA del día: <strong style="color:var(--ink)">${fdaDataLabel}</strong></div>`
                : `<div style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--ink3)"><div style="width:8px;height:8px;border-radius:50%;border:2px solid var(--ink3);border-top-color:transparent;animation:spin .8s linear infinite"></div>actualizando base de datos FDA...</div>`
              }
            </div>
            <div style="margin-bottom:10px">
              <div style="font-size:10px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:var(--ink3);margin-bottom:4px">Rechazos / Alerts FDA</div>
              ${fdaDataLabel === null && refusalsSyncStatus === 'running'
                ? `<div style="font-size:13px;color:var(--ink3);font-style:italic">cargando...</div>`
                : onFdaList
                  ? `<div style="font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--red)">${firmRefusals.length} rechazo(s)</div><div style="font-size:11px;color:var(--red);margin-top:2px;font-weight:600">Su empresa aparece en registros FDA</div>`
                  : `<div style="font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--green)">Limpio</div><div style="font-size:11px;color:var(--ink3);margin-top:2px">Su empresa no aparece en registros FDA</div>`
              }
            </div>
            <div style="margin-bottom:10px">
              <div style="font-size:10px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:var(--ink3);margin-bottom:4px">Import Alerts SV activos</div>
              <div style="font-family:var(--font-display);font-size:22px;font-weight:700;color:var(--amber)">${alerts.length}</div>
              <div style="font-size:11px;color:var(--ink3);margin-top:2px">Aplican a toda empresa exportadora SV</div>
            </div>
            <div style="border-top:1px solid var(--rule);padding-top:10px">
              <div style="font-size:10px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:var(--ink3);margin-bottom:4px">Acceso rapido</div>
              <a href="#" onclick="showPage('mi-fda')" style="display:block;font-size:12px;color:var(--ink);font-weight:600;padding:5px 0;border-bottom:1px solid var(--rule)">Ver mi historial FDA &rarr;</a>
              <a href="#" onclick="showPage('inteligencia')" style="display:block;font-size:12px;color:var(--ink3);padding:5px 0">Ver inteligencia de mercado &rarr;</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

let myShipments = [];

async function loadMisEnvios() {
  const c = document.getElementById('mis-content');
  c.innerHTML = `<div class="loading"><div class="spinner"></div>Cargando...</div>`;
  const data = await API.shipments();
  myShipments = data.data || [];
  const sub = document.getElementById('mis-sub');
  if (sub) sub.textContent = `${myShipments.length} envío(s) registrado(s)`;
  if (!myShipments.length) {
    c.innerHTML = `<div style="text-align:center;padding:56px;color:var(--ink3)"><div style="font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--ink);margin-bottom:8px">Sin envíos registrados</div><div style="font-size:13px;margin-bottom:16px">Registre su primer envío para comenzar el seguimiento.</div><button class="btn-primary" onclick="openModal('modal-add')">Registrar Envío</button></div>`;
    return;
  }
  const counts = myShipments.reduce((a,s)=>{a[s.status]=(a[s.status]||0)+1;return a;},{});

  c.innerHTML = `
  <div class="kpi-strip" style="grid-template-columns:repeat(4,1fr)">
    <div class="kpi-cell"><div class="kpi-label">FDA Hold</div><div class="kpi-value" style="color:var(--red)">${counts.held||0}</div></div>
    <div class="kpi-cell"><div class="kpi-label">CBP Review</div><div class="kpi-value" style="color:var(--amber)">${counts.review||0}</div></div>
    <div class="kpi-cell"><div class="kpi-label">En Tránsito</div><div class="kpi-value" style="color:var(--blue)">${counts.transit||0}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Liberados</div><div class="kpi-value" style="color:var(--green)">${counts.clear||0}</div></div>
  </div>

  <!-- DESKTOP TABLE -->
  <div class="panel shipment-table-desktop table-scroll">
    <table class="data-table">
      <thead><tr><th>Entry No.</th><th>Producto</th><th>Barco / Contenedor</th><th>Ruta</th><th>ETA</th><th>Estado</th><th></th></tr></thead>
      <tbody>
        ${myShipments.map(s=>`<tr>
          <td><div style="font-family:var(--font-mono);font-size:11px">${s.entry_number}</div><div style="font-family:var(--font-mono);font-size:10px;color:var(--ink4)">${s.bl_number||'\u2014'}</div></td>
          <td style="max-width:200px">${s.product}</td>
          <td><div style="font-size:12px;font-weight:600">${s.vessel||'\u2014'}</div><div style="font-family:var(--font-mono);font-size:10px;color:var(--ink3)">${s.container||'\u2014'}</div></td>
          <td style="font-size:12px;color:var(--ink3)">${(s.origin_port||'').split(',')[0]||'\u2014'} &rarr; ${(s.dest_port||'').split(',')[0]||'\u2014'}</td>
          <td style="font-family:var(--font-mono);font-size:11px">${fmtDate(s.eta)}</td>
          <td>${statusTag(s.status)}</td>
          <td style="white-space:nowrap">
            <button onclick="viewShipment(${s.id})" style="background:none;border:1px solid var(--rule);border-radius:var(--radius);padding:5px 12px;font-size:11px;cursor:pointer;color:var(--ink2);font-family:var(--font-body);font-weight:600;text-transform:uppercase;letter-spacing:.5px">Ver</button>
            <button onclick="deleteShipment(${s.id})" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:15px;padding:2px 6px">&times;</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <!-- MOBILE CARDS -->
  <div class="shipment-card-mobile">
    ${myShipments.map(s=>`
    <div class="ship-card">
      <div class="ship-card-header">
        <div>
          <div class="ship-card-entry">${s.entry_number}</div>
          <div class="ship-card-bl">${s.bl_number||'\u2014'}</div>
        </div>
        ${statusTag(s.status)}
      </div>
      <div class="ship-card-body">
        <div class="ship-card-product">${s.product}</div>
        <div class="ship-card-row"><span class="ship-card-label">Barco</span><span class="ship-card-val">${s.vessel||'\u2014'}</span></div>
        <div class="ship-card-row"><span class="ship-card-label">Contenedor</span><span class="ship-card-val">${s.container||'\u2014'}</span></div>
        <div class="ship-card-row"><span class="ship-card-label">Ruta</span><span class="ship-card-val">${(s.origin_port||'').split(',')[0]||'\u2014'} &rarr; ${(s.dest_port||'').split(',')[0]||'\u2014'}</span></div>
        <div class="ship-card-row"><span class="ship-card-label">ETA</span><span class="ship-card-val">${fmtDate(s.eta)}</span></div>
      </div>
      <div class="ship-card-footer">
        ${statusTag(s.status)}
        <div class="ship-card-actions">
          <button class="btn-ver" onclick="viewShipment(${s.id})">Ver</button>
          <button class="btn-del" onclick="deleteShipment(${s.id})">&times;</button>
        </div>
      </div>
    </div>`).join('')}
  </div>`;
}

async function viewShipment(id) {
  const data = await API.shipment(id);
  if (!data.ok) return toast('Error al cargar el envío.','err');
  const s = data.data;
  const modal = document.createElement('div');
  modal.className = 'overlay open';
  const total = (s.costs||[]).filter(c=>c.type==='normal').reduce((a,c)=>a+c.amount,0);
  const extra = (s.costs||[]).filter(c=>c.type==='extra').reduce((a,c)=>a+c.amount,0);
  const hasTracking = s.container || s.bl_number;

  // Info grid — 4 celdas superiores
  var infoGrid = '';
  var infoCells = [['Barco',s.vessel||'—'],['Contenedor',s.container||'—'],['Destino',(s.dest_port||'—').split(',')[0]],['Estado',s.status]];
  for (var ci=0; ci<infoCells.length; ci++) {
    var cl = infoCells[ci][0], cv = infoCells[ci][1];
    infoGrid += '<div class="info-cell"><div class="ic-label">'+cl+'</div><div class="ic-value">'+(cl==='Estado'?statusTag(cv):cv)+'</div></div>';
  }

  // Opciones ITACS
  var itacsOpciones = [
    ['Liberado / May Proceed','green','\u2713 Su cargamento fue liberado por FDA. Puede proceder.','Liberado \u2713'],
    ['En Revisi\u00f3n / Pending Review','amber','Su entry est\u00e1 en revisi\u00f3n por FDA. Puede subir documentaci\u00f3n para agilizar.','En Revisi\u00f3n FDA'],
    ['Examen F\u00edsico / Exam','amber','FDA seleccion\u00f3 su cargamento para examen f\u00edsico o toma de muestra.','Examen F\u00edsico'],
    ['FDA Hold / Detained','red','Su cargamento est\u00e1 detenido. Tiene 90 d\u00edas para responder, reconditioner o re-exportar.','FDA Hold'],
    ['Documentos Requeridos','amber','FDA requiere documentaci\u00f3n adicional. S\u00fabala por ITACS o contacte al distrito FDA.','Docs Requeridos'],
    ['Rechazado / Refused','red','FDA rechaz\u00f3 la entrada. El producto debe re-exportarse o destruirse en 90 d\u00edas.','Rechazado']
  ];
  var opcionesBtns = '';
  for (var oi=0; oi<itacsOpciones.length; oi++) {
    var oLabel=itacsOpciones[oi][0], oColor=itacsOpciones[oi][1], oMsg=itacsOpciones[oi][2], oShort=itacsOpciones[oi][3];
    var oLabelE = oLabel.replace(/'/g,"\\'"), oMsgE = oMsg.replace(/'/g,"\\'");
    opcionesBtns += '<button onclick="guardarEstadoITACS('+s.id+',\''+oShort+'\',\''+oLabelE+'\',\''+oMsgE+'\',\''+oColor+'\')" '
      +'style="background:var(--bg2);border:1px solid var(--rule);border-radius:var(--radius);padding:8px 10px;font-size:11px;cursor:pointer;text-align:left;color:var(--ink2);font-family:var(--font-body);transition:all .1s" '
      +'onmouseover="this.style.borderColor=\'var(--ink)\'" onmouseout="this.style.borderColor=\'var(--rule)\'">'+oLabel+'</button>';
  }

  // Panel tracking
  var trackingPanel = '';
  if (hasTracking) {
    trackingPanel = '<div class="panel" style="margin-bottom:16px">'
      +'<div class="panel-header"><div class="panel-title">Tracking vía ShipsGo API</div>'
      +'<button onclick="loadShipmentTracking('+s.id+',this)" style="background:var(--ink);color:#fff;border:none;border-radius:var(--radius);padding:4px 12px;font-size:11px;cursor:pointer;font-family:var(--font-body)">Consultar</button></div>'
      +'<div class="panel-body" id="track-panel-'+s.id+'">'
      +'<div style="font-size:12px;color:var(--ink3);font-family:var(--font-mono)">Contenedor: <strong>'+(s.container||'—')+'</strong> &nbsp;|&nbsp; BL: <strong>'+(s.bl_number||'—')+'</strong>'
      +' &nbsp;&mdash;&nbsp; Presione "Consultar" para ver el estado actual.</div>'
      +'</div></div>';
  }

  // Panel FDA holds
  var holdsPanel = '';
  if ((s.fda_holds||[]).length) {
    var holdsRows = '';
    for (var hi=0; hi<s.fda_holds.length; hi++) {
      var h = s.fda_holds[hi];
      holdsRows += '<tr><td>'+tag(h.charge_code,'red')+'</td>'
        +'<td style="font-family:var(--font-mono);font-size:10px;color:var(--red)">'+h.section+'</td>'
        +'<td style="font-size:12px">'+h.description+'</td>'
        +'<td><a href="https://www.ecfr.gov/current/title-21" target="_blank" style="font-family:var(--font-mono);font-size:10px">eCFR</a></td></tr>';
    }
    holdsPanel = '<div class="fda-hold-panel">'
      +'<div class="fhp-title">FDA Hold &mdash; '+s.fda_holds.length+' cargo(s) de refusal</div>'
      +'<div class="fhp-sub">90 días para responder, reconditioner o reexportar el producto.</div>'
      +'<table class="data-table" style="background:var(--white);border-radius:var(--radius)">'
      +'<thead><tr><th>Código</th><th>Sección</th><th>Descripción</th><th>Ref</th></tr></thead>'
      +'<tbody>'+holdsRows+'</tbody></table></div>';
  } else {
    holdsPanel = '<div class="ok-banner"><strong>Sin cargos FDA.</strong> Producto liberado sin restricciones.</div>';
  }

  // Costos normales
  var costsNormal = '';
  var normalList = (s.costs||[]).filter(c=>c.type==='normal');
  for (var ni=0; ni<normalList.length; ni++) {
    costsNormal += '<tr><td>'+normalList[ni].item+'</td><td style="text-align:right;font-family:var(--font-mono);font-size:11px">'+(normalList[ni].amount===0?'$0 (CAFTA)':'$'+fmt(normalList[ni].amount))+'</td></tr>';
  }

  // Panel costos extra (hold)
  var extraPanel = '';
  if (extra > 0) {
    var costsExtra = '';
    var extraList = (s.costs||[]).filter(c=>c.type==='extra');
    for (var ei=0; ei<extraList.length; ei++) {
      costsExtra += '<tr><td>'+extraList[ei].item+'</td><td style="text-align:right;font-family:var(--font-mono);font-size:11px;color:var(--red)">'+fmt(extraList[ei].amount)+'</td></tr>';
    }
    extraPanel = '<div class="panel">'
      +'<div class="panel-header" style="background:var(--red-light)"><div class="panel-title" style="color:var(--red)">Costos FDA Hold</div></div>'
      +'<table class="data-table">'+costsExtra
      +'<tr style="border-top:2px solid var(--red-border)"><td style="font-weight:700;color:var(--red)">Total con hold</td>'
      +'<td style="text-align:right;font-weight:700;font-family:var(--font-mono);color:var(--red)">$'+fmt(total+extra)+'</td></tr>'
      +'</table></div>';
  } else {
    extraPanel = '<div class="panel" style="display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;padding:24px">'
      +'<div style="font-family:var(--font-display);font-size:14px;font-weight:700;color:var(--green)">Sin costos adicionales</div></div>';
  }

  // Ensamblar modal completo
  modal.innerHTML =
    '<div class="modal" style="max-width:720px">'
    +'<div class="modal-head">'
    +'<div><div class="modal-title">'+s.entry_number+'</div><div class="modal-sub">'+s.product+' &middot; '+(s.broker||'—')+'</div></div>'
    +'<button class="modal-close" onclick="this.closest(\'.overlay\').remove()">&times;</button>'
    +'</div>'
    +'<div class="modal-body">'
    +'<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">'+infoGrid+'</div>'
    +'<div class="panel" style="margin-bottom:16px">'
    +'<div class="panel-header"><div class="panel-title">Estado FDA \u2014 ITACS</div>'
    +'<span style="font-family:var(--font-mono);font-size:10px;color:var(--ink4)">'+s.entry_number+'</span></div>'
    +'<div class="panel-body" id="itacs-panel-'+s.id+'">'
    +renderItacsPanel(s)
    +'<div id="itacs-opciones-'+s.id+'" style="display:none;margin-top:14px;padding-top:14px;border-top:1px solid var(--rule)">'
    +'<div style="font-size:11px;font-weight:700;color:var(--ink2);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">\u00bfQu\u00e9 estado aparece en ITACS?</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+opcionesBtns+'</div>'
    +'</div>'
    +'</div></div>'
    +trackingPanel
    +holdsPanel
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
    +'<div class="panel"><div class="panel-header"><div class="panel-title">Costos de Importación</div></div>'
    +'<table class="data-table">'+costsNormal
    +'<tr style="border-top:2px solid var(--rule)"><td style="font-weight:700">Subtotal</td>'
    +'<td style="text-align:right;font-weight:700;font-family:var(--font-mono)">$'+fmt(total)+'</td></tr>'
    +'</table></div>'
    +extraPanel
    +'</div>'
    +'</div></div>';

  document.body.appendChild(modal);
  modal.addEventListener('click', function(e) { if (e.target===modal) modal.remove(); });
}

async function deleteShipment(id) {
  if (!confirm('Eliminar este envio?')) return;
  const data = await API.deleteShipment(id);
  if (data.ok) { toast('Envío eliminado.'); loadMisEnvios(); loadMyDashboard(); }
  else toast(data.msg||'Error.','err');
}

async function submitShipment(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-add-ship');
  const container = document.getElementById('s-container').value.trim().toUpperCase();
  if (!container || container.length < 7) {
    toast('Ingrese un numero de contenedor valido (ej. MSCU7284013)', 'err');
    return;
  }
  btn.textContent = 'Registrando y rastreando...'; btn.disabled = true;

  const body = {
    entry_number: document.getElementById('s-entry').value || container,
    bl_number: document.getElementById('s-bl').value || '',
    product: document.getElementById('s-product').value || 'Pendiente de identificar',
    vessel: document.getElementById('s-vessel').value || '',
    container: container,
    origin_port: document.getElementById('s-origin').value || '',
    dest_port: document.getElementById('s-dest').value || '',
    etd: document.getElementById('s-etd').value || '',
    eta: document.getElementById('s-eta').value || '',
    broker: document.getElementById('s-broker').value || '',
  };

  const data = await API.createShipment(body);
  if (!data.ok) {
    btn.textContent = 'Registrar y Rastrear'; btn.disabled = false;
    toast(data.msg || 'Error al registrar.', 'err');
    return;
  }

  toast('Envio registrado — consultando ShipsGo API...');
  const trackResult = await API.trackingRefresh(data.id);

  if (trackResult.ok && trackResult.data) {
    const t = trackResult.data;
    const updates = {};
    if (t.vessel && !body.vessel) updates.vessel = t.vessel;
    if (t.origin_port && !body.origin_port) updates.origin_port = t.origin_port;
    if (t.dest_port && !body.dest_port) updates.dest_port = t.dest_port;
    if (t.eta && !body.eta) updates.eta = t.eta;
    if (Object.keys(updates).length) {
      await API.updateShipment(data.id, updates);
    }
    toast('Envio registrado — datos de ShipsGo API obtenidos.');
  } else {
    toast('Envio registrado — tracking pendiente.');
  }

  btn.textContent = 'Registrar y Rastrear'; btn.disabled = false;
  closeModal('modal-add'); e.target.reset();
  showPage('mis-envios'); loadMyDashboard();
}

async function loadMyFDA() {
  const c = document.getElementById('mi-fda-content');
  const user = getUser();
  const company = user?.company || '';
  c.innerHTML = `<div class="loading"><div class="spinner"></div>Buscando "${company}" en FDA...</div>`;
  const [firmData, alertsData, chargesData] = await Promise.all([API.fdaFirm(company), API.fdaAlerts(), API.fdaCharges()]);
  const refusals = (firmData.data && firmData.data.results) ? firmData.data.results : [];
  const alerts = alertsData.data || [];
  const myCodes = [...new Set(refusals.flatMap(r => (r.RefusalCharges||'').split(',').map(c=>c.trim()).filter(Boolean)))];
  c.innerHTML = `<div class="fade-in">
    <div class="my-dash-grid">
      <div style="background:var(--white);border:1px solid var(--rule);border-radius:var(--radius-lg);padding:16px 18px;position:relative;overflow:hidden">
        <div style="position:absolute;top:0;left:0;right:0;height:3px;background:var(--red)"></div>
        <div class="kpi-label">Rechazos Históricos</div>
        <div class="kpi-value" style="color:${refusals.length?'var(--red)':'var(--green)'}">${refusals.length}</div>
        <div class="kpi-note">${firmData.source||'FDA API'}</div>
      </div>
      <div style="background:var(--white);border:1px solid var(--rule);border-radius:var(--radius-lg);padding:16px 18px;position:relative;overflow:hidden">
        <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${alerts.length?'var(--amber)':'var(--green)'}"></div>
        <div class="kpi-label">Import Alerts SV activos</div>
        <div class="kpi-value" style="color:${alerts.length?'var(--amber)':'var(--green)'}">${alerts.length}</div>
        <div class="kpi-note">Aplican a toda empresa SV</div>
      </div>
      <div style="background:var(--white);border:1px solid var(--rule);border-radius:var(--radius-lg);padding:16px 18px;position:relative;overflow:hidden">
        <div style="position:absolute;top:0;left:0;right:0;height:3px;background:var(--blue)"></div>
        <div class="kpi-label">Tipos de cargo</div>
        <div class="kpi-value" style="color:var(--blue)">${myCodes.length}</div>
        <div class="kpi-note">Códigos de refusal distintos</div>
      </div>
    </div>
    <div class="panel" style="margin-bottom:20px">
      <div class="panel-header"><div class="panel-title">Rechazos FDA &mdash; ${company}</div><div class="panel-meta">${firmData.source||'FDA'}</div></div>
      ${refusals.length === 0 ? `
      <div class="panel-body">
        <div class="ok-banner"><strong>Sin rechazos encontrados.</strong> No se encontraron registros para "${company}" en la base de datos pública de la FDA.</div>
        <div style="font-size:11px;color:var(--ink4);font-family:var(--font-mono)">Nota: Los datos públicos de la FDA pueden tener un retraso de varias semanas.</div>
      </div>` : `
      <table class="data-table">
        <thead><tr><th>Shipment ID</th><th>Producto</th><th>Puerto</th><th>Cargos de Refusal</th><th>Fecha</th></tr></thead>
        <tbody>${refusals.map(r => {
            const charges = (r.RefusalCharges||'').split(',').map(c=>c.trim()).filter(Boolean);
            return `<tr>
              <td style="font-family:var(--font-mono);font-size:11px">${r.ShipmentID||'\u2014'}</td>
              <td style="font-size:12px">${r.ProductCodeDescription||'\u2014'}</td>
              <td style="font-size:11px;color:var(--ink3)">${r.DistrictDescription||'\u2014'}</td>
              <td>${charges.map(ch=>tag(ch,/LISTERIA|SALMONELLA|FILTHY|INSANITARY|PESTICIDE|AFLATOXIN/.test(ch)?'red':'amber')).join(' ')}</td>
              <td style="font-family:var(--font-mono);font-size:11px">${fmtDate(r.RefusalDate)}</td>
            </tr>`;}).join('')}</tbody>
      </table>`}
    </div>
    <div class="panel" style="margin-bottom:20px">
      <div class="panel-header"><div class="panel-title">Import Alerts Activos &mdash; El Salvador</div><div class="panel-meta">Aplican a toda empresa exportadora SV</div></div>
      <div class="panel-body">
        <div class="notice warn" style="margin-bottom:12px">Estos ${alerts.length} Import Alerts aplican a <strong>todas las empresas de El Salvador</strong> que exporten los productos listados.</div>
        ${alerts.slice(0,5).map(a=>`
        <div style="padding:10px 0;border-bottom:1px solid var(--rule);display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
          <div>
            <div style="font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--ink);margin-bottom:3px">Alert ${a.alertNumber} &mdash; ${tag('DWPE','red')}</div>
            <div style="font-size:12px;color:var(--ink2);margin-bottom:3px">${a.alertTitle.substring(0,80)}${a.alertTitle.length>80?'...':''}</div>
            <div style="font-size:11px;color:var(--ink3)"><strong>Productos:</strong> ${a.products}</div>
          </div>
          <a href="${a.url}" target="_blank" style="font-family:var(--font-mono);font-size:10px;color:var(--ink);border:1px solid var(--rule);border-radius:var(--radius);padding:3px 8px;text-decoration:none;white-space:nowrap;background:var(--bg)">FDA &rarr;</a>
        </div>`).join('')}
        ${alerts.length > 5 ? `<div style="padding-top:10px;font-size:11px;color:var(--ink3);font-family:var(--font-mono)">+${alerts.length-5} mas &mdash; <a href="#" onclick="showPage('inteligencia')" style="color:var(--ink)">Ver todos</a></div>` : ''}
      </div>
    </div>
    ${myCodes.length ? `<div class="panel"><div class="panel-header"><div class="panel-title">Códigos de Refusal de su Empresa</div><div class="panel-meta">${myCodes.length} códigos</div></div><div class="panel-body"><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">${myCodes.map(code => tag(code,'red')).join('')}</div><div style="font-size:11px;color:var(--ink3)">Consulte <a href="#" onclick="showPage('referencia')" style="color:var(--ink);font-weight:600">Referencia</a> para la descripción legal completa.</div></div></div>` : ''}
  </div>`;
}

function loadInteligencia() {
  if (!document.getElementById('dash-content').dataset.loaded) loadIntelDash();
}
async function loadIntelDash() {
  const c = document.getElementById('dash-content');
  c.dataset.loaded = '1';
  c.innerHTML = `<div class="loading"><div class="spinner"></div>Consultando FDA API...</div>`;
  const data = await API.fdaSummary();
  renderDashboard(data);
}
function renderDashboard(data) {
  const c = document.getElementById('dash-content');
  const cats = data.byCategory || {}, years = data.byYear || {}, charges = data.topCharges || [], total = data.total || 0;
  const yearArr = Object.entries(years).sort((a,b)=>a[0].localeCompare(b[0]));
  const maxY = Math.max(...yearArr.map(e=>e[1]),1);
  c.innerHTML = `
  <div class="notice info" style="margin-top:4px">Datos generales de todos los exportadores de El Salvador. Para ver solo su empresa, use <a href="#" onclick="showPage('mi-fda')">Mi Historial FDA</a>.</div>
  <div class="kpi-strip" style="grid-template-columns:repeat(5,1fr)">
    <div class="kpi-cell"><div class="kpi-label">Total detenciónes SV</div><div class="kpi-value" style="color:var(--red)">${fmt(total)}</div><div class="kpi-note">${data.source||'FDA'}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Alimentos humanos</div><div class="kpi-value" style="color:var(--amber)">${fmt(cats['Human Foods']||0)}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Medicamentos</div><div class="kpi-value" style="color:var(--blue)">${fmt(cats['Drugs and Biologics']||0)}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Cosmeticos</div><div class="kpi-value">${fmt(cats['Cosmetics']||0)}</div></div>
    <div class="kpi-cell"><div class="kpi-label">Costo prom.</div><div class="kpi-value">$4,200</div><div class="kpi-note">USD por detención</div></div>
  </div>
  <div class="grid-2">
    <div class="panel"><div class="panel-header"><div class="panel-title">Principales Causas de Detención</div></div><div class="panel-body"><div class="hbar-list">
      ${charges.slice(0,8).map(([code,count],i)=>{
        const pct=Math.round((count/(charges[0][1]||1))*100);
        const cols=['red','red','amber','amber','blue','blue','gray','gray'];
        return `<div class="hbar"><div class="hbar-label">${code}</div><div class="hbar-track"><div class="hbar-fill ${cols[i]}" data-w="${pct}%" style="width:0%">${count}</div></div></div>`;
      }).join('')}
    </div></div></div>
    <div class="panel"><div class="panel-header"><div class="panel-title">Detenciónes por Ano Fiscal</div></div><div class="panel-body"><div class="col-chart">
      ${yearArr.map(([yr,val])=>{
        const h=Math.round((val/maxY)*100);
        const isLast=yr===yearArr[yearArr.length-1][0];
        return `<div class="col-wrap"><div class="col-fill ${isLast?'current':''}" style="height:${h}%"><span class="col-num">${val}</span></div><div class="col-label">${yr}</div></div>`;
      }).join('')}
    </div></div></div>
  </div>
  <div style="font-size:10px;color:var(--ink4);text-align:right;font-family:var(--font-mono)">datadashboard.fda.gov &middot; api-datadashboard.fda.gov/v1/import_refusals</div>`;
  setTimeout(()=>document.querySelectorAll('.hbar-fill[data-w]').forEach(el=>el.style.width=el.dataset.w),150);
}

let allRf = [], rfFilter = 'all';
async function loadRefusals() {
  const tbody = document.getElementById('rf-tbody');
  tbody.dataset.loaded = '1';
  tbody.innerHTML = `<tr><td colspan="6"><div class="loading"><div class="spinner"></div>Consultando FDA...</div></td></tr>`;
  const data = await API.fdaRefusals({ limit:100 });
  allRf = (data.data && data.data.results) ? data.data.results : [];
  document.getElementById('rf-source').textContent = data.source || 'FDA';
  renderRfTable(allRf);
}
function renderRfTable(rows) {
  document.getElementById('rf-count').textContent = rows.length;
  const tbody = document.getElementById('rf-tbody');
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--ink3)">Sin resultados</td></tr>`; return; }
  tbody.innerHTML = rows.map(r=>{
    const charges=(r.RefusalCharges||'').split(',').map(c=>c.trim()).filter(Boolean);
    return `<tr>
      <td style="font-family:var(--font-mono);font-size:11px">${r.ShipmentID||'\u2014'}</td>
      <td><div style="font-weight:600;font-size:13px">${r.FirmName||'\u2014'}</div><div style="font-size:11px;color:var(--ink3)">${r.City||''}</div></td>
      <td>${tag(r.ProductCategory||'N/A',catColor(r.ProductCategory))}</td>
      <td style="font-size:12px;max-width:160px">${r.ProductCodeDescription||'\u2014'}</td>
      <td>${charges.map(c=>tag(c,/LISTERIA|SALMONELLA|FILTHY|INSANITARY|PESTICIDE|AFLATOXIN/.test(c)?'red':'amber')).join(' ')}</td>
      <td style="font-family:var(--font-mono);font-size:11px">${fmtDate(r.RefusalDate)}</td>
    </tr>`;}).join('');
}
function filterRefusals() {
  const q = document.getElementById('rf-search').value.toLowerCase();
  let rows = allRf;
  if (rfFilter!=='all') rows=rows.filter(r=>(r.ProductCategory||'').toLowerCase().includes(rfFilter));
  if (q) rows=rows.filter(r=>(r.FirmName||'').toLowerCase().includes(q)||(r.ProductCodeDescription||'').toLowerCase().includes(q)||(r.RefusalCharges||'').toLowerCase().includes(q));
  renderRfTable(rows);
}
function setRfFilter(btn, f) {
  rfFilter = f;
  document.querySelectorAll('#page-inteligencia .filter-tab').forEach(b=>b.classList.remove('active'));
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
    ${alerts.map(a=>`
    <div class="alert-card">
      <div class="alert-card-head">
        <div class="alert-num">Import Alert ${a.alertNumber}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-family:var(--font-mono);font-size:10px;color:var(--ink4)">${a.publishDate}</span>
          ${tag('DWPE','red')}
          <a href="${a.url}" target="_blank" style="font-family:var(--font-mono);font-size:10px;color:var(--ink);border:1px solid var(--rule);border-radius:var(--radius);padding:2px 8px;text-decoration:none;background:var(--white)">FDA</a>
        </div>
      </div>
      <div class="alert-card-body">
        <div class="alert-title">${a.alertTitle}</div>
        <div class="alert-meta-row"><div><strong>Productos:</strong> ${a.products}</div><div><strong>Cargo:</strong> ${a.charge}</div></div>
        <div class="alert-reason"><strong>Razon:</strong> ${a.reason}</div>
      </div>
    </div>`).join('')}`;
}

let allCodes = [], codeFilter = 'all';
async function loadReferencia() {
  if (allCodes.length) return;
  const data = await API.fdaCharges();
  allCodes = data.data || [];
  renderCodes(allCodes);
}
function renderCodes(rows) {
  document.getElementById('cd-count').textContent = rows.length;
  document.getElementById('cd-tbody').innerHTML = rows.map(r=>`<tr>
    <td>${tag(r.code,r.category==='ADULTERATION'?'red':'amber')}<div style="font-family:var(--font-mono);font-size:9px;color:var(--ink4);margin-top:3px">ID: ${r.asc_id||'\u2014'}</div></td>
    <td style="font-family:var(--font-mono);font-size:10px;color:var(--red)">${r.section}</td>
    <td>${tag(r.category,r.category==='ADULTERATION'?'red':'amber')}</td>
    <td><div style="font-size:12px;font-weight:600;color:var(--ink);margin-bottom:2px">${r.desc_es}</div><div style="font-size:11px;color:var(--ink3)">${r.desc_en?r.desc_en.substring(0,90)+'...':''}</div></td>
    <td><a href="https://www.ecfr.gov/current/title-21" target="_blank" style="font-family:var(--font-mono);font-size:11px;color:var(--ink)">eCFR</a></td>
  </tr>`).join('');
}
function filterCodes() {
  const q = document.getElementById('cd-search').value.toLowerCase();
  let rows = allCodes;
  if (codeFilter!=='all') rows=rows.filter(r=>r.category===codeFilter);
  if (q) rows=rows.filter(r=>r.code.toLowerCase().includes(q)||r.desc_es.toLowerCase().includes(q)||r.section.toLowerCase().includes(q));
  renderCodes(rows);
}
function setCodeFilter(btn, f) {
  codeFilter = f;
  document.querySelectorAll('#page-referencia .filter-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  filterCodes();
}
async function loadPerfil() {
  const c = document.getElementById('perfil-content');
  const data = await API.me();
  if (!data.ok) return;
  const u = data.user;
  c.innerHTML = `<div style="max-width:700px">
    <div class="grid-2">
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Información de Cuenta</div></div>
        <div class="panel-body">
          <form onsubmit="updatePerfil(event)">
            <div class="form-group"><label class="form-label">Nombre</label><input class="form-input" id="p-name" value="${u.name}"></div>
            <div class="form-group"><label class="form-label">Empresa</label><input class="form-input" id="p-company" value="${u.company}"></div>
            <div class="form-group"><label class="form-label">Correo</label><input class="form-input" value="${u.email}" disabled></div>
            <div class="form-group"><label class="form-label">Número IOR (CBP)</label><input class="form-input" id="p-ior" value="${u.ior_number||''}"><div class="form-hint">Importer of Record &mdash; asignado por CBP</div></div>
            <div class="form-group"><label class="form-label">Tipo de cuenta</label><div class="form-input" style="background:var(--bg);cursor:default">${u.role==='admin'?'Administrador':u.role==='broker'?'Broker Aduanal':'Importador'}</div></div>
            <button type="submit" class="btn-primary" style="width:100%;margin-top:4px">Guardar cambios</button>
          </form>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header"><div class="panel-title">Cambiar Contraseña</div></div>
        <div class="panel-body">
          <form onsubmit="changePassword(event)">
            <div class="form-group"><label class="form-label">Contraseña actual</label><input type="password" class="form-input" id="p-cur"></div>
            <div class="form-group"><label class="form-label">Nueva contraseña</label><input type="password" class="form-input" id="p-new"></div>
            <div class="form-group"><label class="form-label">Confirmar nueva</label><input type="password" class="form-input" id="p-new2"></div>
            <button type="submit" class="btn-primary" style="width:100%;margin-top:4px">Actualizar contraseña</button>
          </form>
        </div>
      </div>
    </div>
  </div>`;
}
async function updatePerfil(e) {
  e.preventDefault();
  const data = await API.updateMe({ name:document.getElementById('p-name').value, company:document.getElementById('p-company').value, ior_number:document.getElementById('p-ior').value });
  if (data.ok) { toast('Perfil actualizado.'); const user=getUser(); user.name=document.getElementById('p-name').value; user.company=document.getElementById('p-company').value; localStorage.setItem('tf_user',JSON.stringify(user)); document.getElementById('ub-company').textContent=user.company; }
  else toast(data.msg,'err');
}
async function changePassword(e) {
  e.preventDefault();
  const np=document.getElementById('p-new').value, np2=document.getElementById('p-new2').value;
  if (np!==np2) { toast('Las contraseñas no coinciden.','err'); return; }
  const data = await API.password({ current:document.getElementById('p-cur').value, newpass:np });
  if (data.ok) { toast('Contraseña actualizada.'); e.target.reset(); } else toast(data.msg,'err');
}

document.addEventListener('DOMContentLoaded', () => showPage('mi-dashboard'));
async function loadShipmentTracking(shipmentId, btn) {
  const panel = document.getElementById('track-panel-' + shipmentId);
  if (!panel) return;
  btn.textContent = 'Consultando...'; btn.disabled = true;
  panel.innerHTML = '<div class="loading"><div class="spinner"></div>Consultando ShipsGo API...</div>';
  try {
    const data = await API.tracking(shipmentId);
    if (!data.ok) throw new Error(data.msg || 'Error');
    const t = data.data;
    const liveTag = t.live ? '<span class="tag green" style="font-size:9px">LIVE</span>' : '<span class="tag neutral" style="font-size:9px">Sin API key</span>';
    const eventsHtml = t.events && t.events.length ? `<table class="data-table" style="margin-top:12px"><thead><tr><th>Fecha</th><th>Ubicacion</th><th>Evento</th></tr></thead><tbody>${t.events.map(e => `<tr><td style="font-family:var(--font-mono);font-size:11px;white-space:nowrap">${fmtDate(e.date)}</td><td style="font-size:12px">${e.location||'\u2014'}</td><td style="font-size:12px">${e.status||'\u2014'}</td></tr>`).join('')}</tbody></table>` : '';
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div>${liveTag} <span style="font-size:12px;color:var(--ink2);margin-left:8px">Naviera: <strong>${t.carrier||'\u2014'}</strong></span>${data.cached ? '<span style="font-size:10px;color:var(--ink4);margin-left:8px;font-family:var(--font-mono)">cache</span>' : ''}</div>
        <button onclick="refreshTracking(${shipmentId},this)" style="background:none;border:1px solid var(--rule);border-radius:var(--radius);padding:3px 10px;font-size:11px;cursor:pointer;color:var(--ink2);font-family:var(--font-body)">Actualizar</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:12px">
        ${[['Barco',t.vessel||'\u2014'],['Contenedor',t.container||'\u2014'],['Estado',t.status||'\u2014'],['ETA',fmtDate(t.eta)||'\u2014'],['Origen',t.origin_port||'\u2014'],['Destino',t.dest_port||'\u2014']].map(([l,v])=>`<div style="background:var(--bg);border:1px solid var(--rule);border-radius:var(--radius);padding:8px 10px"><div style="font-size:10px;color:var(--ink3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">${l}</div><div style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--ink)">${v}</div></div>`).join('')}
      </div>
      ${t.last_event ? `<div class="notice warn" style="padding:8px 12px;font-size:12px"><strong>Ultimo evento:</strong> ${t.last_event} ${t.last_location ? '&mdash; ' + t.last_location : ''} ${t.last_date ? '<span style="font-family:var(--font-mono);font-size:10px;color:var(--ink4)">' + fmtDate(t.last_date) + '</span>' : ''}</div>` : ''}
      ${eventsHtml}
      <div style="margin-top:10px;text-align:right"><a href="${t.tracking_url}" target="_blank" style="font-family:var(--font-mono);font-size:11px;color:var(--ink);border:1px solid var(--rule);border-radius:var(--radius);padding:4px 10px;text-decoration:none;background:var(--bg)">Ver tracking externo &rarr;</a></div>`;
    btn.textContent = 'Actualizar'; btn.disabled = false;
    btn.onclick = () => refreshTracking(shipmentId, btn);
  } catch(err) {
    panel.innerHTML = `<div style="color:var(--red);font-size:12px;padding:8px">Error: ${err.message}</div>`;
    btn.textContent = 'Reintentar'; btn.disabled = false;
  }
}
async function refreshTracking(shipmentId, btn) {
  const panel = document.getElementById('track-panel-' + shipmentId);
  if (!panel) return;
  btn.textContent = 'Actualizando...'; btn.disabled = true;
  panel.innerHTML = '<div class="loading"><div class="spinner"></div>Actualizando...</div>';
  try {
    const data = await API.trackingRefresh(shipmentId);
    if (!data.ok) throw new Error(data.msg || 'Error');
    await loadShipmentTracking(shipmentId, { textContent:'', disabled:false, onclick:null });
    btn.textContent = 'Actualizar'; btn.disabled = false;
  } catch(err) {
    panel.innerHTML = `<div style="color:var(--red);font-size:12px;padding:8px">Error: ${err.message}</div>`;
    btn.textContent = 'Reintentar'; btn.disabled = false;
  }
}

let _detectTimer = null;
function detectContainerCarrier(value) {
  const hint = document.getElementById('s-carrier-hint');
  const infoBox = document.getElementById('autofill-info');
  const infoContent = document.getElementById('autofill-content');
  if (!hint) return;
  if (!value || value.length < 4) { hint.style.display = 'none'; if(infoBox) infoBox.style.display='none'; return; }

  const prefixes = {'MSCU':'MSC','MEDU':'MSC','MSDU':'MSC','HLCU':'Hapag-Lloyd','HLXU':'Hapag-Lloyd','CSNU':'COSCO','CBHU':'COSCO','MAEU':'Maersk','MSKU':'Maersk','CMAU':'CMA CGM','EISU':'Evergreen','EGHU':'Evergreen','ZIMU':'ZIM','YMLU':'Yang Ming','OOLU':'OOCL'};
  const carrier = prefixes[value.toUpperCase().substring(0, 4)];
  hint.style.display = 'block';
  if (carrier) { hint.style.color = 'var(--green)'; hint.textContent = '\u2713 Naviera detectada: ' + carrier; }
  else { hint.style.color = 'var(--ink3)'; hint.textContent = 'Naviera no identificada por prefijo; se usará OTHERS'; }

  if (value.length >= 10 && carrier) {
    clearTimeout(_detectTimer);
    _detectTimer = setTimeout(async () => {
      hint.textContent = '\u2713 ' + carrier + ' — consultando datos en vivo...';
      hint.style.color = 'var(--blue)';
      try {
        const r = await API.detectCarrier(value.toUpperCase());
        if (r.ok && r.vessel) {
          document.getElementById('s-vessel').value = r.vessel || '';
          document.getElementById('s-origin').value = r.origin_port || '';
          document.getElementById('s-dest').value = r.dest_port || '';
          document.getElementById('s-eta').value = r.eta || '';
          hint.style.color = 'var(--green)';
          hint.textContent = '\u2713 ' + carrier + ' — datos obtenidos en vivo';
          if (infoBox && infoContent) {
            infoBox.style.display = 'block';
            infoContent.innerHTML =
              '<div>Barco: <strong>' + (r.vessel||'—') + '</strong></div>' +
              '<div>Ruta: ' + (r.origin_port||'?') + ' → ' + (r.dest_port||'?') + '</div>' +
              '<div>ETA: ' + (r.eta||'—') + '</div>' +
              '<div>Estado: ' + (r.status||'—') + '</div>' +
              (r.last_event ? '<div>Ultimo evento: ' + r.last_event + '</div>' : '');
          }
        } else {
          hint.style.color = 'var(--green)';
          hint.textContent = '\u2713 ' + carrier + ' — datos se obtendran al registrar';
          if (infoBox) infoBox.style.display = 'none';
        }
      } catch(e) {
        hint.style.color = 'var(--green)';
        hint.textContent = '\u2713 ' + carrier + ' — se consultara al registrar';
      }
    }, 800);
  }
}
// Abre ITACS en ventana nueva con el entry number ya escrito
function abrirITACS(entryNumber, shipmentId) {
  // URL de ITACS con el entry number precargado
  const url = 'https://www.access.fda.gov/itacs?entryNumber=' + encodeURIComponent(entryNumber);
  const win = window.open(url, 'itacs_' + shipmentId, 'width=900,height=700,scrollbars=yes');
  
  // Mostrar instrucciones y opciones de estado
  mostrarOpcionesITACS(shipmentId);
  
  // Mostrar aviso de que se abrió ITACS
  const panel = document.getElementById('itacs-panel-' + shipmentId);
  if (!panel) return;
  
  const aviso = document.createElement('div');
  aviso.style.cssText = 'background:var(--blue-light);border:1px solid var(--blue-border);border-left:3px solid var(--blue);border-radius:var(--radius);padding:10px 14px;font-size:12px;color:var(--ink2);margin-bottom:12px';
  aviso.innerHTML = '<strong>ITACS abierto.</strong> Resuelva el reCAPTCHA en la ventana de FDA y vea el estado. Luego regrese aquí y seleccione qué estado apareció.';
  
  const opcDiv = document.getElementById('itacs-opciones-' + shipmentId);
  if (opcDiv) panel.insertBefore(aviso, opcDiv);
}

function mostrarOpcionesITACS(shipmentId) {
  const div = document.getElementById('itacs-opciones-' + shipmentId);
  if (div) div.style.display = 'block';
}

async function guardarEstadoITACS(shipmentId, label, status, message, color) {
  try {
    const data = await API.saveITACS(shipmentId, { status, label, message, color });
    if (!data.ok) return toast('Error al guardar estado.', 'err');
    toast('Estado FDA guardado.');
    // Cerrar el modal y reabrir con datos actualizados
    document.querySelector('.overlay.open')?.remove();
    viewShipment(shipmentId);
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}

function resetITACSCaptcha(shipmentId) {
  const div = document.getElementById('itacs-opciones-' + shipmentId);
  if (div) div.style.display = 'none';
}
async function loadShipmentTracking(shipmentId, btn) {
  const panel = document.getElementById('track-panel-' + shipmentId);
  if (!panel) return;
  btn.textContent = 'Consultando...';
  btn.disabled    = true;
  panel.innerHTML = '<div class="loading"><div class="spinner"></div>Consultando ShipsGo API...</div>';

  try {
    const data = await API.tracking(shipmentId);
    if (!data.ok) throw new Error(data.msg || 'Error');
    const t = data.data;

    const liveTag = t.live
      ? '<span style="background:var(--green-light);color:var(--green);border:1px solid var(--green-border);padding:2px 8px;border-radius:3px;font-size:10px;font-weight:700">LIVE</span>'
      : '<span style="background:var(--bg2);color:var(--ink4);border:1px solid var(--rule);padding:2px 8px;border-radius:3px;font-size:10px">Sin API key</span>';

    const eventsHtml = t.events && t.events.length
      ? `<table class="data-table" style="margin-top:12px">
           <thead><tr><th>Fecha</th><th>Ubicacion</th><th>Evento</th></tr></thead>
           <tbody>${t.events.map(e => `<tr>
             <td style="font-family:var(--font-mono);font-size:11px;white-space:nowrap">${fmtDate(e.date)}</td>
             <td style="font-size:12px">${e.location||'—'}</td>
             <td style="font-size:12px">${e.status||'—'}</td>
           </tr>`).join('')}</tbody>
         </table>` : '';

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div>${liveTag}<span style="font-size:12px;color:var(--ink2);margin-left:8px">Naviera: <strong>${t.carrier||'—'}</strong></span>${data.cached?'<span style="font-size:10px;color:var(--ink4);margin-left:8px;font-family:var(--font-mono)">caché</span>':''}</div>
        <button onclick="refreshTracking(${shipmentId},this)" style="background:none;border:1px solid var(--rule);border-radius:var(--radius);padding:3px 10px;font-size:11px;cursor:pointer;color:var(--ink2)">Actualizar</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:12px">
        ${[['Barco',t.vessel||'—'],['Contenedor',t.container||'—'],['Estado',t.status||'—'],['ETA',fmtDate(t.eta)||'—'],['Origen',t.origin_port||'—'],['Destino',t.dest_port||'—']].map(([l,v])=>`
          <div style="background:var(--bg2);border:1px solid var(--rule);border-radius:var(--radius);padding:8px 10px">
            <div style="font-size:10px;color:var(--ink3);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">${l}</div>
            <div style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:var(--ink)">${v}</div>
          </div>`).join('')}
      </div>
      ${t.last_event?`<div style="background:var(--amber-light);border:1px solid var(--amber-border);border-left:3px solid var(--amber);border-radius:var(--radius);padding:8px 12px;font-size:12px;color:var(--ink2);margin-bottom:12px"><strong>Ultimo evento:</strong> ${t.last_event} ${t.last_location?'— '+t.last_location:''}</div>`:''}
      ${eventsHtml}
      <div style="margin-top:10px;text-align:right">
        <a href="${t.tracking_url}" target="_blank" style="font-family:var(--font-mono);font-size:11px;color:var(--ink);border:1px solid var(--rule);border-radius:var(--radius);padding:4px 10px;text-decoration:none;background:var(--bg)">Ver tracking externo →</a>
      </div>`;

    btn.textContent = 'Actualizar';
    btn.disabled    = false;
    btn.onclick     = () => refreshTracking(shipmentId, btn);
  } catch(err) {
    panel.innerHTML = `<div style="color:var(--red);font-size:12px;padding:8px">Error: ${err.message}</div>`;
    btn.textContent = 'Reintentar';
    btn.disabled    = false;
  }
}

async function refreshTracking(shipmentId, btn) {
  const panel = document.getElementById('track-panel-' + shipmentId);
  if (!panel) return;
  btn.textContent = 'Actualizando...';
  btn.disabled    = true;
  panel.innerHTML = '<div class="loading"><div class="spinner"></div>Actualizando...</div>';
  try {
    await API.trackingRefresh(shipmentId);
    await loadShipmentTracking(shipmentId, btn);
  } catch(err) {
    panel.innerHTML = `<div style="color:var(--red);font-size:12px;padding:8px">Error: ${err.message}</div>`;
    btn.textContent = 'Reintentar';
    btn.disabled    = false;
  }
}


