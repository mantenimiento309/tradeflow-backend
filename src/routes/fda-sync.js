const { Router } = require('express');
const auth = require('../middleware/auth');
const db = require('../db/database');
const fdaSync = require('../services/fda-sync');
const fdaApi = require('../services/fda-api');

const router = Router();

function requireAdmin(req, res) {
  if (req.userRole !== 'admin') {
    res.status(403).json({ ok: false, msg: 'Solo admin' });
    return false;
  }
  return true;
}

router.post('/sync', auth, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const result = await fdaSync.syncAll();
  res.json({ ok: true, ...result });
});

router.post('/sync/alerts', auth, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const result = await fdaSync.syncImportAlerts();
  res.json({ ok: true, ...result });
});

router.post('/sync/refusals', auth, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const result = await fdaSync.syncAllRefusalsDaily({ full: req.query.full === '1' || req.body?.full === true });
  res.json(result);
});

router.post('/sync/firm/clean', auth, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const { company } = req.body;
  if (!company) return res.status(400).json({ ok: false, msg: 'company requerido' });

  const deleted = db.query(
    'SELECT COUNT(*) as cnt FROM fda_refusals WHERE firm_name LIKE ?',
    [`%${company}%`]
  )[0]?.cnt || 0;

  db.run('DELETE FROM fda_refusals WHERE firm_name LIKE ?', [`%${company}%`]);
  console.log(`[FDA-CLEAN] Eliminados ${deleted} registros previos de: ${company}`);

  const result = await fdaApi.syncFirmRefusals(company);
  res.json({ ok: true, deleted, ...result });
});

router.post('/sync/cleanup', auth, async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const before = db.queryOne('SELECT COUNT(*) as cnt FROM fda_refusals')?.cnt || 0;

  db.run(`
    DELETE FROM fda_refusals
    WHERE length(firm_name) < 5
       OR firm_name NOT LIKE '%[A-Za-z]%'
       OR shipment_id_ref NOT LIKE '%-%'
  `);

  const after = db.queryOne('SELECT COUNT(*) as cnt FROM fda_refusals')?.cnt || 0;
  const deleted = before - after;

  console.log(`[FDA-CLEANUP] Eliminados ${deleted} registros inválidos. Quedan: ${after}`);
  res.json({ ok: true, before, after, deleted });
});

router.get('/firms/search', auth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) {
    return res.status(400).json({ ok: false, msg: 'q requerido (min 2 chars)' });
  }
  res.json(await fdaApi.searchFirmsInDB(q.trim()));
});

router.post('/discover', auth, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const result = await fdaApi.discoverFDAEndpoint();
  res.json(result);
});

router.get('/sync/meta', auth, (req, res) => {
  if (!requireAdmin(req, res)) return;
  const meta = fdaSync.getSyncMeta();
  res.json({ ok: true, status: meta.refusals_sync_status || '', source: meta.refusals_last_source || '' });
});

router.post('/sync/daily', auth, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ ok: true, msg: 'Descarga FDA oficial iniciada' });
  setImmediate(() => {
    const fdaSync = require('../services/fda-sync');
    fdaSync.syncAllRefusalsDaily({ full: req.query.full === '1' || req.body?.full === true }).catch(err =>
      console.log('[FDA-DAILY] Error manual:', err.message)
    );
  });
});

module.exports = router;
