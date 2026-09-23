'use strict';
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../auth');
const { audit } = require('../audit');
const { computeCandidateResult } = require('../scoring');

const router = express.Router();
router.use(authRequired);

router.get('/candidates/:id', requireRole('admin', 'rh', 'gestor', 'auditor'), async (req, res) => {
  const rows = await db.prepare('SELECT d.*, u.name AS decided_by_name FROM decisions d JOIN users u ON u.id = d.decided_by WHERE d.candidate_id = ? ORDER BY d.decided_at DESC')
    .all(Number(req.params.id));
  res.json(rows);
});

// Registra a decisao final. Exige responsavel, data e justificativa.
// Nao altera notas originais; apenas atualiza a situacao do candidato.
router.post('/candidates/:id', requireRole('admin', 'rh', 'gestor'), async (req, res) => {
  const candidateId = Number(req.params.id);
  const cand = await db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId);
  if (!cand) return res.status(404).json({ error: 'Candidato nao encontrado' });
  const { outcome, justification } = req.body || {};
  if (!['aprovado', 'reprovado', 'standby'].includes(outcome)) {
    return res.status(400).json({ error: 'outcome deve ser aprovado, reprovado ou standby' });
  }
  if (!justification || !justification.trim()) {
    return res.status(400).json({ error: 'justificativa obrigatoria' });
  }
  // Nao calcula/decide enquanto houver competencias obrigatorias sem avaliacao.
  const result = await computeCandidateResult(candidateId);
  if (!result.complete && outcome !== 'standby') {
    return res.status(409).json({
      error: 'Avaliacao incompleta: competencias obrigatorias sem nota',
      missing_mandatory: result.missing_mandatory,
    });
  }
  const info = await db.prepare('INSERT INTO decisions (candidate_id, outcome, justification, decided_by) VALUES (?, ?, ?, ?) RETURNING id')
    .run(candidateId, outcome, justification, req.user.id);
  const newStatus = outcome === 'standby' ? cand.status : outcome;
  await db.prepare('UPDATE candidates SET status = ? WHERE id = ?').run(newStatus, candidateId);
  await audit(req.user.id, 'decision', 'candidate', candidateId, { status: cand.status }, { outcome, justification }, justification);
  res.status(201).json({ id: info.lastInsertRowid, outcome, candidate_status: newStatus });
});

module.exports = router;
