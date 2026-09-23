'use strict';
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_TTL = '8h';

function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

async function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Nao autenticado' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await db.prepare('SELECT id, name, email, role, status FROM users WHERE id = ?').get(payload.id);
    if (!user || user.status !== 'ativo') return res.status(401).json({ error: 'Usuario invalido ou inativo' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalido ou expirado' });
  }
}

// Restringe a rota a determinados perfis.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Nao autenticado' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Acesso negado para o perfil ' + req.user.role });
    }
    next();
  };
}

module.exports = { signToken, authRequired, requireRole, JWT_SECRET };
