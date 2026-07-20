require('dotenv').config();
const db = require('../src/db/database');
const ddapi = require('../src/services/fda-ddapi');

(async () => {
  await db.init();
  const status = ddapi.getCredentialsStatus();
  console.log('[FDA-DDAPI-TEST] Configuración:', JSON.stringify(status, null, 2));
  if (!status.configured) {
    console.error('[FDA-DDAPI-TEST] Faltan FDA_DDAPI_USER/FDA_DDAPI_KEY en .env');
    process.exit(1);
  }
  const result = await ddapi.testDdapiConnection();
  console.log('[FDA-DDAPI-TEST] Respuesta OK:', JSON.stringify(result, null, 2));
})().catch(err => {
  console.error('[FDA-DDAPI-TEST] Error:', err.message);
  process.exit(1);
});
