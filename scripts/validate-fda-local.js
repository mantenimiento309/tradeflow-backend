require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db/database');

function fail(msg, extra = {}) {
  console.error('FDA local validation FAILED:', msg, extra);
  process.exit(1);
}

(async () => {
  const dbPath = path.resolve(process.env.DB_PATH || './data/tradeflow.db');
  if (!fs.existsSync(dbPath) && process.env.FDA_VALIDATE_ALLOW_MISSING_DB !== 'false') {
    console.log('FDA local validation SKIPPED: no existe data/tradeflow.db en este patch. Conserve su carpeta data/ actual o ejecute npm run fda:sync.');
    process.exit(0);
  }
  await db.init();
  const total = db.queryOne('SELECT COUNT(*) as cnt FROM fda_refusals')?.cnt || 0;
  const sv = db.queryOne("SELECT COUNT(*) as cnt FROM fda_refusals WHERE LOWER(country_name)=LOWER('El Salvador')")?.cnt || 0;
  const nonSv = db.queryOne("SELECT COUNT(*) as cnt FROM fda_refusals WHERE LOWER(country_name)<>LOWER('El Salvador')")?.cnt || 0;
  const alerts = db.queryOne('SELECT COUNT(*) as cnt FROM fda_alerts')?.cnt || 0;
  const charges = db.queryOne('SELECT COUNT(*) as cnt FROM fda_charges')?.cnt || 0;
  const foods = db.queryOne("SELECT COUNT(*) as cnt FROM fda_refusals WHERE CAST(substr(product_category, 1, 2) AS INTEGER) BETWEEN 2 AND 41")?.cnt || 0;
  const diana = db.queryOne("SELECT COUNT(*) as cnt FROM fda_refusals WHERE LOWER(firm_name) LIKE '%diana%'")?.cnt || 0;
  const serialDates = db.queryOne("SELECT COUNT(*) as cnt FROM fda_refusals WHERE refusal_date GLOB '[0-9][0-9][0-9][0-9][0-9]*'")?.cnt || 0;

  if (total < 500) fail('La base FDA local trae muy pocos registros.', { total });
  if (sv < 500) fail('El filtro de El Salvador trae muy pocos registros.', { sv });
  if (nonSv !== 0) fail('La DB compacta para VM debe contener solo El Salvador.', { nonSv });
  if (alerts < 1) fail('No hay Import Alerts locales.', { alerts });
  if (charges < 25) fail('No hay suficientes códigos FDA locales.', { charges });
  if (foods < 1) fail('No hay registros de alimentos.', { foods });
  if (serialDates > 0) fail('Quedan fechas en serial Excel; deben estar normalizadas.', { serialDates });

  console.log('FDA local validation OK:', { total, sv, nonSv, alerts, charges, foods, diana, serialDates });
  process.exit(0);
})().catch(err => fail(err.message));
