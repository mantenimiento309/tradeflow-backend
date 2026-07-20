require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db/database');
const { seed } = require('./db/seed');

const authRoutes    = require('./routes/auth');
const shipmentRoutes = require('./routes/shipments');
const fdaRoutes     = require('./routes/fda');
const trackingRoutes = require('./routes/tracking');
const fdaSyncRoutes = require('./routes/fda-sync');
const itacsRoutes   = require('./routes/itacs');

const fdaSync = require('./services/fda-sync');

const app  = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.use('/api/auth',      authRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/fda',       fdaRoutes);
app.use('/api/fda',       fdaSyncRoutes);
app.use('/api/tracking',  trackingRoutes);
app.use('/api/itacs',     itacsRoutes);

app.get('/api/health', (req, res) =>
  res.json({ ok: true, ts: new Date().toISOString(), version: '2.1.0' })
);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/{*path}', (req, res) => {
  if (!req.path.startsWith('/api'))
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

(async () => {
  await db.init();

  if (process.env.SEED !== 'false') {
    await seed(process.env.SEED === 'clean' ? 'clean' : 'demo');
  }

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`TradeFlow SV backend → http://localhost:${PORT}`);
    console.log(`API base → http://localhost:${PORT}/api`);

    // ── Sync diario de alerts (cada 6h) ──
    if (process.env.FDA_AUTOSYNC !== 'false') {
      fdaSync.syncAll().then(r =>
        console.log('[FDA] Sync inicial completo:', JSON.stringify(r))
      ).catch(err =>
        console.log('[FDA] Sync falló:', err.message)
      );

      const alertInterval = parseInt(process.env.FDA_SYNC_INTERVAL) || 6;
      setInterval(() => {
        fdaSync.syncAll().catch(err =>
          console.log('[FDA] Re-sync error:', err.message)
        );
      }, alertInterval * 60 * 60 * 1000);
    }

    // ── Descarga diaria COMPLETA de refusals (1 vez al día) ──
    if (process.env.FDA_REFUSALS_DAILY !== 'false') {
      const meta = fdaSync.getSyncMeta();
      const lastSync = meta.refusals_updated_at
        ? new Date(meta.refusals_updated_at) : null;
      const hoursAgo = lastSync
        ? (Date.now() - lastSync.getTime()) / 3600000 : Infinity;

      if (hoursAgo > 20) {
        console.log('[FDA-DAILY] Iniciando descarga completa de refusals...');
        // Delay de 10s para que el servidor termine de iniciar
        setTimeout(() => {
          fdaSync.syncAllRefusalsDaily().then(r => {
            console.log(`[FDA-DAILY] Listo: ${r.total || 0} registros`);
          }).catch(err => {
            console.log('[FDA-DAILY] Error:', err.message);
          });
        }, 10000);
      } else {
        console.log(`[FDA-DAILY] Datos frescos (hace ${hoursAgo.toFixed(1)}h), no se re-descarga`);
      }

      // Programar para las 3am todos los días
      const msUntil3am = (() => {
        const now = new Date();
        const next = new Date();
        next.setHours(3, 0, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        return next - now;
      })();

      setTimeout(() => {
        console.log('[FDA-DAILY] Descarga programada 3am...');
        fdaSync.syncAllRefusalsDaily().catch(err =>
          console.log('[FDA-DAILY] Error 3am:', err.message)
        );
        // Luego repetir cada 24h
        setInterval(() => {
          fdaSync.syncAllRefusalsDaily().catch(err =>
            console.log('[FDA-DAILY] Error diario:', err.message)
          );
        }, 24 * 60 * 60 * 1000);
      }, msUntil3am);

      console.log(`[FDA-DAILY] Próxima descarga programada en ${(msUntil3am/3600000).toFixed(1)}h`);
    }
  });
})();
