const db = require('../db/database');

/*
  Tracking naviero — ShipsGo solamente.

  Flujo seguro para créditos:
  1. Detectar prefijo del contenedor: local, sin llamadas externas y sin gastar créditos.
  2. Registrar/actualizar envío: crea el tracking en ShipsGo solo si no existe provider_id.
  3. Actualizaciones posteriores: consulta el provider_id guardado; no vuelve a crear shipment.

  Por defecto se usa ShipsGo Ocean API v1.2 porque la documentación pública de Ocean
  especifica PostContainerInfo/GetContainerInfo con authCode. También queda soporte v2
  disponible con SHIPSGO_API_VERSION=v2 o SHIPSGO_API_VERSION=auto.
*/

const SHIPSGO_V2_BASE_URL = (process.env.SHIPSGO_BASE_URL || 'https://api.shipsgo.com/v2').replace(/\/+$/, '');
const SHIPSGO_V1_BASE_URL = (process.env.SHIPSGO_V1_BASE_URL || 'https://shipsgo.com/api/v1.2/ContainerService').replace(/\/+$/, '');
const SHIPSGO_TIMEOUT_MS = Number(process.env.SHIPSGO_TIMEOUT_MS || 25000);
const SHIPSGO_API_VERSION = String(process.env.SHIPSGO_API_VERSION || 'v1.2').trim().toLowerCase();
const TRACKING_MODE = 'shipsgo';
// Para evitar el error "shipping line not found", por defecto se envía OTHERS.
// ShipsGo permite OTHERS cuando no se conoce la naviera exacta.
const SHIPSGO_DEFAULT_SHIPPING_LINE = String(process.env.SHIPSGO_DEFAULT_SHIPPING_LINE || 'OTHERS').trim().toUpperCase();
const SHIPSGO_CARRIER_STRATEGY = String(process.env.SHIPSGO_CARRIER_STRATEGY || 'others_first').trim().toLowerCase();
const SHIPSGO_LINE_LIST_TIMEOUT_MS = Number(process.env.SHIPSGO_LINE_LIST_TIMEOUT_MS || 6000);

// Prefijo de contenedor (4 letras) → naviera esperada por ShipsGo.
const CARRIER_PREFIX_MAP = {
  MSCU: { name: 'MSC', shipsgoCarrier: 'MSC', scac: 'MSCU' },
  MEDU: { name: 'MSC', shipsgoCarrier: 'MSC', scac: 'MSCU' },
  MSBU: { name: 'MSC', shipsgoCarrier: 'MSC', scac: 'MSCU' },
  MSDU: { name: 'MSC', shipsgoCarrier: 'MSC', scac: 'MSCU' },

  HLCU: { name: 'Hapag-Lloyd', shipsgoCarrier: 'HAPAG LLOYD', scac: 'HLCU' },
  HLXU: { name: 'Hapag-Lloyd', shipsgoCarrier: 'HAPAG LLOYD', scac: 'HLCU' },

  MAEU: { name: 'Maersk', shipsgoCarrier: 'MAERSK LINE', scac: 'MAEU' },
  MSKU: { name: 'Maersk', shipsgoCarrier: 'MAERSK LINE', scac: 'MAEU' },
  MRKU: { name: 'Maersk', shipsgoCarrier: 'MAERSK LINE', scac: 'MAEU' },

  CMAU: { name: 'CMA CGM', shipsgoCarrier: 'CMA CGM', scac: 'CMDU' },
  CGMU: { name: 'CMA CGM', shipsgoCarrier: 'CMA CGM', scac: 'CMDU' },

  EISU: { name: 'Evergreen', shipsgoCarrier: 'EVERGREEN', scac: 'EGLV' },
  EGHU: { name: 'Evergreen', shipsgoCarrier: 'EVERGREEN', scac: 'EGLV' },

  ZIMU: { name: 'ZIM', shipsgoCarrier: 'ZIM LINE', scac: 'ZIMU' },
  CSNU: { name: 'COSCO', shipsgoCarrier: 'COSCO', scac: 'COSU' },
  CBHU: { name: 'COSCO', shipsgoCarrier: 'COSCO', scac: 'COSU' },
  COSU: { name: 'COSCO', shipsgoCarrier: 'COSCO', scac: 'COSU' },

  YMLU: { name: 'Yang Ming', shipsgoCarrier: 'YANG MING', scac: 'YMLU' },
  OOLU: { name: 'OOCL', shipsgoCarrier: 'OOCL', scac: 'OOLU' },
  ONEU: { name: 'ONE', shipsgoCarrier: 'ONE LINE', scac: 'ONEY' },

  HMMU: { name: 'HMM', shipsgoCarrier: 'HYUNDAI MM', scac: 'HDMU' },
  HDMU: { name: 'HMM', shipsgoCarrier: 'HYUNDAI MM', scac: 'HDMU' },
  HMCU: { name: 'HMM', shipsgoCarrier: 'HYUNDAI MM', scac: 'HDMU' },
  WHLU: { name: 'Wan Hai', shipsgoCarrier: 'WAN HAI LINES', scac: 'WHLC' },
  PILU: { name: 'PIL', shipsgoCarrier: 'PIL', scac: 'PCIU' }
};

// Lista local de respaldo con nombres exactos usados públicamente por ShipsGo.
// El backend también intenta consultar /GetShippingLineList en vivo antes de crear el tracking.
const FALLBACK_SHIPSGO_SHIPPING_LINES = Object.freeze([
  'OTHERS',
  'MSC',
  'MAERSK LINE',
  'CMA CGM',
  'HAPAG LLOYD',
  'COSCO',
  'ONE LINE',
  'EVERGREEN',
  'HYUNDAI MM',
  'YANG MING',
  'WAN HAI LINES',
  'ZIM LINE',
  'PIL',
  'OOCL',
  'TURKON LINE',
  'SEALAND',
  'SEAGO LINE',
  'SAFMARINE',
  'NAMSUNG SHIPPING',
  'HEUNG A',
  'SITC',
  'KMTC',
  'SINOKOR',
  'RCL',
  'IAL',
  'ARKAS LINE',
  'GRIMALDI',
  'HOEGH AUTOLINERS',
  'WEC LINES',
  'MARFRET LINES'
]);

const SHIPSGO_LINE_ALIASES = Object.freeze({
  'AUTO': 'OTHERS',
  'AUTOMATICO': 'OTHERS',
  'AUTOMATIC': 'OTHERS',
  'DETECT': 'OTHERS',
  'DETECTAR': 'OTHERS',
  'OTHER': 'OTHERS',
  'OTHERS': 'OTHERS',
  'OTROS': 'OTHERS',
  'MSC': 'MSC',
  'MEDITERRANEAN SHIPPING COMPANY': 'MSC',
  'MEDITERRANEAN SHIPPING COMPANY SA': 'MSC',
  'MAERSK': 'MAERSK LINE',
  'MAERSK LINE': 'MAERSK LINE',
  'AP MOLLER MAERSK': 'MAERSK LINE',
  'A P MOLLER MAERSK': 'MAERSK LINE',
  'CMA': 'CMA CGM',
  'CMA CGM': 'CMA CGM',
  'HAPAG': 'HAPAG LLOYD',
  'HAPAG LLOYD': 'HAPAG LLOYD',
  'HAPAGLLOYD': 'HAPAG LLOYD',
  'HAPAG-LLOYD': 'HAPAG LLOYD',
  'COSCO': 'COSCO',
  'COSCO SHIPPING': 'COSCO',
  'ONE': 'ONE LINE',
  'ONE LINE': 'ONE LINE',
  'OCEAN NETWORK EXPRESS': 'ONE LINE',
  'EVERGREEN': 'EVERGREEN',
  'EVERGREEN LINE': 'EVERGREEN',
  'HMM': 'HYUNDAI MM',
  'HYUNDAI': 'HYUNDAI MM',
  'HYUNDAI MM': 'HYUNDAI MM',
  'HYUNDAI MERCHANT MARINE': 'HYUNDAI MM',
  'YANG MING': 'YANG MING',
  'YANGMING': 'YANG MING',
  'WAN HAI': 'WAN HAI LINES',
  'WAN HAI LINES': 'WAN HAI LINES',
  'ZIM': 'ZIM LINE',
  'ZIM LINE': 'ZIM LINE',
  'ZIM INTEGRATED SHIPPING SERVICES': 'ZIM LINE',
  'PIL': 'PIL',
  'PACIFIC INTERNATIONAL LINES': 'PIL',
  'OOCL': 'OOCL',
  'ORIENT OVERSEAS CONTAINER LINE': 'OOCL'
});

let shippingLineCache = { fetchedAt: 0, lines: null, error: '' };
const SHIPPING_LINE_CACHE_MS = 6 * 60 * 60 * 1000;

function normalizeLineKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[()]/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function uniqueLines(lines) {
  const out = [];
  const seen = new Set();
  for (const line of lines || []) {
    const clean = String(line || '').trim().replace(/\s+/g, ' ');
    if (!clean) continue;
    const key = normalizeLineKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean.toUpperCase() === 'OTHERS' ? 'OTHERS' : clean);
  }
  if (!seen.has('OTHERS')) out.unshift('OTHERS');
  return out;
}

function xmlDecode(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractShippingLinesFromPayload(json, text) {
  const found = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (typeof value === 'string') { found.push(value); return; }
    if (typeof value === 'object') { Object.values(value).forEach(visit); }
  };

  if (json) {
    if (Array.isArray(json)) visit(json);
    else visit(json.data || json.result || json.lines || json.shippingLines || json.ShippingLines || json);
  }

  const raw = String(text || '');
  for (const match of raw.matchAll(/<string[^>]*>([\s\S]*?)<\/string>/gi)) {
    found.push(xmlDecode(match[1]).trim());
  }

  return uniqueLines(found.filter(v => !/^(true|false|null|undefined)$/i.test(String(v).trim())));
}

function getFallbackShippingLineList() {
  return [...FALLBACK_SHIPSGO_SHIPPING_LINES];
}

async function fetchShipsgoShippingLineList(force = false) {
  const now = Date.now();
  if (!force && shippingLineCache.lines && now - shippingLineCache.fetchedAt < SHIPPING_LINE_CACHE_MS) {
    return shippingLineCache.lines;
  }

  const url = SHIPSGO_V1_BASE_URL + '/GetShippingLineList';
  const res = await fetchWithTimeout(url, { method: 'GET', headers: { Accept: 'application/json, text/xml, */*' }, timeout: SHIPSGO_LINE_LIST_TIMEOUT_MS });
  if (res.error || res.status >= 400) {
    shippingLineCache = { fetchedAt: now, lines: null, error: res.message || res.text || ('HTTP ' + res.status) };
    return null;
  }

  const liveLines = extractShippingLinesFromPayload(res.json, res.text);
  if (!liveLines.length) {
    shippingLineCache = { fetchedAt: now, lines: null, error: 'ShipsGo devolvió una lista vacía de navieras.' };
    return null;
  }

  shippingLineCache = { fetchedAt: now, lines: uniqueLines(['OTHERS', ...liveLines, ...FALLBACK_SHIPSGO_SHIPPING_LINES]), error: '' };
  return shippingLineCache.lines;
}

async function getShipsgoShippingLineList(force = false) {
  const live = await fetchShipsgoShippingLineList(force);
  return live && live.length ? live : getFallbackShippingLineList();
}

function getShipsgoShippingLineListSync() {
  return shippingLineCache.lines && shippingLineCache.lines.length ? shippingLineCache.lines : getFallbackShippingLineList();
}

function matchOfficialShippingLine(value, officialLines = null) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  const lines = uniqueLines(officialLines && officialLines.length ? officialLines : getShipsgoShippingLineListSync());
  const key = normalizeLineKey(clean);
  const alias = SHIPSGO_LINE_ALIASES[key] || SHIPSGO_LINE_ALIASES[clean.toUpperCase()] || '';
  const wanted = normalizeLineKey(alias || clean);
  return lines.find(line => normalizeLineKey(line) === wanted) || alias || '';
}

function normalizeShipsgoShippingLine(value, officialLines = null) {
  return matchOfficialShippingLine(value, officialLines) || '';
}

function addLineCandidate(out, seen, value, officialLines = null) {
  const line = normalizeShipsgoShippingLine(value, officialLines);
  if (!line) return;
  const key = normalizeLineKey(line);
  if (seen.has(key)) return;
  seen.add(key);
  out.push(line);
}

function getShipsgoPostLineCandidates(ship = {}, info = {}, officialLines = null) {
  const out = [];
  const seen = new Set();
  const saved = first(ship.shipsgo_shipping_line, ship.shipsgoShippingLine, ship.shipping_line, ship.shippingLine);

  // Si el usuario eligió una línea explícita en la vista, se prueba primero.
  addLineCandidate(out, seen, saved, officialLines);

  // Estrategia por defecto: OTHERS primero para no depender del prefijo del contenedor.
  if (SHIPSGO_CARRIER_STRATEGY === 'detected_first') {
    addLineCandidate(out, seen, info.shipsgoCarrier || ship.carrier, officialLines);
  }

  addLineCandidate(out, seen, SHIPSGO_DEFAULT_SHIPPING_LINE || 'OTHERS', officialLines);

  if (SHIPSGO_CARRIER_STRATEGY === 'detected_after_others') {
    addLineCandidate(out, seen, info.shipsgoCarrier || ship.carrier, officialLines);
  }

  addLineCandidate(out, seen, 'OTHERS', officialLines);

  // Último recurso: si viene una naviera vieja guardada en DB, probarla solo después de OTHERS.
  if (SHIPSGO_CARRIER_STRATEGY !== 'others_only') {
    addLineCandidate(out, seen, info.shipsgoCarrier || ship.carrier, officialLines);
  }

  return out.length ? out : ['OTHERS'];
}

function isShippingLineValidation(result) {
  const text = [result?.message, result?.text, safeJson(result?.raw || {})].join(' ').toLowerCase();
  return /(shipping\s*line|naviera|carrier|linea|l[ií]nea|shipline|line not|not.*line|not.*carrier|invalid.*line)/i.test(text);
}

function normalizeContainer(containerNumber) {
  return String(containerNumber || '').trim().replace(/[\s-]/g, '').toUpperCase();
}

function detectCarrier(containerNumber) {
  const normalized = normalizeContainer(containerNumber);
  if (normalized.length < 4) return null;
  return CARRIER_PREFIX_MAP[normalized.substring(0, 4)] || null;
}

function getTrackingUrl(containerNumber) {
  const c = detectCarrier(containerNumber);
  if (!c) return null;
  return { carrier: c.name, shipsgoCarrier: c.shipsgoCarrier, scac: c.scac, url: 'https://shipsgo.com' };
}

function maskToken(token) {
  const clean = String(token || '').trim();
  if (!clean) return '';
  if (clean.length <= 8) return clean[0] + '…' + clean.slice(-1);
  return clean.slice(0, 4) + '…' + clean.slice(-4);
}

function addShipsgoKey(entries, seen, token, alias) {
  const clean = String(token || '').trim();
  if (!clean || seen.has(clean)) return;
  seen.add(clean);
  entries.push({
    alias: String(alias || '').trim() || 'key' + (entries.length + 1),
    token: clean,
    masked: maskToken(clean)
  });
}

function parseShipsgoApiKeys() {
  const entries = [];
  const seen = new Set();

  const parseList = (raw) => {
    String(raw || '')
      .split(/[;,\n]+/)
      .map(v => v.trim())
      .filter(Boolean)
      .forEach((item) => {
        // Soporta token1,token2 o alias=token.
        const match = item.match(/^([A-Za-z0-9_-]{1,32})\s*=\s*(.+)$/);
        if (match) addShipsgoKey(entries, seen, match[2], match[1]);
        else addShipsgoKey(entries, seen, item, 'key' + (entries.length + 1));
      });
  };

  parseList(process.env.SHIPSGO_API_KEYS || process.env.SHIPSGO_USER_TOKENS || '');

  for (let i = 1; i <= 10; i += 1) {
    addShipsgoKey(entries, seen, process.env['SHIPSGO_API_KEY_' + i] || process.env['SHIPSGO_USER_TOKEN_' + i], 'key' + i);
  }

  addShipsgoKey(entries, seen, process.env.SHIPSGO_API_KEY || process.env.SHIPSGO_USER_TOKEN, 'key' + (entries.length + 1));

  const aliases = new Set();
  entries.forEach((entry, idx) => {
    if (!entry.alias || aliases.has(entry.alias)) entry.alias = 'key' + (idx + 1);
    aliases.add(entry.alias);
  });

  return entries;
}

function getShipsgoApiKeys() { return parseShipsgoApiKeys(); }
function getShipsgoApiKey() { return getShipsgoApiKeys()[0]?.token || ''; }
function getApiKey() { return getShipsgoApiKey(); }
function getTrackingMode() { return TRACKING_MODE; }
function shipsgoEnabled() { return getShipsgoApiKeys().length > 0; }

function getShipsgoPublicConfig() {
  return {
    mode: TRACKING_MODE,
    enabled: shipsgoEnabled(),
    api_version: SHIPSGO_API_VERSION,
    default_shipping_line: SHIPSGO_DEFAULT_SHIPPING_LINE || 'OTHERS',
    carrier_strategy: SHIPSGO_CARRIER_STRATEGY,
    shipping_lines_cached: getShipsgoShippingLineListSync(),
    key_count: getShipsgoApiKeys().length,
    keys: getShipsgoApiKeys().map(k => ({ alias: k.alias, masked: k.masked }))
  };
}

function getShipsgoCredentials(preferredAlias = '') {
  const keys = getShipsgoApiKeys();
  if (!preferredAlias) return keys;
  const preferred = keys.find(k => k.alias === preferredAlias);
  if (!preferred) return keys;
  return [preferred, ...keys.filter(k => k.alias !== preferred.alias)];
}

function first(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function valueAt(obj, path) {
  if (!obj || !path) return '';
  return path.split('.').reduce((acc, key) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[key];
  }, obj) || '';
}

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return Object.values(value);
  return [];
}

function safeJson(value) {
  try { return JSON.stringify(value || {}); } catch { return '{}'; }
}

function toISO(value) {
  if (!value) return '';
  if (typeof value === 'number') {
    const ms = value > 100000000000 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const text = String(value).trim();
  if (!text) return '';
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? text : d.toISOString();
}

function humanizeStatus(status) {
  const raw = String(status || '').trim();
  if (!raw) return 'En proceso';
  const key = raw.toUpperCase().replace(/[\s-]+/g, '_');
  const map = {
    CREATED: 'Creado en ShipsGo',
    NEW: 'Creado en ShipsGo',
    PENDING: 'Pendiente de datos',
    PROCESSING: 'Procesando en ShipsGo',
    INPROGRESS: 'Procesando en ShipsGo',
    IN_PROGRESS: 'Procesando en ShipsGo',
    IN_TRANSIT: 'En tránsito',
    TRANSIT: 'En tránsito',
    SAILING: 'En tránsito',
    ARRIVED: 'Arribado',
    DISCHARGED: 'Descargado',
    DELIVERED: 'Entregado',
    GATE_OUT: 'Gate out',
    COMPLETED: 'Completado',
    CANCELLED: 'Cancelado',
    CANCELED: 'Cancelado'
  };
  return map[key] || raw.replace(/_/g, ' ');
}

function parseResponseText(text) {
  const clean = String(text || '').trim();
  if (!clean) return { json: null, text: '' };
  try { return { json: JSON.parse(clean), text: clean }; } catch { return { json: null, text: clean }; }
}

async function fetchWithTimeout(url, options = {}, credential = null) {
  if (typeof fetch !== 'function') {
    return { status: 0, error: 'runtime', message: 'Node.js no tiene fetch global. Use Node 18+.', keyAlias: credential?.alias, keyMasked: credential?.masked };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || SHIPSGO_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    const text = await response.text();
    const parsed = parseResponseText(text);
    return {
      ok: response.ok,
      status: response.status,
      json: parsed.json,
      text: parsed.text,
      headers: response.headers,
      keyAlias: credential?.alias,
      keyMasked: credential?.masked
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      status: 0,
      error: err.name === 'AbortError' ? 'timeout' : 'network',
      message: err.name === 'AbortError' ? 'Tiempo agotado al consultar ShipsGo' : err.message,
      keyAlias: credential?.alias,
      keyMasked: credential?.masked
    };
  }
}

async function httpJsonV2(pathOrUrl, options = {}, credential = null) {
  const selected = credential || getShipsgoApiKeys()[0];
  if (!selected?.token) return { status: 0, error: 'missing_key', message: 'Configure SHIPSGO_API_KEYS o SHIPSGO_API_KEY en .env' };
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : SHIPSGO_V2_BASE_URL + pathOrUrl;
  return fetchWithTimeout(url, {
    method: options.method || 'GET',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Shipsgo-User-Token': selected.token
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    timeout: options.timeout
  }, selected);
}

async function httpFormV1(path, form, credential = null) {
  const selected = credential || getShipsgoApiKeys()[0];
  if (!selected?.token) return { status: 0, error: 'missing_key', message: 'Configure SHIPSGO_API_KEYS o SHIPSGO_API_KEY en .env' };
  const body = new URLSearchParams(form);
  const url = SHIPSGO_V1_BASE_URL + path;
  return fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body,
  }, selected);
}

async function httpGetV1(path, params, credential = null) {
  const selected = credential || getShipsgoApiKeys()[0];
  if (!selected?.token) return { status: 0, error: 'missing_key', message: 'Configure SHIPSGO_API_KEYS o SHIPSGO_API_KEY en .env' };
  const qs = new URLSearchParams(params);
  const url = SHIPSGO_V1_BASE_URL + path + '?' + qs.toString();
  return fetchWithTimeout(url, { method: 'GET', headers: { 'Accept': 'application/json' } }, selected);
}

function normalizeEnvelope(json) {
  if (!json) return {};
  if (Array.isArray(json)) return json[0] || {};
  if (typeof json !== 'object') return { value: json };
  return json.shipment || json.data?.shipment || json.data || json.result?.shipment || json.result || json;
}

function extractShipmentId(json) {
  const root = normalizeEnvelope(json);
  return String(first(
    root.id, root.shipment_id, root.shipmentId, root.ShipmentId, root.ShipsgoShipmentId,
    json?.shipment?.id, json?.data?.id, json?.data?.shipment?.id
  ) || '').trim();
}

function extractV1RequestId(json, text) {
  const root = normalizeEnvelope(json);
  const direct = first(
    root.requestId, root.request_id, root.RequestId, root.RequestID, root.requestID,
    root.Id, root.ID, root.id, root.value,
    /^\d+$/.test(String(root.Message || '').trim()) ? root.Message : '',
    /^\d+$/.test(String(root.message || '').trim()) ? root.message : '',
    json?.requestId, json?.RequestId
  );
  if (direct) return String(direct).trim();

  const raw = String(text || '').trim();
  if (/^\d+$/.test(raw)) return raw;
  const m = raw.match(/(?:request\s*id|requestId|RequestId|id)[^0-9]{0,20}(\d+)/i);
  return m ? m[1] : '';
}

function shipsgoError(status, json, fallbackText) {
  const msg = first(
    json?.message,
    json?.Message,
    json?.error,
    json?.Error,
    json?.error_message,
    json?.ErrorMessage,
    json?.errors && Array.isArray(json.errors) ? json.errors.join(', ') : '',
    json?.errors && typeof json.errors === 'object' ? Object.values(json.errors).flat().join(', ') : '',
    fallbackText
  );

  const base = { error: 'shipsgo_error', status, message: msg || `ShipsGo respondió HTTP ${status}` };
  const msgText = String(base.message || '').toLowerCase();
  if (status === 402 || /(credit|cr[eé]dit|quota|balance|saldo|insufficient|not enough|sin\s+cr[eé]dit|no\s+credits?|not\s+enough\s+credits?)/i.test(msgText)) {
    return { ...base, error: 'insufficient_credits' };
  }
  if (status === 400 || status === 422 || /(invalid|required|format|shipping\s*line|container)/i.test(msgText)) return { ...base, error: 'validation' };
  if (status === 401 || status === 403 || /(unauthorized|forbidden|auth|token|key|authcode)/i.test(msgText)) return { ...base, error: 'auth' };
  if (status === 404) return { ...base, error: 'not_found' };
  if (status === 409 || /(already\s+exists|duplicate)/i.test(msgText)) return { ...base, error: 'already_exists' };
  if (status === 429) return { ...base, error: 'rate_limited', retryable: true };
  if (status >= 500) return { ...base, error: 'server', retryable: true };
  return base;
}

function buildShipsgoV2Payload(ship, info) {
  const container = normalizeContainer(ship.container);
  const carrier = first(info?.shipsgoCarrier, ship.carrier, info?.carrier, 'OTHERS');
  const payload = {
    reference: 'tradeflow-shipment-' + ship.id,
    container_number: container,
    carrier,
    tags: ['TradeFlow']
  };
  return payload;
}

function buildShipsgoV1Form(ship, info, credential, shippingLine = 'OTHERS') {
  const container = normalizeContainer(ship.container);
  const carrier = normalizeShipsgoShippingLine(shippingLine) || 'OTHERS';
  return {
    authCode: credential.token,
    containerNumber: container,
    shippingLine: carrier,
    tags: 'TradeFlow'
  };
}

async function createShipsgoShipmentV2(ship, info, credential) {
  const payload = buildShipsgoV2Payload(ship, info);
  const res = await httpJsonV2('/ocean/shipments', { method: 'POST', body: payload }, credential);

  if (res.error) return { ok: false, error: res.error, status: res.status, message: res.message, raw: res.json || res.text };

  const providerId = extractShipmentId(res.json);
  const message = String(res.json?.message || res.json?.Message || '').toUpperCase();
  if ((res.status === 200 || res.status === 201) && (providerId || !message || message === 'SUCCESS')) {
    return { ok: true, providerId, providerVersion: 'v2', created: true, raw: res.json || res.text };
  }
  if (res.status === 409 && providerId) {
    return { ok: true, providerId, providerVersion: 'v2', created: false, duplicate: true, raw: res.json || res.text };
  }

  const err = shipsgoError(res.status, res.json, res.text);
  return { ok: false, ...err, raw: res.json || res.text };
}

async function createShipsgoShipmentV1(ship, info, credential, shippingLine = 'OTHERS') {
  const form = buildShipsgoV1Form(ship, info, credential, shippingLine);
  const res = await httpFormV1('/PostContainerInfo', form, credential);

  if (res.error) return { ok: false, error: res.error, status: res.status, message: res.message, raw: res.json || res.text, shippingLine: form.shippingLine };

  const providerId = extractV1RequestId(res.json, res.text);
  const text = String(res.text || '').trim();
  const looksLikeError = /(error|invalid|unauthorized|credit|not\s+enough|required|failed|fail|wrong|not\s+found)/i.test(text);
  if (res.status >= 200 && res.status < 300 && providerId && !looksLikeError) {
    return { ok: true, providerId, providerVersion: 'v1.2', created: true, raw: res.json || res.text, shippingLine: form.shippingLine };
  }

  const err = shipsgoError(res.status, res.json, res.text);
  return { ok: false, ...err, raw: res.json || res.text, shippingLine: form.shippingLine };
}

function shouldTryNextKeyAfterPost(error) {
  return error === 'insufficient_credits' || error === 'auth' || error === 'missing_key';
}

async function createShipsgoShipment(ship, info, preferredKeyAlias = '') {
  const credentials = getShipsgoCredentials(preferredKeyAlias);
  if (!credentials.length) {
    return { ok: false, error: 'missing_key', message: 'Configure SHIPSGO_API_KEYS o SHIPSGO_API_KEY en .env', attempts: [] };
  }

  const officialLines = await getShipsgoShippingLineList(false);
  const lineCandidates = getShipsgoPostLineCandidates(ship, info, officialLines);
  const attempts = [];
  let lastError = null;
  let lastRaw = null;
  const version = ['v1', 'v1.1', 'v1.2', 'v2', 'auto'].includes(SHIPSGO_API_VERSION) ? SHIPSGO_API_VERSION : 'v1.2';

  for (const credential of credentials) {
    const linesForThisKey = version === 'v2' ? [''] : lineCandidates;

    for (const shippingLine of linesForThisKey) {
      let result;
      if (version === 'v2') {
        result = await createShipsgoShipmentV2(ship, info, credential);
      } else if (version === 'auto') {
        const v2 = await createShipsgoShipmentV2(ship, info, credential);
        // En auto solo bajamos de v2 a v1.2 cuando el error es claramente de endpoint/formato/auth.
        // No hacemos segundo POST después de timeout/red/5xx/rate-limit porque podría duplicar el tracking y gastar dos créditos.
        if (v2.ok) {
          result = v2;
        } else if (['not_found', 'validation', 'auth', 'missing_key'].includes(v2.error)) {
          result = await createShipsgoShipmentV1(ship, info, credential, shippingLine || 'OTHERS');
          if (result.ok) result.v2_error = { error: v2.error, status: v2.status, message: v2.message };
        } else {
          result = v2;
        }
      } else {
        result = await createShipsgoShipmentV1(ship, info, credential, shippingLine || 'OTHERS');
      }

      lastRaw = result.raw || null;

      if (result.ok) {
        return {
          ok: true,
          providerId: result.providerId,
          providerVersion: result.providerVersion,
          providerKeyAlias: credential.alias,
          providerKeyMasked: credential.masked,
          shippingLine: result.shippingLine || shippingLine || '',
          created: result.created,
          duplicate: result.duplicate,
          raw: result.raw,
          attempts
        };
      }

      lastError = {
        error: result.error,
        status: result.status,
        message: result.message,
        shippingLine: result.shippingLine || shippingLine || '',
        keyAlias: credential.alias,
        keyMasked: credential.masked
      };
      attempts.push(lastError);

      // Si ShipsGo rechazó solo la naviera, probamos OTHERS con la MISMA key.
      // Un POST fallido por validación no devuelve request id y no debe consumir crédito.
      if (result.error === 'validation' && isShippingLineValidation(result) && normalizeLineKey(result.shippingLine) !== 'OTHERS') {
        continue;
      }

      // POST no se reintenta en red/timeout/5xx/rate-limit/validación de contenedor para evitar crear dos trackings y gastar dos créditos.
      if (shouldTryNextKeyAfterPost(result.error)) break;
      return { ok: false, ...lastError, attempts, raw: result.raw };
    }
  }

  const allCreditErrors = attempts.length && attempts.every(a => a.error === 'insufficient_credits');
  const anyCreditError = attempts.some(a => a.error === 'insufficient_credits');
  const allAuthErrors = attempts.length && attempts.every(a => a.error === 'auth');
  const error = allCreditErrors || anyCreditError ? 'insufficient_credits' : (allAuthErrors ? 'auth' : (lastError?.error || 'shipsgo_error'));
  const message = error === 'insufficient_credits'
    ? 'ShipsGo no tiene créditos disponibles en las API keys configuradas.'
    : (lastError?.message || 'ShipsGo no pudo crear el tracking con las API keys configuradas.');

  return { ok: false, error, status: lastError?.status || 0, message, attempts, raw: lastRaw };
}

async function getShipsgoDetailsV2(providerId, credential) {
  const suffix = '?mapPoint=true';
  const res = await httpJsonV2('/ocean/shipments/' + encodeURIComponent(providerId) + suffix, {}, credential);
  if (res.error) return { ok: false, error: res.error, status: res.status, message: res.message, raw: res.json || res.text };
  if (res.status === 200 && res.json) return { ok: true, raw: res.json, providerVersion: 'v2' };
  const err = shipsgoError(res.status, res.json, res.text);
  return { ok: false, ...err, raw: res.json || res.text };
}

async function getShipsgoDetailsV1(providerId, credential) {
  const res = await httpGetV1('/GetContainerInfo/', {
    authCode: credential.token,
    requestId: providerId,
    extended: 'true',
    mappoint: 'true',
    mapPoint: 'true'
  }, credential);
  if (res.error) return { ok: false, error: res.error, status: res.status, message: res.message, raw: res.json || res.text };
  if (res.status === 200 && (res.json || res.text)) return { ok: true, raw: res.json || res.text, providerVersion: 'v1.2' };
  const err = shipsgoError(res.status, res.json, res.text);
  return { ok: false, ...err, raw: res.json || res.text };
}

async function getShipsgoDetails(providerId, mapPoint = true, preferredKeyAlias = '', providerVersion = '') {
  if (!providerId) return { ok: false, error: 'missing_provider_id', message: 'Sin ShipsGo request/shipment id' };

  const credentials = getShipsgoCredentials(preferredKeyAlias);
  if (!credentials.length) {
    return { ok: false, error: 'missing_key', message: 'Configure SHIPSGO_API_KEYS o SHIPSGO_API_KEY en .env' };
  }

  const attempts = [];
  let lastError = null;
  let lastRaw = null;
  const preferredVersion = String(providerVersion || SHIPSGO_API_VERSION || 'v1.2').toLowerCase();

  for (const credential of credentials) {
    const versions = preferredVersion === 'v2' ? ['v2'] : (preferredVersion === 'auto' ? ['v1.2', 'v2'] : ['v1.2']);
    for (const version of versions) {
      const detail = version === 'v2'
        ? await getShipsgoDetailsV2(providerId, credential)
        : await getShipsgoDetailsV1(providerId, credential);
      lastRaw = detail.raw || null;

      if (detail.ok) {
        return { ok: true, raw: detail.raw, providerVersion: detail.providerVersion, providerKeyAlias: credential.alias, providerKeyMasked: credential.masked, attempts };
      }

      lastError = { error: detail.error, status: detail.status, message: detail.message, providerVersion: version, keyAlias: credential.alias, keyMasked: credential.masked };
      attempts.push(lastError);
    }
  }

  return { ok: false, ...(lastError || { error: 'shipsgo_error', status: 0, message: 'ShipsGo no devolvió detalle.' }), attempts, raw: lastRaw };
}

function eventFrom(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const date = toISO(first(
    raw.date, raw.Date, raw.datetime, raw.timestamp, raw.time,
    raw.event_date, raw.eventDate, raw.EventDate, raw.event_time, raw.eventTime,
    raw.actual_date, raw.actualDate, raw.ActualDate, raw.planned_date, raw.estimated_date,
    raw.MovementDate, raw.movementDate, raw.EventDateTime
  ));
  const location = first(
    valueAt(raw, 'location.name'), valueAt(raw, 'port.name'), valueAt(raw, 'facility.name'),
    raw.location, raw.Location, raw.LocationName, raw.port, raw.Port, raw.PortName,
    raw.place, raw.Place, raw.city, raw.City, raw.unlocode, raw.Unlocode, raw.locode, raw.Locode
  );
  const status = first(
    raw.status, raw.Status, raw.event, raw.Event, raw.event_name, raw.eventName, raw.EventName,
    raw.description, raw.Description, raw.milestone, raw.Milestone, raw.activity, raw.Activity,
    raw.type, raw.Type, raw.name, raw.Name, raw.code, raw.Code, raw.MoveType, raw.EventType
  );
  const vessel = first(valueAt(raw, 'vessel.name'), raw.vessel_name, raw.vesselName, raw.VesselName, raw.vessel, raw.Vessel);
  if (!date && !location && !status) return null;
  return {
    date,
    location: typeof location === 'object' ? first(location.name, location.portName, location.city) : String(location || ''),
    status: humanizeStatus(status),
    code: raw.code || raw.Code || raw.event_code || raw.eventCode || raw.EventCode || '',
    actual: raw.actual === undefined ? (raw.IsActual === undefined ? true : !!raw.IsActual) : !!raw.actual,
    vessel: typeof vessel === 'object' ? first(vessel.name, vessel.vesselName) : String(vessel || '')
  };
}

function collectEvents(root) {
  const events = [];
  const sources = [
    root.events, root.Events,
    root.movements, root.Movements, root.Movement,
    root.tracking_events, root.trackingEvents, root.TrackingEvents,
    root.ContainerEvents, root.containerEvents,
    root.route?.events, root.route?.movements,
    root.Route?.Events, root.Route?.Movements,
    root.status_extended?.events, root.status_extended?.movements,
    root.statusExtended?.events, root.statusExtended?.movements,
    root.StatusExtended?.Events, root.StatusExtended?.Movements,
    root.TransitDetails, root.transitDetails
  ];

  for (const c of asArray(root.containers || root.Containers)) {
    sources.push(c.events, c.Events, c.movements, c.Movements, c.tracking_events, c.trackingEvents, c.ContainerEvents);
  }

  for (const source of sources) {
    for (const raw of asArray(source)) {
      const mapped = eventFrom(raw);
      if (mapped) events.push(mapped);
    }
  }

  const unique = [];
  const seen = new Set();
  for (const event of events) {
    const key = [event.date, event.location, event.status].join('|');
    if (!seen.has(key)) { seen.add(key); unique.push(event); }
  }

  unique.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return unique;
}

function portName(...values) {
  const value = first(...values);
  if (!value) return '';
  if (typeof value === 'object') {
    return first(value.name, value.portName, value.port_name, value.location, value.city, value.unlocode, value.locode, value.Name, value.PortName, value.Unlocode);
  }
  return String(value);
}

function mapShipsGoShipment(data, info = {}, ship = {}, meta = {}) {
  const root = normalizeEnvelope(data);
  const route = root.route || root.routing || root.Route || root.Routing || {};
  const containers = asArray(root.containers || root.Containers);
  const firstContainer = containers[0] || {};
  const events = collectEvents(root);
  const lastEvent = events.find(e => e.actual) || events[0] || {};

  const providerId = first(meta.providerId, extractShipmentId(data), extractV1RequestId(data, typeof data === 'string' ? data : ''), root.RequestId, root.requestId, root.id);
  const carrier = first(
    valueAt(root, 'carrier.name'), valueAt(root, 'Carrier.Name'), root.carrier_name, root.carrierName, root.carrier, root.Carrier,
    root.shipping_line, root.shippingLine, root.shippingLineName, root.ShippingLine, root.ShippingLineName,
    info.carrier, ship.carrier
  );
  const container = first(
    root.container_number, root.containerNumber, root.ContainerNumber, root.ContainerNo,
    valueAt(root, 'container.number'), valueAt(root, 'Container.Number'),
    firstContainer.number, firstContainer.Number, firstContainer.container_number, firstContainer.ContainerNumber,
    ship.container
  );
  const vessel = first(
    valueAt(root, 'vessel.name'), valueAt(root, 'Vessel.Name'), root.vessel_name, root.vesselName, root.VesselName, root.vessel, root.Vessel,
    valueAt(route, 'vessel.name'), valueAt(route, 'Vessel.Name'), route.vessel_name, route.vesselName, route.VesselName,
    lastEvent.vessel, ship.vessel
  );
  const voyage = first(root.voyage, root.Voyage, root.voyage_number, root.voyageNumber, root.VoyageNumber, route.voyage, route.Voyage, route.voyage_number, route.VoyageNumber);

  const originPort = portName(
    valueAt(route, 'pol.name'), valueAt(route, 'POL.Name'), valueAt(route, 'port_of_loading.name'), valueAt(route, 'loading_port.name'),
    route.pol, route.POL, route.port_of_loading, route.loading_port,
    valueAt(root, 'pol.name'), valueAt(root, 'POL.Name'), valueAt(root, 'origin.name'), root.origin_port, root.OriginPort,
    root.port_of_loading, root.PortOfLoading, root.POL, ship.origin_port
  );
  const destPort = portName(
    valueAt(route, 'pod.name'), valueAt(route, 'POD.Name'), valueAt(route, 'port_of_discharge.name'), valueAt(route, 'discharge_port.name'),
    route.pod, route.POD, route.port_of_discharge, route.discharge_port,
    valueAt(root, 'pod.name'), valueAt(root, 'POD.Name'), valueAt(root, 'destination.name'), root.dest_port, root.destination_port,
    root.DestinationPort, root.port_of_discharge, root.PortOfDischarge, root.POD, ship.dest_port
  );
  const eta = toISO(first(
    valueAt(route, 'pod.eta'), valueAt(route, 'pod.estimated_time_of_arrival'), valueAt(route, 'POD.ETA'),
    route.eta, route.ETA, root.eta, root.ETA, root.Eta, root.estimated_arrival, root.EstimatedArrival,
    root.estimatedArrival, root.estimated_time_of_arrival, root.estimatedTimeOfArrival, root.PodEta, root.PODETA, ship.eta
  ));
  const status = humanizeStatus(first(
    valueAt(root, 'status_extended.label'), valueAt(root, 'statusExtended.label'), valueAt(root, 'StatusExtended.Label'),
    valueAt(root, 'status.name'), valueAt(root, 'Status.Name'), root.status, root.Status, root.status_message, root.statusMessage, root.StatusMessage,
    lastEvent.status, meta.created ? 'CREATED' : ''
  ));

  const lat = first(valueAt(root, 'vessel.latitude'), valueAt(root, 'Vessel.Latitude'), valueAt(root, 'mapPoint.latitude'), valueAt(root, 'MapPoint.Latitude'), root.latitude, root.Latitude, root.VesselLatitude, root.vesselLatitude);
  const lng = first(valueAt(root, 'vessel.longitude'), valueAt(root, 'Vessel.Longitude'), valueAt(root, 'mapPoint.longitude'), valueAt(root, 'MapPoint.Longitude'), root.longitude, root.Longitude, root.VesselLongitude, root.vesselLongitude);

  const hasUsefulData = !!(events.length || vessel || originPort || destPort || eta || lat || lng || /trans|arrib|sailing|delivered|descarg|discharg|gate/i.test(status));

  return {
    source: hasUsefulData ? 'shipsgo' : 'shipsgo-pending',
    provider_id: String(providerId || ''),
    provider_key_alias: meta.providerKeyAlias || ship.provider_key_alias || '',
    provider_version: meta.providerVersion || ship.provider_version || SHIPSGO_API_VERSION,
    carrier: typeof carrier === 'object' ? first(carrier.name, carrier.title, carrier.Name) : String(carrier || ''),
    container: normalizeContainer(container || ship.container),
    mmsi: '',
    vessel: typeof vessel === 'object' ? first(vessel.name, vessel.title, vessel.Name) : String(vessel || ''),
    voyage: String(voyage || ''),
    status: hasUsefulData ? status : 'ShipsGo recibió la solicitud; vuelva a actualizar en unos minutos.',
    progress: root.progress ?? root.Progress ?? null,
    origin_port: originPort || '',
    dest_port: destPort || '',
    eta,
    last_event: lastEvent.status || '',
    last_location: lastEvent.location || '',
    last_date: lastEvent.date || '',
    vessel_lat: lat || null,
    vessel_lng: lng || null,
    events,
    tracking_url: first(root.tracking_url, root.trackingUrl, root.TrackingUrl, root.map_url, root.MapUrl, 'https://shipsgo.com'),
    live: hasUsefulData,
    raw: { ...(typeof data === 'object' && data ? data : { value: data }), shipsgo_shipping_line: meta.shippingLine || ship.shipsgo_shipping_line || '' }
  };
}

function shipsgoStatusData(ship, info, providerId, raw, message, providerKeyAlias = '', providerVersion = '', source = 'shipsgo-pending') {
  return {
    source,
    provider_id: String(providerId || ''),
    provider_key_alias: providerKeyAlias || ship.provider_key_alias || '',
    provider_version: providerVersion || ship.provider_version || SHIPSGO_API_VERSION,
    carrier: info.carrier || ship.carrier || '',
    container: normalizeContainer(ship.container),
    mmsi: '',
    vessel: ship.vessel || '',
    voyage: '',
    status: message || 'ShipsGo recibió la solicitud; vuelva a actualizar en unos minutos.',
    origin_port: ship.origin_port || '',
    dest_port: ship.dest_port || '',
    eta: ship.eta || '',
    last_event: '',
    last_location: '',
    last_date: '',
    events: [],
    tracking_url: 'https://shipsgo.com',
    live: false,
    raw: { ...(typeof raw === 'object' && raw ? raw : { value: raw }), shipsgo_shipping_line: ship.shipsgo_shipping_line || info.shipsgoCarrier || '' }
  };
}

async function fetchFromShipsGo(ship, existingTracking = null) {
  const container = normalizeContainer(ship.container);
  const info = getTrackingUrl(container) || { carrier: ship.carrier || 'OTHERS', shipsgoCarrier: 'OTHERS', url: 'https://shipsgo.com' };

  if (!shipsgoEnabled()) {
    return shipsgoStatusData(
      ship,
      info,
      '',
      { mode: 'shipsgo', reason: 'missing_api_keys' },
      'ShipsGo no está configurado. Agregue SHIPSGO_API_KEYS en .env.',
      '',
      SHIPSGO_API_VERSION,
      'shipsgo-error'
    );
  }

  let providerId = existingTracking?.provider_id || '';
  let providerKeyAlias = existingTracking?.provider_key_alias || '';
  let providerVersion = existingTracking?.provider_version || '';
  if (!providerId && existingTracking?.raw_json) {
    try {
      const raw = JSON.parse(existingTracking.raw_json);
      providerId = extractShipmentId(raw) || extractV1RequestId(raw, '');
      providerVersion = raw?.provider_version || providerVersion;
    } catch {}
  }

  let createRaw = null;
  if (!providerId) {
    const created = await createShipsgoShipment(ship, info, providerKeyAlias);
    createRaw = created.raw || null;
    providerKeyAlias = created.providerKeyAlias || providerKeyAlias;
    providerVersion = created.providerVersion || providerVersion;
    ship.shipsgo_shipping_line = created.shippingLine || ship.shipsgo_shipping_line || '';

    if (!created.ok) {
      const attemptsText = Array.isArray(created.attempts) && created.attempts.length
        ? ' Intentos: ' + created.attempts.map(a => `${a.keyAlias || 'key'}${a.shippingLine ? '/' + a.shippingLine : ''}=${a.error}`).join(', ') + '.'
        : '';
      const messageMap = {
        auth: 'ShipsGo rechazó las API keys configuradas. Revise SHIPSGO_API_KEYS.',
        insufficient_credits: 'ShipsGo no tiene créditos suficientes en ninguna API key configurada.',
        validation: 'ShipsGo rechazó el contenedor o la naviera. Revise que el número sea correcto y que la naviera detectada coincida.',
        rate_limited: 'ShipsGo limitó la consulta. Espere unos segundos y actualice.',
        timeout: 'ShipsGo no respondió a tiempo. No se reintentó automáticamente para evitar doble consumo de crédito.',
        network: 'No se pudo conectar con ShipsGo. No se reintentó automáticamente para evitar doble consumo de crédito.',
        server: 'ShipsGo respondió con error temporal. No se reintentó automáticamente para evitar doble consumo de crédito.'
      };
      return shipsgoStatusData(
        ship,
        info,
        '',
        { create_raw: createRaw, attempts: created.attempts || [] },
        (messageMap[created.error] || created.message || 'ShipsGo no pudo crear el tracking.') + attemptsText,
        providerKeyAlias,
        providerVersion,
        'shipsgo-error'
      );
    }

    providerId = created.providerId;
    if (!providerId) {
      return shipsgoStatusData(
        ship,
        info,
        '',
        createRaw,
        'ShipsGo aceptó la solicitud pero no devolvió request id. Actualice en unos minutos.',
        providerKeyAlias,
        providerVersion,
        'shipsgo-pending'
      );
    }
  }

  const detail = await getShipsgoDetails(providerId, true, providerKeyAlias, providerVersion);
  if (detail.ok) {
    providerKeyAlias = detail.providerKeyAlias || providerKeyAlias;
    providerVersion = detail.providerVersion || providerVersion;
    return mapShipsGoShipment(detail.raw, info, { ...ship, provider_key_alias: providerKeyAlias, provider_version: providerVersion }, { providerId, providerKeyAlias, providerVersion, shippingLine: ship.shipsgo_shipping_line || '' });
  }

  return shipsgoStatusData(
    ship,
    info,
    providerId,
    detail.raw || createRaw,
    detail.error === 'not_found'
      ? 'ShipsGo creó el tracking; el detalle aún no está disponible. Actualice en unos minutos.'
      : (detail.message || 'ShipsGo recibió la solicitud; vuelva a actualizar en unos minutos.'),
    detail.providerKeyAlias || providerKeyAlias,
    detail.providerVersion || providerVersion,
    detail.error ? 'shipsgo-error' : 'shipsgo-pending'
  );
}

async function fetchTrackingFromCarrier(containerNumber, options = {}) {
  const container = normalizeContainer(containerNumber);
  const info = getTrackingUrl(container) || {
    carrier: 'OTHERS',
    shipsgoCarrier: 'OTHERS',
    scac: '',
    url: 'https://shipsgo.com'
  };

  // Preview sin costo mientras el usuario escribe o cuando solo se pide cache.
  // IMPORTANTE: si viene options.ship, aunque el prefijo sea desconocido, SÍ se llama ShipsGo con OTHERS.
  if (options.preview || !options.ship) {
    const known = info.carrier && info.carrier !== 'OTHERS';
    return {
      source: 'shipsgo-ready',
      provider_id: '',
      provider_key_alias: '',
      provider_version: SHIPSGO_API_VERSION,
      carrier: info.carrier || 'OTHERS',
      container,
      status: shipsgoEnabled()
        ? (known ? 'Naviera detectada — ShipsGo se consultará al registrar el envío' : 'Prefijo no identifica naviera; ShipsGo consultará con OTHERS al registrar el envío')
        : 'ShipsGo no está configurado — falta SHIPSGO_API_KEYS',
      tracking_url: 'https://shipsgo.com',
      events: [],
      live: false,
      raw: { mode: TRACKING_MODE, api_version: SHIPSGO_API_VERSION, shipsgo_keys: getShipsgoApiKeys().length, shipsgo_shipping_line: SHIPSGO_DEFAULT_SHIPPING_LINE || 'OTHERS' }
    };
  }

  return fetchFromShipsGo({ ...options.ship, container, carrier: info.carrier || options.ship.carrier || 'OTHERS' }, options.existingTracking || null);
}

async function refreshShipmentTracking(shipmentId) {
  const ship = db.queryOne('SELECT * FROM shipments WHERE id = ?', [shipmentId]);
  if (!ship) return { ok: false, msg: 'Envío no encontrado' };
  if (!ship.container) return { ok: false, msg: 'Sin contenedor' };

  const existing = db.queryOne('SELECT * FROM tracking WHERE shipment_id = ?', [shipmentId]);
  const t = await fetchTrackingFromCarrier(ship.container, { ship, existingTracking: existing });
  if (!t) return { ok: false, msg: 'No se pudo consultar ShipsGo' };

  const vals = [
    t.source || '', t.carrier || '', ship.container || '', t.mmsi || '', t.vessel || '', t.voyage || '', t.status || '',
    t.origin_port || ship.origin_port || '', t.dest_port || ship.dest_port || '',
    t.eta || ship.eta || '', t.last_event || '', t.last_location || '',
    t.last_date || '', JSON.stringify(t.events || []), t.tracking_url || '', t.live ? 1 : 0,
    t.provider_id || '', t.provider_key_alias || '', t.provider_version || SHIPSGO_API_VERSION,
    t.vessel_lat ?? null, t.vessel_lng ?? null, t.speed_knots ?? null, t.course_deg ?? null, t.heading_deg ?? null,
    safeJson(t.raw || {})
  ];

  if (existing) {
    db.run(`UPDATE tracking
      SET source=?,carrier=?,container=?,mmsi=?,vessel=?,voyage=?,status=?,origin_port=?,dest_port=?,eta=?,last_event=?,last_location=?,last_date=?,events=?,tracking_url=?,live=?,provider_id=?,provider_key_alias=?,provider_version=?,vessel_lat=?,vessel_lng=?,speed_knots=?,course_deg=?,heading_deg=?,raw_json=?,updated_at=datetime('now')
      WHERE shipment_id=?`, [...vals, shipmentId]);
  } else {
    db.insert(`INSERT INTO tracking (shipment_id,source,carrier,container,mmsi,bl,vessel,voyage,status,origin_port,dest_port,eta,last_event,last_location,last_date,events,tracking_url,live,provider_id,provider_key_alias,provider_version,vessel_lat,vessel_lng,speed_knots,course_deg,heading_deg,raw_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [shipmentId, t.source || '', t.carrier || '', ship.container || '', t.mmsi || '', ship.bl_number || '', t.vessel || '', t.voyage || '', t.status || '', t.origin_port || ship.origin_port || '', t.dest_port || ship.dest_port || '', t.eta || ship.eta || '', t.last_event || '', t.last_location || '', t.last_date || '', JSON.stringify(t.events || []), t.tracking_url || '', t.live ? 1 : 0, t.provider_id || '', t.provider_key_alias || '', t.provider_version || SHIPSGO_API_VERSION, t.vessel_lat ?? null, t.vessel_lng ?? null, t.speed_knots ?? null, t.course_deg ?? null, t.heading_deg ?? null, safeJson(t.raw || {})]);
  }

  return { ok: true, data: t };
}

module.exports = {
  detectCarrier,
  getTrackingUrl,
  getApiKey,
  getShipsgoApiKey,
  getShipsgoApiKeys,
  getShipsgoPublicConfig,
  getTrackingMode,
  shipsgoEnabled,
  fetchTrackingFromCarrier,
  fetchFromShipsGo,
  refreshShipmentTracking,
  mapShipsGoShipment,
  CARRIER_PREFIX_MAP,
  TRACKING_MODE,
  SHIPSGO_API_VERSION,
  SHIPSGO_DEFAULT_SHIPPING_LINE,
  SHIPSGO_CARRIER_STRATEGY,
  getShipsgoShippingLineList,
  getShipsgoShippingLineListSync,
  normalizeShipsgoShippingLine
};
