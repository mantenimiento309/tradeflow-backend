const { Router } = require('express');
const auth = require('../middleware/auth');
const db = require('../db/database');
const itacsLink = require('../services/itacs-link');

const router = Router();

/*
  Dashboard overview — optimizado para 1GB RAM con 500k+ refusals.

  Clave de rendimiento:
  - Todas las agregaciones se hacen EN SQL (GROUP BY), no trayendo filas a JS.
  - Se usa match exacto del nombre (usa índice, ~30ms) en vez de LIKE '%x%'
    que fuerza un full scan (~900ms). Si el exacto no da resultados, cae a LIKE.
  - Solo se traen a memoria las ~5 filas recientes que se muestran.
*/

// Resuelve cómo filtrar por empresa: exacto si existe (rápido), si no LIKE.
function resolveFirmFilter(company) {
  if (!company) return null;
  const exact = db.queryOne('SELECT 1 as x FROM fda_refusals WHERE firm_name = ? LIMIT 1', [company]);
  if (exact) return { clause: 'firm_name = ?', param: company };
  // Fallback: LIKE (más lento pero solo si el nombre no coincide exacto)
  return { clause: 'firm_name LIKE ?', param: `%${company}%` };
}

// Computa todas las agregaciones FDA de una empresa (se cachea el resultado).
function computeFdaAggregates(company) {
  const empty = { refusalsCount: 0, byYear: {}, topCharges: [], topCategories: [], recentRefusals: [], withEntry: 0 };
  const filter = resolveFirmFilter(company);
  if (!filter) return empty;

  const w = filter.clause, p = [filter.param];
  const refusalsCount = db.queryOne(`SELECT COUNT(*) as c FROM fda_refusals WHERE ${w}`, p)?.c || 0;
  if (refusalsCount === 0) return empty;

  const byYear = {};
  const yearRows = db.query(
    `SELECT substr(refusal_date,1,4) as y, COUNT(*) as c
     FROM fda_refusals WHERE ${w} AND refusal_date IS NOT NULL
     GROUP BY y ORDER BY y`, p
  );
  for (const row of yearRows) if (row.y && /^\d{4}$/.test(row.y)) byYear[row.y] = row.c;

  const topCategories = db.query(
    `SELECT product_category as category, COUNT(*) as count
     FROM fda_refusals WHERE ${w} AND product_category != ''
     GROUP BY product_category ORDER BY count DESC LIMIT 5`, p
  );

  const recentRefusals = db.query(
    `SELECT product_category, refusal_date, refusal_charges, shipment_id_ref, product_code_description, district_description
     FROM fda_refusals WHERE ${w} ORDER BY refusal_date DESC LIMIT 5`, p
  );

  const chargeRows = db.query(
    `SELECT refusal_charges FROM fda_refusals WHERE ${w} AND refusal_charges != '' LIMIT 2000`, p
  );
  const byCharge = {};
  for (const cr of chargeRows) {
    const cs = (cr.refusal_charges || '').split(',');
    for (let j = 0; j < cs.length; j++) {
      const ch = cs[j].trim();
      if (ch) byCharge[ch] = (byCharge[ch] || 0) + 1;
    }
  }
  const topCharges = Object.entries(byCharge).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([code, count]) => ({ code, count }));

  const withEntry = db.queryOne(
    `SELECT COUNT(*) as c FROM fda_refusals WHERE ${w} AND shipment_id_ref LIKE '%-%/%'`, p
  )?.c || 0;

  return { refusalsCount, byYear, topCharges, topCategories, recentRefusals, withEntry };
}

router.get('/overview', auth, (req, res) => {
  const user = req.isGuest
    ? { id: 0, company: req.guestCompany, ior_number: 'DEMO' }
    : db.queryOne('SELECT id, company, ior_number FROM users WHERE id = ?', [req.userId]);
  const company = user?.company || '';

  // ── Envíos: conteos agregados en SQL ──
  const statusRows = db.query(
    'SELECT status, COUNT(*) as cnt FROM shipments WHERE user_id = ? GROUP BY status',
    [req.userId]
  );
  const counts = { held: 0, review: 0, transit: 0, clear: 0 };
  let totalShipments = 0;
  for (const r of statusRows) {
    if (counts[r.status] !== undefined) counts[r.status] = r.cnt;
    totalShipments += r.cnt;
  }
  const recentShipments = db.query(
    'SELECT id, entry_number, product, vessel, dest_port, eta, status FROM shipments WHERE user_id = ? ORDER BY id DESC LIMIT 5',
    [req.userId]
  );

  // ── Refusals: agregación cacheada por empresa + fecha de datos FDA ──
  const meta = require('../services/fda-sync').getSyncMeta();
  const dataDate = meta.refusals_updated_at || 'none';
  const cacheKey = `fda:${company}:${dataDate}`;

  let fdaAgg = null;
  const cached = db.queryOne('SELECT payload FROM dashboard_cache WHERE cache_key = ?', [cacheKey]);
  if (cached) {
    try { fdaAgg = JSON.parse(cached.payload); } catch (_) { fdaAgg = null; }
  }

  if (!fdaAgg) {
    fdaAgg = computeFdaAggregates(company);
    // Guardar en cache (limpia entradas viejas de la misma empresa primero)
    db.run('DELETE FROM dashboard_cache WHERE cache_key LIKE ?', [`fda:${company}:%`]);
    db.run('INSERT OR REPLACE INTO dashboard_cache (cache_key, payload) VALUES (?, ?)',
      [cacheKey, JSON.stringify(fdaAgg)]);
  }

  const { refusalsCount, byYear, topCharges, topCategories, recentRefusals, withEntry } = fdaAgg;

  const alertsCount = db.queryOne('SELECT COUNT(*) as cnt FROM fda_alerts')?.cnt || 0;

  // Costos estimados
  const costModel = { held: 8500, review: 4200, transit: 3500, clear: 4000 };
  let totalCost = 0;
  for (const k of Object.keys(counts)) totalCost += counts[k] * (costModel[k] || 4000);
  const extraHoldCost = counts.held * 7430;

  res.json({
    ok: true,
    company,
    shipments: { total: totalShipments, counts, list: recentShipments },
    fda: {
      refusalsCount,
      onList: refusalsCount > 0,
      byYear, topCharges, topCategories,
      recentRefusals,
      alertsCount,
      dataDate: meta.refusals_updated_at,
      syncStatus: meta.refusals_sync_status
    },
    costs: {
      total: totalCost,
      average: totalShipments ? Math.round(totalCost / totalShipments) : 0,
      extraHold: extraHoldCost
    },
    itacs: { total: refusalsCount, withEntry, byStatus: {} }
  });
});

// Refusals de la empresa con entry CBP extraído (paginado para no saturar memoria)
router.get('/firm-refusals', auth, (req, res) => {
  const user = req.isGuest
    ? { company: req.guestCompany }
    : db.queryOne('SELECT company FROM users WHERE id = ?', [req.userId]);
  const company = req.query.name || user?.company || '';
  if (!company) return res.json({ ok: true, data: [], total: 0 });

  const filter = resolveFirmFilter(company);
  if (!filter) return res.json({ ok: true, data: [], total: 0 });

  const limit = Math.min(parseInt(req.query.limit) || 200, 500);
  const offset = parseInt(req.query.offset) || 0;

  const total = db.queryOne(`SELECT COUNT(*) as c FROM fda_refusals WHERE ${filter.clause}`, [filter.param])?.c || 0;
  const rows = db.query(
    `SELECT * FROM fda_refusals WHERE ${filter.clause} ORDER BY refusal_date DESC LIMIT ? OFFSET ?`,
    [filter.param, limit, offset]
  );
  const data = rows.map(r => ({ ...r, cbp_entry_number: itacsLink.extractEntryNumber(r.shipment_id_ref) }));
  res.json({ ok: true, data, total, limit, offset });
});

module.exports = router;
