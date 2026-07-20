const db = require('../db/database');

const BASE = process.env.FDA_DDAPI_BASE || 'https://api-datadashboard.fda.gov/v1';
const TIMEOUT_MS = Math.max(10000, Number(process.env.FDA_DDAPI_TIMEOUT_MS || 45000));
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.FDA_DDAPI_DELAY_MS || 300));
const FEI_BATCH = Math.max(10, Math.min(100, Number(process.env.FDA_DDAPI_FEI_BATCH || 50)));

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function hasCredentials() {
  return !!(process.env.FDA_DDAPI_USER && process.env.FDA_DDAPI_KEY);
}

function cleanText(value = '') {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function isoDate(value = '') {
  const s = String(value || '');
  return s.length >= 10 ? s.slice(0, 10) : '';
}

function ensureTables() {
  db.runRaw(`CREATE TABLE IF NOT EXISTS fda_compliance_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    row_key TEXT NOT NULL UNIQUE,
    fei_number TEXT DEFAULT '',
    legal_name TEXT DEFAULT '',
    action_type TEXT DEFAULT '',
    action_taken_date TEXT DEFAULT '',
    product_type TEXT DEFAULT '',
    state TEXT DEFAULT '',
    case_injunction_id TEXT DEFAULT ''
  )`);
  db.runRaw(`CREATE TABLE IF NOT EXISTS fda_inspections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    row_key TEXT NOT NULL UNIQUE,
    fei_number TEXT DEFAULT '',
    legal_name TEXT DEFAULT '',
    inspection_id TEXT DEFAULT '',
    classification TEXT DEFAULT '',
    inspection_end_date TEXT DEFAULT '',
    project_area TEXT DEFAULT '',
    product_type TEXT DEFAULT '',
    city TEXT DEFAULT '',
    country TEXT DEFAULT ''
  )`);
  db.runRaw('CREATE INDEX IF NOT EXISTS idx_fda_compliance_fei ON fda_compliance_actions (fei_number)');
  db.runRaw('CREATE INDEX IF NOT EXISTS idx_fda_inspections_fei ON fda_inspections (fei_number)');
}

async function postDdapi(endpoint, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${endpoint}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization-User': process.env.FDA_DDAPI_USER,
        'Authorization-Key': process.env.FDA_DDAPI_KEY,
        'User-Agent': 'TradeFlowSV/DDAPI-Official/1.0'
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; }
    catch (_) { json = { raw: text }; }
    if (!res.ok) throw new Error(`FDA DDAPI /${endpoint} HTTP ${res.status}: ${String(json.message || text).slice(0, 300)}`);
    const status = Number(json.statuscode);
    if (status !== 400 && status !== 412 && Number.isFinite(status)) {
      throw new Error(`FDA DDAPI /${endpoint} statuscode ${status}: ${json.message || ''}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function collectLocalFeis() {
  const feis = new Set();
  try {
    for (const r of db.query("SELECT DISTINCT manufacturer_fei AS fei FROM fda_entries WHERE manufacturer_fei != ''")) {
      const n = Number(r.fei);
      if (Number.isFinite(n) && n > 0) feis.add(n);
    }
  } catch (_) {}
  return [...feis];
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function syncComplianceActions() {
  if (!hasCredentials()) {
    return { ok: true, skipped: true, message: 'Sin credenciales FDA_DDAPI_USER/FDA_DDAPI_KEY.' };
  }
  ensureTables();
  const feis = collectLocalFeis();
  if (!feis.length) {
    return { ok: true, skipped: true, message: 'Sin FEI numbers locales. Ejecuta primero el sync de entries.' };
  }

  console.log(`[FDA-COMPLIANCE] Consultando compliance actions para ${feis.length} FEIs.`);
  let inserted = 0;
  let queried = 0;

  for (const batch of chunk(feis, FEI_BATCH)) {
    const json = await postDdapi('compliance_actions', {
      start: 1,
      rows: 5000,
      sort: 'ActionTakenDate',
      sortorder: 'DESC',
      returntotalcount: false,
      filters: { FEINumber: batch },
      columns: ['FEINumber', 'LegalName', 'ActionType', 'ActionTakenDate', 'ProductType', 'State', 'CaseInjunctionID']
    });
    queried += batch.length;
    const rows = Array.isArray(json.result) ? json.result : [];
    for (const raw of rows) {
      const fei = cleanText(raw.FEINumber);
      const date = isoDate(raw.ActionTakenDate);
      const type = cleanText(raw.ActionType);
      const caseId = cleanText(raw.CaseInjunctionID);
      const rowKey = `${fei}|${type}|${date}|${caseId}`;
      const r = db.runRaw(`INSERT OR IGNORE INTO fda_compliance_actions
        (row_key, fei_number, legal_name, action_type, action_taken_date, product_type, state, case_injunction_id)
        VALUES (?,?,?,?,?,?,?,?)`,
        [rowKey, fei, cleanText(raw.LegalName), type, date, cleanText(raw.ProductType), cleanText(raw.State), caseId]);
      inserted++;
    }
    if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
  }

  db.save(true);
  const total = db.queryOne('SELECT COUNT(*) as cnt FROM fda_compliance_actions')?.cnt || 0;
  console.log(`[FDA-COMPLIANCE] Sync completo: ${total} acciones en base local.`);
  return { ok: true, feis_queried: queried, processed: inserted, total };
}

async function syncInspections() {
  if (!hasCredentials()) {
    return { ok: true, skipped: true, message: 'Sin credenciales FDA_DDAPI_USER/FDA_DDAPI_KEY.' };
  }
  ensureTables();
  const feis = collectLocalFeis();
  if (!feis.length) {
    return { ok: true, skipped: true, message: 'Sin FEI numbers locales. Ejecuta primero el sync de entries.' };
  }

  console.log(`[FDA-INSPECTIONS] Consultando inspections para ${feis.length} FEIs.`);
  let inserted = 0;

  for (const batch of chunk(feis, FEI_BATCH)) {
    const json = await postDdapi('inspections_classifications', {
      start: 1,
      rows: 5000,
      sort: 'InspectionEndDate',
      sortorder: 'DESC',
      returntotalcount: false,
      filters: { FEINumber: batch },
      columns: ['FEINumber', 'LegalName', 'InspectionID', 'Classification', 'InspectionEndDate', 'ProjectArea', 'ProductType', 'City', 'CountryName']
    });
    const rows = Array.isArray(json.result) ? json.result : [];
    for (const raw of rows) {
      const fei = cleanText(raw.FEINumber);
      const inspId = cleanText(raw.InspectionID);
      const area = cleanText(raw.ProjectArea);
      const rowKey = `${fei}|${inspId}|${area}`;
      db.runRaw(`INSERT OR IGNORE INTO fda_inspections
        (row_key, fei_number, legal_name, inspection_id, classification, inspection_end_date, project_area, product_type, city, country)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [rowKey, fei, cleanText(raw.LegalName), inspId, cleanText(raw.Classification),
         isoDate(raw.InspectionEndDate), area, cleanText(raw.ProductType),
         cleanText(raw.City), cleanText(raw.CountryName)]);
      inserted++;
    }
    if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
  }

  db.save(true);
  const total = db.queryOne('SELECT COUNT(*) as cnt FROM fda_inspections')?.cnt || 0;
  console.log(`[FDA-INSPECTIONS] Sync completo: ${total} inspecciones en base local.`);
  return { ok: true, processed: inserted, total };
}

async function syncComplianceAll() {
  const compliance = await syncComplianceActions();
  const inspections = await syncInspections();
  return { ok: true, compliance, inspections };
}

module.exports = {
  hasCredentials,
  ensureTables,
  syncComplianceActions,
  syncInspections,
  syncComplianceAll
};
