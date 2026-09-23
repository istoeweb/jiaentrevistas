'use strict';
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../auth');
const { audit } = require('../audit');

const router = express.Router();
router.use(authRequired);

async function isAssigned(interviewId, userId) {
  return !!(await db.prepare('SELECT 1 FROM interview_interviewers WHERE interview_id = ? AND user_id = ?')
    .get(interviewId, userId));
}

function answersOf(evaluationId) {
  return db.prepare('SELECT * FROM evaluation_answers WHERE evaluation_id = ?').all(evaluationId);
}

// Abre (ou cria) a MINHA avaliacao para uma entrevista. Cada entrevistador tem
// sua sessao independente; nao ve as notas dos demais aqui.
router.get('/interviews/:interviewId/mine', async (req, res) => {
  const interviewId = Number(req.params.interviewId);
  const interview = await db.prepare('SELECT * FROM interviews WHERE id = ?').get(interviewId);
  if (!interview) return res.status(404).json({ error: 'Entrevista nao encontrada' });
  if (!(await isAssigned(interviewId, req.user.id)) && !['admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Voce nao e entrevistador desta entrevista' });
  }
  let ev = await db.prepare('SELECT * FROM evaluations WHERE interview_id = ? AND interviewer_id = ?')
    .get(interviewId, req.user.id);
  if (!ev) {
    const info = await db.prepare('INSERT INTO evaluations (interview_id, interviewer_id) VALUES (?, ?) RETURNING id')
      .run(interviewId, req.user.id);
    ev = await db.prepare('SELECT * FROM evaluations WHERE id = ?').get(info.lastInsertRowid);
  }
  const questions = await db.prepare(
    `SELECT sq.id AS script_question_id, sq.order_index, sq.suggested_minutes, sq.interviewer_instructions,
            sq.allowed_follow_ups, q.text AS question_text, q.methodology, q.expected_indicators,
            c.name AS competency_name, sq.competency_id
     FROM script_questions sq
     JOIN questions q ON q.id = sq.question_id
     JOIN competencies c ON c.id = sq.competency_id
     WHERE sq.script_id = ? ORDER BY sq.order_index, sq.id`
  ).all(interview.script_id);
  const answers = await answersOf(ev.id);
  const byQ = Object.fromEntries(answers.map((a) => [a.script_question_id, a]));
  res.json({ evaluation: ev, questions: questions.map((q) => ({ ...q, answer: byQ[q.script_question_id] || null })) });
});

// Salva rascunho (autosave). Somente o dono e enquanto 'rascunho'.
router.put('/:id/answers', async (req, res) => {
  const id = Number(req.params.id);
  const ev = await db.prepare('SELECT * FROM evaluations WHERE id = ?').get(id);
  if (!ev) return res.status(404).json({ error: 'Avaliacao nao encontrada' });
  if (ev.interviewer_id !== req.user.id) return res.status(403).json({ error: 'Somente o autor edita esta avaliacao' });
  if (ev.status !== 'rascunho') return res.status(409).json({ error: 'Avaliacao enviada esta bloqueada' });

  const items = Array.isArray(req.body?.answers) ? req.body.answers : null;
  if (!items) return res.status(400).json({ error: 'answers (array) obrigatorio' });
  const validSq = new Set(
    (await db.prepare(
      `SELECT sq.id FROM script_questions sq JOIN interviews i ON i.script_id = sq.script_id WHERE i.id = ?`
    ).all(ev.interview_id)).map((r) => r.id)
  );
  const upsert = db.prepare(
    `INSERT INTO evaluation_answers (evaluation_id, script_question_id, answer_summary, evidence, score, not_assessable, justification, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (evaluation_id, script_question_id) DO UPDATE SET
       answer_summary=excluded.answer_summary, evidence=excluded.evidence, score=excluded.score,
       not_assessable=excluded.not_assessable, justification=excluded.justification, notes=excluded.notes`
  );
  for (const it of items) {
    if (!validSq.has(it.script_question_id)) {
      return res.status(400).json({ error: 'script_question_id invalido: ' + it.script_question_id });
    }
    const na = it.not_assessable ? 1 : 0;
    let score = it.score == null ? null : Number(it.score);
    if (na) score = null; // N/A nunca guarda nota
    if (score != null && (score < 1 || score > 5 || !Number.isInteger(score))) {
      return res.status(400).json({ error: 'score deve ser inteiro de 1 a 5 ou N/A' });
    }
    await upsert.run(
      id,
      it.script_question_id,
      it.answer_summary ?? null,
      it.evidence ?? null,
      score,
      na,
      it.justification ?? null,
      it.notes ?? null
    );
  }
  res.json({ ok: true, answers: await answersOf(id) });
});

// Envia a avaliacao: valida cobertura e justificativas, entao bloqueia.
router.post('/:id/submit', async (req, res) => {
  const id = Number(req.params.id);
  const ev = await db.prepare('SELECT * FROM evaluations WHERE id = ?').get(id);
  if (!ev) return res.status(404).json({ error: 'Avaliacao nao encontrada' });
  if (ev.interviewer_id !== req.user.id) return res.status(403).json({ error: 'Somente o autor envia esta avaliacao' });
  if (ev.status === 'enviada') return res.status(409).json({ error: 'Avaliacao ja enviada' });

  const questions = await db.prepare('SELECT id FROM script_questions WHERE script_id = (SELECT script_id FROM interviews WHERE id = ?)')
    .all(ev.interview_id);
  const answers = await answersOf(id);
  const byQ = Object.fromEntries(answers.map((a) => [a.script_question_id, a]));
  const problems = [];
  for (const q of questions) {
    const a = byQ[q.id];
    if (!a || (a.score == null && a.not_assessable === 0)) {
      problems.push(`Pergunta ${q.id}: informe nota (1-5) ou marque N/A`);
      continue;
    }
    // Toda nota exige justificativa baseada em evidencias.
    if (a.not_assessable === 0 && (!a.justification || !a.justification.trim())) {
      problems.push(`Pergunta ${q.id}: justificativa obrigatoria para a nota`);
    }
  }
  if (problems.length) return res.status(400).json({ error: 'Avaliacao incompleta', problems });

  await db.prepare("UPDATE evaluations SET status='enviada', submitted_at=now() WHERE id=?").run(id);
  await audit(req.user.id, 'submit', 'evaluation', id, null, { interview_id: ev.interview_id }, null);
  res.json({ ok: true, status: 'enviada' });
});

// Emenda apos envio: exige justificativa e fica no historico de auditoria.
// A decisao final nao altera notas originais; isto e uma correcao registrada.
router.post('/:id/amend', async (req, res) => {
  const id = Number(req.params.id);
  const ev = await db.prepare('SELECT * FROM evaluations WHERE id = ?').get(id);
  if (!ev) return res.status(404).json({ error: 'Avaliacao nao encontrada' });
  if (ev.interviewer_id !== req.user.id && !['admin', 'rh'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Sem permissao para emendar' });
  }
  if (ev.status !== 'enviada') return res.status(409).json({ error: 'Apenas avaliacoes enviadas podem ser emendadas' });
  const { script_question_id, reason } = req.body || {};
  if (!script_question_id || !reason || !reason.trim()) {
    return res.status(400).json({ error: 'script_question_id e reason (justificativa) obrigatorios' });
  }
  const before = await db.prepare('SELECT * FROM evaluation_answers WHERE evaluation_id = ? AND script_question_id = ?')
    .get(id, script_question_id);
  if (!before) return res.status(404).json({ error: 'Resposta nao encontrada' });
  const b = req.body;
  const na = b.not_assessable != null ? (b.not_assessable ? 1 : 0) : before.not_assessable;
  let score = b.score !== undefined ? (b.score == null ? null : Number(b.score)) : before.score;
  if (na) score = null;
  if (score != null && (score < 1 || score > 5 || !Number.isInteger(score))) {
    return res.status(400).json({ error: 'score deve ser inteiro de 1 a 5 ou N/A' });
  }
  const next = {
    answer_summary: b.answer_summary ?? before.answer_summary,
    evidence: b.evidence ?? before.evidence,
    score,
    not_assessable: na,
    justification: b.justification ?? before.justification,
    notes: b.notes ?? before.notes,
  };
  if (na === 0 && (!next.justification || !next.justification.trim())) {
    return res.status(400).json({ error: 'justificativa obrigatoria para a nota' });
  }
  await db.prepare(
    `UPDATE evaluation_answers SET answer_summary=?, evidence=?, score=?, not_assessable=?, justification=?, notes=?
     WHERE evaluation_id=? AND script_question_id=?`
  ).run(next.answer_summary, next.evidence, next.score, next.not_assessable, next.justification, next.notes, id, script_question_id);
  await audit(req.user.id, 'amend', 'evaluation_answer', before.id, before, next, reason);
  res.json({ ok: true });
});

module.exports = router;
