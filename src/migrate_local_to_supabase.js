'use strict';
// Migra TODO o conteudo do Postgres local para o Supabase, preservando IDs e
// timestamps. Substitui o conteudo atual do Supabase (truncate + copia).
require('dotenv').config();
const { Pool } = require('pg');

const local = new Pool({ connectionString: 'postgres://postgres:postgres@localhost:5433/jia', ssl: false });
const supa = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Ordem segura para FKs.
const TABLES = [
  'users', 'competencies', 'questions', 'jobs', 'job_competencies',
  'scripts', 'script_questions', 'candidates', 'interviews',
  'interview_interviewers', 'evaluations', 'evaluation_answers',
  'decisions', 'audit_log',
];

async function main() {
  // 1) Limpa o Supabase (reinicia identidades).
  await supa.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);

  // 2) Copia tabela a tabela, preservando todas as colunas (inclusive id).
  for (const t of TABLES) {
    const rows = (await local.query(`SELECT * FROM ${t} ORDER BY 1`)).rows;
    let count = 0;
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals = cols.map((c) => row[c]);
      const params = cols.map((_, i) => '$' + (i + 1)).join(', ');
      await supa.query(
        `INSERT INTO ${t} (${cols.map((c) => '"' + c + '"').join(', ')}) VALUES (${params})`,
        vals
      );
      count++;
    }
    console.log(`${t.padEnd(24)} ${count} linha(s)`);
  }

  // 3) Reajusta as sequences (serial) para o maior id.
  for (const t of TABLES) {
    if (t === 'interview_interviewers') continue; // PK composta, sem serial
    await supa.query(
      `SELECT setval(pg_get_serial_sequence('${t}', 'id'),
              GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${t}), 1))`
    );
  }

  console.log('\nMigracao concluida.');
  await local.end();
  await supa.end();
}

main().catch(async (e) => { console.error('ERRO:', e.message); try { await local.end(); await supa.end(); } catch {} process.exit(1); });
