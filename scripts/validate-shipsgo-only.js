#!/usr/bin/env node
/*
  Validación local sin gastar créditos:
  - Carga .env sin depender de llamadas reales.
  - Simula ShipsGo Ocean API v1.2 con fetch mock.
  - Verifica que detectar/preview no haga llamadas externas.
  - Verifica pool multi-key: key1 sin créditos → key2 crea request → detalle se consulta con key2.
*/

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { URL } = require('url');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}

function fakeResponse(status, body, rawText = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => rawText !== null ? String(rawText) : JSON.stringify(body)
  };
}

function bodyToParams(body) {
  if (!body) return new URLSearchParams();
  if (body instanceof URLSearchParams) return body;
  return new URLSearchParams(String(body));
}

loadEnvFile(path.join(__dirname, '..', '.env'));
process.env.TRACKING_MODE = 'shipsgo';
process.env.SHIPSGO_API_VERSION = process.env.SHIPSGO_API_VERSION || 'v1.2';

const dbStub = {
  queryOne: () => null,
  query: () => [],
  run: () => undefined,
  insert: () => 1
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '../db/database' || request.endsWith('/db/database')) return dbStub;
  return originalLoad.apply(this, arguments);
};

const tracking = require('../src/services/tracking-live');
const keys = tracking.getShipsgoApiKeys();
assert(tracking.getTrackingMode() === 'shipsgo', 'TRACKING_MODE debe ser shipsgo');
assert(keys.length >= 2, 'Deben existir al menos 2 API keys en SHIPSGO_API_KEYS');
assert(tracking.shipsgoEnabled(), 'ShipsGo debe quedar habilitado');
assert(tracking.getShipsgoPublicConfig().api_version === 'v1.2', 'SHIPSGO_API_VERSION debe quedar en v1.2 para evitar POST dobles');

const calls = [];
global.fetch = async (url, options = {}) => {
  const method = options.method || 'GET';
  const urlText = String(url);
  const form = bodyToParams(options.body);
  const queryAuthCode = (() => { try { return new URL(urlText).searchParams.get('authCode') || ''; } catch { return ''; } })();
  const token = form.get('authCode') || queryAuthCode || options.headers?.['X-Shipsgo-User-Token'] || '';
  const alias = keys.find(k => k.token === token)?.alias || 'unknown';
  calls.push({ url: urlText, method, alias, form: Object.fromEntries(form.entries()) });

  if (method === 'GET' && urlText.includes('/GetShippingLineList')) {
    return fakeResponse(200, ['OTHERS', 'MSC', 'MAERSK LINE', 'HAPAG LLOYD', 'CMA CGM']);
  }

  if (method === 'POST' && urlText.endsWith('/PostContainerInfo') && alias === keys[0].alias) {
    assert(form.get('containerNumber') === 'MEDU6699325', 'El form debe enviar containerNumber normalizado');
    assert(form.get('shippingLine') === 'OTHERS', 'El form debe enviar OTHERS para evitar rechazo por naviera mal detectada');
    return fakeResponse(402, { Message: 'Not enough credits' });
  }

  if (method === 'POST' && urlText.endsWith('/PostContainerInfo') && alias === keys[1].alias) {
    assert(form.get('containerNumber') === 'MEDU6699325', 'El segundo POST debe conservar containerNumber');
    assert(form.get('shippingLine') === 'OTHERS', 'El segundo POST debe conservar OTHERS');
    return fakeResponse(200, null, '987654');
  }

  if (method === 'GET' && urlText.includes('/GetContainerInfo/')) {
    const parsed = new URL(urlText);
    assert(parsed.searchParams.get('requestId') === '987654', 'GET debe consultar el requestId devuelto por ShipsGo');
    assert(parsed.searchParams.get('mappoint') === 'true', 'GET debe pedir mappoint=true para coordenadas');
    assert(alias === keys[1].alias, 'GET detalle debe usar la key que creó el request');
    return fakeResponse(200, [{
      RequestId: 987654,
      ContainerNumber: 'MEDU6699325',
      ShippingLine: 'MSC',
      VesselName: 'MSC TEST',
      Voyage: 'MOCK123',
      Route: {
        POL: { Name: 'Acajutla' },
        POD: { Name: 'Miami', ETA: '2026-07-01T00:00:00Z' }
      },
      Status: 'IN_TRANSIT',
      Events: [
        { EventDate: '2026-06-20T00:00:00Z', Location: 'Acajutla', Event: 'Loaded', IsActual: true },
        { EventDate: '2026-06-25T00:00:00Z', Location: 'At Sea', Event: 'Sailing', IsActual: true }
      ],
      MapPoint: { Latitude: 13.12345, Longitude: -89.12345 },
      TrackingUrl: 'https://shipsgo.com'
    }]);
  }

  return fakeResponse(403, { Message: 'Unexpected mock request', url: urlText, method, alias });
};

(async () => {
  const preview = await tracking.fetchTrackingFromCarrier('MEDU6699325', { preview: true });
  assert(preview.source === 'shipsgo-ready', 'Preview debe devolver shipsgo-ready');
  assert(preview.carrier === 'MSC', 'Preview debe detectar MSC por prefijo MEDU');
  assert(calls.length === 0, 'Preview/detect no debe llamar ShipsGo ni gastar créditos');

  const result = await tracking.fetchFromShipsGo({
    id: 123,
    container: 'MEDU6699325',
    bl_number: 'MSCUSV000000',
    carrier: '',
    product: 'Prueba'
  }, null);

  assert(result.source === 'shipsgo', 'El resultado debe ser ShipsGo live');
  assert(result.provider_id === '987654', 'Debe guardar provider_id/requestId de ShipsGo');
  assert(result.provider_key_alias === keys[1].alias, 'Debe guardar alias de la key que sí creó el shipment');
  assert(result.provider_version === 'v1.2', 'Debe guardar versión de proveedor v1.2');
  assert(result.vessel === 'MSC TEST', 'Debe mapear vessel');
  assert(result.origin_port === 'Acajutla', 'Debe mapear POL/origen');
  assert(result.dest_port === 'Miami', 'Debe mapear POD/destino');
  assert(result.events.length === 2, 'Debe mapear eventos');
  assert(result.source === 'shipsgo', 'Debe usar ShipsGo como única fuente live');

  assert(calls.length === 4, 'Debe hacer 4 llamadas mock: GET shipping lines, POST key1, POST key2, GET detalle key2');
  assert(calls[0].method === 'GET' && calls[0].url.includes('/GetShippingLineList'), 'Primero debe validar lista ShipsGo sin crédito');
  assert(calls[1].method === 'POST' && calls[1].alias === keys[0].alias, 'Primer POST debe usar key1');
  assert(calls[2].method === 'POST' && calls[2].alias === keys[1].alias, 'Segundo POST debe usar key2 por falta de créditos en key1');
  assert(calls[3].method === 'GET' && calls[3].alias === keys[1].alias, 'GET detalle debe usar la key que creó el shipment');

  console.log('OK: ShipsGo-only v1.2 multi-key + OTHERS validado sin gastar créditos. Keys configuradas:', keys.map(k => k.alias).join(', '));
})().catch(err => {
  console.error('FAIL:', err && err.stack ? err.stack : err);
  process.exit(1);
});
