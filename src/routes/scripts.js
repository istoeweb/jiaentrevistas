'use strict';
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../auth');
const { audit } = require('../audit');

const router = express.Router();
router.use(authRequired);

async function scriptWithQuestions(scriptId) {
  const script = await db.prepare('SELECT * FROM scripts WHERE id = ?').get(scriptId);
  if (!script) return null;
  const questions = await db.prepare(
    `SELECT sq.*, q.text AS question_text, q.methodology, c.name AS competency_name
     FROM script_questions sq
     JOIN questions q ON q.id = sq.question_id
     JOIN competencies c ON c.id = sq.competency_id
     WHERE sq.script_id = ? ORDER BY sq.order_index, sq.id`
  ).all(scriptId);
  return { ...script, weights_snapshot: script.weights_snapshot ? JSON.parse(script.weights_snapshot) : null, questions };
}

router.get('/:id', async (req, res) => {
  const s = await scriptWithQuestions(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Roteiro nao encontrado' });
  res.json(s);
});

// Cria um novo roteiro (rascunho) para a vaga, com a proxima versao.
router.post('/', requireRole('admin', 'rh'), async (req, res) => {
  const { job_id, instructions } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id obrigatorio' });
  const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(job_id);
  if (!job) return res.status(404).json({ error: 'Vaga nao encontrada' });
  const last = (await db.prepare('SELECT MAX(version) v FROM scripts WHERE job_id = ?').get(job_id)).v || 0;
  const info = await db.prepare('INSERT INTO scripts (job_id, version, instructions) VALUES (?, ?, ?) RETURNING id')
    .run(job_id, last + 1, instructions ?? null);
  await audit(req.user.id, 'create', 'script', info.lastInsertRowid, null, { job_id, version: last + 1 }, null);
  res.status(201).json({ id: info.lastInsertRowid, version: last + 1 });
});

// Substitui as perguntas do roteiro (somente em rascunho).
router.put('/:id/questions', requireRole('admin', 'rh'), async (req, res) => {
  const id = Number(req.params.id);
  const script = await db.prepare('SELECT * FROM scripts WHERE id = ?').get(id);
  if (!script) return res.status(404).json({ error: 'Roteiro nao encontrado' });
  if (script.status === 'congelado') {
    return res.status(409).json({ error: 'Roteiro congelado: crie uma nova versao para alterar perguntas' });
  }
  const items = Array.isArray(req.body?.questions) ? req.body.questions : null;
  if (!items || items.length === 0) return res.status(400).json({ error: 'questions (array) obrigatorio' });
  for (const it of items) {
    const q = await db.prepare('SELECT * FROM questions WHERE id = ?').get(it.question_id);
    if (!q) return res.status(400).json({ error: 'question_id inexistente: ' + it.question_id });
    if (!it.competency_id) return res.status(400).json({ error: 'competency_id obrigatorio em cada item' });
  }
  await db.prepare('DELETE FROM script_questions WHERE script_id = ?').run(id);
  const ins = db.prepare(
    `INSERT INTO script_questions (script_id, question_id, competency_id, order_index, suggested_minutes, interviewer_instructions, allowed_follow_ups)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  let idx = 0;
  for (const it of items) {
    await ins.run(
      id, it.question_id, it.competency_id, it.order_index ?? idx,
      it.suggested_minutes ?? null, it.interviewer_instructions ?? null, it.allowed_follow_ups ?? null
    );
    idx++;
  }
  await audit(req.user.id, 'update', 'script_questions', id, null, items, null);
  res.json(await scriptWithQuestions(id));
});

// Congela o roteiro: valida competencias (4-6, soma 100%) e cobertura de perguntas,
// tira snapshot dos pesos e coloca a vaga em entrevistas. Versao congelada = imutavel.
router.post('/:id/freeze', requireRole('admin', 'rh'), async (req, res) => {
  const id = Number(req.params.id);
  const script = await db.prepare('SELECT * FROM scripts WHERE id = ?').get(id);
  if (!script) return res.status(404).json({ error: 'Roteiro nao encontrado' });
  if (script.status === 'congelado') return res.status(409).json({ error: 'Roteiro ja congelado' });

  const comps = await db.prepare(
    `SELECT jc.competency_id, jc.weight, jc.mandatory, c.name
     FROM job_competencies jc JOIN competencies c ON c.id = jc.competency_id
     WHERE jc.job_id = ?`
  ).all(script.job_id);
  if (comps.length < 4 || comps.length > 6) {
    return res.status(400).json({ error: 'A vaga deve ter entre 4 e 6 competencias antes de congelar' });
  }
  const total = comps.reduce((s, c) => s + c.weight, 0);
  if (Math.abs(total - 100) > 0.01) {
    return res.status(400).json({ error: `Pesos devem somar 100% (atual: ${total}%)` });
  }
  const sqs = await db.prepare('SELECT DISTINCT competency_id FROM script_questions WHERE script_id = ?').all(id);
  const covered = new Set(sqs.map((r) => r.competency_id));
  const missing = comps.filter((c) => c.mandatory && !covered.has(c.competency_id));
  if (missing.length > 0) {
    return res.status(400).json({ error: 'Competencias obrigatorias sem pergunta no roteiro: ' + missing.map((m) => m.name).join(', ') });
  }

  await db.prepare("UPDATE scripts SET status='congelado', frozen_at=now(), weights_snapshot=? WHERE id=?")
    .run(JSON.stringify(comps), id);
  await db.prepare("UPDATE jobs SET status='em_entrevistas' WHERE id=? AND status IN ('rascunho','aberta')").run(script.job_id);
  await audit(req.user.id, 'freeze', 'script', id, null, { weights_snapshot: comps }, null);
  res.json(await scriptWithQuestions(id));
});

module.exports = router;
