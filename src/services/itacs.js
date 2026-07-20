const db = require('../db/database');

const CBP_ACE_BASE = 'https://ace.cbp.dhs.gov';
const ITACS_API = `${CBP_ACE_BASE}/itacs/api`;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; TradeFlowSV/2.0)',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://ace.cbp.dhs.gov/itacs/'
};

const STATUS_MAP = {
  '1': 'En Revisión',
  '2': 'Liberado',
  '3': 'Hold FDA',
  '4': 'Hold CBP',
  '5': 'Rechazado',
  '6': 'Destruido',
  '7': 'Re-exportado',
  'RELEASED': 'Liberado',
  'HOLD': 'En Hold',
  'REFUSED': 'Rechazado',
  'PENDING': 'Pendiente',
  'IN_BOND': 'En Bonded',
  'EXAM': 'En Examen'
};

function normalizeEntry(raw, entryNumber) {
  const status = raw.status || raw.entryStatus || raw.dispositionCode || '';
  return {
    entry_number:     entryNumber,
    firm_name:        raw.importerName || raw.consigneeName || '',
    ior_number:       raw.importerOfRecord || raw.iorNumber || '',
    entry_type:       raw.entryType || raw.type || '',
    entry_date:       raw.entryDate || raw.arrivalDate || '',
    port_of_entry:    raw.portOfEntry || raw.portCode || '',
    vessel:           raw.vessel || raw.vesselName || '',
    bl_number:        raw.blNumber || raw.masterBill || '',
    status_code:      String(status).toUpperCase(),
    status_label:     STATUS_MAP[String(status).toUpperCase()] ||
                      STATUS_MAP[status] ||
                      status ||
                      'Desconocido',
    hold_agency:      raw.holdAgency || raw.holdingAgency || '',
    hold_reason:      raw.holdReason || raw.holdDescription || '',
    liquidation_date: raw.liquidationDate || '',
    raw_json:         JSON.stringify(raw)
  };
}

async function fetchJSON(url, timeout = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: HEADERS });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function cleanEntryNumber(raw) {
  return String(raw || '').replace(/[^A-Z0-9\-]/gi, '').toUpperCase().trim();
}

function upsertItacsEntry(data) {
  const exists = db.queryOne(
    'SELECT id FROM itacs_entries WHERE entry_number = ?',
    [data.entry_number]
  );

  if (exists) {
    db.run(
      `UPDATE itacs_entries
       SET firm_name=?, ior_number=?, entry_type=?, entry_date=?,
           port_of_entry=?, vessel=?, bl_number=?, status_code=?,
           status_label=?, hold_agency=?, hold_reason=?,
           liquidation_date=?, raw_json=?,
           updated_at=datetime('now')
       WHERE id=?`,
      [
        data.firm_name, data.ior_number, data.entry_type,
        data.entry_date, data.port_of_entry, data.vessel,
        data.bl_number, data.status_code, data.status_label,
        data.hold_agency, data.hold_reason, data.liquidation_date,
        data.raw_json, exists.id
      ]
    );
    return { id: exists.id, action: 'updated' };
  }

  const id = db.insert(
    `INSERT INTO itacs_entries
     (entry_number, firm_name, ior_number, entry_type, entry_date,
      port_of_entry, vessel, bl_number, status_code, status_label,
      hold_agency, hold_reason, liquidation_date, raw_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      data.entry_number, data.firm_name, data.ior_number,
      data.entry_type, data.entry_date, data.port_of_entry,
      data.vessel, data.bl_number, data.status_code,
      data.status_label, data.hold_agency, data.hold_reason,
      data.liquidation_date, data.raw_json
    ]
  );
  return { id, action: 'inserted' };
}

async function lookupEntry(entryNumber) {
  const clean = cleanEntryNumber(entryNumber);
  if (!clean) return { ok: false, error: 'Número de entrada inválido' };

  console.log(`[ITACS] Consultando entrada: ${clean}`);

  try {
    const json = await fetchJSON(
      `${ITACS_API}/entry/${encodeURIComponent(clean)}`,
      25000
    );

    const entry = normalizeEntry(json, clean);
    const { action } = upsertItacsEntry(entry);

    db.run(
      `UPDATE shipments
       SET itacs_status=?
       WHERE entry_number=?`,
      [entry.status_label, clean]
    );

    console.log(`[ITACS] ${clean} → ${entry.status_label} (${action})`);
    return { ok: true, entry, action };

  } catch (err) {
    console.log(`[ITACS] Error ${clean}:`, err.message);

    const cached = db.queryOne(
      'SELECT * FROM itacs_entries WHERE entry_number = ?',
      [clean]
    );

    if (cached) {
      return {
        ok: true,
        entry: cached,
        action: 'cached',
        warning: 'Usando datos en caché — CBP no respondió'
      };
    }

    return { ok: false, error: err.message };
  }
}

async function syncAllShipmentEntries(userId = null) {
  const sql = userId
    ? 'SELECT id, entry_number FROM shipments WHERE user_id = ? AND entry_number != \'\''
    : 'SELECT id, entry_number FROM shipments WHERE entry_number != \'\'';

  const params = userId ? [userId] : [];
  const shipments = db.query(sql, params);

  console.log(`[ITACS] Sincronizando ${shipments.length} entradas...`);

  const results = [];

  for (const s of shipments) {
    if (!s.entry_number) continue;
    const result = await lookupEntry(s.entry_number);
    results.push({
      shipment_id: s.id,
      entry_number: s.entry_number,
      ...result
    });
    await new Promise(r => setTimeout(r, 600));
  }

  const ok = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;

  console.log(`[ITACS] Sync completo — OK: ${ok} | Error: ${fail}`);
  return { ok: true, total: shipments.length, success: ok, failed: fail, results };
}

async function getEntryFromDB(entryNumber) {
  const clean = cleanEntryNumber(entryNumber);
  return db.queryOne(
    'SELECT * FROM itacs_entries WHERE entry_number = ?',
    [clean]
  );
}

module.exports = {
  lookupEntry,
  syncAllShipmentEntries,
  getEntryFromDB,
  cleanEntryNumber
};
