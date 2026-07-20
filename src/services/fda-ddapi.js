const db = require('../db/database');
const { normalizeForDb, promoteStage } = require('./fda-official-normalize');

const API_URL = process.env.FDA_DDAPI_URL || 'https://api-datadashboard.fda.gov/v1/import_refusals';
const TARGET_COUNTRY = process.env.FDA_REFUSALS_COUNTRY || 'El Salvador';
const TARGET_COUNTRY_CODE = process.env.FDA_REFUSALS_COUNTRY_CODE || 'SV';
const PAGE_SIZE = Math.min(5000, Math.max(100, Number(process.env.FDA_DDAPI_PAGE_SIZE || 5000)));
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.FDA_DDAPI_DELAY_MS || 250));
const TIMEOUT_MS = Math.max(10000, Number(process.env.FDA_DDAPI_TIMEOUT_MS || 45000));
const MAX_PAGES = Math.max(1, Number(process.env.FDA_DDAPI_MAX_PAGES || 1000));

const DEFAULT_COLUMNS = [
  'FEINumber',
  'FirmName',
  'AddressLine1',
  'AddressLine2',
  'City',
  'CountryCode',
  'CountryName',
  'DistrictCode',
  'DistrictDescription',
  'IndustryCode',
  'IndustryCodeDescription',
  'ProductCategory',
  'ProductCode',
  'ProductCodeDescription',
  'RefusalDate',
  'ShipmentID',
  'FDASampleAnalysis',
  'PrivateLabAnalysis',
  'RefusalCharges',
  'FirmProfile'
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function hasCredentials() {
  return !!(process.env.FDA_DDAPI_USER && process.env.FDA_DDAPI_KEY);
}

function getCredentialsStatus() {
  return {
    configured: hasCredentials(),
    user: process.env.FDA_DDAPI_USER ? maskEmail(process.env.FDA_DDAPI_USER) : '',
    endpoint: API_URL,
    countryCode: TARGET_COUNTRY_CODE,
    pageSize: PAGE_SIZE
  };
}

function maskEmail(email = '') {
  const clean = String(email || '').trim();
  const [name, domain] = clean.split('@');
  if (!name || !domain) return clean ? '***' : '';
  const safeName = name.length <= 2 ? `${name[0] || '*'}***` : `${name.slice(0, 2)}***${name.slice(-1)}`;
  return `${safeName}@${domain}`;
}

function configuredColumns() {
  const raw = String(process.env.FDA_DDAPI_COLUMNS || '').trim();
  if (!raw) return DEFAULT_COLUMNS;
  const cols = raw.split(',').map(s => s.trim()).filter(Boolean);
  return cols.length ? cols : DEFAULT_COLUMNS;
}

function ensureStageTable() {
  db.runRaw(`CREATE TABLE IF NOT EXISTS fda_refusals_stage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    row_key TEXT NOT NULL UNIQUE,
    firm_name TEXT NOT NULL,
    city TEXT DEFAULT '',
    country_name TEXT DEFAULT 'El Salvador',
    product_category TEXT DEFAULT '',
    product_code_description TEXT DEFAULT '',
    refusal_date TEXT,
    refusal_charges TEXT DEFAULT '',
    district_description TEXT DEFAULT '',
    shipment_id_ref TEXT DEFAULT ''
  )`);
  db.runRaw('DELETE FROM fda_refusals_stage');
  db.save(true);
}

function cleanText(value = '') {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normKey(value = '') {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isTargetCountry(value = '') {
  const raw = cleanText(value);
  return raw.toUpperCase() === TARGET_COUNTRY_CODE.toUpperCase() ||
    normKey(raw) === normKey(TARGET_COUNTRY) ||
    normKey(raw) === 'salvador' ||
    normKey(raw).endsWith(' el salvador');
}

function rowLooksValid(row = {}) {
  if (!row || !row.firm_name) return false;
  const text = [row.firm_name, row.product_code_description, row.refusal_charges, row.shipment_id_ref].join(' ');
  if (/no records|no data|not found/i.test(text)) return false;
  return !!(row.product_code_description || row.refusal_charges || row.shipment_id_ref || row.refusal_date);
}

function normalizeApiRow(raw = {}) {
  const merged = { ...raw };

  // La API devuelve nombres como FirmName/ProductCode/RefusalDate. El normalizador
  // histórico también soporta encabezados del Excel oficial; duplicamos aliases para
  // mantener una sola ruta de normalización entre API e importación manual.
  if (raw.FirmName && !merged['Firm Legal Name']) merged['Firm Legal Name'] = raw.FirmName;
  if (raw.AddressLine1 && !merged['Firm Address']) {
    merged['Firm Address'] = [raw.AddressLine1, raw.AddressLine2, raw.City, raw.CountryName || raw.CountryCode]
      .map(cleanText).filter(Boolean).join(', ');
  }
  if (raw.CountryCode && !merged['Country Code']) merged['Country Code'] = raw.CountryCode;
  if (raw.CountryName && !merged['Country Name']) merged['Country Name'] = raw.CountryName;
  if (raw.ProductCode && !merged['Product Code']) merged['Product Code'] = raw.ProductCode;
  if (!merged['Product Code'] && raw.IndustryCode) merged['Product Code'] = raw.IndustryCode;
  if (raw.ProductCodeDescription && !merged['Product Code Description']) merged['Product Code Description'] = raw.ProductCodeDescription;
  if (raw.RefusalDate && !merged['Refused Date']) merged['Refused Date'] = raw.RefusalDate;
  if (raw.RefusalCharges && !merged['Refusal Charges']) merged['Refusal Charges'] = raw.RefusalCharges;
  if (raw.DistrictDescription && !merged['Import Division']) merged['Import Division'] = raw.DistrictDescription;
  if (raw.ShipmentID !== undefined && raw.ShipmentID !== null && !merged['Shipment ID']) merged['Shipment ID'] = raw.ShipmentID;

  const row = normalizeForDb(merged);
  if (!isTargetCountry(raw.CountryCode || raw.CountryName || row.country_name)) return null;
  row.country_name = TARGET_COUNTRY;
  return row;
}

function insertApiRows(rawRows = []) {
  let inserted = 0;
  if (!rawRows.length) return 0;
  db.runRaw('BEGIN');
  try {
    for (const raw of rawRows) {
      const row = normalizeApiRow(raw);
      if (!row || !rowLooksValid(row)) continue;
      const rowKey = db.buildRefusalRowKey(row);
      db.runRaw(`INSERT OR IGNORE INTO fda_refusals_stage
        (row_key, firm_name, city, country_name, product_category, product_code_description,
         refusal_date, refusal_charges, district_description, shipment_id_ref)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [rowKey, row.firm_name, row.city, row.country_name, row.product_category,
         row.product_code_description, row.refusal_date, row.refusal_charges,
         row.district_description, row.shipment_id_ref]);
      inserted++;
    }
    db.runRaw('COMMIT');
    db.save(true);
    return inserted;
  } catch (err) {
    try { db.runRaw('ROLLBACK'); } catch (_) {}
    throw err;
  }
}

function normalizeApiErrorPayload(json = {}) {
  const parts = [];
  if (json.message) parts.push(String(json.message));
  for (const key of ['invalid_columns', 'invalid_filters', 'invalid_filters_type', 'invalid_parameters', 'fieldnames_with_invalid_values', 'missing_parameters']) {
    if (Array.isArray(json[key]) && json[key].length) parts.push(`${key}: ${json[key].join(', ')}`);
  }
  if (json.raw && !parts.length) parts.push(String(json.raw).slice(0, 400));
  return parts.join(' | ') || 'Error desconocido FDA DDAPI';
}

function assertDdapiSuccess(json = {}) {
  const status = Number(json.statuscode);
  // La DDAPI usa statuscode=400 para éxito y 412 para no results, aunque HTTP sea 200.
  if (status === 400 || status === 412 || !Number.isFinite(status)) return;
  throw new Error(`FDA DDAPI statuscode ${status}: ${normalizeApiErrorPayload(json)}`);
}

async function postApi(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
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
    if (!res.ok) {
      const msg = normalizeApiErrorPayload(json) || `HTTP ${res.status}`;
      throw new Error(`FDA DDAPI HTTP ${res.status}: ${String(msg).slice(0, 500)}`);
    }
    assertDdapiSuccess(json);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function getRowsFromResponse(json = {}) {
  if (Array.isArray(json.result)) return json.result;
  if (Array.isArray(json.results)) return json.results;
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.rows)) return json.rows;
  return [];
}

function getTotalFromResponse(json = {}) {
  const candidates = [json.totalrecordcount, json.totalRecordCount, json.total, json.count];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function buildRequestBody({ start = 1, rows = PAGE_SIZE, returntotalcount = false } = {}) {
  return {
    start,
    rows,
    sort: 'RefusalDate',
    sortorder: 'ASC',
    returntotalcount,
    filters: { CountryCode: [TARGET_COUNTRY_CODE] },
    columns: configuredColumns()
  };
}

async function testDdapiConnection() {
  if (!hasCredentials()) throw new Error('Faltan FDA_DDAPI_USER/FDA_DDAPI_KEY en .env');
  const json = await postApi(buildRequestBody({ start: 1, rows: 1, returntotalcount: true }));
  const rows = getRowsFromResponse(json);
  return {
    ok: true,
    provider: 'ddapi',
    endpoint: API_URL,
    countryCode: TARGET_COUNTRY_CODE,
    totalrecordcount: getTotalFromResponse(json),
    resultcount: Number(json.resultcount || rows.length || 0),
    sample: rows[0] ? {
      FirmName: rows[0].FirmName || '',
      CountryCode: rows[0].CountryCode || '',
      ProductCode: rows[0].ProductCode || '',
      RefusalDate: rows[0].RefusalDate || '',
      ShipmentID: rows[0].ShipmentID || ''
    } : null
  };
}

async function syncDdapiDataset() {
  if (!hasCredentials()) {
    const current = db.queryOne('SELECT COUNT(*) as cnt FROM fda_refusals WHERE LOWER(country_name)=LOWER(?)', [TARGET_COUNTRY])?.cnt || 0;
    return {
      ok: true,
      skipped: true,
      base_preserved: true,
      legal_safe: true,
      strategy: 'ddapi-official',
      provider: 'ddapi',
      total: current,
      message: 'No hay credenciales oficiales FDA_DDAPI_USER/FDA_DDAPI_KEY. Se conserva la base local y solo queda disponible la importación manual de archivo oficial.'
    };
  }

  ensureStageTable();
  console.log(`[FDA-DDAPI] Descargando refusals por API oficial FDA Data Dashboard: país ${TARGET_COUNTRY_CODE}.`);

  let start = 1;
  let page = 0;
  let apiTotal = null;
  let stageInserted = 0;

  while (page < MAX_PAGES) {
    page++;
    const body = buildRequestBody({ start, rows: PAGE_SIZE, returntotalcount: page === 1 });
    const json = await postApi(body);
    const rows = getRowsFromResponse(json);
    if (page === 1) apiTotal = getTotalFromResponse(json);
    if (!rows.length) break;

    stageInserted += insertApiRows(rows);
    console.log(`[FDA-DDAPI] Página ${page}: start=${start}, filas=${rows.length.toLocaleString()}, stage=${stageInserted.toLocaleString()}${apiTotal !== null ? `, total FDA=${apiTotal.toLocaleString()}` : ''}.`);

    if (rows.length < PAGE_SIZE) break;
    if (apiTotal !== null && start + rows.length > apiTotal) break;
    start += rows.length;
    if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
  }

  const result = promoteStage(stageInserted, 'fda-ddapi-official');
  result.provider = 'ddapi';
  result.strategy = 'ddapi-official';
  result.country = TARGET_COUNTRY;
  result.countryCode = TARGET_COUNTRY_CODE;
  result.downloaded = stageInserted;
  result.api_total = apiTotal;
  result.full = true;
  result.legal_safe = true;
  return result;
}

module.exports = {
  hasCredentials,
  getCredentialsStatus,
  buildRequestBody,
  testDdapiConnection,
  syncDdapiDataset
};
