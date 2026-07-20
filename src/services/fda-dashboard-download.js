const officialFile = require('./fda-official-file');

async function syncDashboardDataset() {
  return {
    ok: true,
    skipped: true,
    base_preserved: true,
    legal_safe: true,
    provider: 'ddapi',
    strategy: 'ddapi-required',
    message: 'La actualización automática de refusals se realiza por DDAPI. Para archivo descargado manualmente use scripts/import-fda-file.js.'
  };
}

async function downloadEntireDataset() {
  throw new Error('La descarga automática de archivo fue retirada. Use FDA_DDAPI_USER/FDA_DDAPI_KEY o importación manual.');
}

module.exports = {
  syncDashboardDataset,
  downloadEntireDataset,
  stageXlsx: officialFile.stageXlsx,
  stageCsv: officialFile.stageCsv,
  promoteStage: officialFile.promoteStage,
  normalizeForDb: officialFile.normalizeForDb
};
