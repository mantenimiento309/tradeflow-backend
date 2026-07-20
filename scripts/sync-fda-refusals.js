require('dotenv').config();
const db = require('../src/db/database');
const fdaSync = require('../src/services/fda-sync');

(async () => {
  await db.init();
  const args = process.argv.slice(2);
  const full = !args.includes('--incremental');
  if (!process.env.FDA_REFUSALS_PROVIDER) process.env.FDA_REFUSALS_PROVIDER = 'ddapi';
  console.log(`[FDA-CLI] Proveedor: ${process.env.FDA_REFUSALS_PROVIDER}. ${full ? 'Actualización completa legal-segura' : 'Modo incremental/fallback'}.`);
  const result = await fdaSync.syncAllRefusalsDaily({ full });
  console.log(JSON.stringify(result, null, 2));
  // Si la descarga externa falla pero la base local queda preservada, no salimos con error.
  if (!result.ok && !result.base_preserved && !result.preserved) process.exitCode = 1;
  try { db.flush(); } catch (_) {}
})().catch(err => { console.error(err); process.exit(1); });
