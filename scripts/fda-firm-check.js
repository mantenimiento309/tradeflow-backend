require('dotenv').config();
const db = require('../src/db/database');

function normalizeCompanyName(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/\bS\s*\.?\s*A\s*\.?\s*(DE)?\s*C\s*\.?\s*V\s*\.?\b/g, ' ')
    .replace(/\bSOCIEDAD\s+ANONIMA\s+(DE\s+)?CAPITAL\s+VARIABLE\b/g, ' ')
    .replace(/\b(SOCIEDAD|ANONIMA|CAPITAL|VARIABLE|INCORPORATED|INC|LLC|LTD|LIMITED|COMPANY|CO|CORP|CORPORATION|DE|DEL|LA|EL|Y|THE)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokens(value = '') {
  const stop = new Set(['SA','CV','S','A','C','V','DE','DEL','LA','EL','Y','THE','INC','LLC','LTD','CO','CORP','CIA','LTDA']);
  return normalizeCompanyName(value).split(' ').filter(t => t.length >= 3 && !stop.has(t));
}
function score(query, firm) {
  const q = normalizeCompanyName(query), f = normalizeCompanyName(firm);
  if (!q || !f) return 0;
  if (f.includes(q) || q.includes(f)) return 1;
  const ts = tokens(q);
  if (!ts.length) return 0;
  const hits = ts.filter(t => f.includes(t)).length;
  const ratio = hits / ts.length;
  return ts.length <= 2 ? (ratio === 1 ? ratio : 0) : (ratio >= 0.78 ? ratio : 0);
}

(async () => {
  await db.init();
  const name = process.argv.slice(2).join(' ').trim();
  if (!name) {
    console.error('Uso: node scripts/fda-firm-check.js "Nombre de empresa"');
    process.exit(2);
  }
  const country = process.env.FDA_REFUSALS_COUNTRY || 'El Salvador';
  const exact = db.query('SELECT * FROM fda_refusals WHERE firm_name LIKE ? AND LOWER(country_name)=LOWER(?)', [`%${name}%`, country]);
  const all = db.query('SELECT * FROM fda_refusals WHERE LOWER(country_name)=LOWER(?)', [country]);
  const matches = all.filter(r => score(name, r.firm_name) > 0);
  const byFirm = new Map();
  for (const r of matches) byFirm.set(r.firm_name, (byFirm.get(r.firm_name) || 0) + 1);
  console.log(JSON.stringify({
    company: name,
    normalized: normalizeCompanyName(name),
    tokens: tokens(name),
    exactLike: exact.length,
    flexible: matches.length,
    firms: [...byFirm.entries()].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([firm,count])=>({firm,count}))
  }, null, 2));
})().catch(err => { console.error(err); process.exit(1); });
