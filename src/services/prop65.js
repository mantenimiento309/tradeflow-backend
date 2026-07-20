const db = require('../db/database');

// Buscador público de 60-Day Notices del Attorney General de California.
// El CSV export depende de una búsqueda en sesión; en cambio la página de resultados
// HTML devuelve los notices de forma consistente y paginable con ?page=N.
const PROP65_RESULTS_URL = process.env.PROP65_RESULTS_URL ||
  'https://oag.ca.gov/prop65/60-day-notice-search-results';
const TIMEOUT_MS = Math.max(15000, Number(process.env.PROP65_TIMEOUT_MS || 60000));
const MAX_PAGES = Math.max(1, Number(process.env.PROP65_MAX_PAGES || 25));
const REQUEST_DELAY_MS = Math.max(0, Number(process.env.PROP65_DELAY_MS || 500));

const HEADERS = {
  'User-Agent': 'TradeFlowSV/1.0 (contacto: mantenimiento9090@gmail.com)',
  'Accept': 'text/html,application/xhtml+xml'
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cleanText(value = '') {
  return String(value ?? '')
    .replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"').replace(/&rsquo;/g, '’').replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function toIsoDate(value = '') {
  const s = cleanText(value);
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

function ensureTables() {
  db.runRaw(`CREATE TABLE IF NOT EXISTS prop65_notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ag_number TEXT NOT NULL UNIQUE,
    date_filed TEXT DEFAULT '',
    noticing_party TEXT DEFAULT '',
    plaintiff_attorney TEXT DEFAULT '',
    alleged_violators TEXT DEFAULT '',
    chemical TEXT DEFAULT '',
    product_source TEXT DEFAULT '',
    notice_pdf TEXT DEFAULT ''
  )`);
  db.runRaw('CREATE INDEX IF NOT EXISTS idx_prop65_violators ON prop65_notices (alleged_violators)');
  db.runRaw('CREATE INDEX IF NOT EXISTS idx_prop65_chemical ON prop65_notices (chemical)');
  db.runRaw('CREATE INDEX IF NOT EXISTS idx_prop65_date ON prop65_notices (date_filed)');
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!res.ok) throw new Error(`Prop65 HTTP ${res.status}`);
    const text = await res.text();
    if (!text || text.length < 200) throw new Error('Prop65 HTML vacío');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// Extrae el valor que sigue a una etiqueta. Maneja dos formatos:
// (a) HTML con tags: <div>Label:</div><div>VALOR</div>
// (b) texto/markdown: "Label:\nVALOR" o "Label: VALOR"
function extractField(block, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // (a) HTML: etiqueta, cierre de tag, apertura de tag, valor
  const reHtml = new RegExp(esc + '\\s*:?\\s*<\\/[^>]+>\\s*<[^>]*>([\\s\\S]*?)<\\/', 'i');
  const mHtml = block.match(reHtml);
  if (mHtml && cleanText(mHtml[1])) return cleanText(mHtml[1]);
  // (b) texto plano: "Label:" y valor hasta salto de línea o siguiente etiqueta conocida
  const stops = 'Date Filed|Noticing Party|Plaintiff Attorney|Alleged Violators|Chemical|Source|Complaint|Notice PDF|AG Number';
  const reTxt = new RegExp(esc + '\\s*:\\s*([\\s\\S]*?)(?:\\n\\s*(?:' + stops + ')|<\\/div>|<div|Complaint\\s*\\()', 'i');
  const mTxt = block.match(reTxt);
  if (mTxt && cleanText(mTxt[1])) return cleanText(mTxt[1]);
  // (c) valor en la línea siguiente a la etiqueta
  const reNl = new RegExp(esc + '\\s*:?\\s*\\n\\s*([^\\n]+)', 'i');
  const mNl = block.match(reNl);
  return mNl ? cleanText(mNl[1]) : '';
}

function parseNoticesFromHtml(html) {
  const notices = [];
  const parts = html.split(/AG Number\s+/i).slice(1);
  for (const part of parts) {
    const agMatch = part.match(/(\d{4}-\d{4,6})/);
    if (!agMatch) continue;
    const agNumber = agMatch[1];
    const block = part.slice(0, 2500);

    const violators = extractField(block, 'Alleged Violators');
    const chemical = extractField(block, 'Chemical');
    const source = extractField(block, 'Source');
    // Un notice válido debe tener al menos violador o químico
    if (!violators && !chemical) continue;

    notices.push({
      ag_number: agNumber,
      date_filed: toIsoDate(extractField(block, 'Date Filed')),
      noticing_party: extractField(block, 'Noticing Party'),
      plaintiff_attorney: extractField(block, 'Plaintiff Attorney'),
      alleged_violators: violators,
      chemical: chemical,
      product_source: source,
      notice_pdf: `https://oag.ca.gov/system/files/prop65/notices/${agNumber}.pdf`
    });
  }
  return notices;
}

function upsertRows(rows = []) {
  let inserted = 0;
  if (!rows.length) return 0;
  db.runRaw('BEGIN');
  try {
    for (const r of rows) {
      if (!r || !r.ag_number) continue;
      db.runRaw(`INSERT INTO prop65_notices
        (ag_number, date_filed, noticing_party, plaintiff_attorney, alleged_violators, chemical, product_source, notice_pdf)
        VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(ag_number) DO UPDATE SET
          date_filed=excluded.date_filed,
          alleged_violators=excluded.alleged_violators,
          chemical=excluded.chemical,
          product_source=excluded.product_source`,
        [r.ag_number, r.date_filed, r.noticing_party, r.plaintiff_attorney,
         r.alleged_violators, r.chemical, r.product_source, r.notice_pdf]);
      inserted++;
    }
    db.runRaw('COMMIT');
    db.save(true);
    return inserted;
  } catch (err) {
    try { db.runRaw('ROLLBACK'); } catch (_) {}
    throw err;
  }
}

let _prop65SyncPromise = null;

async function syncProp65() {
  if (_prop65SyncPromise) {
    return { ok: true, inProgress: true, message: 'Sync Prop 65 ya en curso' };
  }
  _prop65SyncPromise = runProp65Sync();
  try { return await _prop65SyncPromise; }
  finally { _prop65SyncPromise = null; }
}

async function runProp65Sync() {
  ensureTables();
  console.log('[PROP65] Descargando 60-Day Notices desde California AG (HTML)...');
  let processed = 0;
  const before = db.queryOne('SELECT COUNT(*) as c FROM prop65_notices')?.c || 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = page === 0 ? PROP65_RESULTS_URL : `${PROP65_RESULTS_URL}?page=${page}`;
    let html;
    try {
      html = await fetchHtml(url);
    } catch (err) {
      if (page === 0) throw err;
      console.log(`[PROP65] Página ${page} sin datos (${err.message}), fin.`);
      break;
    }
    const notices = parseNoticesFromHtml(html);
    if (!notices.length) {
      console.log(`[PROP65] Página ${page}: 0 notices, fin de paginación.`);
      break;
    }
    const n = upsertRows(notices);
    processed += n;
    console.log(`[PROP65] Página ${page}: ${notices.length} notices (${n} procesados).`);
    if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
  }

  setProp65Meta('prop65_last_sync_at', new Date().toISOString());
  const total = db.queryOne('SELECT COUNT(*) as c FROM prop65_notices')?.c || 0;
  console.log(`[PROP65] Sync completo: ${total} notices en base local (+${total - before} nuevos).`);
  return { ok: true, processed, total, new_rows: total - before, source: 'ca-ag-html' };
}

function setProp65Meta(key, value) {
  db.runRaw('CREATE TABLE IF NOT EXISTS fda_sync_meta (key TEXT PRIMARY KEY, value TEXT)');
  db.runRaw('INSERT OR REPLACE INTO fda_sync_meta (key, value) VALUES (?, ?)', [key, String(value ?? '')]);
  db.save();
}

function getProp65Meta(key) {
  try { return db.queryOne('SELECT value FROM fda_sync_meta WHERE key = ?', [key])?.value || null; }
  catch (_) { return null; }
}

function getProp65Status() {
  ensureTables();
  const total = db.queryOne('SELECT COUNT(*) as c FROM prop65_notices')?.c || 0;
  const latest = db.queryOne('SELECT MAX(date_filed) as d FROM prop65_notices')?.d || '';
  return { total, latestFiled: latest, lastSync: getProp65Meta('prop65_last_sync_at') };
}

function searchProp65({ company = '', chemical = '', product = '', limit = 100 } = {}) {
  ensureTables();
  let sql = 'SELECT * FROM prop65_notices WHERE 1=1';
  const params = [];
  if (company) { sql += ' AND alleged_violators LIKE ?'; params.push(`%${company}%`); }
  if (chemical) { sql += ' AND chemical LIKE ?'; params.push(`%${chemical}%`); }
  if (product) { sql += ' AND product_source LIKE ?'; params.push(`%${product}%`); }
  sql += ' ORDER BY date_filed DESC LIMIT ?';
  params.push(Math.max(1, Math.min(500, limit)));
  return db.query(sql, params);
}

module.exports = {
  ensureTables,
  syncProp65,
  getProp65Status,
  getProp65Meta,
  searchProp65,
  PROP65_RESULTS_URL
};
