'use strict';
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../auth');
const { audit } = require('../audit');
const { parse } = require('../import');

const router = express.Router();
router.use(authRequired);
router.use(requireRole('admin', 'rh'));

const STANDARD_SCALE = {
  1: 'Nao apresentou exemplo relevante ou evidencia da competencia',
  2: 'Apresentou evidencia limitada, com acao ou resultado pouco claro',
  3: 'Demonstrou a competencia de maneira adequada',
  4: 'Demonstrou atuacao estruturada e resultado relevante',
  5: 'Demonstrou atuacao excepcional, impacto mensuravel e aprendizado',
};

function bufferFromBody(req) {
  const b64 = req.body && req.body.data;
  if (!b64 || typeof b64 !== 'string') return null;
  const raw = b64.includes(',') ? b64.split(',').pop() : b64; // aceita data URL
  try { return Buffer.from(raw, 'base64'); } catch { return null; }
}

// Pre-visualiza o conteudo a ser importado (nao grava nada).
router.post('/preview', (req, res) => {
  const buf = bufferFromBody(req);
  if (!buf) return res.status(400).json({ error: 'Envie o arquivo .xlsx no campo "data" (base64)' });
  try {
    res.json(parse(buf));
  } catch (e) {
    res.status(400).json({ error: 'Falha ao ler a planilha: ' + e.message });
  }
});

// Efetiva a importacao: cria vaga, competencias (com pesos) e candidatos.
router.post('/commit', async (req, res) => {
  const buf = bufferFromBody(req);
  if (!buf) return res.status(400).json({ error: 'Arquivo .xlsx ausente' });
  let parsed;
  try { parsed = parse(buf); } catch (e) { return res.status(400).json({ error: 'Falha ao ler planilha: ' + e.message }); }

  // Overrides opcionais vindos da tela de revisao.
  const job = { ...parsed.job, ...(req.body.job || {}) };
  const competencies = Array.isArray(req.body.competencies) ? req.body.competencies : parsed.competencies;
  const candidates = Array.isArray(req.body.candidates) ? req.body.candidates : parsed.candidates;

  // Validacoes de negocio antes de gravar.
  if (competencies.length < 4 || competencies.length > 6) {
    return res.status(400).json({ error: `A vaga precisa de 4 a 6 competencias (recebidas: ${competencies.length})` });
  }
  const total = competencies.reduce((s, c) => s + Number(c.weight || 0), 0);
  if (Math.abs(total - 100) > 0.01) {
    return res.status(400).json({ error: `Os pesos das competencias devem somar 100% (atual: ${total}%)` });
  }

  const description = [job.description, job.soft_skills && job.soft_skills.length
    ? 'Soft skills esperadas:\n' + job.soft_skills.map((s) => '- ' + s).join('\n') : '']
    .filter(Boolean).join('\n\n');

  let result;
  try {
    result = await db.transaction(async (tx) => {
      const jobInfo = await tx.prepare(
        `INSERT INTO jobs (title, area, description, responsibilities, required_requirements, desired_requirements, min_score, eliminatory_criteria, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aberta') RETURNING id`
      ).run(job.title, job.area, description, job.responsibilities, job.required_requirements,
        job.desired_requirements, job.min_score || 0, job.eliminatory_criteria || '');
      const jobId = Number(jobInfo.lastInsertRowid);

      const findComp = tx.prepare('SELECT id FROM competencies WHERE name = ?');
      const insComp = tx.prepare(
        `INSERT INTO competencies (name, description, expected_behaviors, areas, scale_json) VALUES (?, ?, ?, ?, ?) RETURNING id`
      );
      const insQuestion = tx.prepare(
        `INSERT INTO questions (text, methodology, competency_id, expected_indicators) VALUES (?, 'STAR', ?, ?)`
      );
      const linkComp = tx.prepare('INSERT INTO job_competencies (job_id, competency_id, weight, mandatory) VALUES (?, ?, ?, 1)');
      const createdComps = [];
      for (const c of competencies) {
        let compId = (await findComp.get(c.name))?.id;
        if (!compId) {
          compId = Number((await insComp.run(
            c.name,
            `Competencia avaliada em entrevista: ${c.name}.`,
            `Comportamentos esperados relacionados a ${c.name}.`,
            job.area || 'Tecnologia',
            JSON.stringify(STANDARD_SCALE)
          )).lastInsertRowid);
          // Pergunta recomendada (STAR) para viabilizar o roteiro.
          await insQuestion.run(
            `Conte uma situacao real em que voce demonstrou ${c.name.toLowerCase()}. Qual era o contexto, sua acao e o resultado?`,
            compId, 'Acao concreta e resultado mensuravel'
          );
        }
        await linkComp.run(jobId, compId, Number(c.weight));
        createdComps.push({ competency_id: compId, name: c.name, weight: Number(c.weight) });
      }

      const insCand = tx.prepare(
        `INSERT INTO candidates (name, email, phone, city, job_id, stage, status) VALUES (?, ?, ?, ?, ?, 'Triagem', 'pendente')`
      );
      let created = 0;
      for (const c of candidates) {
        if (!c.name) continue;
        await insCand.run(c.name, c.email || null, c.phone || null, c.city || null, jobId);
        created++;
      }

      return { jobId, competencies: createdComps, candidatesCreated: created };
    });
  } catch (e) {
    return res.status(500).json({ error: 'Erro ao importar: ' + e.message });
  }

  await audit(req.user.id, 'import', 'job', result.jobId, null,
    { title: job.title, competencies: result.competencies.length, candidates: result.candidatesCreated }, 'Importacao de planilha');

  res.status(201).json({
    ok: true,
    job_id: result.jobId,
    competencies_created: result.competencies.length,
    candidates_created: result.candidatesCreated,
  });
});

module.exports = router;
