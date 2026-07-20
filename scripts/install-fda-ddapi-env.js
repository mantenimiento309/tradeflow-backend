const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcPath = path.join(root, '.env.fda-ddapi');
const envPath = path.join(root, '.env');

function parseEnv(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) map.set(key, value);
  }
  return map;
}

function setOrAppend(lines, key, value) {
  const re = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`);
  let replaced = false;
  const out = lines.map(line => {
    if (re.test(line)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) out.push(`${key}=${value}`);
  return out;
}

if (!fs.existsSync(srcPath)) {
  console.error('No existe .env.fda-ddapi');
  process.exit(1);
}

const source = parseEnv(fs.readFileSync(srcPath, 'utf8'));
let lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split(/\r?\n/) : [];
if (!lines.length) lines = ['# TradeFlow SV'];

for (const [key, value] of source.entries()) {
  lines = setOrAppend(lines, key, value);
}

fs.writeFileSync(envPath, lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n');
console.log('[FDA-DDAPI] .env actualizado sin tocar otras variables.');
console.log('[FDA-DDAPI] Proveedor activo: ddapi.');
