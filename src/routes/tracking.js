const { Router } = require('express');
const db = require('../db/database');
const auth = require('../middleware/auth');
const trackingService = require('../services/tracking-live');

const router = Router();

router.get('/config', auth, (_req, res) => {
  res.json({ ok: true, data: trackingService.getShipsgoPublicConfig() });
});


router.get('/shipping-lines', auth, async (req, res) => {
  try {
    const data = await trackingService.getShipsgoShippingLineList(req.query.refresh === '1');
    res.json({
      ok: true,
      data,
      default_shipping_line: trackingService.SHIPSGO_DEFAULT_SHIPPING_LINE || 'OTHERS',
      carrier_strategy: trackingService.SHIPSGO_CARRIER_STRATEGY || 'others_first'
    });
  } catch (err) {
    res.json({
      ok: true,
      data: trackingService.getShipsgoShippingLineListSync(),
      default_shipping_line: trackingService.SHIPSGO_DEFAULT_SHIPPING_LINE || 'OTHERS',
      warning: err.message
    });
  }
});

function formatTracking(t) {
  let events = [];
  let raw = {};
  try { events = JSON.parse(t.events || '[]'); } catch {}
  try { raw = JSON.parse(t.raw_json || '{}'); } catch {}
  return {
    ok: true,
    cached: !!(t.updated_at),
    data: {
      source: t.source,
      provider_id: t.provider_id || '',
      provider_key_alias: t.provider_key_alias || '',
      provider_version: t.provider_version || '',
      carrier: t.carrier,
      shipsgo_shipping_line: raw.shipsgo_shipping_line || raw.shippingLine || raw.ShippingLine || '',
      container: t.container,
      bl: t.bl,
      vessel: t.vessel,
      voyage: t.voyage,
      status: t.status,
      origin_port: t.origin_port,
      dest_port: t.dest_port,
      eta: t.eta,
      last_event: t.last_event,
      last_location: t.last_location,
      last_date: t.last_date,
      vessel_lat: t.vessel_lat,
      vessel_lng: t.vessel_lng,
      speed_knots: t.speed_knots,
      course_deg: t.course_deg,
      heading_deg: t.heading_deg,
      events,
      tracking_url: t.tracking_url,
      live: !!t.live,
      updated_at: t.updated_at
    }
  };
}

// Debe ir antes de /:shipmentId para que Express no capture "detect" como id.
router.get('/detect/:container', auth, async (req, res) => {
  const container = String(req.params.container || '').trim().replace(/[\s-]/g, '').toUpperCase();
  const info = trackingService.getTrackingUrl(container);
  if (!info) {
    return res.json({
      ok: true,
      carrier: 'OTHERS',
      shipsgo_shipping_line: trackingService.SHIPSGO_DEFAULT_SHIPPING_LINE || 'OTHERS',
      detected_shipping_line: 'OTHERS',
      tracking_url: 'https://shipsgo.com',
      prefix: container.substring(0, 4),
      status: 'Naviera no identificada por prefijo; ShipsGo consultará con OTHERS al registrar el envío',
      live: false,
      source: 'shipsgo-ready'
    });
  }

  const result = {
    ok: true,
    carrier: info.carrier,
    shipsgo_shipping_line: trackingService.SHIPSGO_DEFAULT_SHIPPING_LINE || 'OTHERS',
    detected_shipping_line: info.shipsgoCarrier || info.carrier,
    tracking_url: 'https://shipsgo.com',
    prefix: container.substring(0, 4),
    status: trackingService.shipsgoEnabled()
      ? 'Naviera detectada — ShipsGo se consultará al registrar el envío'
      : 'Naviera detectada — falta configurar SHIPSGO_API_KEYS',
    source: 'shipsgo-ready',
    live: false
  };

  try {
    const trackData = await trackingService.fetchTrackingFromCarrier(container, { preview: true });
    if (trackData) {
      result.status = trackData.status || result.status;
      result.source = trackData.source || result.source;
    }
  } catch (_) {}

  res.json(result);
});

router.get('/:shipmentId', auth, (req, res) => {
  const ship = db.queryOne('SELECT id, container FROM shipments WHERE id = ? AND user_id = ?', [req.params.shipmentId, req.userId]);
  if (!ship) return res.status(404).json({ ok: false, msg: 'Envío no encontrado' });

  const t = db.queryOne('SELECT * FROM tracking WHERE shipment_id = ?', [req.params.shipmentId]);
  if (!t) {
    const info = trackingService.getTrackingUrl(ship.container);
    return res.json({
      ok: true,
      cached: false,
      data: {
        source: 'shipsgo-ready',
        provider_id: '',
        provider_key_alias: '',
        provider_version: trackingService.SHIPSGO_API_VERSION || '',
        carrier: info?.carrier || 'OTHERS',
        shipsgo_shipping_line: trackingService.SHIPSGO_DEFAULT_SHIPPING_LINE || 'OTHERS',
        detected_shipping_line: info?.shipsgoCarrier || 'OTHERS',
        container: ship.container,
        status: trackingService.shipsgoEnabled()
          ? 'Sin consultar — presione Consultar ShipsGo para crear/consultar el tracking'
          : 'ShipsGo no está configurado — falta SHIPSGO_API_KEYS',
        tracking_url: 'https://shipsgo.com',
        events: [],
        live: false
      }
    });
  }

  res.json(formatTracking(t));
});

router.post('/:shipmentId/refresh', auth, async (req, res) => {
  const ship = db.queryOne('SELECT id FROM shipments WHERE id = ? AND user_id = ?', [req.params.shipmentId, req.userId]);
  if (!ship) return res.status(404).json({ ok: false, msg: 'Envío no encontrado' });

  try {
    const result = await trackingService.refreshShipmentTracking(parseInt(req.params.shipmentId, 10));
    if (!result.ok) return res.json(result);

    const t = db.queryOne('SELECT * FROM tracking WHERE shipment_id = ?', [req.params.shipmentId]);
    if (!t) return res.json(result);

    res.json(formatTracking(t));
  } catch (err) {
    res.status(500).json({ ok: false, msg: 'No se pudo consultar ShipsGo: ' + err.message });
  }
});

module.exports = router;
