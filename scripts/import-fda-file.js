require('dotenv').config();
const path = require('path');
const fs = require('fs');
const db = require('../src/db/database');
const officialFile = require('../src/services/fda-official-file');

(async () => {
  await db.init();
  const input = process.argv[2];
  if (!input) {
    console.error('Uso: npm run fda:import -- ruta/al/dataset-oficial.xlsx');
    process.exit(1);
  }
  const filePath = path.resolve(input);
  if (!fs.existsSync(filePath)) {
    console.error(`Archivo no encontrado: ${filePath}`);
    process.exit(1);
  }
  console.log(`[FDA-IMPORT] Importando archivo oficial: ${path.basename(filePath)}`);
  const result = await officialFile.importOfficialFile(filePath);
  console.log(JSON.stringify(result, null, 2));
  try { db.flush(); } catch (_) {}
})().catch(err => {
  console.error('[FDA-IMPORT] Error:', err.message);
  process.exit(1);
});
