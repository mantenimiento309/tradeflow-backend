/*
  Helpers de validación y sanitización de inputs.
  Centraliza las reglas para usarlas en todas las rutas.
*/

// Limpia y limita longitud de un string
function str(v, maxLen = 500) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, maxLen);
}

// Valida email con formato razonable
function isEmail(v) {
  if (!v || typeof v !== 'string') return false;
  const e = v.trim();
  if (e.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// Valida número de contenedor ISO 6346: 4 letras + 7 dígitos (con o sin espacios)
function isContainer(v) {
  if (!v || typeof v !== 'string') return false;
  const c = v.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z]{4}\d{7}$/.test(c);
}

// Normaliza contenedor a formato estándar
function normalizeContainer(v) {
  return String(v || '').replace(/[\s-]/g, '').toUpperCase().slice(0, 11);
}

// Valida fecha ISO o YYYY-MM-DD; devuelve null si inválida
function cleanDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  // Rango razonable: 2000 a 2 años en el futuro
  const year = d.getFullYear();
  if (year < 2000 || year > new Date().getFullYear() + 2) return null;
  return s.slice(0, 10);
}

// Valida que un monto sea numérico no negativo
function cleanAmount(v) {
  const n = Number(v);
  if (isNaN(n) || n < 0 || !isFinite(n)) return 0;
  return Math.round(n * 100) / 100; // 2 decimales
}

// Valida un estado de envío contra la lista permitida
const VALID_STATUSES = ['transit', 'held', 'review', 'clear'];
function cleanStatus(v) {
  const s = String(v || '').toLowerCase().trim();
  return VALID_STATUSES.includes(s) ? s : 'transit';
}

// Valida rol de usuario
const VALID_ROLES = ['importer', 'broker', 'admin'];
function cleanRole(v) {
  const r = String(v || '').toLowerCase().trim();
  return VALID_ROLES.includes(r) ? r : 'importer';
}

// Valida tipo de costo
function cleanCostType(v) {
  const t = String(v || '').toLowerCase().trim();
  return ['normal', 'extra'].includes(t) ? t : 'normal';
}

// Valida número IOR (Importer of Record): opcional, pero si viene debe ser
// alfanumérico con guiones, 5-40 chars, y NO un email
function cleanIOR(v) {
  if (!v) return '';
  let s = String(v).trim();
  if (!s) return '';
  // El Importer of Record number del CBP usa solo dígitos y guiones.
  // Formatos válidos: EIN "12-3456789", SSN "123-45-6789", CBP "1234567-89".
  // Rechazamos cualquier letra o símbolo.
  if (!/^[0-9\-]{5,15}$/.test(s)) return null;
  // Debe tener al menos 7 dígitos en total (un IOR real los tiene)
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 12) return null;
  return s;
}

module.exports = {
  str, isEmail, isContainer, normalizeContainer,
  cleanDate, cleanAmount, cleanStatus, cleanRole, cleanCostType, cleanIOR,
  VALID_STATUSES, VALID_ROLES
};
