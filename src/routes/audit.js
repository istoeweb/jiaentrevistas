'use strict';
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../auth');

const router = express.Router();
router.use(authRequired);
// Auditoria e visivel para admin, rh, gestor e auditor.
router.use(requireRole('admin', 'rh', 'gestor', 'auditor'));

router.get('/', async (req, res) => {
  const { entity, entity_id, limit } = req.query;
  let sql = `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id`;
  const where = [];
  const params = [];
  if (entity) { where.push('a.entity = ?'); params.push(entity); }
  if (entity_id) { where.push('a.entity_id = ?'); params.push(Number(entity_id)); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY a.id DESC LIMIT ?';
  params.push(Math.min(Number(limit) || 200, 1000));
  res.json(await db.prepare(sql).all(...params));
});

module.exports = router;
