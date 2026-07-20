require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db/database');
const { firmMatchScore } = require('../src/services/fda-firm-match');

(async () => {
  const dbPath = path.resolve(process.env.DB_PATH || './data/tradeflow.db');
  if (!fs.existsSync(dbPath) && process.env.FDA_VALIDATE_ALLOW_MISSING_DB !== 'false') {
    console.log('FDA firm match SKIPPED: no existe data/tradeflow.db en este patch.');
    process.exit(0);
  }
  await db.init();
  const rows = db.query("SELECT firm_name FROM fda_refusals WHERE LOWER(country_name)=LOWER('El Salvador')");
  if (!rows.length && process.env.FDA_VALIDATE_ALLOW_MISSING_DB !== 'false') {
    console.log('FDA firm match SKIPPED: no hay filas FDA locales.');
    process.exit(0);
  }
  const countMatches = (query) => rows.filter(r => firmMatchScore(query, r.firm_name) >= 75).length;
  const tests = [
    ['Productos tipicos de centroamerica sa de cv', 77],
    ['tipicos centroamerica', 77],
    ['Exportadora Rio Grande S.A. de C.V.', 58],
    ['Productos Alimenticios Diana S.A. de C.V.', 61]
  ];
  for (const [query, expectedMin] of tests) {
    const count = countMatches(query);
    if (count < expectedMin) {
      console.error(`Firm match FAILED: ${query} => ${count}, expected at least ${expectedMin}`);
      process.exit(1);
    }
  }
  console.log('FDA firm match OK:', Object.fromEntries(tests.map(([q]) => [q, countMatches(q)])));
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
