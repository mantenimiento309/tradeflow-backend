const crypto = require('crypto');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const SAFE_TEXT_RE = /^[\p{L}\p{N}\s.,'&()\-/]+$/u;
const SAFE_IOR_RE = /^[A-Za-z0-9 ._\-/]*$/;
const COMMON_PASSWORDS = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890',
  'password', 'password1', 'qwerty', 'qwerty123', 'admin123',
  'tradeflow', 'tradeflow123', 'empresa123', 'changeme', 'abc123',
  '000000', '111111', 'iloveyou', 'letmein', 'welcome', 'usuario123'
]);

function cleanText(value, max = 120) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function isValidEmail(email) {
  const e = normalizeEmail(email);
  return e.length >= 5 && e.length <= 254 && EMAIL_RE.test(e);
}

function validateRequiredText(label, value, { min = 2, max = 120, safe = true } = {}) {
  const clean = cleanText(value, max + 5);
  if (!clean || clean.length < min) return `${label} debe tener al menos ${min} caracteres.`;
  if (clean.length > max) return `${label} no puede exceder ${max} caracteres.`;
  if (safe && !SAFE_TEXT_RE.test(clean)) return `${label} contiene caracteres no permitidos.`;
  return '';
}

function hasSequentialRun(password) {
  const p = String(password || '').toLowerCase();
  const seq = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const rev = seq.split('').reverse().join('');
  for (let i = 0; i <= seq.length - 5; i++) {
    if (p.includes(seq.slice(i, i + 5))) return true;
  }
  for (let i = 0; i <= rev.length - 5; i++) {
    if (p.includes(rev.slice(i, i + 5))) return true;
  }
  return false;
}

function hasRepeatedRun(password) {
  return /(.)\1{3,}/.test(String(password || ''));
}

function passwordStrength(password, context = {}) {
  const p = String(password ?? '');
  const lower = p.toLowerCase();
  const issues = [];

  if (p.length < 10) issues.push('mínimo 10 caracteres');
  if (p.length > 128) issues.push('máximo 128 caracteres');
  if (!/[a-z]/.test(p)) issues.push('una minúscula');
  if (!/[A-Z]/.test(p)) issues.push('una mayúscula');
  if (!/[0-9]/.test(p)) issues.push('un número');
  if (!/[^A-Za-z0-9]/.test(p)) issues.push('un símbolo');
  if (COMMON_PASSWORDS.has(lower)) issues.push('no usar contraseñas comunes');
  if (hasSequentialRun(p)) issues.push('no usar secuencias como 12345 o abcde');
  if (hasRepeatedRun(p)) issues.push('no repetir el mismo carácter muchas veces');

  const personalParts = [context.email, context.name, context.company]
    .map(v => String(v || '').toLowerCase())
    .flatMap(v => v.split(/[^a-z0-9áéíóúñ]+/i))
    .map(v => v.trim())
    .filter(v => v.length >= 4);
  for (const part of personalParts) {
    if (part && lower.includes(part.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) {
      issues.push('no incluir nombre, empresa o correo');
      break;
    }
    if (part && lower.includes(part)) {
      issues.push('no incluir nombre, empresa o correo');
      break;
    }
  }

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(p)).length;
  let score = Math.min(100, Math.max(0, p.length * 5 + classes * 12 - issues.length * 12));
  if (p.length >= 14 && classes >= 3 && !issues.length) score = Math.max(score, 90);
  return { ok: issues.length === 0, score, issues };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function newResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '')
    .split(',')[0]
    .trim();
}

function validateIor(ior) {
  const clean = cleanText(ior || '', 60);
  if (!clean) return '';
  if (clean.length > 40) return 'El IOR no puede exceder 40 caracteres.';
  if (!SAFE_IOR_RE.test(clean)) return 'El IOR contiene caracteres no permitidos.';
  return '';
}

module.exports = {
  cleanText,
  normalizeEmail,
  isValidEmail,
  validateRequiredText,
  validateIor,
  passwordStrength,
  hashToken,
  newResetToken,
  clientIp
};
