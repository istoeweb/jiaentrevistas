'use strict';
// Teste de aceite do MVP: valida os 10 criterios via API HTTP.
const assert = require('node:assert');
const app = require('../server');
const db = require('../src/db');

const BASE = 'http://localhost:3199';
let server;

async function api(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}

async function login(email, password) {
  const r = await api('POST', '/api/auth/login', null, { email, password });
  assert.equal(r.status, 200, 'login ' + email + ' -> ' + JSON.stringify(r.body));
  return r.body.token;
}

let pass = 0;
function ok(label) { console.log('  OK  - ' + label); pass++; }

async function main() {
  await db.init();
  await new Promise((r) => { server = app.listen(3199, r); });

  const admin = await login('admin@empresa.com', 'admin123');
  const rh = await login('rh@empresa.com', 'rh123');
  const igor = await login('igor@empresa.com', 'entrev123');
  const bea = await login('bea@empresa.com', 'entrev123');
  const gestor = await login('gestor@empresa.com', 'gestor123');
  const auditor = await login('auditor@empresa.com', 'auditor123');

  // IDs de usuarios entrevistadores.
  const users = (await api('GET', '/api/users', admin)).body;
  const igorId = users.find((u) => u.email === 'igor@empresa.com').id;
  const beaId = users.find((u) => u.email === 'bea@empresa.com').id;

  const comps = (await api('GET', '/api/competencies', rh)).body;
  const chosen = comps.slice(0, 4); // 4 competencias

  // --- Criterio 1: RH cria vaga com competencias somando 100% ---
  const jobRes = await api('POST', '/api/jobs', rh, {
    title: 'Engenheiro de Software', area: 'Tecnologia', description: 'Backend',
    min_score: 50, eliminatory_criteria: 'Sem experiencia comprovada em backend',
  });
  assert.equal(jobRes.status, 201, JSON.stringify(jobRes.body));
  const jobId = jobRes.body.id;

  // Rejeita soma != 100.
  const bad = await api('PUT', `/api/jobs/${jobId}/competencies`, rh, {
    competencies: chosen.map((c, i) => ({ competency_id: c.id, weight: i === 0 ? 10 : 20 })),
  });
  assert.equal(bad.status, 400, 'deveria rejeitar soma != 100');

  const weights = [25, 25, 25, 25];
  const setComp = await api('PUT', `/api/jobs/${jobId}/competencies`, rh, {
    competencies: chosen.map((c, i) => ({ competency_id: c.id, weight: weights[i] })),
  });
  assert.equal(setComp.status, 200, JSON.stringify(setComp.body));
  assert.equal(setComp.body.weights_total, 100);
  ok('Criterio 1: vaga com competencias somando 100%');

  // --- Criterio 2: roteiro versionado; todos candidatos recebem o mesmo ---
  const scriptRes = await api('POST', '/api/scripts', rh, { job_id: jobId, instructions: 'Siga a ordem' });
  const scriptId = scriptRes.body.id;
  assert.equal(scriptRes.body.version, 1);

  const qByComp = {};
  for (const c of chosen) {
    qByComp[c.id] = (await api('GET', `/api/questions?competency_id=${c.id}`, rh)).body;
  }
  const scriptQuestions = chosen.map((c, i) => ({
    question_id: qByComp[c.id][0].id, competency_id: c.id, order_index: i, suggested_minutes: 10,
  }));
  await api('PUT', `/api/scripts/${scriptId}/questions`, rh, { questions: scriptQuestions });
  const freeze = await api('POST', `/api/scripts/${scriptId}/freeze`, rh, {});
  assert.equal(freeze.status, 200, 'freeze -> ' + JSON.stringify(freeze.body));
  assert.equal(freeze.body.status, 'congelado');
  ok('Criterio 2: roteiro versionado e congelado');

  // Dois candidatos usam o mesmo roteiro congelado.
  const c1 = (await api('POST', '/api/candidates', rh, { name: 'Candidato A', job_id: jobId })).body.id;
  const c2 = (await api('POST', '/api/candidates', rh, { name: 'Candidato B', job_id: jobId })).body.id;
  const iv1 = (await api('POST', `/api/candidates/${c1}/interviews`, rh, { interviewers: [igorId, beaId] })).body;
  const iv2 = (await api('POST', `/api/candidates/${c2}/interviews`, rh, { interviewers: [igorId] })).body;
  assert.equal(iv1.script_id, iv2.script_id, 'mesmo roteiro para todos');
  assert.equal(iv1.script_id, scriptId);
  ok('Criterio 2b: todos candidatos recebem o mesmo roteiro');

  // Pesos travados apos congelar.
  const lockedWeights = await api('PUT', `/api/jobs/${jobId}/competencies`, rh, {
    competencies: chosen.map((c) => ({ competency_id: c.id, weight: 25 })),
  });
  assert.equal(lockedWeights.status, 409, 'pesos devem estar travados');

  // --- Criterio 3: entrevistador registra evidencias, notas e justificativas ---
  const mineIgor = await api('GET', `/api/evaluations/interviews/${iv1.id}/mine`, igor);
  assert.equal(mineIgor.status, 200);
  const evIgor = mineIgor.body.evaluation.id;
  const igorAnswers = mineIgor.body.questions.map((q, i) => ({
    script_question_id: q.script_question_id,
    answer_summary: 'Resumo ' + i,
    evidence: 'Evidencia observada ' + i,
    score: 4,
    justification: 'Demonstrou com exemplo concreto',
  }));
  const saveIgor = await api('PUT', `/api/evaluations/${evIgor}/answers`, igor, { answers: igorAnswers });
  assert.equal(saveIgor.status, 200);
  ok('Criterio 3: evidencias, notas e justificativas registradas');

  // --- Criterio 9: nota baixa difere de ausencia de evidencia (N/A) ---
  // Bea: uma competencia com N/A, restante nota 2.
  const mineBea = await api('GET', `/api/evaluations/interviews/${iv1.id}/mine`, bea);
  const evBea = mineBea.body.evaluation.id;
  const beaAnswers = mineBea.body.questions.map((q, i) => (
    i === 0
      ? { script_question_id: q.script_question_id, not_assessable: true, answer_summary: 'Nao abordado' }
      : { script_question_id: q.script_question_id, score: 2, evidence: 'Evidencia fraca', justification: 'Exemplo pouco claro' }
  ));
  await api('PUT', `/api/evaluations/${evBea}/answers`, bea, { answers: beaAnswers });

  // --- Criterio 4: avaliacoes independentes ate envio ---
  // Igor nao ve a avaliacao da Bea; endpoint 'mine' retorna apenas a propria.
  const igorViewAgain = await api('GET', `/api/evaluations/interviews/${iv1.id}/mine`, igor);
  assert.equal(igorViewAgain.body.evaluation.id, evIgor, 'igor so ve a propria avaliacao');
  // Relatorio de evidencias antes do envio nao mostra nada (nenhuma enviada).
  const preEvidence = await api('GET', `/api/reports/candidates/${c1}/evidence`, rh);
  assert.equal(preEvidence.body.length, 0, 'nada visivel antes do envio');
  ok('Criterio 4: avaliacoes independentes ate o envio');

  // Justificativa obrigatoria: tentar enviar sem justificativa falha.
  const evTmp = (await api('GET', `/api/evaluations/interviews/${iv2.id}/mine`, igor)).body;
  const noJust = evTmp.questions.map((q) => ({ script_question_id: q.script_question_id, score: 3 }));
  await api('PUT', `/api/evaluations/${evTmp.evaluation.id}/answers`, igor, { answers: noJust });
  const subFail = await api('POST', `/api/evaluations/${evTmp.evaluation.id}/submit`, igor, {});
  assert.equal(subFail.status, 400, 'envio sem justificativa deve falhar');

  // Envia as duas avaliacoes do candidato 1.
  assert.equal((await api('POST', `/api/evaluations/${evIgor}/submit`, igor, {})).status, 200);
  assert.equal((await api('POST', `/api/evaluations/${evBea}/submit`, bea, {})).status, 200);

  // Avaliacao enviada bloqueada.
  const editLocked = await api('PUT', `/api/evaluations/${evIgor}/answers`, igor, { answers: igorAnswers });
  assert.equal(editLocked.status, 409, 'avaliacao enviada deve estar bloqueada');

  // --- Criterio 5: calculo de medias e pontuacao ponderada ---
  const result = (await api('GET', `/api/reports/candidates/${c1}`, rh)).body;
  // Competencia 0: apenas Igor nota 4 (Bea marcou N/A) -> media 4.
  const comp0 = result.competencies.find((k) => k.competency_id === chosen[0].id);
  assert.equal(comp0.average, 4, 'media comp0 = 4 (N/A ignorado)');
  assert.equal(comp0.na_count, 1, 'N/A contabilizado separadamente');
  // Competencia 1: Igor 4, Bea 2 -> media 3.
  const comp1 = result.competencies.find((k) => k.competency_id === chosen[1].id);
  assert.equal(comp1.average, 3, 'media comp1 = 3');
  // Ponderado comp1 = (3/5)*25 = 15.
  assert.equal(comp1.weighted_result, 15, 'ponderado comp1 = 15');
  assert.equal(result.complete, true, 'todas obrigatorias avaliadas');
  // Final = (4/5*25)+(3/5*25)+(3/5*25)+(3/5*25) = 20+15+15+15 = 65
  assert.equal(result.final_score, 65, 'pontuacao final = 65');
  ok('Criterio 5: medias e pontuacao ponderada corretas');

  // --- Criterio 9 (cont): N/A nao virou zero ---
  assert.notEqual(comp0.average, 0, 'N/A nao vira zero');
  assert.equal(comp0.assessed, true);
  ok('Criterio 9: nota baixa difere de ausencia de evidencia');

  // --- Criterio 6: gestor visualiza resultados por candidato e competencia ---
  const gestorView = await api('GET', `/api/reports/candidates/${c1}`, gestor);
  assert.equal(gestorView.status, 200);
  assert.ok(gestorView.body.competencies.length === 4);
  const comparison = await api('GET', `/api/reports/jobs/${jobId}/comparison`, gestor);
  assert.equal(comparison.status, 200);
  assert.equal(comparison.body.results.length, 2);
  ok('Criterio 6: gestor visualiza resultados por candidato e competencia');

  // --- Criterio 7: alteracao em avaliacao concluida gera auditoria ---
  const amend = await api('POST', `/api/evaluations/${evIgor}/amend`, igor, {
    script_question_id: mineIgor.body.questions[1].script_question_id,
    score: 5, justification: 'Revisao apos rever anotacoes', reason: 'Correcao de nota',
  });
  assert.equal(amend.status, 200, JSON.stringify(amend.body));
  const auditLog = await api('GET', `/api/audit?entity=evaluation_answer`, auditor);
  assert.ok(auditLog.body.some((a) => a.action === 'amend' && a.reason === 'Correcao de nota'), 'auditoria da emenda');
  ok('Criterio 7: alteracoes concluidas geram auditoria');

  // --- Criterio 8: usuarios sem permissao nao acessam dados restritos ---
  const igorReport = await api('GET', `/api/reports/candidates/${c1}`, igor);
  assert.equal(igorReport.status, 403, 'entrevistador nao acessa relatorios consolidados');
  const auditorDecision = await api('POST', `/api/decisions/candidates/${c1}`, auditor, { outcome: 'aprovado', justification: 'x' });
  assert.equal(auditorDecision.status, 403, 'auditor nao registra decisao');
  ok('Criterio 8: controle de acesso por perfil');

  // --- Criterio 10: exportacao para analise ---
  const csv = await fetch(`${BASE}/api/reports/jobs/${jobId}/export.csv`, { headers: { Authorization: 'Bearer ' + rh } });
  assert.equal(csv.status, 200);
  const csvText = await csv.text();
  assert.ok(csvText.includes('Candidato'), 'CSV com cabecalho');
  assert.ok(csvText.includes('Pontuacao Final'));
  ok('Criterio 10: exportacao (CSV) disponivel');

  // Decisao final com justificativa (responsavel + data no registro).
  const beforeDecision = (await api('GET', `/api/reports/candidates/${c1}`, rh)).body;
  const decision = await api('POST', `/api/decisions/candidates/${c1}`, gestor, {
    outcome: 'aprovado', justification: 'Melhor pontuacao e evidencias solidas',
  });
  assert.equal(decision.status, 201, JSON.stringify(decision.body));
  // Notas originais permanecem inalteradas apos a decisao.
  const afterDecision = (await api('GET', `/api/reports/candidates/${c1}`, rh)).body;
  assert.equal(afterDecision.final_score, beforeDecision.final_score, 'decisao nao altera notas');
  ok('Decisao final registrada sem alterar notas');

  console.log(`\nTODOS OS TESTES PASSARAM (${pass} verificacoes).`);
  server.close();
  await db.pool.end();
}

main().catch(async (e) => {
  console.error('\nFALHA NO TESTE:', e.message);
  if (server) server.close();
  try { await db.pool.end(); } catch {}
  process.exit(1);
});
