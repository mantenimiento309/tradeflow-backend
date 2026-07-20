require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db/database');

function count(sql, params = []) {
  return db.queryOne(sql, params)?.cnt || 0;
}

(async () => {
  await db.init();
  const dbPath = path.resolve(process.env.DB_PATH || './data/tradeflow.db');
  const sizeMB = fs.existsSync(dbPath) ? Math.round((fs.statSync(dbPath).size / 1024 / 1024) * 100) / 100 : 0;
  const out = {
    dbPath,
    sizeMB,
    scope: process.env.FDA_REFUSALS_SCOPE || 'sv',
    country: process.env.FDA_REFUSALS_COUNTRY || 'El Salvador',
    counts: {
      totalRefusals: count('SELECT COUNT(*) as cnt FROM fda_refusals'),
      elSalvador: count("SELECT COUNT(*) as cnt FROM fda_refusals WHERE LOWER(country_name)=LOWER('El Salvador')"),
      nonElSalvador: count("SELECT COUNT(*) as cnt FROM fda_refusals WHERE LOWER(country_name)<>LOWER('El Salvador')"),
      alerts: count('SELECT COUNT(*) as cnt FROM fda_alerts'),
      charges: count('SELECT COUNT(*) as cnt FROM fda_charges'),
      diana: count("SELECT COUNT(*) as cnt FROM fda_refusals WHERE LOWER(firm_name) LIKE '%diana%'")
    },
    byYear: Object.fromEntries(db.query("SELECT substr(refusal_date,1,4) AS year, COUNT(*) as cnt FROM fda_refusals WHERE refusal_date IS NOT NULL AND refusal_date != '' GROUP BY year ORDER BY year").map(r => [r.year, r.cnt])),
    meta: Object.fromEntries(db.query('SELECT key, value FROM fda_sync_meta ORDER BY key').map(r => [r.key, r.value]))
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
