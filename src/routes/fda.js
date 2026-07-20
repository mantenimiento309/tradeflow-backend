const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db/database');
const auth = require('../middleware/auth');
const fdaSync = require('../services/fda-sync');
const { normalizeFirmName, firmTokens, firmMatchScore } = require('../services/fda-firm-match');

const router = Router();

// sql.js mantiene la DB en memoria. Si `npm run fda:sync` actualiza
// data/tradeflow.db en otro proceso, recargamos antes de responder lecturas FDA.
router.use((req, res, next) => {
  if (req.method === 'GET' && typeof db.refreshFromDiskIfChanged === 'function') {
    try { db.refreshFromDiskIfChanged(true); } catch (err) { console.log('[FDA] Reload externo omitido:', err.message); }
  }
  next();
});

function toInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}


function cleanQueryText(value, max = 120) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function escapeLike(value) {
  return String(value || '').replace(/[\\%_]/g, ch => '\\' + ch);
}

function publicDataVersion(parts = []) {
  return crypto.createHash('sha1').update(parts.map(v => String(v ?? '')).join('|')).digest('hex').slice(0, 16);
}

function categorySql(category) {
  const key = String(category || '').trim().toLowerCase();
  if (!key || key === 'all') return { sql: '', params: [] };
  const prefixExpr = "CAST(substr(product_category, 1, 2) AS INTEGER)";
  if (['food', 'foods', 'alimento', 'alimentos'].includes(key)) return { sql: ` AND ${prefixExpr} BETWEEN 2 AND 41`, params: [] };
  if (['drug', 'drugs', 'medicamento', 'medicamentos'].includes(key)) return { sql: ` AND ${prefixExpr} BETWEEN 50 AND 66 AND substr(product_category, 1, 2) <> '53'`, params: [] };
  if (['cosm', 'cosmetic', 'cosmetics', 'cosmetico', 'cosmeticos'].includes(key)) {
    return { sql: " AND (substr(product_category, 1, 2) = '53' OR LOWER(product_code_description) LIKE ?)", params: ['%cosmetic%'] };
  }
  return { sql: '', params: [] };
}

function productBucket(row) {
  const code = String(row.product_category || '').trim();
  const desc = String(row.product_code_description || '').toLowerCase();
  const prefix = parseInt(code.slice(0, 2), 10);
  if (code.slice(0, 2) === '53' || /cosmetic|cosmetics|shampoo|lotion|perfume|make\s*up|lipstick|mascara|eyeliner/.test(desc)) return 'Cosmetics';
  if (prefix >= 50 && prefix <= 66) return 'Drugs and Biologics';
  if (prefix >= 2 && prefix <= 41) return 'Human Foods';
  return 'Other';
}

function categoryCaseSql() {
  return `CASE
    WHEN substr(product_category, 1, 2) = '53' OR LOWER(product_code_description) LIKE '%cosmetic%' THEN 'Cosmetics'
    WHEN CAST(substr(product_category, 1, 2) AS INTEGER) BETWEEN 50 AND 66 THEN 'Drugs and Biologics'
    WHEN CAST(substr(product_category, 1, 2) AS INTEGER) BETWEEN 2 AND 41 THEN 'Human Foods'
    ELSE 'Other'
  END`;
}

function normalizeRefusalDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.substring(0, 10);
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 20000 && serial < 90000) {
      const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      if (!Number.isNaN(date.getTime())) return date.toISOString().substring(0, 10);
    }
  }
  return raw;
}

function buildRefusalWhere(query = {}) {
  let sql = ' WHERE 1=1';
  const params = [];
  const country = cleanQueryText(query.country ?? process.env.FDA_REFUSALS_COUNTRY ?? 'El Salvador', 60);
  if (country && country.toLowerCase() !== 'all') {
    sql += ' AND LOWER(country_name) = LOWER(?)';
    params.push(country);
  }
  const cat = categorySql(cleanQueryText(query.category, 30));
  if (cat.sql) { sql += cat.sql; params.push(...cat.params); }
  const search = cleanQueryText(query.search, 120);
  if (search) {
    const like = '%' + escapeLike(search) + '%';
    sql += ` AND (
      firm_name LIKE ? ESCAPE '\\' OR
      product_code_description LIKE ? ESCAPE '\\' OR
      refusal_charges LIKE ? ESCAPE '\\' OR
      shipment_id_ref LIKE ? ESCAPE '\\' OR
      district_description LIKE ? ESCAPE '\\'
    )`;
    params.push(like, like, like, like, like);
  }
  return { sql, params };
}
function mapRefusal(r) {
  return {
    FirmName: r.firm_name,
    City: r.city,
    CountryName: r.country_name,
    ProductCategory: productBucket(r),
    ProductCode: r.product_category,
    ProductCodeDescription: r.product_code_description,
    RefusalDate: normalizeRefusalDate(r.refusal_date),
    RefusalCharges: r.refusal_charges,
    DistrictDescription: r.district_description,
    ShipmentID: r.shipment_id_ref
  };
}

function firmScoreThreshold(name = '') {
  const tokens = firmTokens(name);
  if (tokens.length <= 1) return Math.max(72, Number(process.env.FDA_FIRM_MATCH_MIN_SCORE || 60));
  return Math.max(50, Math.min(90, Number(process.env.FDA_FIRM_MATCH_MIN_SCORE || 60)));
}

function objectFromCountRows(rows, keyName = 'key') {
  const out = {};
  for (const r of rows) out[r[keyName] || 'N/A'] = r.cnt || 0;
  return out;
}

function isGuest(req) {
  return req.userRole === 'guest';
}

function blockGuest(res, feature = 'esta sección') {
  return res.status(403).json({ ok: false, msg: `Cree una cuenta para desbloquear ${feature}.` });
}

router.get('/status', auth, (req, res) => {
  const country = cleanQueryText(req.query.country || process.env.FDA_REFUSALS_COUNTRY || 'El Salvador', 60);
  const filteredCountryRefusals = db.queryOne('SELECT COUNT(*) as total FROM fda_refusals WHERE LOWER(country_name)=LOWER(?)', [country])?.total || 0;
  const alerts = db.queryOne('SELECT COUNT(*) as total FROM fda_alerts')?.total || 0;
  const charges = db.queryOne('SELECT COUNT(*) as total FROM fda_charges')?.total || 0;
  const maxRow = db.queryOne('SELECT MAX(row_key) AS maxKey, MAX(refusal_date) AS maxDate FROM fda_refusals WHERE LOWER(country_name)=LOWER(?)', [country]) || {};
  const catExpr = categoryCaseSql();
  const categoryRows = db.query(`SELECT ${catExpr} AS bucket, COUNT(*) as cnt FROM fda_refusals WHERE LOWER(country_name)=LOWER(?) GROUP BY bucket`, [country]);
  res.json({
    ok: true,
    country,
    counts: { filteredCountryRefusals, totalRefusals: filteredCountryRefusals, alerts, charges },
    byCategory: objectFromCountRows(categoryRows, 'bucket'),
    dataVersion: publicDataVersion([filteredCountryRefusals, alerts, charges, maxRow.maxKey, maxRow.maxDate])
  });
});

router.get('/alerts', auth, (req, res) => {
  if (isGuest(req)) return blockGuest(res, 'Import Alerts completos');
  const data = db.query('SELECT * FROM fda_alerts ORDER BY publish_date DESC');
  res.json({ ok: true, data: data.map(a => ({ alertNumber: a.alert_number, alertTitle: a.alert_title, publishDate: a.publish_date, products: a.products, reason: a.reason, charge: a.charge, type: a.type, url: a.url })) });
});

router.get('/charges', auth, (req, res) => {
  if (isGuest(req)) return blockGuest(res, 'la referencia FDA completa');
  res.json({ ok: true, data: db.query('SELECT * FROM fda_charges ORDER BY code') });
});

router.get('/summary', auth, (req, res) => {
  const country = req.query.country || process.env.FDA_REFUSALS_COUNTRY || 'El Salvador';
  const { sql, params } = buildRefusalWhere({ country });
  const total = db.queryOne('SELECT COUNT(*) as total FROM fda_refusals' + sql, params)?.total || 0;
  const catExpr = categoryCaseSql();
  const byCategory = objectFromCountRows(db.query(`SELECT ${catExpr} AS bucket, COUNT(*) as cnt FROM fda_refusals${sql} GROUP BY bucket`, params), 'bucket');
  const byYear = objectFromCountRows(db.query(`SELECT substr(refusal_date, 1, 4) AS year, COUNT(*) as cnt FROM fda_refusals${sql} AND refusal_date IS NOT NULL AND refusal_date != '' GROUP BY year ORDER BY year`, params), 'year');
  const topFirms = db.query(`SELECT firm_name AS name, COUNT(*) as cnt FROM fda_refusals${sql} GROUP BY firm_name ORDER BY cnt DESC, firm_name LIMIT 10`, params).map(r => [r.name, r.cnt]);
  const byDistrict = db.query(`SELECT COALESCE(NULLIF(district_description,''),'N/A') AS name, COUNT(*) as cnt FROM fda_refusals${sql} GROUP BY name ORDER BY cnt DESC, name LIMIT 8`, params).map(r => [r.name, r.cnt]);
  const chargeCount = {};
  const chargeRows = db.query('SELECT refusal_charges FROM fda_refusals' + sql, params);
  for (const r of chargeRows) {
    for (const ch of (r.refusal_charges || '').split(',').map(c => c.trim()).filter(Boolean)) chargeCount[ch] = (chargeCount[ch] || 0) + 1;
  }
  const topCharges = Object.entries(chargeCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
  res.json({ ok: true, country, total, byCategory, byYear, topCharges, topFirms, byDistrict });
});

router.get('/refusals', auth, (req, res) => {
  const limit = isGuest(req) ? toInt(req.query.limit, 25, 1, 25) : toInt(req.query.limit, 250, 1, 1000);
  const offset = toInt(req.query.offset, 0, 0, 1000000);
  const { sql: whereSql, params } = buildRefusalWhere(req.query);
  const countRow = db.queryOne('SELECT COUNT(*) as total FROM fda_refusals' + whereSql, params);
  const rows = db.query('SELECT * FROM fda_refusals' + whereSql + ' ORDER BY refusal_date DESC, id DESC LIMIT ? OFFSET ?', [...params, limit, offset]);
  res.json({ ok: true, data: { results: rows.map(mapRefusal), total: countRow?.total || 0, returned: rows.length } });
});

router.get('/firm', auth, (req, res) => {
  const name = cleanQueryText(req.query.name || '', 140);
  const country = String(req.query.country || process.env.FDA_REFUSALS_COUNTRY || 'El Salvador').trim();
  if (!name) return res.json({ ok: true, data: { results: [], total: 0, query: '' } });

  // La FDA no normaliza igual todas las razones sociales: S.A. de C.V., SA DE CV,
  // mayúsculas, acentos y puntuación pueden variar. Por eso esta búsqueda usa un
  // filtro flexible en memoria sobre la DB SV compacta, no solo LIKE exacto.
  let sql = 'SELECT * FROM fda_refusals WHERE 1=1';
  const params = [];
  if (country && country.toLowerCase() !== 'all') { sql += ' AND LOWER(country_name) = LOWER(?)'; params.push(country); }
  const allRows = db.query(sql, params);
  const minScore = firmScoreThreshold(name);
  const scored = allRows
    .map(row => ({ row, score: firmMatchScore(name, row.firm_name) }))
    .filter(item => item.score >= minScore)
    .sort((a, b) => (b.score - a.score) || String(b.row.refusal_date || '').localeCompare(String(a.row.refusal_date || '')) || ((b.row.id || 0) - (a.row.id || 0)));

  const totalMatches = scored.length;
  const rows = scored.map(item => ({ ...mapRefusal(item.row), MatchScore: item.score }));
  const variants = db.query(`SELECT firm_name AS name, COUNT(*) as cnt FROM fda_refusals ${sql.replace('SELECT * FROM fda_refusals', '')} GROUP BY firm_name`, params)
    .map(r => ({ ...r, score: firmMatchScore(name, r.name) }))
    .filter(r => r.score >= minScore)
    .sort((a, b) => (b.score - a.score) || (b.cnt - a.cnt) || String(a.name).localeCompare(String(b.name)))
    .slice(0, isGuest(req) ? 3 : 12);
  const visibleRows = isGuest(req) ? rows.slice(0, 25) : rows;

  res.json({
    ok: true,
    data: {
      results: visibleRows,
      total: totalMatches,
      query: name,
      variants
    }
  });
});

module.exports = router;
