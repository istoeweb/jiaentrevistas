'use strict';
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../auth');
const { audit } = require('../audit');

const router = express.Router();
router.use(authRequired);

// Uma vaga esta "travada" para pesos/criterios se ja possui roteiro congelado
// ou qualquer avaliacao enviada. Regra: criterios e pesos nao mudam apos a
// primeira avaliacao / inicio das entrevistas.
async function jobLocked(jobId) {
  const frozen = (await db.prepare("SELECT COUNT(*)::int n FROM scripts WHERE job_id = ? AND status = 'congelado'").get(jobId)).n;
  const submitted = (await db.prepare(
    `SELECT COUNT(*)::int n FROM evaluations ev
     JOIN interviews i ON i.id = ev.interview_id
     JOIN candidates c ON c.id = i.candidate_id
     WHERE c.job_id = ? AND ev.status = 'enviada'`
  ).get(jobId)).n;
  return frozen > 0 || submitted > 0;
}

function competenciesOf(jobId) {
  return db.prepare(
    `SELECT jc.id, jc.competency_id, jc.weight, jc.mandatory, c.name
     FROM job_competencies jc JOIN competencies c ON c.id = jc.competency_id
     WHERE jc.job_id = ? ORDER BY c.name`
  ).all(jobId);
}

router.get('/', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM jobs ORDER BY id DESC').all();
  const out = [];
  for (const j of rows) {
    out.push({ ...j, locked: await jobLocked(j.id), competencies: await competenciesOf(j.id) });
  }
  res.json(out);
});

router.get('/:id', async (req, res) => {
  const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(Number(req.params.id));
  if (!job) return res.status(404).json({ error: 'Vaga nao encontrada' });
  const competencies = await competenciesOf(job.id);
  const weightsTotal = competencies.reduce((s, c) => s + c.weight, 0);
  const scripts = await db.prepare('SELECT id, version, status, frozen_at FROM scripts WHERE job_id = ? ORDER BY version').all(job.id);
  res.json({ ...job, locked: await jobLocked(job.id), competencies, weights_total: weightsTotal, scripts });
});

router.post('/', requireRole('admin', 'rh'), async (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'title obrigatorio' });
  const info = await db.prepare(
    `INSERT INTO jobs (title, area, description, responsibilities, required_requirements, desired_requirements, min_score, eliminatory_criteria, owners_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).run(
    b.title, b.area ?? null, b.description ?? null, b.responsibilities ?? null,
    b.required_requirements ?? null, b.desired_requirements ?? null,
    b.min_score ?? 0, b.eliminatory_criteria ?? null,
    b.owners ? JSON.stringify(b.owners) : null, b.status ?? 'rascunho'
  );
  await audit(req.user.id, 'create', 'job', info.lastInsertRowid, null, b, null);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/:id', requireRole('admin', 'rh'), async (req, res) => {
  const id = Number(req.params.id);
  const cur = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'Vaga nao encontrada' });
  const b = req.body || {};
  const locked = await jobLocked(id);
  // Criterios eliminatorios e nota minima nao mudam apos travamento.
  if (locked && (b.eliminatory_criteria !== undefined || b.min_score !== undefined)) {
    return res.status(409).json({ error: 'Vaga travada: criterios/nota minima nao podem mudar apos inicio das avaliacoes' });
  }
  const next = {
    title: b.title ?? cur.title,
    area: b.area ?? cur.area,
    description: b.description ?? cur.description,
    responsibilities: b.responsibilities ?? cur.responsibilities,
    required_requirements: b.required_requirements ?? cur.required_requirements,
    desired_requirements: b.desired_requirements ?? cur.desired_requirements,
    min_score: b.min_score ?? cur.min_score,
    eliminatory_criteria: b.eliminatory_criteria ?? cur.eliminatory_criteria,
    owners_json: b.owners ? JSON.stringify(b.owners) : cur.owners_json,
    status: b.status ?? cur.status,
  };
  await db.prepare(
    `UPDATE jobs SET title=?, area=?, description=?, responsibilities=?, required_requirements=?, desired_requirements=?, min_score=?, eliminatory_criteria=?, owners_json=?, status=? WHERE id=?`
  ).run(next.title, next.area, next.description, next.responsibilities, next.required_requirements, next.desired_requirements, next.min_score, next.eliminatory_criteria, next.owners_json, next.status, id);
  await audit(req.user.id, 'update', 'job', id, cur, next, null);
  res.json({ id });
});

// Define TODAS as competencias da vaga de uma vez (valida 4-6 e soma 100%).
router.put('/:id/competencies', requireRole('admin', 'rh'), async (req, res) => {
  const id = Number(req.params.id);
  const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!job) return res.status(404).json({ error: 'Vaga nao encontrada' });
  if (await jobLocked(id)) {
    return res.status(409).json({ error: 'Vaga travada: pesos/competencias nao podem mudar apos inicio das avaliacoes' });
  }
  const items = Array.isArray(req.body?.competencies) ? req.body.competencies : null;
  if (!items) return res.status(400).json({ error: 'competencies (array) obrigatorio' });
  if (items.length < 4 || items.length > 6) {
    return res.status(400).json({ error: 'A vaga deve ter entre 4 e 6 competencias' });
  }
  for (const it of items) {
    if (!it.competency_id || typeof it.weight !== 'number' || it.weight <= 0) {
      return res.status(400).json({ error: 'Cada competencia precisa de competency_id e weight > 0' });
    }
    const exists = await db.prepare('SELECT id FROM competencies WHERE id = ?').get(it.competency_id);
    if (!exists) return res.status(400).json({ error: 'competency_id inexistente: ' + it.competency_id });
  }
  const total = items.reduce((s, it) => s + it.weight, 0);
  // Tolerancia para ponto flutuante.
  if (Math.abs(total - 100) > 0.01) {
    return res.status(400).json({ error: `A soma dos pesos deve ser 100% (atual: ${total}%)` });
  }
  const old = await competenciesOf(id);
  await db.prepare('DELETE FROM job_competencies WHERE job_id = ?').run(id);
  const ins = db.prepare('INSERT INTO job_competencies (job_id, competency_id, weight, mandatory) VALUES (?, ?, ?, ?)');
  for (const it of items) await ins.run(id, it.competency_id, it.weight, it.mandatory === false ? 0 : 1);
  await audit(req.user.id, 'update', 'job_competencies', id, old, items, null);
  res.json({ ok: true, competencies: await competenciesOf(id), weights_total: total });
});

module.exports = { router, jobLocked };
