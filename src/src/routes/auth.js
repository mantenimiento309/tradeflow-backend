const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../db/database');
const auth = require('../middleware/auth');
const fdaSync = require('../services/fda-sync');

const router = Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function safeUser(u) {
  return { id: u.id, name: u.name, email: u.email, company: u.company, ior_number: u.ior_number, role: u.role };
}

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, company, ior_number, role } = req.body;
    if (!name || !email || !password) return res.status(400).json({ ok: false, msg: 'Campos requeridos: name, email, password' });
    if (password.length < 6) return res.status(400).json({ ok: false, msg: 'La contraseña debe tener al menos 6 caracteres' });

    const exists = db.queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (exists) return res.status(409).json({ ok: false, msg: 'El correo ya está registrado' });

    const hash = bcrypt.hashSync(password, 10);
    const id = db.insert(
      'INSERT INTO users (name,email,password,company,ior_number,role) VALUES (?,?,?,?,?,?)',
      [name, email, hash, company || '', ior_number || '', role || 'importer']
    );

    const user = db.queryOne('SELECT * FROM users WHERE id = ?', [id]);
    const token = signToken(user);
    res.json({ ok: true, token, user: safeUser(user) });

    // Post-registro: buscar en DB local, NO disparar sincronización si ya hay datos o hay sync corriendo
    if (company && company.trim()) {
      setImmediate(async () => {
        try {
          const localCount = db.queryOne(
            'SELECT COUNT(*) as cnt FROM fda_refusals WHERE firm_name LIKE ?',
            [`%${company.trim()}%`]
          )?.cnt || 0;

          const meta = fdaSync.getSyncMeta();
          const syncStatus = meta.refusals_sync_status;
          const lastSync = meta.refusals_updated_at ? new Date(meta.refusals_updated_at) : null;
          const hoursAgo = lastSync ? (Date.now() - lastSync.getTime()) / 3600000 : Infinity;

          console.log(`[FDA] Empresa: "${company}" | Locales: ${localCount} | DB hace: ${hoursAgo.toFixed(1)}h | Sync: ${syncStatus}`);

          // DB fresca o hay datos → no descargar nada
          if (hoursAgo < 24 || localCount > 0) {
            console.log(`[FDA] Usando DB local — ${localCount} registros encontrados`);
            return;
          }
          // Ya hay sync corriendo → esperar
          if (syncStatus === 'running') {
            console.log('[FDA] Descarga diaria en curso — datos disponibles al terminar');
            return;
          }
          // DB vacía y sin sync → lanzar descarga completa una sola vez
          console.log('[FDA] DB vacía — iniciando descarga completa...');
          fdaSync.syncAllRefusalsDaily().catch(e =>
            console.log('[FDA] Error descarga:', e.message)
          );
        } catch (err) {
          console.log('[FDA] Error post-registro:', err.message);
        }
      });
    }
  } catch (err) {
    console.log('[AUTH REGISTER ERROR]', err.message);
    res.status(500).json({ ok: false, msg: 'Error interno del servidor' });
  }
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ ok: false, msg: 'Email y contraseña requeridos' });
  const user = db.queryOne('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ ok: false, msg: 'Correo o contraseña incorrectos' });
  res.json({ ok: true, token: signToken(user), user: safeUser(user) });
});

router.get('/me', auth, (req, res) => {
  const user = db.queryOne('SELECT * FROM users WHERE id = ?', [req.userId]);
  if (!user) return res.status(404).json({ ok: false, msg: 'Usuario no encontrado' });
  res.json({ ok: true, user: safeUser(user) });
});

router.put('/me', auth, (req, res) => {
  const { name, company, ior_number } = req.body;
  db.run('UPDATE users SET name=COALESCE(?,name),company=COALESCE(?,company),ior_number=COALESCE(?,ior_number) WHERE id=?',
    [name || null, company || null, ior_number || null, req.userId]);
  const user = db.queryOne('SELECT * FROM users WHERE id = ?', [req.userId]);
  res.json({ ok: true, user: safeUser(user) });
});

router.put('/password', auth, (req, res) => {
  const { current, newpass } = req.body;
  const user = db.queryOne('SELECT * FROM users WHERE id = ?', [req.userId]);
  if (!user) return res.status(404).json({ ok: false, msg: 'Usuario no encontrado' });
  if (!bcrypt.compareSync(current, user.password)) return res.status(400).json({ ok: false, msg: 'Contraseña actual incorrecta' });
  if (!newpass || newpass.length < 6) return res.status(400).json({ ok: false, msg: 'Nueva contraseña mínimo 6 caracteres' });
  db.run('UPDATE users SET password=? WHERE id=?', [bcrypt.hashSync(newpass, 10), req.userId]);
  res.json({ ok: true });
});

module.exports = router;
