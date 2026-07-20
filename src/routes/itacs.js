const { Router } = require('express');
const auth = require('../middleware/auth');
const db = require('../db/database');
const itacs = require('../services/itacs');

const router = Router();

router.get('/entry/:entryNumber', auth, async (req, res) => {
  const { entryNumber } = req.params;
  const { refresh } = req.query;

  if (!refresh || refresh === 'false') {
    const cached = await itacs.getEntryFromDB(entryNumber);
    if (cached) {
      return res.json({ ok: true, source: 'cache', entry: cached });
    }
  }

  const result = await itacs.lookupEntry(entryNumber);
  res.json({ ...result, source: result.action === 'cached' ? 'cache' : 'live' });
});

router.post('/sync', auth, async (req, res) => {
  const { user_id } = req.body;
  const targetUserId = user_id || req.userId;
  const result = await itacs.syncAllShipmentEntries(targetUserId);
  res.json(result);
});

router.post('/sync/all', auth, async (req, res) => {
  if (req.userRole !== 'admin') {
    return res.status(403).json({ ok: false, msg: 'Solo administradores' });
  }
  const result = await itacs.syncAllShipmentEntries(null);
  res.json(result);
});

router.get('/entries', auth, (req, res) => {
  const { search, status, limit, offset } = req.query;
  let sql = 'SELECT * FROM itacs_entries WHERE 1=1';
  const params = [];

  if (search) {
    sql += ' AND (entry_number LIKE ? OR firm_name LIKE ? OR ior_number LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (status) {
    sql += ' AND status_code = ?';
    params.push(status.toUpperCase());
  }

  sql += ' ORDER BY updated_at DESC';

  if (limit) {
    sql += ' LIMIT ?';
    params.push(parseInt(limit));
  }
  if (offset) {
    sql += ' OFFSET ?';
    params.push(parseInt(offset));
  }

  const rows = db.query(sql, params);
  const countRow = db.queryOne('SELECT COUNT(*) as total FROM itacs_entries');
  res.json({ ok: true, data: rows, total: countRow?.total || 0 });
});

router.get('/entries/:entryNumber', auth, (req, res) => {
  const entry = db.queryOne(
    'SELECT * FROM itacs_entries WHERE entry_number = ?',
    [itacs.cleanEntryNumber(req.params.entryNumber)]
  );
  if (!entry) {
    return res.status(404).json({ ok: false, msg: 'Entrada no encontrada en caché' });
  }
  res.json({ ok: true, entry });
});

router.get('/summary', auth, (req, res) => {
  const all = db.query('SELECT status_code, status_label FROM itacs_entries');
  const byStatus = {};
  for (const r of all) {
    const key = r.status_label || r.status_code || 'Desconocido';
    byStatus[key] = (byStatus[key] || 0) + 1;
  }
  const shipments = db.query(
    'SELECT itacs_status, COUNT(*) as cnt FROM shipments GROUP BY itacs_status'
  );
  res.json({
    ok: true,
    totalEntries: all.length,
    byStatus,
    shipmentStatuses: shipments
  });
});

module.exports = router;
