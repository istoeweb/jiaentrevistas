'use strict';
const db = require('./db');

// Limite de divergencia entre entrevistadores (em pontos da escala 1..5).
const DIVERGENCE_THRESHOLD = 2;

// Calcula o resultado consolidado de um candidato.
// Regras:
//  - nota da competencia = media das avaliacoes recebidas (ignora N/A e sem nota);
//  - resultado da competencia = (media / 5) * peso;
//  - pontuacao final = soma dos resultados;
//  - N/A e ausencia de nota NUNCA viram zero;
//  - so ha pontuacao final quando todas as competencias obrigatorias tem ao menos uma nota;
//  - arredondamento apenas na exibicao (aqui retornamos valores crus).
async function computeCandidateResult(candidateId) {
  const candidate = await db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId);
  if (!candidate) return null;
  const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').get(candidate.job_id);

  const jobComps = await db.prepare(
    `SELECT jc.competency_id, jc.weight, jc.mandatory, c.name
     FROM job_competencies jc JOIN competencies c ON c.id = jc.competency_id
     WHERE jc.job_id = ? ORDER BY c.name`
  ).all(candidate.job_id);

  // Todas as respostas enviadas (evaluations status 'enviada') das entrevistas do candidato.
  const rows = await db.prepare(
    `SELECT ea.score, ea.not_assessable, ea.justification, sq.competency_id, ev.interviewer_id
     FROM evaluation_answers ea
     JOIN evaluations ev ON ev.id = ea.evaluation_id
     JOIN interviews i ON i.id = ev.interview_id
     JOIN script_questions sq ON sq.id = ea.script_question_id
     WHERE i.candidate_id = ? AND ev.status = 'enviada'`
  ).all(candidateId);

  const competencies = jobComps.map((jc) => {
    const compRows = rows.filter((r) => r.competency_id === jc.competency_id);
    const scored = compRows.filter((r) => r.not_assessable === 0 && r.score != null);
    const naCount = compRows.filter((r) => r.not_assessable === 1).length;

    let average = null;
    if (scored.length > 0) {
      average = scored.reduce((s, r) => s + r.score, 0) / scored.length;
    }

    // Media por entrevistador (para divergencia e relatorios).
    const byInterviewer = {};
    for (const r of scored) {
      (byInterviewer[r.interviewer_id] ||= []).push(r.score);
    }
    const interviewerAverages = Object.entries(byInterviewer).map(([uid, arr]) => ({
      interviewer_id: Number(uid),
      average: arr.reduce((a, b) => a + b, 0) / arr.length,
      count: arr.length,
    }));

    let divergence = false;
    if (interviewerAverages.length >= 2) {
      const avgs = interviewerAverages.map((x) => x.average);
      divergence = Math.max(...avgs) - Math.min(...avgs) >= DIVERGENCE_THRESHOLD;
    }

    const assessed = average != null;
    // Resultado ponderado apenas quando avaliada.
    const weightedResult = assessed ? (average / 5) * jc.weight : null;

    return {
      competency_id: jc.competency_id,
      name: jc.name,
      weight: jc.weight,
      mandatory: !!jc.mandatory,
      average,            // null = sem evidencia (NAO e zero)
      assessed,
      na_count: naCount,
      scored_count: scored.length,
      weighted_result: weightedResult,
      interviewer_averages: interviewerAverages,
      divergence,
    };
  });

  const missingMandatory = competencies
    .filter((c) => c.mandatory && !c.assessed)
    .map((c) => c.name);

  const complete = missingMandatory.length === 0 && competencies.length > 0;

  // Pontuacao final soma so as competencias avaliadas; so e "oficial" quando completo.
  const finalScore = competencies
    .filter((c) => c.weighted_result != null)
    .reduce((s, c) => s + c.weighted_result, 0);

  const weightsTotal = jobComps.reduce((s, c) => s + c.weight, 0);

  return {
    candidate: { id: candidate.id, name: candidate.name, status: candidate.status },
    job: { id: job.id, title: job.title, min_score: job.min_score },
    competencies,
    weights_total: weightsTotal,
    missing_mandatory: missingMandatory,
    complete,
    final_score: complete ? finalScore : null,
    provisional_score: finalScore,
    meets_min_score: complete ? finalScore >= (job.min_score || 0) : null,
  };
}

module.exports = { computeCandidateResult, DIVERGENCE_THRESHOLD };
