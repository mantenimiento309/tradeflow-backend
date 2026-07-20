const db = require('../db/database');

/*
  Servicio de notificaciones — genera alertas automáticas para cada empresa.
  Las notificaciones se generan a partir de eventos del sistema:
  - nuevo rechazo FDA detectado para la empresa
  - envío con FDA Hold
  - envío próximo a llegar (ETA en menos de 3 días)
  - nuevo Import Alert publicado
*/

function ensureTable() {
  db.runRaw(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    severity TEXT DEFAULT 'info',
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    link TEXT DEFAULT '',
    read INTEGER DEFAULT 0,
    dedupe_key TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.save();
}

function create(userId, { type, severity = 'info', title, body = '', link = '', dedupe_key = '' }) {
  if (dedupe_key) {
    const existing = db.queryOne(
      'SELECT id FROM notifications WHERE user_id = ? AND dedupe_key = ?',
      [userId, dedupe_key]
    );
    if (existing) return existing.id;
  }
  return db.insert(
    `INSERT INTO notifications (user_id, type, severity, title, body, link, dedupe_key)
     VALUES (?,?,?,?,?,?,?)`,
    [userId, type, severity, title, body, link, dedupe_key]
  );
}

function listForUser(userId, { unreadOnly = false, limit = 50 } = {}) {
  let sql = 'SELECT * FROM notifications WHERE user_id = ?';
  const params = [userId];
  if (unreadOnly) sql += ' AND read = 0';
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  return db.query(sql, params);
}

function unreadCount(userId) {
  const row = db.queryOne(
    'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND read = 0',
    [userId]
  );
  return row?.cnt || 0;
}

function markRead(userId, id) {
  db.run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', [id, userId]);
}

function markAllRead(userId) {
  db.run('UPDATE notifications SET read = 1 WHERE user_id = ?', [userId]);
}

function remove(userId, id) {
  db.run('DELETE FROM notifications WHERE id = ? AND user_id = ?', [id, userId]);
}

/*
  Genera notificaciones para un usuario basándose en el estado actual.
  Se llama al hacer login y periódicamente. Usa dedupe_key para no duplicar.
*/
function generateForUser(user) {
  if (!user) return;
  ensureTable();

  // 1. Rechazos FDA de la empresa (match exacto usa índice; LIKE solo de respaldo)
  if (user.company) {
    let count = db.queryOne(
      'SELECT COUNT(*) as cnt FROM fda_refusals WHERE firm_name = ?',
      [user.company]
    )?.cnt || 0;
    if (count === 0) {
      count = db.queryOne(
        'SELECT COUNT(*) as cnt FROM fda_refusals WHERE firm_name LIKE ?',
        [`%${user.company}%`]
      )?.cnt || 0;
    }
    if (count > 0) {
      create(user.id, {
        type: 'fda_refusal',
        severity: 'danger',
        title: `${count} rechazo(s) FDA registrados`,
        body: `Su empresa aparece en ${count} registro(s) de rechazo de la FDA. Revise su historial.`,
        link: 'mi-fda',
        dedupe_key: `fda_refusal_count_${count}`
      });
    }
  }

  // 2. Envíos con FDA Hold
  const held = db.query(
    "SELECT id, entry_number FROM shipments WHERE user_id = ? AND status = 'held'",
    [user.id]
  );
  for (const s of held) {
    create(user.id, {
      type: 'shipment_hold',
      severity: 'danger',
      title: `Envío ${s.entry_number} con FDA Hold`,
      body: 'Tiene un cargamento detenido por la FDA. Cuenta con 90 días para responder o reexportar.',
      link: 'mis-envios',
      dedupe_key: `hold_${s.id}`
    });
  }

  // 3. Envíos próximos a llegar (ETA dentro de 3 días)
  const arriving = db.query(
    "SELECT id, entry_number, eta, dest_port FROM shipments WHERE user_id = ? AND status = 'transit' AND eta IS NOT NULL",
    [user.id]
  );
  const now = Date.now();
  for (const s of arriving) {
    const eta = new Date(s.eta).getTime();
    if (isNaN(eta)) continue;
    const daysUntil = (eta - now) / 86400000;
    if (daysUntil > 0 && daysUntil <= 3) {
      create(user.id, {
        type: 'shipment_arriving',
        severity: 'info',
        title: `Envío ${s.entry_number} llega pronto`,
        body: `Llegada estimada a ${(s.dest_port || 'destino').split(',')[0]} en ${Math.ceil(daysUntil)} día(s).`,
        link: 'mis-envios',
        dedupe_key: `arriving_${s.id}_${s.eta}`
      });
    }
  }
}

module.exports = {
  ensureTable, create, listForUser, unreadCount,
  markRead, markAllRead, remove, generateForUser
};
