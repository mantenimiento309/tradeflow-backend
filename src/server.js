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
const fdaEntriesRoutes = require('./routes/fda-entries');

const fdaSync = require('./services/fda-sync');
const fdaIed = require('./services/fda-ied');
const fdaCompliance = require('./services/fda-ddapi-compliance');
const prop65 = require('./services/prop65');

const app  = express();
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';

app.disable('x-powered-by');
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: process.env.JSON_LIMIT || '128kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'DENY');
  next();
});
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use('/api/auth',      authRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/fda',       fdaRoutes);
app.use('/api/fda',       fdaSyncRoutes);
app.use('/api/fda',       fdaEntriesRoutes);
app.use('/api/tracking',  trackingRoutes);
app.use('/api/itacs',     itacsRoutes);

app.get('/api/health', (req, res) =>
  res.json({ ok: true })
);

app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
}));
app.get('/{*path}', (req, res) => {
  if (!req.path.startsWith('/api'))
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

(async () => {
  await db.init();

  if (process.env.SEED !== 'false') {
    await seed(process.env.SEED === 'clean' ? 'clean' : 'demo');
  }

  app.listen(PORT, HOST, () => {
    console.log(`TradeFlow SV backend → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
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

    // ── Actualización FDA SV automática cada 24h ──
    // Fuente oficial por defecto: FDA Data Dashboard API (DDAPI).
    const refusalsDailyEnabled = process.env.FDA_REFUSALS_DAILY === 'true';
    const refusalsScheduleEnabled = process.env.FDA_REFUSALS_SCHEDULE !== 'false' && refusalsDailyEnabled;
    const refusalsStartupEnabled = process.env.FDA_REFUSALS_STARTUP !== 'false' && refusalsDailyEnabled;
    const refusalsIntervalHours = Math.max(1, Number(process.env.FDA_REFUSALS_INTERVAL_HOURS || 24));
    const startupMinHours = Math.max(1, Number(process.env.FDA_REFUSALS_STARTUP_MIN_HOURS || 23));
    const intervalMs = refusalsIntervalHours * 60 * 60 * 1000;

    function hoursSince(value) {
      if (!value) return Infinity;
      const t = new Date(value).getTime();
      if (!Number.isFinite(t)) return Infinity;
      return (Date.now() - t) / 3600000;
    }

    async function runFdaDaily(label = 'programada') {
      const fullDailyEnabled = process.env.FDA_REFUSALS_FULL_DAILY !== 'false';
      const provider = process.env.FDA_REFUSALS_PROVIDER || 'ddapi';
      console.log(`[FDA-DAILY] Descarga ${label}: iniciando descarga completa FDA SV vía ${provider}...`);
      const r = await fdaSync.syncAllRefusalsDaily({ full: fullDailyEnabled });
      if (r?.no_changes || r?.skipped) {
        console.log(`[FDA-DAILY] Sin cambios: ${r.total || 0} registros. DB local preservada.`);
      } else if (r?.ok) {
        console.log(`[FDA-DAILY] Actualizada: ${r.total || 0} registros.`);
      } else {
        console.log(`[FDA-DAILY] No aplicada: ${r?.message || r?.error || 'error desconocido'}`);
      }
    }

    if (refusalsScheduleEnabled) {
      const meta = fdaSync.getSyncMeta();
      const lastAttempt = meta.refusals_last_attempt_at || meta.refusals_checked_at || meta.refusals_updated_at;
      const attemptAgeHours = hoursSince(lastAttempt);
      const expectedProvider = String(process.env.FDA_REFUSALS_PROVIDER || 'ddapi').toLowerCase();
      const lastSource = String(meta.refusals_last_source || '').toLowerCase();
      const providerChanged = expectedProvider && !lastSource.includes(expectedProvider.split('-')[0]);
      const shouldRunStartup = refusalsStartupEnabled && (providerChanged || attemptAgeHours >= startupMinHours);

      if (shouldRunStartup) {
        const startupDelayMs = Math.max(10000, Number(process.env.FDA_REFUSALS_STARTUP_DELAY_MS || 60000));
        const reason = providerChanged ? `proveedor cambiado (${lastSource || 'sin fuente'} → ${expectedProvider})` : `última revisión hace ${Number.isFinite(attemptAgeHours) ? attemptAgeHours.toFixed(1) : '∞'}h`;
        console.log(`[FDA-DAILY] Startup: ${reason}; se ejecutará en ${(startupDelayMs / 1000).toFixed(0)}s.`);
        setTimeout(() => runFdaDaily('startup').catch(err => console.log('[FDA-DAILY] Error startup:', err.message)), startupDelayMs);
      } else {
        console.log(`[FDA-DAILY] Startup: datos/revisión frescos (${Number.isFinite(attemptAgeHours) ? attemptAgeHours.toFixed(1) : '∞'}h).`);
      }

      const firstDelay = shouldRunStartup
        ? intervalMs
        : (Number.isFinite(attemptAgeHours)
          ? Math.max(60000, intervalMs - (attemptAgeHours * 60 * 60 * 1000))
          : intervalMs);

      setTimeout(function scheduleTick() {
        runFdaDaily('24h').catch(err => console.log('[FDA-DAILY] Error 24h:', err.message));
        setTimeout(scheduleTick, intervalMs);
      }, firstDelay);

      console.log(`[FDA-DAILY] Automático activo cada ${refusalsIntervalHours}h. Próxima revisión en ${(firstDelay / 3600000).toFixed(1)}h.`);
    } else {
      console.log('[FDA-DAILY] Descarga automática apagada. Active FDA_REFUSALS_DAILY=true para revisión cada 24h.');
    }

    // ── Sync semanal de Import Entries (FDA refresca jueves por la noche) ──
    const entriesWeeklyEnabled = process.env.FDA_ENTRIES_WEEKLY !== 'false';
    if (entriesWeeklyEnabled) {
      async function runFdaEntriesWeekly(label = 'programada') {
        console.log(`[FDA-ENTRIES] Descarga ${label}: iniciando sync de entries SV...`);
        const r = await fdaIed.syncEntriesWeekly();
        if (r?.rejected || r?.skipped) {
          console.log(`[FDA-ENTRIES] No aplicada: ${r.message || 'sin cambios'}. Base local preservada (${r.total || 0}).`);
        } else if (r?.ok) {
          console.log(`[FDA-ENTRIES] Actualizada: ${r.total || 0} entries (${r.new_rows || 0} nuevas).`);
          if (fdaCompliance.hasCredentials()) {
            const c = await fdaCompliance.syncComplianceAll().catch(err => {
              console.log('[FDA-ENTRIES] Error compliance:', err.message);
              return null;
            });
            if (c) console.log(`[FDA-ENTRIES] Compliance: ${c.compliance?.total ?? 0} acciones, ${c.inspections?.total ?? 0} inspecciones.`);
          }
        }
      }

      const lastEntriesSync = fdaIed.getEntriesMeta('entries_last_attempt_at');
      const entriesAgeHours = lastEntriesSync ? (Date.now() - new Date(lastEntriesSync).getTime()) / 3600000 : Infinity;
      const entriesEmpty = (fdaIed.getEntriesStatus().total || 0) === 0;

      if (entriesEmpty || entriesAgeHours >= 7 * 24) {
        const startupDelayMs = Math.max(15000, Number(process.env.FDA_ENTRIES_STARTUP_DELAY_MS || 120000));
        const reason = entriesEmpty ? 'base de entries vacía' : `último intento hace ${entriesAgeHours.toFixed(0)}h`;
        console.log(`[FDA-ENTRIES] Startup: ${reason}; sync inicial en ${(startupDelayMs / 1000).toFixed(0)}s.`);
        setTimeout(() => runFdaEntriesWeekly('startup').catch(err => console.log('[FDA-ENTRIES] Error startup:', err.message)), startupDelayMs);
      } else {
        console.log(`[FDA-ENTRIES] Startup: entries frescos (${entriesAgeHours.toFixed(1)}h).`);
      }

      // Prop 65: sync inicial si está vacío o viejo (>7 días)
      if (process.env.PROP65_SYNC !== 'false') {
        const p65Total = prop65.getProp65Status().total || 0;
        const p65Last = prop65.getProp65Meta('prop65_last_sync_at');
        const p65AgeHours = p65Last ? (Date.now() - new Date(p65Last).getTime()) / 3600000 : Infinity;
        if (p65Total === 0 || p65AgeHours >= 7 * 24) {
          setTimeout(() => {
            prop65.syncProp65()
              .then(r => console.log(`[PROP65] Startup sync: ${r.total || 0} notices (+${r.new_rows || 0}).`))
              .catch(err => console.log('[PROP65] Error startup:', err.message));
          }, Math.max(20000, Number(process.env.PROP65_STARTUP_DELAY_MS || 180000)));
        }
        // Prop 65 se actualiza a diario en el sitio del AG; refrescamos con el ciclo semanal de entries
      }

      // Próximo viernes 06:00 UTC (jueves ~11 PM El Salvador, tras el refresh de la FDA)
      const now = new Date();
      const nextFriday = new Date(now);
      nextFriday.setUTCDate(now.getUTCDate() + ((5 - now.getUTCDay() + 7) % 7 || 7));
      nextFriday.setUTCHours(6, 0, 0, 0);
      if (nextFriday <= now) nextFriday.setUTCDate(nextFriday.getUTCDate() + 7);
      const firstWeeklyDelay = nextFriday.getTime() - now.getTime();

      setTimeout(function weeklyTick() {
        runFdaEntriesWeekly('semanal').catch(err => console.log('[FDA-ENTRIES] Error semanal:', err.message));
        if (process.env.PROP65_SYNC !== 'false') {
          prop65.syncProp65().catch(err => console.log('[PROP65] Error semanal:', err.message));
        }
        setTimeout(weeklyTick, 7 * 24 * 60 * 60 * 1000);
      }, firstWeeklyDelay);

      console.log(`[FDA-ENTRIES] Automático activo. Próximo sync semanal: ${nextFriday.toISOString()}.`);
    } else {
      console.log('[FDA-ENTRIES] Sync semanal apagado (FDA_ENTRIES_WEEKLY=false).');
    }
  });
})();

function flushAndExit(code = 0) {
  try { if (typeof db.flush === 'function') db.flush(); else if (typeof db.save === 'function') db.save(true); } catch (_) {}
  process.exit(code);
}
process.on('SIGINT', () => flushAndExit(0));
process.on('SIGTERM', () => flushAndExit(0));
