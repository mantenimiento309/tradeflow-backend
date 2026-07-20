const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

let db = null;

async function init() {
  const dbPath = path.resolve(process.env.DB_PATH || './data/tradeflow.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');

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

  db.run(`CREATE TABLE IF NOT EXISTS shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    entry_number TEXT NOT NULL,
    bl_number TEXT DEFAULT '',
    vessel TEXT DEFAULT '',
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

  db.run(`CREATE TABLE IF NOT EXISTS fda_refusals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firm_name TEXT NOT NULL,
    city TEXT DEFAULT '',
    country_name TEXT DEFAULT 'El Salvador',
    product_category TEXT DEFAULT '',
    product_code_description TEXT DEFAULT '',
    refusal_date TEXT,
    refusal_charges TEXT DEFAULT '',
    district_description TEXT DEFAULT '',
    shipment_id_ref TEXT DEFAULT '',
    UNIQUE(firm_name, shipment_id_ref)
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_refusals_firm ON fda_refusals(firm_name)`);
  db.run(`CREATE TABLE IF NOT EXISTS tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id INTEGER NOT NULL UNIQUE,
    source TEXT DEFAULT 'trackcargo.co',
    carrier TEXT DEFAULT '',
    container TEXT DEFAULT '',
    bl TEXT DEFAULT '',
    vessel TEXT DEFAULT '',
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
    live INTEGER DEFAULT 1,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
  )`);

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

  save();
  return db;
}

function save() {
  if (!db) return;
  const dbPath = path.resolve(process.env.DB_PATH || './data/tradeflow.db');
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

function get() { return db; }

function runRaw(sql, params = []) {
  db.run(sql, params);
}

function run(sql, params = []) {
  db.run(sql, params);
  save();
}

function query(sql, params = []) {
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
  db.run(sql, params);
  const row = db.exec('SELECT last_insert_rowid() as id');
  save();
  return row[0]?.values[0]?.[0] || null;
}

module.exports = { init, get, save, run, runRaw, query, queryOne, insert };
