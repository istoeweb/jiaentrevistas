'use strict';
require('dotenv').config();
const { Pool } = require('pg');

// Conexao Postgres (Supabase ou Postgres local). Configuravel por DATABASE_URL.
const connectionString =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5433/jia';

// SSL: habilitado para hosts remotos (ex.: Supabase); desabilitado em localhost.
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
const ssl = process.env.PGSSL === 'disable' || isLocal ? false : { rejectUnauthorized: false };

const pool = new Pool({ connectionString, ssl });

// Converte placeholders estilo SQLite ('?') para Postgres ('$1', '$2', ...).
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + ++i);
}

// Envolve o resultado do pg em uma API parecida com better-sqlite3, porem async.
function makeStatement(runner, sql) {
  const text = toPg(sql);
  return {
    async get(...params) {
      const r = await runner(text, params);
      return r.rows[0];
    },
    async all(...params) {
      const r = await runner(text, params);
      return r.rows;
    },
    async run(...params) {
      const r = await runner(text, params);
      return {
        rowCount: r.rowCount,
        changes: r.rowCount,
        rows: r.rows,
        // Disponivel quando a query usa "RETURNING id".
        lastInsertRowid: r.rows && r.rows[0] ? r.rows[0].id : undefined,
      };
    },
  };
}

const poolRunner = (text, params) => pool.query(text, params);

const db = {
  prepare(sql) {
    return makeStatement(poolRunner, sql);
  },
  async exec(sql) {
    return pool.query(sql);
  },
  // Executa uma funcao dentro de uma transacao; recebe um objeto com prepare().
  async transaction(fn) {
    const client = await pool.connect();
    const txRunner = (text, params) => client.query(text, params);
    const txDb = { prepare: (sql) => makeStatement(txRunner, sql) };
    try {
      await client.query('BEGIN');
      const result = await fn(txDb);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },
  pool,
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','rh','entrevistador','gestor','auditor')),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS competencies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  expected_behaviors TEXT,
  positive_evidence TEXT,
  negative_evidence TEXT,
  areas TEXT,
  scale_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  methodology TEXT NOT NULL CHECK (methodology IN ('STAR','CAR','SOAR','situacional','incidente_critico','Topgrading')),
  competency_id INTEGER REFERENCES competencies(id),
  follow_ups TEXT,
  expected_indicators TEXT,
  status TEXT NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','inativa')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  area TEXT,
  description TEXT,
  responsibilities TEXT,
  required_requirements TEXT,
  desired_requirements TEXT,
  min_score REAL DEFAULT 0,
  eliminatory_criteria TEXT,
  owners_json TEXT,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','aberta','em_entrevistas','encerrada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_competencies (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  competency_id INTEGER NOT NULL REFERENCES competencies(id),
  weight REAL NOT NULL,
  mandatory INTEGER NOT NULL DEFAULT 1,
  UNIQUE (job_id, competency_id)
);

CREATE TABLE IF NOT EXISTS scripts (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','congelado')),
  instructions TEXT,
  frozen_at TIMESTAMPTZ,
  weights_snapshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, version)
);

CREATE TABLE IF NOT EXISTS script_questions (
  id SERIAL PRIMARY KEY,
  script_id INTEGER NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  competency_id INTEGER NOT NULL REFERENCES competencies(id),
  order_index INTEGER NOT NULL DEFAULT 0,
  suggested_minutes INTEGER,
  interviewer_instructions TEXT,
  allowed_follow_ups TEXT
);

CREATE TABLE IF NOT EXISTS candidates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  professional_info TEXT,
  email TEXT,
  phone TEXT,
  city TEXT,
  first_contact_at TIMESTAMPTZ,
  interview_confirmed_at TIMESTAMPTZ,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  stage TEXT,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_avaliacao','aprovado','reprovado','desistente')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS interviews (
  id SERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  script_id INTEGER NOT NULL REFERENCES scripts(id),
  scheduled_at TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS interview_interviewers (
  interview_id INTEGER NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (interview_id, user_id)
);

CREATE TABLE IF NOT EXISTS evaluations (
  id SERIAL PRIMARY KEY,
  interview_id INTEGER NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  interviewer_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','enviada')),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (interview_id, interviewer_id)
);

CREATE TABLE IF NOT EXISTS evaluation_answers (
  id SERIAL PRIMARY KEY,
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
  script_question_id INTEGER NOT NULL REFERENCES script_questions(id),
  answer_summary TEXT,
  evidence TEXT,
  score INTEGER,
  not_assessable INTEGER NOT NULL DEFAULT 0,
  justification TEXT,
  notes TEXT,
  UNIQUE (evaluation_id, script_question_id)
);

CREATE TABLE IF NOT EXISTS decisions (
  id SERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL CHECK (outcome IN ('aprovado','reprovado','standby')),
  justification TEXT NOT NULL,
  decided_by INTEGER NOT NULL REFERENCES users(id),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

// Cria o schema (idempotente). Deve ser chamado antes de atender requisicoes.
async function init() {
  await pool.query(SCHEMA);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS email TEXT`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phone TEXT`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS city TEXT`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS first_contact_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS interview_confirmed_at TIMESTAMPTZ`);
}

db.init = init;

module.exports = db;
