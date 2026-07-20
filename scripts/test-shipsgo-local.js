#!/usr/bin/env node
/* Prueba local con mock. No llama a internet ni consume créditos ShipsGo. */
const fs = require('fs');
const path = require('path');
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
    if ((value.startsWith('\"') && value.endsWith('\"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(path.join(__dirname, '..', '.env'));
const assert = require('assert');
const { URL } = require('url');

process.env.TRACKING_MODE = 'shipsgo';
process.env.SHIPSGO_API_VERSION = process.env.SHIPSGO_API_VERSION || 'v1.2';

const Module = require('module');
const dbStub = { queryOne: () => null, query: () => [], run: () => undefined, insert: () => 1 };
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '../db/database' || request.endsWith('/db/database')) return dbStub;
  return originalLoad.apply(this, arguments);
};

const tracking = require('../src/services/tracking-live');

class MockResponse {
  constructor(status, body, rawText = null) {
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this._body = body;
    this._rawText = rawText;
  }
  async text() { return this._rawText !== null ? String(this._rawText) : JSON.stringify(this._body); }
}

function bodyToParams(body) {
  if (!body) return new URLSearchParams();
  if (body instanceof URLSearchParams) return body;
  return new URLSearchParams(String(body));
}

let postCount = 0;
let getCount = 0;
let postContainers = [];
let detailByRequest = {};
let requestCounter = 987654;

global.fetch = async (url, options = {}) => {
  const method = options.method || 'GET';
  const keys = tracking.getShipsgoApiKeys();
  const key1 = keys[0]?.token;
  const key2 = keys[1]?.token;
  const urlText = String(url);

  if (method === 'GET' && urlText.includes('/GetShippingLineList')) {
    return new MockResponse(200, ['OTHERS', 'MSC', 'MAERSK LINE', 'HAPAG LLOYD', 'CMA CGM']);
  }

  if (method === 'POST' && urlText.endsWith('/PostContainerInfo')) {
    postCount += 1;
    const form = bodyToParams(options.body);
    const containerNumber = form.get('containerNumber');
    assert.ok(['MEDU6699325', 'FBIU0302267'].includes(containerNumber), 'Contenedor inesperado: ' + containerNumber);
    assert.strictEqual(form.get('shippingLine'), 'OTHERS');
    postContainers.push(containerNumber);

    if (form.get('authCode') === key1) return new MockResponse(402, { Message: 'not enough credits' });
    if (form.get('authCode') === key2) {
      const requestId = String(requestCounter++);
      detailByRequest[requestId] = containerNumber;
      return new MockResponse(200, null, requestId);
    }
    return new MockResponse(401, { Message: 'invalid authCode' });
  }

  if (method === 'GET' && urlText.includes('/GetContainerInfo/')) {
    getCount += 1;
    const parsed = new URL(urlText);
    const requestId = parsed.searchParams.get('requestId');
    const containerNumber = detailByRequest[requestId] || 'MEDU6699325';
    assert.strictEqual(parsed.searchParams.get('authCode'), key2);
    assert.strictEqual(parsed.searchParams.get('mappoint'), 'true');
    return new MockResponse(200, [{
      RequestId: requestId,
      ContainerNumber: containerNumber,
      ShippingLine: containerNumber === 'FBIU0302267' ? 'OTHERS' : 'MSC',
      VesselName: containerNumber === 'FBIU0302267' ? 'UNKNOWN PREFIX MOCK VESSEL' : 'MSC MOCK VESSEL',
      Voyage: 'MOCK123',
      Route: {
        POL: { Name: 'Acajutla' },
        POD: { Name: 'Los Angeles', ETA: '2026-06-30T00:00:00Z' }
      },
      Status: 'IN_TRANSIT',
      Events: [
        { EventDate: '2026-06-17T12:00:00Z', Location: 'Acajutla', Event: 'Loaded', VesselName: 'MOCK VESSEL', IsActual: true }
      ],
      MapPoint: { Latitude: 13.0, Longitude: -89.0 },
      TrackingUrl: 'https://shipsgo.com'
    }]);
  }

  return new MockResponse(404, { Message: 'mock route not found', url: urlText, method });
};

(async () => {
  const config = tracking.getShipsgoPublicConfig();
  const keys = tracking.getShipsgoApiKeys();
  assert.strictEqual(config.mode, 'shipsgo');
  assert.strictEqual(config.enabled, true);
  assert.strictEqual(config.api_version, 'v1.2');
  assert.ok(config.key_count >= 2, 'Se esperaban al menos 2 API keys ShipsGo');

  const preview = await tracking.fetchTrackingFromCarrier('MEDU6699325', { preview: true });
  assert.strictEqual(preview.source, 'shipsgo-ready');
  assert.strictEqual(preview.carrier, 'MSC');
  assert.strictEqual(postCount + getCount, 0, 'Preview no debe gastar crédito');

  const result = await tracking.fetchTrackingFromCarrier('MEDU6699325', {
    ship: { id: 999, container: 'MEDU6699325', carrier: 'MSC', shipsgo_shipping_line: 'OTHERS', product: 'Mock' }
  });

  assert.strictEqual(result.source, 'shipsgo');
  assert.strictEqual(result.provider_id, '987654');
  assert.strictEqual(result.provider_key_alias, keys[1].alias);
  assert.strictEqual(result.provider_version, 'v1.2');
  assert.strictEqual(result.container, 'MEDU6699325');
  assert.strictEqual(result.carrier, 'MSC');
  assert.strictEqual(result.vessel, 'MSC MOCK VESSEL');
  assert.strictEqual(result.events.length, 1);
  assert.strictEqual(postCount, 2, 'Debe intentar key1 y luego key2');
  assert.strictEqual(getCount, 1, 'Debe consultar detalle una sola vez con key2');

  const unknownPreview = await tracking.fetchTrackingFromCarrier('FBIU0302267', { preview: true });
  assert.strictEqual(unknownPreview.carrier, 'OTHERS');
  assert.ok(/OTHERS/.test(unknownPreview.status), 'Preview debe avisar que usará OTHERS');
  assert.strictEqual(postCount + getCount, 3, 'Preview de prefijo desconocido no debe llamar ShipsGo');

  const unknownResult = await tracking.fetchTrackingFromCarrier('FBIU0302267', {
    ship: { id: 1000, container: 'FBIU0302267', carrier: 'OTHERS', shipsgo_shipping_line: 'OTHERS', product: 'Mock' }
  });
  assert.strictEqual(unknownResult.source, 'shipsgo');
  assert.strictEqual(unknownResult.container, 'FBIU0302267');
  assert.strictEqual(unknownResult.carrier, 'OTHERS');
  assert.strictEqual(unknownResult.vessel, 'UNKNOWN PREFIX MOCK VESSEL');
  assert.deepStrictEqual(postContainers, ['MEDU6699325', 'MEDU6699325', 'FBIU0302267', 'FBIU0302267']);
  assert.strictEqual(postCount, 4, 'Prefijo desconocido también debe intentar key1 y luego key2');
  assert.strictEqual(getCount, 2, 'Debe consultar detalle también para prefijo desconocido');

  console.log('OK ShipsGo local mock: v1.2, OTHERS, pool de 2 keys, fallback de créditos, prefijos desconocidos y mapeo funcionan.');
  console.log('Keys:', config.keys.map(k => `${k.alias} (${k.masked})`).join(', '));
})();
