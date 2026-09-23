'use strict';
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../auth');
const { audit } = require('../audit');

const router = express.Router();
router.use(authRequired);

function parse(row) {
  if (!row) return row;
  return { ...row, scale: row.scale_json ? JSON.parse(row.scale_json) : null };
}

router.get('/', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM competencies ORDER BY name').all();
  res.json(rows.map(parse));
});

router.get('/:id', async (req, res) => {
  const row = await db.prepare('SELECT * FROM competencies WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Competencia nao encontrada' });
  const questions = await db.prepare('SELECT id, text, methodology, status FROM questions WHERE competency_id = ?')
    .all(row.id);
  res.json({ ...parse(row), questions });
});

router.post('/', requireRole('admin', 'rh'), async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name obrigatorio' });
  const info = await db.prepare(
    `INSERT INTO competencies (name, description, expected_behaviors, positive_evidence, negative_evidence, areas, scale_json)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).run(
    b.name, b.description ?? null, b.expected_behaviors ?? null,
    b.positive_evidence ?? null, b.negative_evidence ?? null, b.areas ?? null,
    b.scale ? JSON.stringify(b.scale) : null
  );
  await audit(req.user.id, 'create', 'competency', info.lastInsertRowid, null, b, null);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/:id', requireRole('admin', 'rh'), async (req, res) => {
  const id = Number(req.params.id);
  const cur = await db.prepare('SELECT * FROM competencies WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'Competencia nao encontrada' });
  const b = req.body || {};
  const next = {
    name: b.name ?? cur.name,
    description: b.description ?? cur.description,
    expected_behaviors: b.expected_behaviors ?? cur.expected_behaviors,
    positive_evidence: b.positive_evidence ?? cur.positive_evidence,
    negative_evidence: b.negative_evidence ?? cur.negative_evidence,
    areas: b.areas ?? cur.areas,
    scale_json: b.scale ? JSON.stringify(b.scale) : cur.scale_json,
  };
  await db.prepare(
    `UPDATE competencies SET name=?, description=?, expected_behaviors=?, positive_evidence=?, negative_evidence=?, areas=?, scale_json=? WHERE id=?`
  ).run(next.name, next.description, next.expected_behaviors, next.positive_evidence, next.negative_evidence, next.areas, next.scale_json, id);
  await audit(req.user.id, 'update', 'competency', id, cur, next, null);
  res.json({ id });
});

module.exports = router;
