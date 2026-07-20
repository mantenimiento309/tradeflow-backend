// Parser CSV robusto: respeta campos entre comillas con comas y saltos de línea internos.
// Reemplaza el split(',') crudo que truncaba descripciones con comas.

function parseCsv(text = '') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

// Convierte CSV a array de objetos usando la primera fila como headers.
function parseCsvToObjects(text = '') {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h).trim());
  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
    return obj;
  });
}

// Busca el valor de una fila probando varios nombres de header posibles (case-insensitive, fuzzy).
function pickField(obj, candidates = []) {
  const keys = Object.keys(obj);
  for (const cand of candidates) {
    const target = cand.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const k of keys) {
      if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === target) return obj[k];
    }
  }
  // fallback: contiene
  for (const cand of candidates) {
    const target = cand.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const k of keys) {
      if (k.toLowerCase().replace(/[^a-z0-9]/g, '').includes(target)) return obj[k];
    }
  }
  return '';
}

module.exports = { parseCsv, parseCsvToObjects, pickField };
