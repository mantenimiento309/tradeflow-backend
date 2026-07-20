function cleanText(value = '') {
  return String(value ?? '')
    .replace(/&/g, ' y ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBasic(value = '') {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeFirmName(value = '') {
  let text = normalizeBasic(value);
  // Quitar sufijos legales comunes sin borrar el nombre real de la empresa.
  text = text
    .replace(/\bs\s*\.?\s*a\s*\.?\s*de\s*c\s*\.?\s*v\s*\.?\b/g, ' ')
    .replace(/\bsa\s*de\s*cv\b/g, ' ')
    .replace(/\bsociedad\s+anonima\s+de\s+capital\s+variable\b/g, ' ')
    .replace(/\bs\s*\.?\s*de\s*r\s*\.?\s*l\s*\.?\s*de\s*c\s*\.?\s*v\s*\.?\b/g, ' ')
    .replace(/\bs\s*de\s*rl\s*de\s*cv\b/g, ' ')
    .replace(/\b(ltda|limitada|incorporated|inc|corp|corporation|co|company|cia)\b/g, ' ');

  return text
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'the', 'of', 'and',
  'sa', 's', 'a', 'cv', 'c', 'v', 'cia', 'co', 'company', 'corp', 'inc'
]);

function singularToken(token = '') {
  const t = String(token || '').trim();
  if (t.length > 5 && t.endsWith('es')) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith('s')) return t.slice(0, -1);
  return t;
}

function firmTokens(value = '') {
  const normalized = normalizeFirmName(value);
  const tokens = normalized
    .split(' ')
    .map(singularToken)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
  return [...new Set(tokens)];
}

function firmMatchScore(query = '', candidate = '') {
  const qNorm = normalizeFirmName(query);
  const cNorm = normalizeFirmName(candidate);
  if (!qNorm || !cNorm) return 0;
  if (qNorm === cNorm) return 100;
  if (cNorm.includes(qNorm) || qNorm.includes(cNorm)) return 94;

  const qTokens = firmTokens(query);
  const cTokens = new Set(firmTokens(candidate));
  if (!qTokens.length || !cTokens.size) return 0;
  const matched = qTokens.filter(t => cTokens.has(t)).length;
  const coverage = matched / qTokens.length;
  const reverseCoverage = matched / cTokens.size;

  if (qTokens.length === 1) return matched ? 72 : 0;
  if (coverage >= 0.9) return 90 + Math.round(reverseCoverage * 4);
  if (coverage >= 0.75 && matched >= 2) return 82 + Math.round(reverseCoverage * 5);
  if (coverage >= 0.66 && matched >= 3) return 76 + Math.round(reverseCoverage * 5);
  return 0;
}

function firmMatches(query = '', candidate = '', minScore = 75) {
  return firmMatchScore(query, candidate) >= minScore;
}

module.exports = { normalizeFirmName, firmTokens, firmMatchScore, firmMatches };
