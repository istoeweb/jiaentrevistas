'use strict';
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../auth');
const { audit } = require('../audit');

const router = express.Router();
router.use(authRequired);

const METHODS = ['STAR', 'CAR', 'SOAR', 'situacional', 'incidente_critico', 'Topgrading'];

router.get('/', async (req, res) => {
  const { competency_id, status } = req.query;
  let sql = 'SELECT * FROM questions';
  const where = [];
  const params = [];
  if (competency_id) { where.push('competency_id = ?'); params.push(Number(competency_id)); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY id DESC';
  res.json(await db.prepare(sql).all(...params));
});

router.post('/', requireRole('admin', 'rh'), async (req, res) => {
  const b = req.body || {};
  if (!b.text || !b.methodology) return res.status(400).json({ error: 'text e methodology obrigatorios' });
  if (!METHODS.includes(b.methodology)) return res.status(400).json({ error: 'methodology invalida' });
  const info = await db.prepare(
    `INSERT INTO questions (text, methodology, competency_id, follow_ups, expected_indicators, status)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
  ).run(
    b.text, b.methodology, b.competency_id ?? null,
    b.follow_ups ?? null, b.expected_indicators ?? null, b.status ?? 'ativa'
  );
  await audit(req.user.id, 'create', 'question', info.lastInsertRowid, null, b, null);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/:id', requireRole('admin', 'rh'), async (req, res) => {
  const id = Number(req.params.id);
  const cur = await db.prepare('SELECT * FROM questions WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'Pergunta nao encontrada' });
  const b = req.body || {};
  if (b.methodology && !METHODS.includes(b.methodology)) return res.status(400).json({ error: 'methodology invalida' });
  const next = {
    text: b.text ?? cur.text,
    methodology: b.methodology ?? cur.methodology,
    competency_id: b.competency_id ?? cur.competency_id,
    follow_ups: b.follow_ups ?? cur.follow_ups,
    expected_indicators: b.expected_indicators ?? cur.expected_indicators,
    status: b.status ?? cur.status,
  };
  await db.prepare(
    `UPDATE questions SET text=?, methodology=?, competency_id=?, follow_ups=?, expected_indicators=?, status=? WHERE id=?`
  ).run(next.text, next.methodology, next.competency_id, next.follow_ups, next.expected_indicators, next.status, id);
  await audit(req.user.id, 'update', 'question', id, cur, next, null);
  res.json({ id });
});

module.exports = router;
