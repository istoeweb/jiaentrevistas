'use strict';
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../auth');
const { computeCandidateResult } = require('../scoring');

const router = express.Router();
router.use(authRequired);
// Relatorios/consolidacao: RH, gestor, admin e auditor (somente leitura).
router.use(requireRole('admin', 'rh', 'gestor', 'auditor'));

const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

// Resultado consolidado de um candidato (arredondado na exibicao).
router.get('/candidates/:id', async (req, res) => {
  const result = await computeCandidateResult(Number(req.params.id));
  if (!result) return res.status(404).json({ error: 'Candidato nao encontrado' });
  result.final_score = round2(result.final_score);
  result.provisional_score = round2(result.provisional_score);
  result.competencies = result.competencies.map((c) => ({
    ...c,
    average: round2(c.average),
    weighted_result: round2(c.weighted_result),
    interviewer_averages: c.interviewer_averages.map((i) => ({ ...i, average: round2(i.average) })),
  }));
  return res.json(result);
});

// Justificativas e evidencias de um candidato (por competencia/pergunta/entrevistador).
router.get('/candidates/:id/evidence', async (req, res) => {
  const rows = await db.prepare(
    `SELECT u.name AS interviewer, c.name AS competency, q.text AS question,
            ea.score, ea.not_assessable, ea.justification, ea.evidence, ea.answer_summary
     FROM evaluation_answers ea
     JOIN evaluations ev ON ev.id = ea.evaluation_id
     JOIN interviews i ON i.id = ev.interview_id
     JOIN users u ON u.id = ev.interviewer_id
     JOIN script_questions sq ON sq.id = ea.script_question_id
     JOIN questions q ON q.id = sq.question_id
     JOIN competencies c ON c.id = sq.competency_id
     WHERE i.candidate_id = ? AND ev.status = 'enviada'
     ORDER BY c.name, q.id, u.name`
  ).all(Number(req.params.id));
  res.json(rows);
});

// Comparacao entre todos os candidatos de uma vaga.
router.get('/jobs/:id/comparison', async (req, res) => {
  const jobId = Number(req.params.id);
  const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return res.status(404).json({ error: 'Vaga nao encontrada' });
  const candidates = await db.prepare('SELECT id FROM candidates WHERE job_id = ?').all(jobId);
  const results = [];
  for (const c of candidates) {
    const r = await computeCandidateResult(c.id);
    results.push({
      candidate: r.candidate,
      complete: r.complete,
      final_score: round2(r.final_score),
      provisional_score: round2(r.provisional_score),
      meets_min_score: r.meets_min_score,
      missing_mandatory: r.missing_mandatory,
      competencies: r.competencies.map((k) => ({ name: k.name, weight: k.weight, average: round2(k.average), assessed: k.assessed, divergence: k.divergence })),
    });
  }
  results.sort((a, b) => (b.provisional_score || 0) - (a.provisional_score || 0));
  res.json({ job: { id: job.id, title: job.title, min_score: job.min_score }, results });
});

// Exportacao em planilha (CSV) da comparacao da vaga.
router.get('/jobs/:id/export.csv', async (req, res) => {
  const jobId = Number(req.params.id);
  const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return res.status(404).json({ error: 'Vaga nao encontrada' });
  const candidates = await db.prepare('SELECT id FROM candidates WHERE job_id = ?').all(jobId);
  const comps = (await db.prepare(
    `SELECT c.name FROM job_competencies jc JOIN competencies c ON c.id = jc.competency_id WHERE jc.job_id = ? ORDER BY c.name`
  ).all(jobId)).map((r) => r.name);
  const header = ['Candidato', 'Status', 'Completo', ...comps.map((n) => 'Media ' + n), 'Pontuacao Final', 'Atende Nota Minima'];
  const lines = [header.join(';')];
  for (const c of candidates) {
    const r = await computeCandidateResult(c.id);
    const byName = Object.fromEntries(r.competencies.map((k) => [k.name, k]));
    const row = [
      escapeCsv(r.candidate.name),
      r.candidate.status,
      r.complete ? 'Sim' : 'Nao',
      ...comps.map((n) => {
        const k = byName[n];
        if (!k || !k.assessed) return 'N/A';
        return String(round2(k.average)).replace('.', ',');
      }),
      r.final_score == null ? '' : String(round2(r.final_score)).replace('.', ','),
      r.meets_min_score == null ? '' : (r.meets_min_score ? 'Sim' : 'Nao'),
    ];
    lines.push(row.join(';'));
  }
  const csv = '\uFEFF' + lines.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="vaga_${jobId}_comparacao.csv"`);
  res.send(csv);
});

function escapeCsv(v) {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

module.exports = router;
