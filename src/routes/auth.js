'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, authRequired } = require('../auth');
const { audit } = require('../audit');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Informe email e senha' });
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || user.status !== 'ativo') return res.status(401).json({ error: 'Credenciais invalidas' });
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciais invalidas' });
  }
  await audit(user.id, 'login', 'user', user.id, null, null, null);
  res.json({ token: signToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

router.get('/me', authRequired, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
