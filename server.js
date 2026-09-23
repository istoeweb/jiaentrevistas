'use strict';
const path = require('path');
const express = require('express');
const db = require('./src/db');

const app = express();
app.use(express.json({ limit: '15mb' }));

// Cabecalhos basicos de seguranca (defesa em profundidade).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/users', require('./src/routes/users'));
app.use('/api/competencies', require('./src/routes/competencies'));
app.use('/api/questions', require('./src/routes/questions'));
app.use('/api/jobs', require('./src/routes/jobs').router);
app.use('/api/scripts', require('./src/routes/scripts'));
app.use('/api/candidates', require('./src/routes/candidates'));
app.use('/api/evaluations', require('./src/routes/evaluations'));
app.use('/api/reports', require('./src/routes/reports'));
app.use('/api/decisions', require('./src/routes/decisions'));
app.use('/api/audit', require('./src/routes/audit'));
app.use('/api/import', require('./src/routes/import'));

app.use(express.static(path.join(__dirname, 'public')));

// Handler de erro JSON.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno', detail: err.message });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  db.init()
    .then(() => app.listen(PORT, () => console.log(`Servidor em http://localhost:${PORT}`)))
    .catch((e) => { console.error('Falha ao iniciar (DB):', e.message); process.exit(1); });
}

module.exports = app;
