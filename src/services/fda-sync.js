const db = require('../db/database');
const { parseCsv } = require('./csv-util');

const FDA_CHARGES_CSV_URL = 'https://datadashboard.fda.gov/oii/download/ACT_SECTION_CHARGES.CSV';

async function fetchText(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'TradeFlowSV/OfficialAPI' }
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch (err) { clearTimeout(timer); throw err; }
}

function setMeta(key, value) {
  db.run(`INSERT OR REPLACE INTO fda_sync_meta (key, value) VALUES (?, ?)`, [key, String(value ?? '')]);
}

function getMetaValue(key) {
  return db.queryOne('SELECT value FROM fda_sync_meta WHERE key = ?', [key])?.value || null;
}

async function syncImportAlerts() {
  const current = db.queryOne('SELECT COUNT(*) as cnt FROM fda_alerts')?.cnt || 0;
  setMeta('alerts_checked_at', new Date().toISOString());
  return {
    ok: true,
    skipped: true,
    legal_safe: true,
    source: 'local-cache',
    count: current,
    inserted: 0,
    message: 'Import Alerts automáticos no se actualizan sin endpoint API oficial configurado; se conserva la base local.'
  };
}

let _refusalsSyncPromise = null;

async function syncAllRefusalsDaily(options = {}) {
  if (_refusalsSyncPromise) {
    console.log('[FDA-SYNC] Descarga de refusals ya está en curso; no se lanza otra.');
    return { ok: true, inProgress: true, message: 'Descarga FDA ya en curso' };
  }

  _refusalsSyncPromise = runRefusalsSyncDaily(options);
  try {
    return await _refusalsSyncPromise;
  } finally {
    _refusalsSyncPromise = null;
  }
}

async function runRefusalsSyncDaily(options = {}) {
  const targetCountry = process.env.FDA_REFUSALS_COUNTRY || 'El Salvador';
  const nowIso = new Date().toISOString();
  const provider = String(process.env.FDA_REFUSALS_PROVIDER || 'ddapi').toLowerCase();
  console.log(`[FDA-SYNC] Iniciando descarga de refusals FDA (${targetCountry}) vía API oficial...`);

  setMeta('refusals_sync_status', 'running');
  setMeta('refusals_sync_started', nowIso);
  setMeta('refusals_last_attempt_at', nowIso);

  const before = db.queryOne('SELECT COUNT(*) as cnt FROM fda_refusals WHERE LOWER(country_name)=LOWER(?)', [targetCountry])?.cnt || 0;

  async function runProvider(name) {
    if (name === 'ddapi' || name === 'api' || name === 'official-api') {
      const ddapi = require('./fda-ddapi');
      return await ddapi.syncDdapiDataset();
    }
    return {
      ok: true,
      skipped: true,
      base_preserved: true,
      legal_safe: true,
      strategy: 'ddapi-required',
      provider: 'ddapi',
      total: before,
      message: `Proveedor "${name}" retirado. Configure FDA_REFUSALS_PROVIDER=ddapi y credenciales FDA_DDAPI_USER/FDA_DDAPI_KEY.`
    };
  }

  try {
    const result = await runProvider(provider);
    const checkedAt = new Date().toISOString();

    if (result.ok) {
      setMeta('refusals_checked_at', checkedAt);
      setMeta('refusals_total', String(result.total || before));
      setMeta('refusals_last_source', result.strategy || 'ddapi-official');
      setMeta('refusals_scope', result.scope || process.env.FDA_REFUSALS_SCOPE || 'sv');
      setMeta('refusals_full_daily', result.full ? 'true' : 'false');
      setMeta('refusals_last_error', '');

      if (result.rejected || result.base_preserved) {
        const status = result.rejected ? 'partial_rejected' : 'preserved_after_error';
        setMeta('refusals_sync_status', status);
        setMeta('refusals_last_error', result.message || result.error || 'Descarga FDA no aplicada');
        setMeta('refusals_last_message', result.message || 'Base local preservada; no se aplicaron datos parciales.');
        console.log(`[FDA-SYNC] Descarga FDA preservada: ${result.message || result.error || 'datos no aceptados'}`);
        return { ...result, checked_at: checkedAt, total: result.total || before };
      }

      if (result.no_changes || result.skipped) {
        setMeta('refusals_sync_status', 'no_changes');
        setMeta('refusals_last_message', result.message || 'Sin cambios nuevos');
        console.log(`[FDA-SYNC] Sin cambios nuevos: ${result.total || before} registros. Base local preservada.`);
        return { ...result, checked_at: checkedAt };
      }

      setMeta('refusals_updated_at', checkedAt);
      setMeta('refusals_sync_status', 'ok');
      setMeta('refusals_last_message', result.message || `Actualizado: ${result.total || 0} registros`);
      console.log(`[FDA-SYNC] Descarga FDA aceptada: ${result.total} registros | ${targetCountry} antes: ${before}`);
      return { ...result, updated_at: checkedAt };
    }

    const checkedAtRejected = new Date().toISOString();
    setMeta('refusals_checked_at', checkedAtRejected);
    setMeta('refusals_sync_status', 'preserved_after_error');
    setMeta('refusals_last_error', result.message || result.error || 'FDA sync no aplicado');
    setMeta('refusals_last_message', 'Base local preservada; no se aplicaron datos parciales.');
    return {
      ...result,
      ok: true,
      skipped: true,
      base_preserved: true,
      checked_at: checkedAtRejected,
      total: before,
      message: result.message || result.error || 'FDA no entregó una descarga válida; base local preservada.'
    };
  } catch (err) {
    const checkedAt = new Date().toISOString();
    setMeta('refusals_checked_at', checkedAt);
    setMeta('refusals_sync_status', 'preserved_after_error');
    setMeta('refusals_last_error', err.message);
    setMeta('refusals_last_message', 'Error en API externa; base local preservada.');
    console.log('[FDA-SYNC] Error descarga FDA:', err.message);
    return {
      ok: true,
      skipped: true,
      base_preserved: true,
      error: err.message,
      checked_at: checkedAt,
      total: before,
      message: 'FDA no entregó una descarga válida; se conserva la base local y se volverá a intentar en la próxima revisión de 24h.'
    };
  } finally {
    try { db.save(true); } catch (_) {}
  }
}

function searchFirmLocal(company) {
  const rows = db.query(
    `SELECT * FROM fda_refusals WHERE firm_name LIKE ? ORDER BY refusal_date DESC`,
    [`%${company}%`]
  );
  return { ok: true, company, total: rows.length, source: 'local' };
}

function getSyncMeta() {
  const keys = ['refusals_updated_at', 'refusals_checked_at', 'refusals_last_attempt_at',
                 'refusals_total', 'refusals_sync_status', 'alerts_updated_at', 'alerts_checked_at',
                 'refusals_sync_started', 'refusals_last_error', 'refusals_last_message',
                 'refusals_last_source', 'refusals_scope', 'refusals_full_daily'];
  const meta = {};
  for (const k of keys) {
    const row = db.queryOne('SELECT value FROM fda_sync_meta WHERE key = ?', [k]);
    meta[k] = row?.value || null;
  }
  return meta;
}

async function syncCharges() {
  console.log('[FDA-SYNC] Descargando códigos FDA desde archivo oficial...');
  try {
    const csv = await fetchText(FDA_CHARGES_CSV_URL);
    const rows = parseCsv(csv);
    if (rows.length < 2) throw new Error('CSV vacío');
    let inserted = 0;
    let updated = 0;
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i];
      if (cols.length < 3) continue;
      const code = String(cols[0] || '').trim();
      if (!code) continue;
      const section = String(cols[1] || '').trim();
      const descEn = String(cols[2] || '').trim();
      const existing = db.queryOne('SELECT id, desc_en FROM fda_charges WHERE code = ?', [code]);
      if (existing) {
        // Reparar descripciones truncadas de cargas previas con el parser viejo
        if (descEn && descEn.length > String(existing.desc_en || '').length) {
          db.runRaw('UPDATE fda_charges SET desc_en = ?, section = ? WHERE id = ?', [descEn, section, existing.id]);
          updated++;
        }
        continue;
      }
      db.insert('INSERT INTO fda_charges (code,asc_id,section,category,desc_es,desc_en) VALUES (?,?,?,?,?,?)',
        [code, 0, section, '', '', descEn]);
      inserted++;
    }
    db.save(true);
    console.log(`[FDA-SYNC] ${inserted} charges insertados, ${updated} descripciones reparadas`);
    return { ok: true, inserted, updated, source: 'official-csv' };
  } catch (err) {
    console.log('[FDA-SYNC] Charges error:', err.message);
    return { ok: false, error: err.message };
  }
}

async function syncAll(company = '') {
  const alerts  = await syncImportAlerts();
  const charges = await syncCharges();
  return {
    ok: true,
    alerts,
    refusals: { ok: true, skipped: true },
    charges,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  syncImportAlerts,
  syncAllRefusalsDaily,
  searchFirmLocal,
  getSyncMeta,
  syncCharges,
  syncAll
};
