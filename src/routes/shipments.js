const { Router } = require('express');
const db = require('../db/database');
const auth = require('../middleware/auth');

const router = Router();

function enrichShipment(s) {
  s.fda_holds = db.query('SELECT * FROM fda_holds WHERE shipment_id = ?', [s.id]);
  s.costs = db.query('SELECT * FROM costs WHERE shipment_id = ?', [s.id]);
  if (s.itacs_status && typeof s.itacs_status === 'string') {
    try { s.itacs_status = JSON.parse(s.itacs_status); } catch {}
  }
  return s;
}

function cleanText(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function cleanContainer(value) {
  return String(value || '').trim().replace(/[\s-]/g, '').toUpperCase();
}

function isContainer(value) {
  return /^[A-Z]{4}\d{7}$/.test(String(value || ''));
}

router.get('/', auth, (req, res) => {
  const rows = db.query('SELECT * FROM shipments WHERE user_id = ? ORDER BY id DESC', [req.userId]);
  const data = rows.map(s => {
    s.fda_holds = db.query('SELECT * FROM fda_holds WHERE shipment_id = ?', [s.id]);
    s.costs = db.query('SELECT * FROM costs WHERE shipment_id = ?', [s.id]);
    return s;
  });
  res.json({ ok: true, data });
});

router.get('/:id', auth, (req, res) => {
  const s = db.queryOne('SELECT * FROM shipments WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!s) return res.status(404).json({ ok: false, msg: 'No encontrado' });
  res.json({ ok: true, data: enrichShipment(s) });
});

router.post('/', auth, (req, res) => {
  const raw = req.body || {};
  const container = cleanContainer(raw.container);
  if (!container) return res.status(400).json({ ok: false, msg: 'Número de contenedor requerido' });
  if (!isContainer(container)) {
    return res.status(400).json({ ok: false, msg: 'Contenedor inválido. Formato esperado: 4 letras + 7 dígitos, por ejemplo MSCU7284013.' });
  }

  const trackingService = require('../services/tracking-live');
  const info = trackingService.getTrackingUrl(container);
  const requestedLine = raw.shipsgo_shipping_line || raw.shipping_line || '';
  const shipsgoLine = trackingService.normalizeShipsgoShippingLine(requestedLine) || 'OTHERS';
  const detectedCarrier = info ? info.carrier : (cleanText(raw.carrier, 80) || 'OTHERS');

  const id = db.insert(
    'INSERT INTO shipments (user_id,entry_number,bl_number,vessel,mmsi,container,product,origin_port,dest_port,etd,eta,broker,carrier,shipsgo_shipping_line,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [
      req.userId,
      cleanText(raw.entry_number, 40) || ('TF-' + Date.now()),
      cleanText(raw.bl_number, 40),
      cleanText(raw.vessel, 120),
      cleanText(raw.mmsi || raw.vessel_mmsi, 20),
      container,
      cleanText(raw.product, 300) || ('Envío ' + container),
      cleanText(raw.origin_port, 120),
      cleanText(raw.dest_port, 120),
      cleanText(raw.etd, 20) || null,
      cleanText(raw.eta, 20) || null,
      cleanText(raw.broker, 120),
      detectedCarrier,
      shipsgoLine,
      'transit'
    ]
  );

  // Importante: aquí NO llamamos a ShipsGo automáticamente.
  // La UI llama /api/tracking/:id/refresh una sola vez para crear/consultar el tracking.
  // Esto evita doble consumo de créditos por carrera entre backend y frontend.
  res.json({ ok: true, id });
});

router.put('/:id', auth, (req, res) => {
  const s = db.queryOne('SELECT id, container FROM shipments WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!s) return res.status(404).json({ ok: false, msg: 'No encontrado' });

  const trackingService = require('../services/tracking-live');
  const fields = ['entry_number','bl_number','vessel','mmsi','vessel_mmsi','vessel_imo','container','product','origin_port','dest_port','etd','eta','arrived_at','status','broker','carrier','shipsgo_shipping_line'];
  const sets = [];
  const vals = [];
  let containerChanged = false;

  for (const f of fields) {
    if (req.body[f] !== undefined) {
      let value = req.body[f];
      if (f === 'container') {
        value = cleanContainer(value);
        if (value && !isContainer(value)) return res.status(400).json({ ok: false, msg: 'Contenedor inválido.' });
        containerChanged = value && value !== s.container;
      } else if (f === 'shipsgo_shipping_line') {
        value = trackingService.normalizeShipsgoShippingLine(value) || 'OTHERS';
      } else if (['entry_number','bl_number'].includes(f)) value = cleanText(value, 40);
      else if (['vessel','origin_port','dest_port','broker'].includes(f)) value = cleanText(value, 120);
      else if (f === 'product') value = cleanText(value, 300);
      else if (['mmsi','vessel_mmsi','vessel_imo','etd','eta','arrived_at','status','carrier'].includes(f)) value = cleanText(value, 80);
      sets.push(`${f}=?`);
      vals.push(value);
    }
  }
  if (sets.length) {
    vals.push(req.params.id);
    db.run(`UPDATE shipments SET ${sets.join(',')} WHERE id=?`, vals);
    if (containerChanged) db.run('DELETE FROM tracking WHERE shipment_id = ?', [req.params.id]);
  }
  res.json({ ok: true });
});

router.delete('/:id', auth, (req, res) => {
  const s = db.queryOne('SELECT id FROM shipments WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!s) return res.status(404).json({ ok: false, msg: 'No encontrado' });
  db.run('DELETE FROM shipments WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

router.put('/:id/itacs', auth, (req, res) => {
  const s = db.queryOne('SELECT id FROM shipments WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!s) return res.status(404).json({ ok: false, msg: 'No encontrado' });
  const itacs = JSON.stringify(req.body);
  db.run('UPDATE shipments SET itacs_status=? WHERE id=?', [itacs, req.params.id]);
  res.json({ ok: true });
});

router.post('/:id/costs', auth, (req, res) => {
  const s = db.queryOne('SELECT id FROM shipments WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!s) return res.status(404).json({ ok: false, msg: 'No encontrado' });
  const item = cleanText(req.body.item, 120);
  if (!item) return res.status(400).json({ ok: false, msg: 'Concepto requerido' });
  const amount = Number(req.body.amount || 0);
  const type = ['normal','extra'].includes(req.body.type) ? req.body.type : 'normal';
  const id = db.insert('INSERT INTO costs (shipment_id,item,amount,type) VALUES (?,?,?,?)',
    [req.params.id, item, Number.isFinite(amount) ? amount : 0, type]);
  res.json({ ok: true, id });
});

router.post('/:id/holds', auth, (req, res) => {
  const s = db.queryOne('SELECT id FROM shipments WHERE id = ? AND user_id = ?', [req.params.id, req.userId]);
  if (!s) return res.status(404).json({ ok: false, msg: 'No encontrado' });
  const { charge_code, section, description } = req.body;
  const id = db.insert('INSERT INTO fda_holds (shipment_id,charge_code,section,description) VALUES (?,?,?,?)',
    [req.params.id, cleanText(charge_code, 40), cleanText(section, 80), cleanText(description, 500)]);
  res.json({ ok: true, id });
});

module.exports = router;
