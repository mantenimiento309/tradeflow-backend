const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let db = null;
let SQLModule = null;
let _lastDiskMtimeMs = 0;
let _lastExternalCheckMs = 0;
let _isRefreshingFromDisk = false;
const EXTERNAL_REFRESH_THROTTLE_MS = Math.max(100, Number(process.env.DB_EXTERNAL_REFRESH_THROTTLE_MS || 250));

function getDbPath() {
  return path.resolve(process.env.DB_PATH || './data/tradeflow.db');
}

function getDiskMtimeMs(dbPath = getDbPath()) {
  try { return fs.existsSync(dbPath) ? fs.statSync(dbPath).mtimeMs : 0; }
  catch (_) { return 0; }
}

function normalizeKeyPart(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function buildRefusalRowKey(row = {}) {
  const parts = [
    row.firm_name,
    row.city,
    row.country_name,
    row.product_category,
    row.product_code_description,
    row.refusal_date,
    row.refusal_charges,
    row.district_description,
    row.shipment_id_ref
  ].map(normalizeKeyPart);
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

function createFdaRefusalsTable(sqlDb) {
  sqlDb.run(`CREATE TABLE IF NOT EXISTS fda_refusals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    row_key TEXT NOT NULL UNIQUE,
    firm_name TEXT NOT NULL,
    city TEXT DEFAULT '',
    country_name TEXT DEFAULT 'El Salvador',
    product_category TEXT DEFAULT '',
    product_code_description TEXT DEFAULT '',
    refusal_date TEXT,
    refusal_charges TEXT DEFAULT '',
    district_description TEXT DEFAULT '',
    shipment_id_ref TEXT DEFAULT ''
  )`);
  sqlDb.run(`CREATE INDEX IF NOT EXISTS idx_refusals_row_key ON fda_refusals(row_key)`);
  sqlDb.run(`CREATE INDEX IF NOT EXISTS idx_refusals_firm ON fda_refusals(firm_name)`);
  sqlDb.run(`CREATE INDEX IF NOT EXISTS idx_refusals_firm_date ON fda_refusals(firm_name, refusal_date)`);
  sqlDb.run(`CREATE INDEX IF NOT EXISTS idx_refusals_country ON fda_refusals(country_name)`);
  sqlDb.run(`CREATE INDEX IF NOT EXISTS idx_refusals_category ON fda_refusals(product_category)`);
  sqlDb.run(`CREATE INDEX IF NOT EXISTS idx_refusals_shipment ON fda_refusals(shipment_id_ref)`);
  sqlDb.run(`CREATE INDEX IF NOT EXISTS idx_refusals_country_date ON fda_refusals(country_name, refusal_date)`);
  sqlDb.run(`CREATE INDEX IF NOT EXISTS idx_refusals_country_firm ON fda_refusals(country_name, firm_name)`);
  sqlDb.run(`CREATE INDEX IF NOT EXISTS idx_refusals_country_category ON fda_refusals(country_name, product_category)`);
}

async function init() {
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!SQLModule) SQLModule = await initSqlJs();
  const SQL = SQLModule;

  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  _lastDiskMtimeMs = getDiskMtimeMs(dbPath);

  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');

  function tableExists(table) {
    const safe = String(table).replace(/'/g, "''");
    const out = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${safe}'`);
    return !!(out[0] && out[0].values && out[0].values.length);
  }

  function tableColumns(table) {
    const info = db.exec(`PRAGMA table_info(${table})`);
    return info[0]?.values?.map(row => row[1]) || [];
  }

  function ensureColumn(table, column, definition) {
    const cols = tableColumns(table);
    if (!cols.includes(column)) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  function migrateFdaRefusalsIfNeeded() {
    if (!tableExists('fda_refusals')) {
      createFdaRefusalsTable(db);
      return;
    }

    const cols = tableColumns('fda_refusals');
    if (cols.includes('row_key')) {
      createFdaRefusalsTable(db);
      return;
    }

    console.log('[FDA-DB] Migrando fda_refusals: se reemplaza UNIQUE(firm_name, shipment_id_ref) por row_key por línea de rechazo.');
    const legacy = 'fda_refusals_legacy_unique';
    db.run(`DROP TABLE IF EXISTS ${legacy}`);
    db.run(`ALTER TABLE fda_refusals RENAME TO ${legacy}`);
    createFdaRefusalsTable(db);

    const select = db.prepare(`SELECT firm_name, city, country_name, product_category, product_code_description, refusal_date, refusal_charges, district_description, shipment_id_ref FROM ${legacy}`);
    const insert = db.prepare(`INSERT OR IGNORE INTO fda_refusals
      (row_key, firm_name, city, country_name, product_category, product_code_description, refusal_date, refusal_charges, district_description, shipment_id_ref)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);

    let migrated = 0;
    db.run('BEGIN');
    try {
      while (select.step()) {
        const row = select.getAsObject();
        const normalized = {
          firm_name: row.firm_name || '',
          city: row.city || '',
          country_name: row.country_name || 'El Salvador',
          product_category: row.product_category || '',
          product_code_description: row.product_code_description || '',
          refusal_date: row.refusal_date || '',
          refusal_charges: row.refusal_charges || '',
          district_description: row.district_description || '',
          shipment_id_ref: row.shipment_id_ref || ''
        };
        if (!normalized.firm_name) continue;
        insert.run([
          buildRefusalRowKey(normalized),
          normalized.firm_name,
          normalized.city,
          normalized.country_name,
          normalized.product_category,
          normalized.product_code_description,
          normalized.refusal_date,
          normalized.refusal_charges,
          normalized.district_description,
          normalized.shipment_id_ref
        ]);
        migrated++;
      }
      db.run('COMMIT');
    } catch (err) {
      try { db.run('ROLLBACK'); } catch (_) {}
      throw err;
    } finally {
      select.free();
      insert.free();
    }
    db.run(`DROP TABLE IF EXISTS ${legacy}`);
    console.log(`[FDA-DB] Migración lista: ${migrated} registros preservados.`);
  }

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    ior_number TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'importer',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  ensureColumn('users', 'password_changed_at', "TEXT DEFAULT ''");
  ensureColumn('users', 'last_login_at', "TEXT DEFAULT ''");
  ensureColumn('users', 'login_failed_count', "INTEGER DEFAULT 0");
  ensureColumn('users', 'locked_until', "TEXT DEFAULT ''");

  db.run(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT DEFAULT '',
    requested_ip TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_password_reset_expires ON password_reset_tokens(expires_at)`);

  db.run(`CREATE TABLE IF NOT EXISTS auth_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    email TEXT DEFAULT '',
    event_type TEXT NOT NULL,
    ip TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_auth_events_email ON auth_events(email)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_auth_events_user ON auth_events(user_id)`);

  db.run(`CREATE TABLE IF NOT EXISTS shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    entry_number TEXT NOT NULL,
    bl_number TEXT DEFAULT '',
    vessel TEXT DEFAULT '',
    vessel_mmsi TEXT DEFAULT '',
    vessel_imo TEXT DEFAULT '',
    mmsi TEXT DEFAULT '',
    container TEXT DEFAULT '',
    product TEXT NOT NULL,
    origin_port TEXT DEFAULT '',
    dest_port TEXT DEFAULT '',
    etd TEXT,
    eta TEXT,
    arrived_at TEXT,
    status TEXT NOT NULL DEFAULT 'transit',
    broker TEXT DEFAULT '',
    carrier TEXT DEFAULT '',
    shipsgo_shipping_line TEXT DEFAULT 'OTHERS',
    itacs_status TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS fda_holds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id INTEGER NOT NULL,
    charge_code TEXT NOT NULL,
    section TEXT DEFAULT '',
    description TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id INTEGER NOT NULL,
    item TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    type TEXT NOT NULL DEFAULT 'normal',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS fda_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_number TEXT NOT NULL,
    alert_title TEXT NOT NULL,
    publish_date TEXT,
    products TEXT DEFAULT '',
    reason TEXT DEFAULT '',
    charge TEXT DEFAULT '',
    type TEXT DEFAULT 'DWPE',
    url TEXT DEFAULT ''
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS fda_charges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    asc_id INTEGER,
    section TEXT DEFAULT '',
    category TEXT DEFAULT '',
    desc_es TEXT DEFAULT '',
    desc_en TEXT DEFAULT ''
  )`);

  migrateFdaRefusalsIfNeeded();

  db.run(`CREATE TABLE IF NOT EXISTS dashboard_cache (
    cache_key TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id INTEGER NOT NULL UNIQUE,
    source TEXT DEFAULT 'shipsgo',
    carrier TEXT DEFAULT '',
    container TEXT DEFAULT '',
    bl TEXT DEFAULT '',
    vessel TEXT DEFAULT '',
    vessel_mmsi TEXT DEFAULT '',
    vessel_imo TEXT DEFAULT '',
    mmsi TEXT DEFAULT '',
    voyage TEXT DEFAULT '',
    status TEXT DEFAULT '',
    origin_port TEXT DEFAULT '',
    dest_port TEXT DEFAULT '',
    eta TEXT,
    last_event TEXT DEFAULT '',
    last_location TEXT DEFAULT '',
    last_date TEXT,
    events TEXT DEFAULT '[]',
    tracking_url TEXT DEFAULT '',
    vessel_lat REAL,
    vessel_lng REAL,
    vessel_speed REAL,
    vessel_course REAL,
    vessel_heading REAL,
    vessel_position_at TEXT,
    speed_knots REAL,
    course_deg REAL,
    heading_deg REAL,
    live INTEGER DEFAULT 1,
    provider_id TEXT DEFAULT '',
    provider_key_alias TEXT DEFAULT '',
    provider_version TEXT DEFAULT '',
    raw_json TEXT DEFAULT '{}',
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
  )`);

  ensureColumn('shipments', 'mmsi', "TEXT DEFAULT ''");
  ensureColumn('tracking', 'mmsi', "TEXT DEFAULT ''");
  ensureColumn('tracking', 'vessel_lat', "REAL");
  ensureColumn('tracking', 'vessel_lng', "REAL");
  ensureColumn('tracking', 'speed_knots', "REAL");
  ensureColumn('tracking', 'course_deg', "REAL");
  ensureColumn('tracking', 'heading_deg', "REAL");
  ensureColumn('shipments', 'vessel_mmsi', "TEXT DEFAULT ''");
  ensureColumn('shipments', 'vessel_imo', "TEXT DEFAULT ''");
  ensureColumn('shipments', 'shipsgo_shipping_line', "TEXT DEFAULT 'OTHERS'");

  ensureColumn('tracking', 'provider_id', "TEXT DEFAULT ''");
  ensureColumn('tracking', 'provider_key_alias', "TEXT DEFAULT ''");
  ensureColumn('tracking', 'provider_version', "TEXT DEFAULT ''");
  ensureColumn('tracking', 'raw_json', "TEXT DEFAULT '{}'");
  ensureColumn('tracking', 'vessel_mmsi', "TEXT DEFAULT ''");
  ensureColumn('tracking', 'vessel_imo', "TEXT DEFAULT ''");
  ensureColumn('tracking', 'vessel_lat', "REAL");
  ensureColumn('tracking', 'vessel_lng', "REAL");
  ensureColumn('tracking', 'vessel_speed', "REAL");
  ensureColumn('tracking', 'vessel_course', "REAL");
  ensureColumn('tracking', 'vessel_heading', "REAL");
  ensureColumn('tracking', 'vessel_position_at', "TEXT");
  db.run(`CREATE INDEX IF NOT EXISTS idx_tracking_provider_id ON tracking(provider_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tracking_provider_key_alias ON tracking(provider_key_alias)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tracking_provider_version ON tracking(provider_version)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tracking_vessel_mmsi ON tracking(vessel_mmsi)`);

  db.run(`CREATE TABLE IF NOT EXISTS fda_sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS itacs_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_number TEXT NOT NULL UNIQUE,
    firm_name TEXT DEFAULT '',
    ior_number TEXT DEFAULT '',
    entry_type TEXT DEFAULT '',
    entry_date TEXT DEFAULT '',
    port_of_entry TEXT DEFAULT '',
    vessel TEXT DEFAULT '',
    bl_number TEXT DEFAULT '',
    status_code TEXT DEFAULT '',
    status_label TEXT DEFAULT '',
    hold_agency TEXT DEFAULT '',
    hold_reason TEXT DEFAULT '',
    liquidation_date TEXT DEFAULT '',
    raw_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  save(true);
  return db;
}


function queryOn(sqlDb, sql, params = []) {
  const stmt = sqlDb.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function tableExistsOn(sqlDb, table) {
  const safe = String(table || '').replace(/'/g, "''");
  const rows = queryOn(sqlDb, `SELECT name FROM sqlite_master WHERE type='table' AND name='${safe}'`);
  return rows.length > 0;
}

function importTableFromExternal(extDb, table, columns, { requireRows = false } = {}) {
  if (!tableExistsOn(extDb, table) || !tableExistsOn(db, table)) return { table, imported: 0, skipped: true };
  const colList = columns.join(', ');
  const placeholders = columns.map(() => '?').join(',');
  const rows = queryOn(extDb, `SELECT ${colList} FROM ${table}`);
  if (requireRows && !rows.length) return { table, imported: 0, skipped: true };

  db.run(`DELETE FROM ${table}`);
  const insert = db.prepare(`INSERT OR REPLACE INTO ${table} (${colList}) VALUES (${placeholders})`);
  try {
    for (const row of rows) insert.run(columns.map(c => row[c] ?? ''));
  } finally {
    insert.free();
  }
  return { table, imported: rows.length, skipped: false };
}

function refreshFromDiskIfChanged(force = false) {
  if (!db || !SQLModule) return false;
  if (process.env.DB_AUTO_RELOAD_EXTERNAL === 'false') return false;
  if (_isRefreshingFromDisk) return false;

  const now = Date.now();
  if (!force && now - _lastExternalCheckMs < EXTERNAL_REFRESH_THROTTLE_MS) return false;
  _lastExternalCheckMs = now;

  const dbPath = getDbPath();
  const diskMtime = getDiskMtimeMs(dbPath);
  if (!diskMtime || diskMtime <= _lastDiskMtimeMs + 5) return false;

  _isRefreshingFromDisk = true;
  let extDb = null;
  try {
    const buf = fs.readFileSync(dbPath);
    extDb = new SQLModule.Database(buf);

    if (!tableExistsOn(extDb, 'fda_refusals')) {
      _lastDiskMtimeMs = diskMtime;
      return false;
    }

    const extSyncStatus = tableExistsOn(extDb, 'fda_sync_meta')
      ? (queryOn(extDb, "SELECT value FROM fda_sync_meta WHERE key='refusals_sync_status'")[0]?.value || '')
      : '';
    // Nota: no bloqueamos reload por status='running'. El sync externo escribe la tabla
    // principal solo cuando termina; mientras está corriendo conserva la base anterior.
    // En algunas DB antiguas el meta quedó en 'running' aunque el archivo ya tiene
    // los datos buenos, y eso era justo lo que dejaba las vistas congeladas.

    const targetCountry = process.env.FDA_REFUSALS_COUNTRY || 'El Salvador';
    const minTotal = Math.max(0, Number(process.env.FDA_REFUSALS_MIN_TOTAL || 500));
    const extTotal = queryOn(extDb, 'SELECT COUNT(*) as cnt FROM fda_refusals WHERE LOWER(country_name)=LOWER(?)', [targetCountry])[0]?.cnt || 0;
    const curTotal = queryOn(db, 'SELECT COUNT(*) as cnt FROM fda_refusals WHERE LOWER(country_name)=LOWER(?)', [targetCountry])[0]?.cnt || 0;

    // Evita importar una base externa vacía/parcial encima de una base local buena.
    if (curTotal >= minTotal && extTotal < minTotal) {
      console.log(`[FDA-DB] Cambio externo ignorado: ${extTotal} registros SV < mínimo ${minTotal}; base en memoria preservada (${curTotal}).`);
      _lastDiskMtimeMs = diskMtime;
      return false;
    }

    const imports = [];
    db.run('BEGIN');
    try {
      imports.push(importTableFromExternal(extDb, 'fda_refusals', [
        'row_key', 'firm_name', 'city', 'country_name', 'product_category',
        'product_code_description', 'refusal_date', 'refusal_charges',
        'district_description', 'shipment_id_ref'
      ], { requireRows: true }));
      imports.push(importTableFromExternal(extDb, 'fda_alerts', [
        'id', 'alert_number', 'alert_title', 'publish_date', 'products', 'reason', 'charge', 'type', 'url'
      ]));
      imports.push(importTableFromExternal(extDb, 'fda_charges', [
        'id', 'code', 'asc_id', 'section', 'category', 'desc_es', 'desc_en'
      ]));
      imports.push(importTableFromExternal(extDb, 'fda_sync_meta', ['key', 'value']));
      db.run('COMMIT');
    } catch (err) {
      try { db.run('ROLLBACK'); } catch (_) {}
      throw err;
    }

    const afterTotal = queryOn(db, 'SELECT COUNT(*) as cnt FROM fda_refusals WHERE LOWER(country_name)=LOWER(?)', [targetCountry])[0]?.cnt || 0;
    console.log(`[FDA-DB] Base FDA recargada desde disco: ${curTotal} → ${afterTotal} registros SV. (${imports.filter(x => !x.skipped).map(x => `${x.table}:${x.imported}`).join(', ')})`);

    // Regraba la DB completa para mezclar los datos FDA externos con usuarios/cuentas que existan en memoria.
    _saveDirty = true;
    _flushSave();
    _lastDiskMtimeMs = getDiskMtimeMs(dbPath);
    return true;
  } catch (err) {
    console.log('[FDA-DB] No se pudo recargar FDA desde disco:', err.message);
    _lastDiskMtimeMs = diskMtime;
    return false;
  } finally {
    try { if (extDb) extDb.close(); } catch (_) {}
    _isRefreshingFromDisk = false;
  }
}

let _saveTimer = null;
let _saveDirty = false;

function save(immediate = false) {
  if (!db) return;
  if (immediate) {
    _saveDirty = true;
    _flushSave();
    return;
  }
  _saveDirty = true;
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => { _saveTimer = null; _flushSave(); }, 400);
}

function _flushSave() {
  if (!db || !_saveDirty) return;

  // sql.js mantiene la DB en memoria. Si otro proceso (npm run fda:sync)
  // actualizó data/tradeflow.db mientras este servidor estaba vivo, primero
  // importamos las tablas FDA nuevas para no volver a grabar una copia vieja.
  if (!_isRefreshingFromDisk && process.env.DB_AUTO_RELOAD_EXTERNAL !== 'false') {
    const dbPath = getDbPath();
    const diskMtime = getDiskMtimeMs(dbPath);
    if (diskMtime && diskMtime > _lastDiskMtimeMs + 5) {
      try {
        refreshFromDiskIfChanged(true);
      } catch (err) {
        console.log('[FDA-DB] Reload previo a guardado omitido:', err.message);
      }
      if (!_saveDirty) return;
    }
  }

  _saveDirty = false;
  const dbPath = getDbPath();
  const data = db.export();
  const tmpPath = dbPath + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmpPath, Buffer.from(data));
  fs.renameSync(tmpPath, dbPath);
  _lastDiskMtimeMs = getDiskMtimeMs(dbPath);
}

function flush() { if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; } _flushSave(); }

function get() { return db; }

function runRaw(sql, params = []) {
  db.run(sql, params);
}

function run(sql, params = []) {
  refreshFromDiskIfChanged();
  db.run(sql, params);
  save();
}

function query(sql, params = []) {
  refreshFromDiskIfChanged();
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = query(sql, params);
  return rows.length ? rows[0] : null;
}

function insert(sql, params = []) {
  refreshFromDiskIfChanged();
  db.run(sql, params);
  const row = db.exec('SELECT last_insert_rowid() as id');
  save();
  return row[0]?.values[0]?.[0] || null;
}

module.exports = { init, get, save, flush, run, runRaw, query, queryOne, insert, buildRefusalRowKey, refreshFromDiskIfChanged, getDbPath };
