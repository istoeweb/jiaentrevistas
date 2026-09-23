'use strict';
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../auth');
const { audit } = require('../audit');

const router = express.Router();
router.use(authRequired);

router.get('/', async (req, res) => {
  const { job_id } = req.query;
  let sql = 'SELECT * FROM candidates';
  const params = [];
  if (job_id) { sql += ' WHERE job_id = ?'; params.push(Number(job_id)); }
  sql += ' ORDER BY id DESC';
  res.json(await db.prepare(sql).all(...params));
});

router.get('/:id', async (req, res) => {
  const c = await db.prepare('SELECT * FROM candidates WHERE id = ?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Candidato nao encontrado' });
  const interviews = await db.prepare(
    `SELECT i.*, s.version AS script_version FROM interviews i
     JOIN scripts s ON s.id = i.script_id WHERE i.candidate_id = ? ORDER BY i.scheduled_at`
  ).all(c.id);
  for (const iv of interviews) {
    iv.interviewers = await db.prepare(
      `SELECT u.id, u.name FROM interview_interviewers ii JOIN users u ON u.id = ii.user_id WHERE ii.interview_id = ?`
    ).all(iv.id);
  }
  res.json({ ...c, interviews });
});

router.post('/', requireRole('admin', 'rh'), async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.job_id) return res.status(400).json({ error: 'name e job_id obrigatorios' });
  const job = await db.prepare('SELECT id FROM jobs WHERE id = ?').get(b.job_id);
  if (!job) return res.status(404).json({ error: 'Vaga nao encontrada' });
  const info = await db.prepare(
    'INSERT INTO candidates (name, professional_info, email, phone, city, job_id, stage, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id'
  ).run(b.name, b.professional_info ?? null, b.email ?? null, b.phone ?? null, b.city ?? null, b.job_id, b.stage ?? null, b.status ?? 'pendente');
  await audit(req.user.id, 'create', 'candidate', info.lastInsertRowid, null, { name: b.name, job_id: b.job_id }, null);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/:id', requireRole('admin', 'rh'), async (req, res) => {
  const id = Number(req.params.id);
  const cur = await db.prepare('SELECT * FROM candidates WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'Candidato nao encontrado' });
  const b = req.body || {};
  const next = {
    name: b.name ?? cur.name,
    professional_info: b.professional_info ?? cur.professional_info,
    email: b.email ?? cur.email,
    phone: b.phone ?? cur.phone,
    city: b.city ?? cur.city,
    stage: b.stage ?? cur.stage,
    status: b.status ?? cur.status,
  };
  await db.prepare('UPDATE candidates SET name=?, professional_info=?, email=?, phone=?, city=?, stage=?, status=? WHERE id=?')
    .run(next.name, next.professional_info, next.email, next.phone, next.city, next.stage, next.status, id);
  await audit(req.user.id, 'update', 'candidate', id, cur, next, null);
  res.json({ id });
});

// Registra a data do primeiro contato (ex.: ao abrir o convite no WhatsApp).
// Mantem o primeiro registro; nao sobrescreve se ja existir, salvo force=true.
router.post('/:id/first-contact', requireRole('admin', 'rh'), async (req, res) => {
  const id = Number(req.params.id);
  const cur = await db.prepare('SELECT * FROM candidates WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'Candidato nao encontrado' });
  if (cur.first_contact_at && !req.body?.force) {
    return res.json({ id, first_contact_at: cur.first_contact_at, already: true });
  }
  const row = await db.prepare('UPDATE candidates SET first_contact_at = now() WHERE id = ? RETURNING first_contact_at').get(id);
  await audit(req.user.id, 'first_contact', 'candidate', id, { first_contact_at: cur.first_contact_at }, { first_contact_at: row.first_contact_at }, 'Convite WhatsApp aberto');
  res.json({ id, first_contact_at: row.first_contact_at, already: false });
});

// Marca/desmarca a confirmacao da entrevista pelo candidato.
router.post('/:id/confirm', requireRole('admin', 'rh'), async (req, res) => {
  const id = Number(req.params.id);
  const cur = await db.prepare('SELECT * FROM candidates WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'Candidato nao encontrado' });
  const confirmed = req.body?.confirmed !== false; // default true
  const row = confirmed
    ? await db.prepare('UPDATE candidates SET interview_confirmed_at = now() WHERE id = ? RETURNING interview_confirmed_at').get(id)
    : await db.prepare('UPDATE candidates SET interview_confirmed_at = NULL WHERE id = ? RETURNING interview_confirmed_at').get(id);
  await audit(req.user.id, confirmed ? 'confirm_interview' : 'unconfirm_interview', 'candidate', id,
    { interview_confirmed_at: cur.interview_confirmed_at }, { interview_confirmed_at: row.interview_confirmed_at }, null);
  res.json({ id, interview_confirmed_at: row.interview_confirmed_at });
});

// Agenda entrevista: exige roteiro congelado. Todos os candidatos da vaga usam
// o mesmo roteiro principal (mesma versao congelada).
router.post('/:id/interviews', requireRole('admin', 'rh'), async (req, res) => {
  const candidateId = Number(req.params.id);
  const cand = await db.prepare('SELECT * FROM candidates WHERE id = ?').get(candidateId);
  if (!cand) return res.status(404).json({ error: 'Candidato nao encontrado' });
  const b = req.body || {};
  let scriptId = b.script_id;
  if (!scriptId) {
    // Usa o roteiro congelado mais recente da vaga.
    const s = await db.prepare(
      "SELECT id FROM scripts WHERE job_id = ? AND status='congelado' ORDER BY version DESC LIMIT 1"
    ).get(cand.job_id);
    if (!s) return res.status(400).json({ error: 'Nenhum roteiro congelado para a vaga' });
    scriptId = s.id;
  }
  const script = await db.prepare('SELECT * FROM scripts WHERE id = ?').get(scriptId);
  if (!script || script.job_id !== cand.job_id) return res.status(400).json({ error: 'Roteiro invalido para a vaga' });
  if (script.status !== 'congelado') return res.status(400).json({ error: 'Roteiro precisa estar congelado' });

  const info = await db.prepare('INSERT INTO interviews (candidate_id, script_id, scheduled_at) VALUES (?, ?, ?) RETURNING id')
    .run(candidateId, scriptId, b.scheduled_at ?? null);
  const interviewers = Array.isArray(b.interviewers) ? b.interviewers : [];
  const ins = db.prepare('INSERT INTO interview_interviewers (interview_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING');
  for (const uid of interviewers) {
    const u = await db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('entrevistador','rh','gestor','admin')").get(uid);
    if (u) await ins.run(info.lastInsertRowid, uid);
  }
  if (cand.status === 'pendente') {
    await db.prepare("UPDATE candidates SET status='em_avaliacao' WHERE id=?").run(candidateId);
  }
  await audit(req.user.id, 'create', 'interview', info.lastInsertRowid, null, { candidateId, scriptId, interviewers }, null);
  res.status(201).json({ id: info.lastInsertRowid, script_id: scriptId });
});

module.exports = router;
