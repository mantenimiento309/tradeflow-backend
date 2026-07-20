/*
  FDA Import Refusals — API oficial FDA Data Dashboard.

  Requiere FDA_DDAPI_USER + FDA_DDAPI_KEY en .env. Sin credenciales oficiales,
  el sistema conserva la base local y no intenta fuentes alternativas.
*/

const db = require('../db/database');
const DDAPI_BASE = 'https://api-datadashboard.fda.gov/v1';

function hasDDAPICredentials() {
  return !!(process.env.FDA_DDAPI_USER && process.env.FDA_DDAPI_KEY);
}

async function fetchJSON(url, opts = {}, timeout = 35000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(url, { signal: controller.signal, ...opts });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (err) { clearTimeout(timer); throw err; }
}

function upsertRefusal(row) {
  if (!row.firm_name) return null;
  const clean = {
    firm_name: String(row.firm_name || '').trim(),
    city: String(row.city || '').trim(),
    country_name: String(row.country_name || 'El Salvador').trim(),
    product_category: String(row.product_category || '').trim(),
    product_code_description: String(row.product_code_description || '').trim(),
    refusal_date: String(row.refusal_date || '').trim(),
    refusal_charges: String(row.refusal_charges || '').trim(),
    district_description: String(row.district_description || '').trim(),
    shipment_id_ref: String(row.shipment_id_ref || '').trim()
  };
  const rowKey = db.buildRefusalRowKey ? db.buildRefusalRowKey(clean) : [clean.firm_name, clean.shipment_id_ref, clean.product_category, clean.refusal_date, clean.refusal_charges].join('|');
  const exists = db.queryOne('SELECT id FROM fda_refusals WHERE row_key = ?', [rowKey]);
  if (exists) {
    db.run(
      `UPDATE fda_refusals SET firm_name=?,city=?,country_name=?,product_category=?,
       product_code_description=?,refusal_date=?,refusal_charges=?,
       district_description=?,shipment_id_ref=? WHERE id=?`,
      [clean.firm_name, clean.city, clean.country_name, clean.product_category,
       clean.product_code_description, clean.refusal_date,
       clean.refusal_charges, clean.district_description, clean.shipment_id_ref, exists.id]
    );
    return 'updated';
  }
  db.insert(
    `INSERT INTO fda_refusals (row_key,firm_name,city,country_name,product_category,
     product_code_description,refusal_date,refusal_charges,district_description,shipment_id_ref)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [rowKey, clean.firm_name, clean.city, clean.country_name, clean.product_category,
     clean.product_code_description, clean.refusal_date, clean.refusal_charges,
     clean.district_description, clean.shipment_id_ref]
  );
  return 'inserted';
}

async function syncViaDDAPI(firmName) {
  if (!hasDDAPICredentials()) {
    return {
      ok: false,
      skipped: true,
      legal_safe: true,
      error: 'Faltan FDA_DDAPI_USER/FDA_DDAPI_KEY en .env.'
    };
  }

  console.log(`[FDA-DDAPI] Consultando API oficial: "${firmName || 'El Salvador'}"`);
  let start = 1, inserted = 0, updated = 0, totalFetched = 0;

  while (true) {
    const filters = firmName
      ? { FirmName: [firmName], CountryCode: ['SV'] }
      : { CountryCode: ['SV'] };

    const json = await fetchJSON(`${DDAPI_BASE}/import_refusals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization-User': process.env.FDA_DDAPI_USER,
        'Authorization-Key': process.env.FDA_DDAPI_KEY
      },
      body: JSON.stringify({
        start, rows: 5000, sort: 'RefusalDate', sortorder: 'desc',
        returntotalcount: true, filters, columns: []
      })
    });

    const rows = json?.result ?? [];
    const totalCount = json?.totalrecordcount ?? 0;
    if (!rows.length) break;

    for (const r of rows) {
      const res = upsertRefusal({
        firm_name: String(r.FirmName || '').trim(),
        city: String(r.City || '').trim(),
        country_name: String(r.CountryName || 'El Salvador').trim(),
        product_category: String(r.ProductCategory || '').trim(),
        product_code_description: String(r.ProductCodeDescription || '').trim(),
        refusal_date: String(r.RefusalDate || '').trim(),
        refusal_charges: String(r.ChargeCode || r.RefusalCharges || '').trim(),
        district_description: String(r.DistrictDescription || '').trim(),
        shipment_id_ref: String(r.LineID || r.EntryLineNumber || r.ShipmentID || '').trim()
      });
      if (res === 'inserted') inserted++;
      else if (res === 'updated') updated++;
      totalFetched++;
    }

    console.log(`[FDA-DDAPI] start=${start} rows=${rows.length} total=${totalCount}`);
    if (start + rows.length > totalCount || rows.length < 5000) break;
    start += rows.length;
    await new Promise(r => setTimeout(r, 300));
  }

  return { ok: true, strategy: 'ddapi-official', provider: 'ddapi', total: totalFetched, inserted, updated, legal_safe: true };
}

async function syncFirmRefusals(company) {
  return await syncViaDDAPI(company);
}

async function syncAllRefusalsBySalvador() {
  return await syncViaDDAPI(null);
}

async function searchFirmsInDB(query) {
  const rows = db.query(
    `SELECT DISTINCT firm_name, city, country_name FROM fda_refusals
     WHERE firm_name LIKE ? ORDER BY firm_name LIMIT 30`,
    [`%${query}%`]
  );
  return { ok: true, firms: rows };
}

async function discoverFDAEndpoint() {
  return {
    ok: true,
    provider: 'ddapi',
    endpoint: `${DDAPI_BASE}/import_refusals`,
    configured: hasDDAPICredentials(),
    legal_safe: true,
    message: 'El backend usa únicamente la API oficial FDA Data Dashboard.'
  };
}

module.exports = {
  syncFirmRefusals,
  syncAllRefusalsBySalvador,
  searchFirmsInDB,
  discoverFDAEndpoint,
  hasDDAPICredentials
};
