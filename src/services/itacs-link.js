const db = require('../db/database');

/*
  Vincula automáticamente los refusals de la FDA con el módulo ITACS.
  El "Shipment ID" de cada refusal (ej: 8Q4-0008382-5/10002/1) contiene el
  entry number de CBP en su primera parte (8Q4-0008382-5).

  Esto permite consultar el estado ITACS de cada rechazo sin que el usuario
  ingrese nada manualmente — el entry number ya viene en los datos de la FDA.
*/

// Extrae el entry number CBP de un Shipment ID de la FDA
function extractEntryNumber(shipmentId) {
  if (!shipmentId) return null;
  // El formato es ENTRY/LINE/SUBLINE — tomamos la parte antes del primer slash
  const entry = String(shipmentId).split('/')[0].trim();
  // Validar que parezca un entry number (tiene guiones, longitud razonable)
  if (entry.length >= 8 && entry.includes('-')) return entry;
  return null;
}

// Para una empresa, devuelve sus refusals enriquecidos con el entry number CBP
function getFirmRefusalsWithEntries(company) {
  const rows = db.query(
    'SELECT * FROM fda_refusals WHERE firm_name LIKE ? ORDER BY refusal_date DESC',
    [`%${company}%`]
  );
  return rows.map(r => ({
    ...r,
    cbp_entry_number: extractEntryNumber(r.shipment_id_ref)
  }));
}

// Resumen de estados ITACS para los refusals de una empresa
function getFirmItacsSummary(company) {
  const refusals = getFirmRefusalsWithEntries(company);
  const withEntry = refusals.filter(r => r.cbp_entry_number);

  // Buscar cuáles ya tienen estado consultado en itacs_entries
  const summary = { total: refusals.length, withEntry: withEntry.length, byStatus: {} };

  for (const r of withEntry) {
    const cached = db.queryOne(
      'SELECT status_label FROM itacs_entries WHERE entry_number = ?',
      [r.cbp_entry_number]
    );
    const label = cached?.status_label || 'No consultado';
    summary.byStatus[label] = (summary.byStatus[label] || 0) + 1;
  }

  return summary;
}

module.exports = {
  extractEntryNumber,
  getFirmRefusalsWithEntries,
  getFirmItacsSummary
};
