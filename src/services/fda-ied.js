const db = require('../db/database');

const IED_URL = process.env.FDA_IED_URL || 'https://api-datadashboard.fda.gov/search/IED/select';
const TARGET_COUNTRY = process.env.FDA_ENTRIES_COUNTRY || 'El Salvador';
const PAGE_SIZE = Math.min(5000, Math.max(200, Number(process.env.FDA_IED_PAGE_SIZE || 2000)));
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.FDA_IED_DELAY_MS || 400));
const TIMEOUT_MS = Math.max(10000, Number(process.env.FDA_IED_TIMEOUT_MS || 60000));
const MAX_PAGES = Math.max(1, Number(process.env.FDA_IED_MAX_PAGES || 500));
const MIN_ACCEPT_TOTAL = Math.max(1, Number(process.env.FDA_ENTRIES_MIN_TOTAL || 1000));
const MIN_ACCEPT_RATIO = Math.max(0.1, Math.min(1, Number(process.env.FDA_ENTRIES_MIN_ACCEPT_RATIO || 0.85)));

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'TradeFlowSV/1.0 (contacto: mantenimiento9090@gmail.com)',
  'Referer': 'https://datadashboard.fda.gov/oii/cd/impentry-table.htm'
};

const FIELDS = [
  'Shipment_ID', 'Arrival_Date', 'Submission_Date', 'Port_of_Entry_District',
  'Country_Of_Origin', 'Product_Code', 'Product_Category', 'Product_Code_Description',
  'Manufacturer_FEI_Number', 'Manufacturer_Legal_Name', 'Manufacturer_City_Name',
  'Filer_FEI_Number', 'Filer_Legal_Name',
  'Final_Disposition', 'Final_Disposition_Date'
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanText(value = '') {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function isoDate(value = '') {
  const s = String(value || '');
  return s.length >= 10 ? s.slice(0, 10) : '';
}

function ensureTables() {
  db.runRaw(`CREATE TABLE IF NOT EXISTS fda_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id TEXT NOT NULL UNIQUE,
    arrival_date TEXT DEFAULT '',
    submission_date TEXT DEFAULT '',
    port_division TEXT DEFAULT '',
    country_of_origin TEXT DEFAULT '',
    product_code TEXT DEFAULT '',
    product_category TEXT DEFAULT '',
    product_description TEXT DEFAULT '',
    manufacturer_fei TEXT DEFAULT '',
    manufacturer_name TEXT DEFAULT '',
    manufacturer_city TEXT DEFAULT '',
    filer_fei TEXT DEFAULT '',
    filer_name TEXT DEFAULT '',
    final_disposition TEXT DEFAULT '',
    final_disposition_date TEXT DEFAULT ''
  )`);
  db.runRaw('CREATE INDEX IF NOT EXISTS idx_fda_entries_mfg ON fda_entries (manufacturer_name)');
  db.runRaw('CREATE INDEX IF NOT EXISTS idx_fda_entries_fei ON fda_entries (manufacturer_fei)');
  db.runRaw('CREATE INDEX IF NOT EXISTS idx_fda_entries_arrival ON fda_entries (arrival_date)');
}

function ensureStageTable() {
  db.runRaw(`CREATE TABLE IF NOT EXISTS fda_entries_stage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id TEXT NOT NULL UNIQUE,
    arrival_date TEXT DEFAULT '',
    submission_date TEXT DEFAULT '',
    port_division TEXT DEFAULT '',
    country_of_origin TEXT DEFAULT '',
    product_code TEXT DEFAULT '',
    product_category TEXT DEFAULT '',
    product_description TEXT DEFAULT '',
    manufacturer_fei TEXT DEFAULT '',
    manufacturer_name TEXT DEFAULT '',
    manufacturer_city TEXT DEFAULT '',
    filer_fei TEXT DEFAULT '',
    filer_name TEXT DEFAULT '',
    final_disposition TEXT DEFAULT '',
    final_disposition_date TEXT DEFAULT ''
  )`);
  db.runRaw('DELETE FROM fda_entries_stage');
  db.save(true);
}

function normalizeDoc(raw = {}) {
  const shipmentId = cleanText(raw.Shipment_ID);
  if (!shipmentId) return null;
  return {
    shipment_id: shipmentId,
    arrival_date: isoDate(raw.Arrival_Date),
    submission_date: isoDate(raw.Submission_Date),
    port_division: cleanText(raw.Port_of_Entry_District),
    country_of_origin: cleanText(raw.Country_Of_Origin) || TARGET_COUNTRY,
    product_code: cleanText(raw.Product_Code),
    product_category: cleanText(raw.Product_Category),
    product_description: cleanText(raw.Product_Code_Description),
    manufacturer_fei: cleanText(raw.Manufacturer_FEI_Number),
    manufacturer_name: cleanText(raw.Manufacturer_Legal_Name),
    manufacturer_city: cleanText(raw.Manufacturer_City_Name),
    filer_fei: cleanText(raw.Filer_FEI_Number),
    filer_name: cleanText(raw.Filer_Legal_Name),
    final_disposition: cleanText(raw.Final_Disposition),
    final_disposition_date: isoDate(raw.Final_Disposition_Date)
  };
}

async function solrQuery(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(IED_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: HEADERS,
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); }
    catch (_) { throw new Error(`Respuesta IED no es JSON: ${text.slice(0, 200)}`); }
    if (!res.ok || json.error) {
      throw new Error(`FDA IED HTTP ${res.status}: ${json.error?.msg || text.slice(0, 200)}`);
    }
    return json.response || { numFound: 0, docs: [] };
  } finally {
    clearTimeout(timer);
  }
}

function buildQuery({ offset = 0, limit = PAGE_SIZE } = {}) {
  return {
    query: `Country_Of_Origin:"${TARGET_COUNTRY}"`,
    limit,
    offset,
    sort: 'Shipment_ID asc',
    fields: FIELDS
  };
}

async function testIedConnection() {
  const response = await solrQuery(buildQuery({ offset: 0, limit: 1 }));
  const doc = response.docs?.[0] || null;
  return {
    ok: true,
    provider: 'ied-solr',
    endpoint: IED_URL,
    country: TARGET_COUNTRY,
    total: response.numFound,
    sample: doc ? {
      Shipment_ID: doc.Shipment_ID || '',
      Manufacturer_Legal_Name: doc.Manufacturer_Legal_Name || '',
      Arrival_Date: doc.Arrival_Date || '',
      Product_Code: doc.Product_Code || ''
    } : null
  };
}

function insertStageRows(docs = []) {
  let inserted = 0;
  if (!docs.length) return 0;
  db.runRaw('BEGIN');
  try {
    for (const raw of docs) {
      const row = normalizeDoc(raw);
      if (!row) continue;
      db.runRaw(`INSERT OR IGNORE INTO fda_entries_stage
        (shipment_id, arrival_date, submission_date, port_division, country_of_origin,
         product_code, product_category, product_description, manufacturer_fei,
         manufacturer_name, manufacturer_city, filer_fei, filer_name,
         final_disposition, final_disposition_date)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [row.shipment_id, row.arrival_date, row.submission_date, row.port_division,
         row.country_of_origin, row.product_code, row.product_category,
         row.product_description, row.manufacturer_fei, row.manufacturer_name,
         row.manufacturer_city, row.filer_fei, row.filer_name,
         row.final_disposition, row.final_disposition_date]);
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

function promoteEntriesStage(stageInserted) {
  const current = db.queryOne('SELECT COUNT(*) as cnt FROM fda_entries')?.cnt || 0;
  const staged = db.queryOne('SELECT COUNT(*) as cnt FROM fda_entries_stage')?.cnt || 0;

  if (staged < MIN_ACCEPT_TOTAL) {
    return {
      ok: true, skipped: true, rejected: true, base_preserved: true,
      total: current, downloaded: staged,
      message: `Descarga rechazada: FDA entregó ${staged} entries; mínimo aceptado ${MIN_ACCEPT_TOTAL}.`
    };
  }
  if (current >= MIN_ACCEPT_TOTAL && staged < Math.floor(current * MIN_ACCEPT_RATIO)) {
    return {
      ok: true, skipped: true, rejected: true, base_preserved: true,
      total: current, downloaded: staged,
      message: `Descarga rechazada: FDA entregó ${staged}, menor al ${(MIN_ACCEPT_RATIO * 100).toFixed(0)}% de la base local (${current}).`
    };
  }

  db.runRaw('BEGIN');
  try {
    db.runRaw('DELETE FROM fda_entries');
    db.runRaw(`INSERT INTO fda_entries
      (shipment_id, arrival_date, submission_date, port_division, country_of_origin,
       product_code, product_category, product_description, manufacturer_fei,
       manufacturer_name, manufacturer_city, filer_fei, filer_name,
       final_disposition, final_disposition_date)
      SELECT shipment_id, arrival_date, submission_date, port_division, country_of_origin,
       product_code, product_category, product_description, manufacturer_fei,
       manufacturer_name, manufacturer_city, filer_fei, filer_name,
       final_disposition, final_disposition_date
      FROM fda_entries_stage`);
    db.runRaw('DELETE FROM fda_entries_stage');
    db.runRaw('COMMIT');
    db.save(true);
  } catch (err) {
    try { db.runRaw('ROLLBACK'); } catch (_) {}
    throw err;
  }

  const total = db.queryOne('SELECT COUNT(*) as cnt FROM fda_entries')?.cnt || 0;
  return {
    ok: true, promoted: true, total,
    downloaded: stageInserted,
    previous: current,
    new_rows: Math.max(0, total - current)
  };
}

let _entriesSyncPromise = null;

async function syncEntriesWeekly() {
  if (_entriesSyncPromise) {
    console.log('[FDA-IED] Descarga de entries ya en curso; no se lanza otra.');
    return { ok: true, inProgress: true, message: 'Descarga de entries ya en curso' };
  }
  _entriesSyncPromise = runEntriesSync();
  try {
    return await _entriesSyncPromise;
  } finally {
    _entriesSyncPromise = null;
  }
}

async function runEntriesSync() {
  ensureTables();
  ensureStageTable();
  console.log(`[FDA-IED] Descargando entries de ${TARGET_COUNTRY} desde FDA Data Dashboard (Solr público).`);

  const first = await solrQuery(buildQuery({ offset: 0, limit: 1 }));
  const apiTotal = first.numFound || 0;
  console.log(`[FDA-IED] FDA reporta ${apiTotal.toLocaleString()} entries para ${TARGET_COUNTRY}.`);

  let offset = 0;
  let page = 0;
  let stageInserted = 0;

  while (page < MAX_PAGES && offset < apiTotal) {
    page++;
    const response = await solrQuery(buildQuery({ offset, limit: PAGE_SIZE }));
    const docs = response.docs || [];
    if (!docs.length) break;

    stageInserted += insertStageRows(docs);
    console.log(`[FDA-IED] Página ${page}: offset=${offset.toLocaleString()}, filas=${docs.length.toLocaleString()}, stage=${stageInserted.toLocaleString()}.`);

    offset += docs.length;
    if (docs.length < PAGE_SIZE) break;
    if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
  }

  const result = promoteEntriesStage(stageInserted);
  setEntriesMeta('entries_last_attempt_at', new Date().toISOString());
  if (result.promoted) setEntriesMeta('entries_last_sync_at', new Date().toISOString());
  result.provider = 'ied-solr';
  result.strategy = 'ied-public-solr';
  result.country = TARGET_COUNTRY;
  result.api_total = apiTotal;
  result.legal_safe = true;
  console.log(`[FDA-IED] Sync completo: ${JSON.stringify({ total: result.total, downloaded: result.downloaded, rejected: !!result.rejected })}`);
  return result;
}

function setEntriesMeta(key, value) {
  db.runRaw('CREATE TABLE IF NOT EXISTS fda_sync_meta (key TEXT PRIMARY KEY, value TEXT)');
  db.runRaw('INSERT OR REPLACE INTO fda_sync_meta (key, value) VALUES (?, ?)', [key, String(value ?? '')]);
  db.save();
}

function getEntriesMeta(key) {
  try {
    return db.queryOne('SELECT value FROM fda_sync_meta WHERE key = ?', [key])?.value || null;
  } catch (_) {
    return null;
  }
}

function getEntriesStatus() {
  ensureTables();
  const total = db.queryOne('SELECT COUNT(*) as cnt FROM fda_entries')?.cnt || 0;
  const maxDate = db.queryOne('SELECT MAX(arrival_date) as maxDate FROM fda_entries')?.maxDate || '';
  const firms = db.queryOne('SELECT COUNT(DISTINCT manufacturer_name) as cnt FROM fda_entries')?.cnt || 0;
  return {
    total, firms, latestArrival: maxDate, country: TARGET_COUNTRY,
    lastSync: getEntriesMeta('entries_last_sync_at'),
    lastAttempt: getEntriesMeta('entries_last_attempt_at')
  };
}

module.exports = {
  testIedConnection,
  syncEntriesWeekly,
  getEntriesStatus,
  getEntriesMeta,
  ensureTables
};
