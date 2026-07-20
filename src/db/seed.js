const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./database');

function strongUnusableDemoPassword() {
  return 'Demo!' + crypto.randomBytes(24).toString('base64url') + '9aA#';
}

async function seed(mode) {
  if (mode === 'demo') {
    const hash = bcrypt.hashSync(strongUnusableDemoPassword(), 12);
    const existing = db.queryOne('SELECT id FROM users WHERE email = ?', ['alimentos@tradeflow.sv']);
    if (!existing) {
      db.insert(
        'INSERT INTO users (name, email, password, company, ior_number, role, password_changed_at) VALUES (?,?,?,?,?,?,datetime(\'now\'))',
        ['Invitado', 'alimentos@tradeflow.sv', hash, 'Consulta rápida FDA', '', 'importer']
      );
      console.log('[SEED] Usuario invitado creado. Acceso invitado usa /api/auth/guest, no contraseña débil.');
    } else {
      db.run(
        'UPDATE users SET name=?, company=?, ior_number=?, role=?, password=?, password_changed_at=datetime(\'now\') WHERE email=?',
        ['Invitado', 'Consulta rápida FDA', '', 'importer', hash, 'alimentos@tradeflow.sv']
      );
    }
  }
}

module.exports = { seed };
