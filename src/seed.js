'use strict';
// Popula dados iniciais: usuarios de cada perfil, competencias, perguntas e
// escala padrao. Idempotente por email/nome.
const bcrypt = require('bcryptjs');
const db = require('./db');

const STANDARD_SCALE = {
  1: 'Nao apresentou exemplo relevante ou evidencia da competencia',
  2: 'Apresentou evidencia limitada, com acao ou resultado pouco claro',
  3: 'Demonstrou a competencia de maneira adequada',
  4: 'Demonstrou atuacao estruturada e resultado relevante',
  5: 'Demonstrou atuacao excepcional, impacto mensuravel e aprendizado',
};

async function ensureUser(name, email, role, password) {
  const ex = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (ex) return ex.id;
  const hash = bcrypt.hashSync(password, 10);
  return (await db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?) RETURNING id')
    .run(name, email, hash, role)).lastInsertRowid;
}

async function ensureCompetency(name, description) {
  const ex = await db.prepare('SELECT id FROM competencies WHERE name = ?').get(name);
  if (ex) return ex.id;
  return (await db.prepare(
    `INSERT INTO competencies (name, description, expected_behaviors, positive_evidence, negative_evidence, areas, scale_json)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).run(
    name, description,
    'Comportamentos esperados para ' + name,
    'Evidencias positivas de ' + name,
    'Evidencias negativas de ' + name,
    'Geral',
    JSON.stringify(STANDARD_SCALE)
  )).lastInsertRowid;
}

async function ensureQuestion(text, methodology, competencyId) {
  const ex = await db.prepare('SELECT id FROM questions WHERE text = ?').get(text);
  if (ex) return ex.id;
  return (await db.prepare(
    `INSERT INTO questions (text, methodology, competency_id, follow_ups, expected_indicators)
     VALUES (?, ?, ?, ?, ?) RETURNING id`
  ).run(text, methodology, competencyId, 'Pode aprofundar em contexto e resultado', 'Acao concreta e resultado mensuravel')).lastInsertRowid;
}

async function main() {
  await db.init();
  const admin = await ensureUser('Administrador', 'admin@empresa.com', 'admin', 'admin123');
  await ensureUser('Rita RH', 'rh@empresa.com', 'rh', 'rh123');
  await ensureUser('Igor Entrevistador', 'igor@empresa.com', 'entrevistador', 'entrev123');
  await ensureUser('Bea Entrevistadora', 'bea@empresa.com', 'entrevistador', 'entrev123');
  await ensureUser('Gustavo Gestor', 'gestor@empresa.com', 'gestor', 'gestor123');
  await ensureUser('Auro Auditor', 'auditor@empresa.com', 'auditor', 'auditor123');

  const compDefs = [
    ['Comunicacao', 'Clareza e influencia na comunicacao'],
    ['Resolucao de Problemas', 'Analise e solucao estruturada'],
    ['Trabalho em Equipe', 'Colaboracao e cooperacao'],
    ['Lideranca', 'Direcionamento e desenvolvimento de pessoas'],
    ['Orientacao a Resultados', 'Foco em entrega e impacto'],
  ];
  const comps = [];
  for (const [n, d] of compDefs) comps.push({ id: await ensureCompetency(n, d), name: n });

  for (const c of comps) {
    await ensureQuestion(`Conte uma situacao em que voce demonstrou ${c.name.toLowerCase()}.`, 'STAR', c.id);
    await ensureQuestion(`Descreva um desafio recente relacionado a ${c.name.toLowerCase()} e o que voce fez.`, 'CAR', c.id);
  }

  console.log('Seed concluido. Usuarios (senha):');
  console.log('  admin@empresa.com / admin123 (admin)');
  console.log('  rh@empresa.com / rh123 (rh)');
  console.log('  igor@empresa.com / entrev123 (entrevistador)');
  console.log('  bea@empresa.com / entrev123 (entrevistador)');
  console.log('  gestor@empresa.com / gestor123 (gestor)');
  console.log('  auditor@empresa.com / auditor123 (auditor)');
  console.log('Admin id:', admin);
}

main().then(() => db.pool.end()).catch((e) => { console.error(e); process.exit(1); });
