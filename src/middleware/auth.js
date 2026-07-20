const jwt = require('jsonwebtoken');

function jwtSecret() {
  return process.env.JWT_SECRET || 'change-this-local-secret';
}

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, msg: 'Token requerido' });
  }
  try {
    const decoded = jwt.verify(header.slice(7), jwtSecret());
    req.userId = decoded.id;
    req.userRole = decoded.role;
    req.isGuest = !!decoded.guest || decoded.role === 'guest';
    next();
  } catch {
    return res.status(401).json({ ok: false, msg: 'Token inválido' });
  }
}

module.exports = auth;
