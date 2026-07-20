const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db/database');

const TARGET_COUNTRY = process.env.FDA_REFUSALS_COUNTRY || 'El Salvador';
const TARGET_COUNTRY_CODE = process.env.FDA_REFUSALS_COUNTRY_CODE || 'SV';
const MIN_ACCEPT_TOTAL = Math.max(1, Number(process.env.FDA_REFUSALS_MIN_TOTAL || 500));
const MIN_ACCEPT_RATIO = Math.max(0.1, Math.min(1, Number(process.env.FDA_REFUSALS_MIN_ACCEPT_RATIO || 0.85)));

const COUNTRY_BY_CODE = {
  SV: 'El Salvador', MX: 'Mexico', GT: 'Guatemala', HN: 'Honduras', NI: 'Nicaragua', CR: 'Costa Rica', PA: 'Panama',
  US: 'United States', CN: 'China', IN: 'India', VN: 'Vietnam', KR: 'Korea, Republic of', JP: 'Japan'
};

function cleanText(value = '') {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normKey(value = '') {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getAny(row, aliases) {
  if (!row) return '';
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null && row[alias] !== '') return row[alias];
  }
  const normalized = Object.create(null);
  for (const [k, v] of Object.entries(row)) normalized[normKey(k)] = v;
  for (const alias of aliases) {
    const val = normalized[normKey(alias)];
    if (val !== undefined && val !== null && val !== '') return val;
  }
  return '';
}

function parseAddress(rawAddress = '') {
  const parts = String(rawAddress || '').split(',').map(s => cleanText(s)).filter(Boolean);
  return {
    city: parts.length >= 2 ? parts[parts.length - 2] : '',
    country: parts.length ? parts[parts.length - 1] : ''
  };
}

function parseProduct(rawCode = '', rawDesc = '') {
  const combined = cleanText(rawCode || rawDesc || '');
  const descOnly = cleanText(rawDesc || '');
  if (rawCode && rawDesc && !String(rawCode).includes('\\')) {
    return { code: cleanText(rawCode), desc: descOnly || cleanText(rawCode) };
  }
  if (combined.includes('\\')) {
    const parts = combined.split('\\').map(cleanText).filter(Boolean);
    return { code: parts[0] || '', desc: parts.slice(1).join(' — ') || combined };
  }
  const m = combined.match(/^([0-9]{2}[A-Z0-9]{3,})\s+(.+)$/i);
  if (m) return { code: cleanText(m[1]), desc: cleanText(m[2]) };
  return { code: combined, desc: descOnly || combined };
}

function normalizeDate(value = '') {
  const raw = cleanText(value);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.substring(0, 10);
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    const [mmRaw, ddRaw, yyyyRaw] = raw.split('/');
    const mm = mmRaw.padStart(2, '0');
    const dd = ddRaw.padStart(2, '0');
    const yyyy = yyyyRaw.padStart(4, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 20000 && serial < 90000) {
      const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      if (!Number.isNaN(date.getTime())) return date.toISOString().substring(0, 10);
    }
  }
  return raw;
}

function isTargetCountry(value = '') {
  const raw = cleanText(value);
  const mapped = COUNTRY_BY_CODE[raw.toUpperCase()] || raw;
  const norm = normKey(mapped);
  return raw.toUpperCase() === TARGET_COUNTRY_CODE.toUpperCase() ||
    norm === normKey(TARGET_COUNTRY) ||
    normKey(raw) === normKey(TARGET_COUNTRY_CODE) ||
    norm === 'salvador' ||
    norm.endsWith(' el salvador');
}

function rowLooksValid(row = {}) {
  if (!row || !row.firm_name) return false;
  const text = [row.firm_name, row.product_code_description, row.refusal_charges, row.shipment_id_ref].join(' ');
  if (/no records|no data|not found/i.test(text)) return false;
  return !!(row.product_code_description || row.refusal_charges || row.shipment_id_ref || row.refusal_date);
}

function parseRowFDA(r = {}) {
  const firmName = cleanText(getAny(r, ['Firm Legal Name', 'FirmName', 'Firm Name', 'LegalName', 'Legal Name']));
  if (!firmName) return null;

  const address = parseAddress(getAny(r, ['Firm Address', 'FirmAddress', 'Address', 'AddressLine1']));
  const countryRaw = cleanText(getAny(r, ['CountryName', 'Country Name', 'Country', 'CountryCode', 'Country Code'])) || address.country || TARGET_COUNTRY;
  const country = COUNTRY_BY_CODE[countryRaw.toUpperCase()] || countryRaw;
  const city = cleanText(getAny(r, ['City', 'CityName', 'Firm City'])) || address.city;

  const productCombined = getAny(r, ['Product Code and Description', 'ProductCodeAndDescription', 'Product', 'ProductDescription']);
  const productCode = getAny(r, ['ProductCode', 'Product Code', 'IndustryCode', 'Industry Code']);
  const productDesc = getAny(r, ['ProductCodeDescription', 'Product Code Description', 'Product Description', 'Description']);
  const prod = parseProduct(productCode || productCombined, productDesc || productCombined);

  const refDate = normalizeDate(getAny(r, ['Refused Date', 'RefusalDate', 'Refusal Date', 'Date Refused', 'Date']));
  const shipment = cleanText(getAny(r, ['Shipment ID', 'ShipmentID', 'ShipmentId', 'Shipment', 'Entry Line', 'EntryLine']));
  const charges = cleanText(getAny(r, ['Refusal Charges', 'RefusalCharges', 'Charges', 'Charge', 'ChargeCode', 'Charge Code']));
  const district = cleanText(getAny(r, ['Import Division', 'ImportDivision', 'DistrictDescription', 'District Description', 'Import District', 'ImportDistrict', 'District']));

  return {
    firm_name: firmName,
    city,
    country_name: country,
    product_category: prod.code || '',
    product_code_description: prod.desc || productCombined || '',
    refusal_date: refDate,
    refusal_charges: charges,
    district_description: district,
    shipment_id_ref: shipment
  };
}

function hasTargetCountryEvidence(raw = {}) {
  const entries = Object.entries(raw || {});
  const countryLikeValues = entries
    .filter(([key]) => /country|area|address|firm address|manufacturer address/i.test(String(key || '')))
    .map(([, value]) => cleanText(value));
  const combinedCountry = countryLikeValues.join(' | ');
  if (countryLikeValues.some(value => isTargetCountry(value))) return true;
  if (/\bSV\b/i.test(combinedCountry)) return true;
  if (normKey(combinedCountry).includes(normKey(TARGET_COUNTRY))) return true;

  const allText = entries.map(([, value]) => cleanText(value)).join(' | ');
  return /\bSV\b/i.test(allText) || normKey(allText).includes(normKey(TARGET_COUNTRY));
}

function normalizeForDb(row = {}) {
  const countryEvidence = hasTargetCountryEvidence(row);
  const parsed = parseRowFDA(row) || row;
  const normalized = {
    firm_name: cleanText(parsed.firm_name || parsed.FirmName || parsed['Firm Legal Name'] || ''),
    city: cleanText(parsed.city || parsed.City || ''),
    country_name: cleanText(parsed.country_name || parsed.CountryName || parsed['Country Name'] || parsed.CountryCode || parsed['Country Code'] || TARGET_COUNTRY),
    product_category: cleanText(parsed.product_category || parsed.ProductCode || parsed['Product Code'] || ''),
    product_code_description: cleanText(parsed.product_code_description || parsed.ProductCodeDescription || parsed['Product Code Description'] || parsed.ProductDescription || ''),
    refusal_date: normalizeDate(parsed.refusal_date || parsed.RefusalDate || parsed['Refusal Date'] || parsed['Refused Date'] || ''),
    refusal_charges: cleanText(parsed.refusal_charges || parsed.RefusalCharges || parsed['Refusal Charges'] || ''),
    district_description: cleanText(parsed.district_description || parsed.DistrictDescription || parsed['District Description'] || parsed['Import Division'] || ''),
    shipment_id_ref: cleanText(parsed.shipment_id_ref || parsed.ShipmentID || parsed['Shipment ID'] || '')
  };
  if (/^sv$/i.test(normalized.country_name)) normalized.country_name = TARGET_COUNTRY;
  normalized._targetCountryEvidence = countryEvidence || isTargetCountry(normalized.country_name);
  return normalized;
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

function insertBatch(rawRows, table = 'fda_refusals_stage') {
  if (!rawRows.length) return 0;
  let inserted = 0;
  db.runRaw('BEGIN');
  try {
    for (const raw of rawRows) {
      const row = normalizeForDb(raw);
      if (!rowLooksValid(row)) continue;
      if (!row._targetCountryEvidence) continue;
      if (!isTargetCountry(row.country_name)) continue;
      row.country_name = TARGET_COUNTRY;
      delete row._targetCountryEvidence;
      const rowKey = db.buildRefusalRowKey(row);
      db.runRaw(`INSERT OR IGNORE INTO ${table}
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

function count(sql, params = []) {
  return db.queryOne(sql, params)?.cnt || 0;
}

function tableRowKeyHash(table, country = '') {
  const safeTable = table === 'fda_refusals_stage' ? 'fda_refusals_stage' : 'fda_refusals';
  const params = [];
  let sql = `SELECT row_key FROM ${safeTable}`;
  if (country) {
    sql += ' WHERE LOWER(country_name)=LOWER(?)';
    params.push(country);
  }
  sql += ' ORDER BY row_key';
  const rows = db.query(sql, params);
  const hash = crypto.createHash('sha1');
  for (const row of rows) hash.update(String(row.row_key || '')).update('\n');
  return { count: rows.length, hash: hash.digest('hex') };
}

function backupDbFileBeforePromote() {
  try {
    const dbPath = path.resolve(process.env.DB_PATH || './data/tradeflow.db');
    if (!fs.existsSync(dbPath)) return '';
    const backupPath = dbPath + '.last-good-before-fda-official-sync';
    fs.copyFileSync(dbPath, backupPath);
    return backupPath;
  } catch (err) {
    console.log('[FDA-OFFICIAL] No se pudo crear backup previo:', err.message);
    return '';
  }
}

function promoteStage(stageTotal, sourceName = 'fda-official') {
  const current = count('SELECT COUNT(*) as cnt FROM fda_refusals WHERE LOWER(country_name)=LOWER(?)', [TARGET_COUNTRY]);
  const stageSv = count('SELECT COUNT(*) as cnt FROM fda_refusals_stage WHERE LOWER(country_name)=LOWER(?)', [TARGET_COUNTRY]);
  const stageOther = count('SELECT COUNT(*) as cnt FROM fda_refusals_stage WHERE LOWER(country_name)<>LOWER(?)', [TARGET_COUNTRY]);
  if (stageOther > 0) db.runRaw('DELETE FROM fda_refusals_stage WHERE LOWER(country_name)<>LOWER(?)', [TARGET_COUNTRY]);

  const newRows = count(`SELECT COUNT(*) as cnt FROM fda_refusals_stage s
    LEFT JOIN fda_refusals f ON f.row_key = s.row_key
    WHERE f.row_key IS NULL`);
  const removedRows = count(`SELECT COUNT(*) as cnt FROM fda_refusals f
    LEFT JOIN fda_refusals_stage s ON s.row_key = f.row_key
    WHERE LOWER(f.country_name)=LOWER(?) AND s.row_key IS NULL`, [TARGET_COUNTRY]);

  if (stageSv < MIN_ACCEPT_TOTAL) {
    return {
      ok: true,
      skipped: true,
      rejected: true,
      base_preserved: true,
      strategy: sourceName,
      total: current,
      downloaded: stageSv,
      message: `Descarga rechazada: FDA entregó ${stageSv} filas SV; mínimo aceptado ${MIN_ACCEPT_TOTAL}.`
    };
  }

  if (current >= MIN_ACCEPT_TOTAL && stageSv < Math.floor(current * MIN_ACCEPT_RATIO)) {
    return {
      ok: true,
      skipped: true,
      rejected: true,
      base_preserved: true,
      strategy: sourceName,
      total: current,
      downloaded: stageSv,
      message: `Descarga rechazada: FDA entregó ${stageSv}, menor al ${(MIN_ACCEPT_RATIO * 100).toFixed(0)}% de la base local (${current}).`
    };
  }

  const currentStats = tableRowKeyHash('fda_refusals', TARGET_COUNTRY);
  const stageStats = tableRowKeyHash('fda_refusals_stage', TARGET_COUNTRY);
  if (currentStats.count === stageStats.count && currentStats.hash === stageStats.hash) {
    return {
      ok: true,
      skipped: true,
      no_changes: true,
      strategy: sourceName,
      country: TARGET_COUNTRY,
      total: current,
      previous_total: current,
      downloaded: stageSv,
      added: 0,
      removed: 0,
      sourceFile: sourceName,
      message: 'Dataset oficial FDA procesado; no hay diferencias contra la base local.'
    };
  }

  const backup = backupDbFileBeforePromote();
  db.runRaw('BEGIN');
  try {
    db.runRaw('DELETE FROM fda_refusals WHERE LOWER(country_name)=LOWER(?)', [TARGET_COUNTRY]);
    db.runRaw(`INSERT OR IGNORE INTO fda_refusals
      (row_key, firm_name, city, country_name, product_category, product_code_description,
       refusal_date, refusal_charges, district_description, shipment_id_ref)
      SELECT row_key, firm_name, city, country_name, product_category, product_code_description,
       refusal_date, refusal_charges, district_description, shipment_id_ref
      FROM fda_refusals_stage
      WHERE LOWER(country_name)=LOWER(?)`, [TARGET_COUNTRY]);
    db.runRaw('COMMIT');
    db.save(true);
  } catch (err) {
    try { db.runRaw('ROLLBACK'); } catch (_) {}
    throw err;
  }

  const after = count('SELECT COUNT(*) as cnt FROM fda_refusals WHERE LOWER(country_name)=LOWER(?)', [TARGET_COUNTRY]);
  return {
    ok: true,
    strategy: sourceName,
    country: TARGET_COUNTRY,
    total: after,
    previous_total: current,
    downloaded: stageSv,
    added: newRows,
    removed: removedRows,
    replaced: true,
    backup,
    sourceFile: sourceName,
    message: `Base FDA SV reemplazada desde fuente oficial: ${after} registros (${newRows} nuevos, ${removedRows} removidos).`
  };
}

module.exports = {
  TARGET_COUNTRY,
  TARGET_COUNTRY_CODE,
  cleanText,
  normKey,
  normalizeDate,
  isTargetCountry,
  rowLooksValid,
  parseRowFDA,
  normalizeForDb,
  ensureStageTable,
  insertBatch,
  promoteStage
};
