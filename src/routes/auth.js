const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../db/database');
const auth = require('../middleware/auth');
const fdaSync = require('../services/fda-sync');
const { firmMatchScore } = require('../services/fda-firm-match');
const {
  cleanText,
  normalizeEmail,
  isValidEmail,
  validateRequiredText,
  validateIor,
  passwordStrength,
  hashToken,
  newResetToken,
  clientIp
} = require('../services/auth-security');
const { sendPasswordResetEmail } = require('../services/mailer');

const router = Router();
const loginAttempts = new Map();

function jwtSecret() {
  const secret = process.env.JWT_SECRET || 'change-this-local-secret';
  if (secret === 'change-this-local-secret' && process.env.NODE_ENV === 'production') {
    console.warn('[AUTH] JWT_SECRET usa valor por defecto en producción. Cámbielo en .env.');
  }
  return secret;
}

function signToken(user, extra = {}) {
  return jwt.sign(
    { id: user.id, role: extra.role || user.role, guest: !!extra.guest },
    jwtSecret(),
    { expiresIn: extra.guest ? (process.env.GUEST_TOKEN_TTL || '12h') : (process.env.JWT_TTL || '7d') }
  );
}

function safeUser(u, extra = {}) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    company: u.company,
    ior_number: u.ior_number,
    role: extra.role || u.role,
    guest: !!extra.guest
  };
}

function recordEvent(type, { userId = null, email = '', req } = {}) {
  try {
    db.runRaw(
      'INSERT INTO auth_events (user_id,email,event_type,ip,user_agent) VALUES (?,?,?,?,?)',
      [userId, normalizeEmail(email), type, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 250)]
    );
    db.save();
  } catch (_) {}
}

function rateKey(req, email) {
  return `${clientIp(req)}|${normalizeEmail(email)}`;
}

function pruneAttempts(now = Date.now()) {
  for (const [k, v] of loginAttempts.entries()) {
    if ((v.resetAt || 0) < now) loginAttempts.delete(k);
  }
}

function checkRateLimit(req, email) {
  pruneAttempts();
  const key = rateKey(req, email);
  const item = loginAttempts.get(key);
  if (!item) return { ok: true };
  if (item.lockedUntil && item.lockedUntil > Date.now()) {
    const seconds = Math.ceil((item.lockedUntil - Date.now()) / 1000);
    return { ok: false, retryAfter: seconds };
  }
  return { ok: true };
}

function registerFailedLogin(req, email) {
  const key = rateKey(req, email);
  const now = Date.now();
  const windowMs = Number(process.env.AUTH_LOGIN_WINDOW_MS || 15 * 60 * 1000);
  const maxAttempts = Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS || 6);
  const lockMs = Number(process.env.AUTH_LOGIN_LOCK_MS || 15 * 60 * 1000);
  const item = loginAttempts.get(key) || { count: 0, resetAt: now + windowMs, lockedUntil: 0 };
  if (item.resetAt < now) {
    item.count = 0;
    item.resetAt = now + windowMs;
    item.lockedUntil = 0;
  }
  item.count += 1;
  if (item.count >= maxAttempts) item.lockedUntil = now + lockMs;
  loginAttempts.set(key, item);
}

function clearFailedLogin(req, email) {
  loginAttempts.delete(rateKey(req, email));
}

function validateRegisterBody(body) {
  const name = cleanText(body.name, 90);
  const company = cleanText(body.company, 140);
  const email = normalizeEmail(body.email);
  const ior_number = cleanText(body.ior_number, 60);
  const role = ['importer', 'broker'].includes(body.role) ? body.role : 'importer';
  const password = String(body.password || '');

  const errors = [];
  const nameErr = validateRequiredText('Nombre', name, { min: 2, max: 90 });
  if (nameErr) errors.push(nameErr);
  const companyErr = validateRequiredText('Empresa', company, { min: 2, max: 140 });
  if (companyErr) errors.push(companyErr);
  if (!isValidEmail(email)) errors.push('Ingrese un correo electrónico válido.');
  const iorErr = validateIor(ior_number);
  if (iorErr) errors.push(iorErr);
  const pass = passwordStrength(password, { email, name, company });
  if (!pass.ok) errors.push('La contraseña debe cumplir: ' + pass.issues.join(', ') + '.');
  return { ok: !errors.length, errors, values: { name, company, email, ior_number, role, password } };
}

function validateProfileBody(body) {
  const name = body.name === undefined ? undefined : cleanText(body.name, 90);
  const company = body.company === undefined ? undefined : cleanText(body.company, 140);
  const ior_number = body.ior_number === undefined ? undefined : cleanText(body.ior_number, 60);
  const errors = [];
  if (name !== undefined) {
    const e = validateRequiredText('Nombre', name, { min: 2, max: 90 });
    if (e) errors.push(e);
  }
  if (company !== undefined) {
    const e = validateRequiredText('Empresa', company, { min: 2, max: 140 });
    if (e) errors.push(e);
  }
  if (ior_number !== undefined) {
    const e = validateIor(ior_number);
    if (e) errors.push(e);
  }
  return { ok: !errors.length, errors, values: { name, company, ior_number } };
}

function resetLinkAllowedInResponse() {
  return process.env.PASSWORD_RESET_DEV_LINK === 'true';
}

function mailDebugAllowed() {
  return process.env.MAIL_DEBUG === 'true' && process.env.NODE_ENV !== 'production';
}

function sqliteDateTimeFromMs(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function parseSqliteDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return Date.parse(raw.replace(' ', 'T') + 'Z');
  return Date.parse(raw);
}

router.post('/guest', (req, res) => {
  try {
    let user = db.queryOne('SELECT * FROM users WHERE email = ?', ['alimentos@tradeflow.sv']);
    if (!user) {
      const hash = bcrypt.hashSync(newResetToken() + 'A1!', 12);
      const id = db.insert(
        'INSERT INTO users (name,email,password,company,ior_number,role) VALUES (?,?,?,?,?,?)',
        ['Invitado', 'alimentos@tradeflow.sv', hash, 'Consulta rápida FDA', '', 'importer']
      );
      user = db.queryOne('SELECT * FROM users WHERE id = ?', [id]);
    }
    recordEvent('guest_login', { userId: user.id, email: user.email, req });
    res.json({ ok: true, token: signToken(user, { role: 'guest', guest: true }), user: safeUser(user, { role: 'guest', guest: true }) });
  } catch (err) {
    console.log('[AUTH GUEST ERROR]', err.message);
    res.status(500).json({ ok: false, msg: 'Error interno del servidor' });
  }
});

router.post('/register', async (req, res) => {
  try {
    const parsed = validateRegisterBody(req.body || {});
    if (!parsed.ok) return res.status(400).json({ ok: false, msg: parsed.errors[0], errors: parsed.errors });
    const { name, email, password, company, ior_number, role } = parsed.values;

    const exists = db.queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (exists) return res.status(409).json({ ok: false, msg: 'El correo ya está registrado' });

    const hash = bcrypt.hashSync(password, 12);
    const id = db.insert(
      'INSERT INTO users (name,email,password,company,ior_number,role,password_changed_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))',
      [name, email, hash, company, ior_number || '', role]
    );

    const user = db.queryOne('SELECT * FROM users WHERE id = ?', [id]);
    recordEvent('register', { userId: user.id, email, req });
    const token = signToken(user);
    res.json({ ok: true, token, user: safeUser(user) });

    // Post-registro: consulta local; no ejecuta procesos pesados automáticamente.
    if (process.env.FDA_REFUSALS_ON_REGISTER === 'true' && company && company.trim()) {
      setImmediate(async () => {
        try {
          const allSvRows = db.query(
            "SELECT firm_name FROM fda_refusals WHERE LOWER(country_name)=LOWER('El Salvador')"
          );
          const localCount = allSvRows.filter(r => firmMatchScore(company.trim(), r.firm_name) >= 75).length;

          const meta = fdaSync.getSyncMeta();
          const syncStatus = meta.refusals_sync_status;
          const lastSync = meta.refusals_updated_at ? new Date(meta.refusals_updated_at) : null;
          const hoursAgo = lastSync ? (Date.now() - lastSync.getTime()) / 3600000 : Infinity;

          console.log(`[FDA] Empresa: "${company}" | Locales: ${localCount} | DB hace: ${hoursAgo.toFixed(1)}h | Sync: ${syncStatus}`);

          if (hoursAgo < 24 || localCount > 0) {
            console.log(`[FDA] Usando DB local — ${localCount} registros encontrados`);
            return;
          }
          if (syncStatus === 'running') {
            console.log('[FDA] Descarga diaria en curso — datos disponibles al terminar');
            return;
          }
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
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || '');
  if (!isValidEmail(email) || !password) {
    return res.status(400).json({ ok: false, msg: 'Ingrese correo y contraseña válidos.' });
  }
  const rate = checkRateLimit(req, email);
  if (!rate.ok) {
    res.set('Retry-After', String(rate.retryAfter || 60));
    return res.status(429).json({ ok: false, msg: `Demasiados intentos. Intente de nuevo en ${rate.retryAfter || 60} segundos.` });
  }

  const user = db.queryOne('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    registerFailedLogin(req, email);
    recordEvent('login_failed', { userId: user?.id || null, email, req });
    return res.status(401).json({ ok: false, msg: 'Correo o contraseña incorrectos' });
  }

  clearFailedLogin(req, email);
  db.run('UPDATE users SET last_login_at=datetime(\'now\'), login_failed_count=0, locked_until=\'\' WHERE id=?', [user.id]);
  recordEvent('login_ok', { userId: user.id, email, req });
  res.json({ ok: true, token: signToken(user), user: safeUser(user) });
});

router.post('/forgot-password', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  // Respuesta genérica para no revelar si el correo existe.
  const generic = { ok: true, msg: 'Si el correo existe, enviaremos instrucciones para recuperar la contraseña.' };
  try {
    if (!isValidEmail(email)) return res.json(generic);
    const user = db.queryOne('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || user.email === 'alimentos@tradeflow.sv') {
      recordEvent('password_reset_requested_unknown', { email, req });
      return res.json(generic);
    }

    db.run('DELETE FROM password_reset_tokens WHERE user_id=? OR expires_at < datetime(\'now\') OR used_at <> \'\'', [user.id]);
    const token = newResetToken();
    const ttl = Math.max(10, Number(process.env.PASSWORD_RESET_TTL_MINUTES || 30));
    const expiresAt = sqliteDateTimeFromMs(Date.now() + ttl * 60 * 1000);
    db.insert(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip) VALUES (?,?,?,?)',
      [user.id, hashToken(token), expiresAt, clientIp(req)]
    );
    recordEvent('password_reset_requested', { userId: user.id, email, req });

    const delivered = await sendPasswordResetEmail({ to: user.email, name: user.name, token, req, baseUrl: req.body?.reset_base_url });
    if (delivered.ok && delivered.accepted) {
      console.log(`[AUTH] Recuperación aceptada por ${delivered.provider} para ${user.email}${delivered.messageId ? ' messageId=' + delivered.messageId : ''}.`);
    } else if (delivered.ok && delivered.provider === 'dev') {
      console.log(`[AUTH] Recuperación en modo local para ${user.email}.`);
    } else {
      console.log(`[AUTH] Recuperación no enviada para ${user.email}: ${delivered.error || 'proveedor no disponible'}`);
    }
    const out = { ...generic };
    if (mailDebugAllowed()) {
      out.mail_debug = {
        accepted: !!delivered.accepted,
        delivered: !!delivered.delivered,
        provider: delivered.provider || '',
        messageId: delivered.messageId || '',
        error: delivered.error || ''
      };
    }
    if (resetLinkAllowedInResponse() && delivered.resetUrl) out.dev_reset_url = delivered.resetUrl;
    res.json(out);
  } catch (err) {
    console.log('[AUTH FORGOT ERROR]', err.message);
    res.json(generic);
  }
});

router.post('/reset-password', (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');
    if (!token || token.length < 32) return res.status(400).json({ ok: false, msg: 'Enlace inválido o incompleto.' });

    const tokenHash = hashToken(token);
    const row = db.queryOne(
      `SELECT prt.*, u.email, u.name, u.company FROM password_reset_tokens prt
       JOIN users u ON u.id = prt.user_id
       WHERE prt.token_hash=? AND (prt.used_at IS NULL OR prt.used_at='')`,
      [tokenHash]
    );
    if (!row) return res.status(400).json({ ok: false, msg: 'El enlace de recuperación no es válido o ya fue usado.' });
    if (parseSqliteDateTime(row.expires_at) < Date.now()) {
      return res.status(400).json({ ok: false, msg: 'El enlace de recuperación venció. Solicite uno nuevo.' });
    }

    const strength = passwordStrength(password, { email: row.email, name: row.name, company: row.company });
    if (!strength.ok) return res.status(400).json({ ok: false, msg: 'La contraseña debe cumplir: ' + strength.issues.join(', ') + '.', errors: strength.issues });

    db.run('UPDATE users SET password=?, password_changed_at=datetime(\'now\') WHERE id=?', [bcrypt.hashSync(password, 12), row.user_id]);
    db.run('UPDATE password_reset_tokens SET used_at=datetime(\'now\') WHERE token_hash=?', [tokenHash]);
    db.run('DELETE FROM password_reset_tokens WHERE user_id=? AND token_hash<>?', [row.user_id, tokenHash]);
    recordEvent('password_reset_completed', { userId: row.user_id, email: row.email, req });
    res.json({ ok: true, msg: 'Contraseña actualizada. Ya puede iniciar sesión.' });
  } catch (err) {
    console.log('[AUTH RESET ERROR]', err.message);
    res.status(500).json({ ok: false, msg: 'Error interno del servidor' });
  }
});

router.get('/me', auth, (req, res) => {
  const user = db.queryOne('SELECT * FROM users WHERE id = ?', [req.userId]);
  if (!user) return res.status(404).json({ ok: false, msg: 'Usuario no encontrado' });
  const guest = req.userRole === 'guest';
  res.json({ ok: true, user: safeUser(user, guest ? { role: 'guest', guest: true } : {}) });
});

router.put('/me', auth, (req, res) => {
  if (req.userRole === 'guest') return res.status(403).json({ ok: false, msg: 'Cree una cuenta para editar perfil.' });
  const parsed = validateProfileBody(req.body || {});
  if (!parsed.ok) return res.status(400).json({ ok: false, msg: parsed.errors[0], errors: parsed.errors });
  const { name, company, ior_number } = parsed.values;
  db.run('UPDATE users SET name=COALESCE(?,name),company=COALESCE(?,company),ior_number=COALESCE(?,ior_number) WHERE id=?',
    [name ?? null, company ?? null, ior_number ?? null, req.userId]);
  const user = db.queryOne('SELECT * FROM users WHERE id = ?', [req.userId]);
  recordEvent('profile_updated', { userId: req.userId, email: user.email, req });
  res.json({ ok: true, user: safeUser(user) });
});

router.put('/password', auth, (req, res) => {
  if (req.userRole === 'guest') return res.status(403).json({ ok: false, msg: 'Cree una cuenta para cambiar contraseña.' });
  const current = String(req.body?.current || '');
  const newpass = String(req.body?.newpass || '');
  const user = db.queryOne('SELECT * FROM users WHERE id = ?', [req.userId]);
  if (!user) return res.status(404).json({ ok: false, msg: 'Usuario no encontrado' });
  if (!bcrypt.compareSync(current, user.password)) return res.status(400).json({ ok: false, msg: 'Contraseña actual incorrecta' });
  if (current === newpass) return res.status(400).json({ ok: false, msg: 'La nueva contraseña debe ser diferente a la actual.' });
  const strength = passwordStrength(newpass, { email: user.email, name: user.name, company: user.company });
  if (!strength.ok) return res.status(400).json({ ok: false, msg: 'La contraseña debe cumplir: ' + strength.issues.join(', ') + '.', errors: strength.issues });
  db.run('UPDATE users SET password=?, password_changed_at=datetime(\'now\') WHERE id=?', [bcrypt.hashSync(newpass, 12), req.userId]);
  recordEvent('password_changed', { userId: req.userId, email: user.email, req });
  res.json({ ok: true });
});

module.exports = router;
