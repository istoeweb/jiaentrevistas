'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authRequired, requireRole } = require('../auth');
const { audit } = require('../audit');

const router = express.Router();
router.use(authRequired);

// Admin gerencia usuarios. Demais perfis podem listar entrevistadores para atribuicao.
router.get('/', async (req, res) => {
  const rows = await db.prepare('SELECT id, name, email, role, status, created_at FROM users ORDER BY name').all();
  res.json(rows);
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password e role sao obrigatorios' });
  }
  const valid = ['admin', 'rh', 'entrevistador', 'gestor', 'auditor'];
  if (!valid.includes(role)) return res.status(400).json({ error: 'role invalido' });
  const exists = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'Email ja cadastrado' });
  const hash = bcrypt.hashSync(password, 10);
  const info = await db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?) RETURNING id')
    .run(name, email, hash, role);
  await audit(req.user.id, 'create', 'user', info.lastInsertRowid, null, { name, email, role }, null);
  res.status(201).json({ id: info.lastInsertRowid, name, email, role, status: 'ativo' });
});

router.patch('/:id', requireRole('admin'), async (req, res) => {
  const id = Number(req.params.id);
  const user = await db.prepare('SELECT id, name, email, role, status FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' });
  const { name, role, status, password } = req.body || {};
  const next = {
    name: name ?? user.name,
    role: role ?? user.role,
    status: status ?? user.status,
  };
  await db.prepare('UPDATE users SET name = ?, role = ?, status = ? WHERE id = ?')
    .run(next.name, next.role, next.status, id);
  if (password) {
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), id);
  }
  await audit(req.user.id, 'update', 'user', id, user, next, null);
  res.json({ id, ...next });
});

module.exports = router;
