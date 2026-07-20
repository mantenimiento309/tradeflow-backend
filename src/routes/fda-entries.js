const { Router } = require('express');
const db = require('../db/database');
const auth = require('../middleware/auth');
const fdaIed = require('../services/fda-ied');
const fdaCompliance = require('../services/fda-ddapi-compliance');
const prop65 = require('../services/prop65');
const { firmMatchScore } = require('../services/fda-firm-match');

const router = Router();

function isGuest(req) {
  return req.userRole === 'guest';
}

function requireAdmin(req, res) {
  if (req.userRole !== 'admin') {
    res.status(403).json({ ok: false, msg: 'Solo admin' });
    return false;
  }
  return true;
}

function toInt(value, def, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function cleanQueryText(value = '', maxLen = 140) {
  return String(value || '').replace(/[<>]/g, '').trim().slice(0, maxLen);
}

function buildEntriesWhere(query = {}) {
  let sql = ' WHERE 1=1';
  const params = [];
  const firm = cleanQueryText(query.firm || '', 140);
  const product = cleanQueryText(query.product || '', 140);
  const disposition = cleanQueryText(query.disposition || '', 60);
  const category = cleanQueryText(query.category || '', 60);
  const from = cleanQueryText(query.from || '', 10);
  const to = cleanQueryText(query.to || '', 10);
  if (firm) { sql += ' AND manufacturer_name LIKE ?'; params.push(`%${firm}%`); }
  if (product) { sql += ' AND (product_description LIKE ? OR product_code LIKE ?)'; params.push(`%${product}%`, `%${product}%`); }
  if (disposition) { sql += ' AND final_disposition LIKE ?'; params.push(`%${disposition}%`); }
  if (category) { sql += ' AND product_category LIKE ?'; params.push(`%${category}%`); }
  if (from) { sql += ' AND arrival_date >= ?'; params.push(from); }
  if (to) { sql += ' AND arrival_date <= ?'; params.push(to); }
  return { sql, params };
}

router.get('/entries/status', auth, (req, res) => {
  res.json({ ok: true, ...fdaIed.getEntriesStatus() });
});

router.get('/entries', auth, (req, res) => {
  const limit = isGuest(req) ? toInt(req.query.limit, 25, 1, 25) : toInt(req.query.limit, 100, 1, 1000);
  const offset = toInt(req.query.offset, 0, 0, 1000000);
  const { sql, params } = buildEntriesWhere(req.query);
  const total = db.queryOne('SELECT COUNT(*) as total FROM fda_entries' + sql, params)?.total || 0;
  const rows = db.query(
    'SELECT * FROM fda_entries' + sql + ' ORDER BY arrival_date DESC, id DESC LIMIT ? OFFSET ?',
    [...params, limit, offset]
  );
  res.json({ ok: true, data: { results: rows, total, returned: rows.length } });
});

router.get('/entries/summary', auth, (req, res) => {
  const { sql, params } = buildEntriesWhere(req.query);
  const total = db.queryOne('SELECT COUNT(*) as total FROM fda_entries' + sql, params)?.total || 0;
  const byYear = db.query(`SELECT substr(arrival_date, 1, 4) AS year, COUNT(*) as cnt FROM fda_entries${sql} AND arrival_date != '' GROUP BY year ORDER BY year`, params);
  const byCategory = db.query(`SELECT COALESCE(NULLIF(product_category,''),'N/A') AS name, COUNT(*) as cnt FROM fda_entries${sql} GROUP BY name ORDER BY cnt DESC LIMIT 10`, params);
  const byDisposition = db.query(`SELECT COALESCE(NULLIF(final_disposition,''),'Pendiente') AS name, COUNT(*) as cnt FROM fda_entries${sql} GROUP BY name ORDER BY cnt DESC LIMIT 10`, params);
  const topFirms = db.query(`SELECT manufacturer_name AS name, COUNT(*) as cnt FROM fda_entries${sql} AND manufacturer_name != '' GROUP BY manufacturer_name ORDER BY cnt DESC LIMIT 10`, params);
  const byPort = db.query(`SELECT COALESCE(NULLIF(port_division,''),'N/A') AS name, COUNT(*) as cnt FROM fda_entries${sql} GROUP BY name ORDER BY cnt DESC LIMIT 8`, params);
  res.json({
    ok: true, total,
    byYear: Object.fromEntries(byYear.map(r => [r.year, r.cnt])),
    byCategory: byCategory.map(r => [r.name, r.cnt]),
    byDisposition: byDisposition.map(r => [r.name, r.cnt]),
    topFirms: topFirms.map(r => [r.name, r.cnt]),
    byPort: byPort.map(r => [r.name, r.cnt])
  });
});

router.get('/entries/firm', auth, (req, res) => {
  const name = cleanQueryText(req.query.name || '', 140);
  if (!name) return res.json({ ok: true, data: { results: [], total: 0, query: '' } });

  const allFirms = db.query("SELECT manufacturer_name AS name, manufacturer_fei AS fei, COUNT(*) as cnt FROM fda_entries WHERE manufacturer_name != '' GROUP BY manufacturer_name, manufacturer_fei");
  const minScore = 0.55;
  const matched = allFirms
    .map(f => ({ ...f, score: firmMatchScore(name, f.name) }))
    .filter(f => f.score >= minScore)
    .sort((a, b) => (b.score - a.score) || (b.cnt - a.cnt));

  if (!matched.length) return res.json({ ok: true, data: { results: [], variants: [], total: 0, query: name } });

  const names = matched.map(f => f.name);
  const placeholders = names.map(() => '?').join(',');
  const limit = isGuest(req) ? 25 : 500;
  const rows = db.query(
    `SELECT * FROM fda_entries WHERE manufacturer_name IN (${placeholders}) ORDER BY arrival_date DESC, id DESC LIMIT ?`,
    [...names, limit]
  );
  const total = db.queryOne(
    `SELECT COUNT(*) as total FROM fda_entries WHERE manufacturer_name IN (${placeholders})`,
    names
  )?.total || 0;

  res.json({
    ok: true,
    data: {
      results: rows,
      variants: matched.slice(0, isGuest(req) ? 3 : 12),
      total,
      returned: rows.length,
      query: name
    }
  });
});

router.get('/compliance', auth, (req, res) => {
  const fei = cleanQueryText(req.query.fei || '', 20);
  const firm = cleanQueryText(req.query.firm || '', 140);
  let sql = 'SELECT * FROM fda_compliance_actions WHERE 1=1';
  const params = [];
  if (fei) { sql += ' AND fei_number = ?'; params.push(fei); }
  if (firm) { sql += ' AND legal_name LIKE ?'; params.push(`%${firm}%`); }
  sql += ' ORDER BY action_taken_date DESC LIMIT 200';
  res.json({ ok: true, data: db.query(sql, params) });
});

router.get('/inspections', auth, (req, res) => {
  const fei = cleanQueryText(req.query.fei || '', 20);
  const firm = cleanQueryText(req.query.firm || '', 140);
  let sql = 'SELECT * FROM fda_inspections WHERE 1=1';
  const params = [];
  if (fei) { sql += ' AND fei_number = ?'; params.push(fei); }
  if (firm) { sql += ' AND legal_name LIKE ?'; params.push(`%${firm}%`); }
  sql += ' ORDER BY inspection_end_date DESC LIMIT 200';
  res.json({ ok: true, data: db.query(sql, params) });
});

router.get('/prop65/status', auth, (req, res) => {
  res.json({ ok: true, ...prop65.getProp65Status() });
});

router.get('/prop65', auth, (req, res) => {
  const company = cleanQueryText(req.query.company || req.query.firm || '', 140);
  const chemical = cleanQueryText(req.query.chemical || '', 80);
  const product = cleanQueryText(req.query.product || '', 140);
  const limit = isGuest(req) ? 20 : 200;
  const rows = prop65.searchProp65({ company, chemical, product, limit });
  res.json({ ok: true, data: { results: rows, total: rows.length, query: company || product || chemical } });
});

router.post('/sync/prop65', auth, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await prop65.syncProp65();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/sync/entries', auth, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await fdaIed.syncEntriesWeekly();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/sync/compliance', auth, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await fdaCompliance.syncComplianceAll();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/entries/test', auth, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const result = await fdaIed.testIedConnection();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
