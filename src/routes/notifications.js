const { Router } = require('express');
const auth = require('../middleware/auth');
const db = require('../db/database');
const notif = require('../services/notifications');

const router = Router();

router.get('/', auth, (req, res) => {
  const unreadOnly = req.query.unread === 'true';
  const list = notif.listForUser(req.userId, { unreadOnly });
  const unread = notif.unreadCount(req.userId);
  res.json({ ok: true, data: list, unread });
});

router.get('/count', auth, (req, res) => {
  res.json({ ok: true, unread: notif.unreadCount(req.userId) });
});

router.post('/:id/read', auth, (req, res) => {
  notif.markRead(req.userId, parseInt(req.params.id));
  res.json({ ok: true });
});

router.post('/read-all', auth, (req, res) => {
  notif.markAllRead(req.userId);
  res.json({ ok: true });
});

router.delete('/:id', auth, (req, res) => {
  notif.remove(req.userId, parseInt(req.params.id));
  res.json({ ok: true });
});

// Regenera notificaciones bajo demanda (se llama al cargar el dashboard)
router.post('/refresh', auth, (req, res) => {
  const user = db.queryOne('SELECT * FROM users WHERE id = ?', [req.userId]);
  notif.generateForUser(user);
  res.json({ ok: true, unread: notif.unreadCount(req.userId) });
});

module.exports = router;
