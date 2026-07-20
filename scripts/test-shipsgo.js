#!/usr/bin/env node
require('dotenv').config();

const BASE_V1 = (process.env.SHIPSGO_V1_BASE_URL || 'https://shipsgo.com/api/v1.2/ContainerService').replace(/\/+$/, '');
const shouldCreate = process.argv.includes('--create');
const container = (process.argv.find(a => /^[A-Z]{4}\d{7}$/i.test(a)) || 'MEDU6699325').toUpperCase();
function argValue(flag, fallback = '') {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}
const carrier = argValue('--carrier', argValue('--line', 'OTHERS'));
const requestIdArgIndex = process.argv.indexOf('--request-id');
const requestId = requestIdArgIndex >= 0 ? process.argv[requestIdArgIndex + 1] : '';

function mask(token) {
  const clean = String(token || '').trim();
  if (!clean) return '';
  if (clean.length <= 8) return clean[0] + '…' + clean.slice(-1);
  return clean.slice(0, 4) + '…' + clean.slice(-4);
}

function addKey(entries, seen, token, alias) {
  const clean = String(token || '').trim();
  if (!clean || seen.has(clean)) return;
  seen.add(clean);
  entries.push({ alias: alias || 'key' + (entries.length + 1), token: clean, masked: mask(clean) });
}

function parseKeys() {
  const entries = [];
  const seen = new Set();
  String(process.env.SHIPSGO_API_KEYS || process.env.SHIPSGO_USER_TOKENS || '')
    .split(/[;,\n]+/)
    .map(v => v.trim())
    .filter(Boolean)
    .forEach((item) => {
      const m = item.match(/^([A-Za-z0-9_-]{1,32})\s*=\s*(.+)$/);
      if (m) addKey(entries, seen, m[2], m[1]);
      else addKey(entries, seen, item, 'key' + (entries.length + 1));
    });

  for (let i = 1; i <= 10; i += 1) {
    addKey(entries, seen, process.env['SHIPSGO_API_KEY_' + i] || process.env['SHIPSGO_USER_TOKEN_' + i], 'key' + i);
  }

  const positional = process.argv.filter(a => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(a));
  positional.forEach((k) => addKey(entries, seen, k, 'arg' + (entries.length + 1)));
  addKey(entries, seen, process.env.SHIPSGO_API_KEY || process.env.SHIPSGO_USER_TOKEN, 'key' + (entries.length + 1));

  const aliases = new Set();
  entries.forEach((entry, idx) => {
    if (!entry.alias || aliases.has(entry.alias)) entry.alias = 'key' + (idx + 1);
    aliases.add(entry.alias);
  });
  return entries;
}

const API_KEYS = parseKeys();

if (!API_KEYS.length) {
  console.log('Uso recomendado: SHIPSGO_API_KEYS=key1,key2 node scripts/test-shipsgo.js');
  console.log('Opcional sin crear: node scripts/test-shipsgo.js --request-id 123456');
  console.log('Opcional con creación: node scripts/test-shipsgo.js --create MEDU6699325 --carrier OTHERS');
  console.log('Aviso: --create puede consumir 1 crédito si el contenedor/request es nuevo.');
  process.exit(1);
}

async function parseResponse(res) {
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, ok: res.ok, json, text };
}

async function postContainer(credential) {
  const body = new URLSearchParams({
    authCode: credential.token,
    containerNumber: container,
    shippingLine: carrier,
    tags: 'TradeFlow'
  });
  const res = await fetch(BASE_V1 + '/PostContainerInfo', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  return parseResponse(res);
}

async function getContainerInfo(credential, id) {
  const qs = new URLSearchParams({
    authCode: credential.token,
    requestId: String(id),
    extended: 'true',
    mappoint: 'true',
    mapPoint: 'true'
  });
  const res = await fetch(BASE_V1 + '/GetContainerInfo/?' + qs.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });
  return parseResponse(res);
}

function extractRequestId(result) {
  const json = result.json;
  const root = Array.isArray(json) ? (json[0] || {}) : (json?.shipment || json?.data || json?.result || json || {});
  const direct = root.requestId || root.request_id || root.RequestId || root.RequestID || root.requestID || root.Id || root.ID || root.id || json?.RequestId;
  if (direct) return String(direct).trim();
  const raw = String(result.text || '').trim();
  if (/^\d+$/.test(raw)) return raw;
  const m = raw.match(/(?:request\s*id|requestId|RequestId|id)[^0-9]{0,20}(\d+)/i);
  return m ? m[1] : '';
}

function errorLooksLikeNoCredits(result) {
  const text = JSON.stringify(result.json || result.text || '').toLowerCase();
  return result.status === 402 || /(credit|cr[eé]dit|quota|balance|saldo|insufficient|not enough|sin\s+cr[eé]dit|no\s+credits?)/i.test(text);
}

(async () => {
  console.log('=== ShipsGo Ocean API v1.2 multi-key smoke test ===');
  console.log('Base URL:', BASE_V1);
  console.log('Shipping line:', carrier, '(usar OTHERS evita rechazo por naviera mal detectada)');
  console.log('API version:', process.env.SHIPSGO_API_VERSION || 'v1.2');
  console.log('Keys configuradas:', API_KEYS.map(k => `${k.alias} (${k.masked})`).join(', '));

  if (requestId) {
    console.log('\nConsultando request existente. Esto no crea shipment nuevo.');
    for (const key of API_KEYS) {
      console.log(`\nGET detalle ${requestId} con ${key.alias} (${key.masked})`);
      const detail = await getContainerInfo(key, requestId);
      console.log('HTTP', detail.status);
      console.log(JSON.stringify(detail.json || detail.text, null, 2));
      if (detail.ok) return;
    }
    return;
  }

  if (!shouldCreate) {
    console.log('\nNo se hizo ninguna llamada externa ni se creó shipment.');
    console.log('Para validar lógica local sin gastar créditos: npm run validate:shipsgo');
    console.log('Para consultar un request existente: node scripts/test-shipsgo.js --request-id 123456');
    console.log('Para crear tracking real: node scripts/test-shipsgo.js --create MEDU6699325 --carrier OTHERS');
    return;
  }

  console.log('\nCreando request de tracking real con pool de keys.');
  console.log('Aviso: consume 1 crédito si ShipsGo registra un nuevo tracking. Solo se cambia de key si ShipsGo responde sin créditos o token inválido.');

  for (const key of API_KEYS) {
    console.log(`\nPOST PostContainerInfo con ${key.alias} (${key.masked})`);
    const created = await postContainer(key);
    console.log('HTTP', created.status);
    console.log(JSON.stringify(created.json || created.text, null, 2));

    const id = extractRequestId(created);
    if ((created.status >= 200 && created.status < 300) && id) {
      console.log(`Request creado/encontrado con ${key.alias}. RequestId: ${id}`);
      console.log('\nConsultando detalle con la misma key...');
      const detail = await getContainerInfo(key, id);
      console.log('HTTP', detail.status);
      console.log(JSON.stringify(detail.json || detail.text, null, 2));
      return;
    }

    if (created.status === 401 || created.status === 403 || errorLooksLikeNoCredits(created)) {
      console.log(`${key.alias} no disponible para crear; probando siguiente key.`);
      continue;
    }

    console.log('No se prueba otra key porque este error podría ser de datos/servidor y repetir POST puede gastar doble.');
    return;
  }

  console.log('Ninguna key pudo crear el tracking. Posiblemente no quedan créditos o las keys no son válidas.');
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
