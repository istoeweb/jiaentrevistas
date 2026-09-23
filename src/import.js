'use strict';
const XLSX = require('xlsx');

// Le uma planilha de processo seletivo (layout SENAI-SP / Jornada de IA) e
// extrai vaga, competencias com pesos e candidatos para importacao.
// Funciona a partir de um Buffer do arquivo .xlsx.

function rowsOf(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
// Remove marcadores do tipo "  ✓  " no inicio das linhas de requisito.
const stripBullet = (v) => clean(v).replace(/^[✓•\-\u2022\s]+/, '').trim();

// Coleta itens de uma secao do Painel entre um cabecalho e a proxima secao vazia.
function collectSection(rows, startIdx) {
  const out = [];
  for (let i = startIdx + 1; i < rows.length; i++) {
    const cell = clean(rows[i][0]);
    if (!cell) break;
    // Nova secao (titulo em MAIUSCULAS sem marcador) encerra a coleta.
    if (/^[A-ZÀ-Ü].*—/.test(cell) && !/[✓]/.test(String(rows[i][0]))) break;
    out.push(stripBullet(rows[i][0]));
  }
  return out;
}

function findRow(rows, predicate) {
  for (let i = 0; i < rows.length; i++) if (predicate(clean(rows[i][0]), rows[i], i)) return i;
  return -1;
}

function parseJob(wb) {
  const painel = rowsOf(wb, 'Painel');
  const header = clean(painel[0] && painel[0][0]);
  // Titulo da vaga a partir do cabecalho "... | TÉCNICO EM PROGRAMAÇÃO | ...".
  let title = 'Vaga importada';
  const m = header.match(/\|\s*([^|]+?)\s*\|/);
  if (m) title = capitalizeWords(m[1]);
  const subtitle = clean(painel[1] && painel[1][0]);

  const idxObrig = findRow(painel, (c) => /OBRIGAT[ÓO]RIOS/i.test(c));
  const idxDif = findRow(painel, (c) => /DIFERENCIAIS/i.test(c));
  const idxSoft = findRow(painel, (c) => /SOFT SKILLS/i.test(c));
  const idxAtiv = findRow(painel, (c) => /ATIVIDADES/i.test(c));

  const obrigatorios = idxObrig >= 0 ? collectSection(painel, idxObrig) : [];
  const diferenciais = idxDif >= 0 ? collectSection(painel, idxDif) : [];
  const softskills = idxSoft >= 0 ? collectSection(painel, idxSoft) : [];
  const atividades = idxAtiv >= 0 ? collectSection(painel, idxAtiv) : [];

  // Nota de corte da entrevista (ex.: "Nota de corte: 9,0 /15") -> normaliza p/ 0-100.
  let minScore = 60;
  const entrev = rowsOf(wb, 'Avaliação Entrevista');
  const cutText = entrev.map((r) => clean(r.join(' '))).find((t) => /nota de corte/i.test(t)) || '';
  const cm = cutText.match(/nota de corte:?\s*([\d.,]+)\s*\/\s*([\d.,]+)/i);
  if (cm) {
    const val = parseFloat(cm[1].replace(',', '.'));
    const max = parseFloat(cm[2].replace(',', '.'));
    if (val && max) minScore = Math.round((val / max) * 100);
  }

  return {
    title,
    area: extractArea(subtitle) || 'Tecnologia',
    description: [header, subtitle].filter(Boolean).join('\n'),
    responsibilities: atividades.join('\n'),
    required_requirements: obrigatorios.join('\n'),
    desired_requirements: diferenciais.join('\n'),
    eliminatory_criteria: obrigatorios.length
      ? 'Requisitos obrigatorios nao atendidos: ' + obrigatorios.join('; ')
      : '',
    soft_skills: softskills,
    min_score: minScore,
  };
}

function extractArea(subtitle) {
  const parts = subtitle.split('|').map(clean);
  const loc = parts.find((p) => /Tecnol[óo]gico|S[ãa]o|Distrito/i.test(p));
  return loc || '';
}

function capitalizeWords(s) {
  return clean(s).toLowerCase().replace(/(^|\s)\p{L}/gu, (m) => m.toUpperCase());
}

// Competencias a partir dos criterios da aba "Avaliação Entrevista" (0-3 cada).
// Pesos padrao diferenciados por prioridade (editaveis antes de congelar).
const DEFAULT_WEIGHTS = {
  'Python e Lógica': 30,
  'Perfil Executor e Soft Skills': 25,
  'APIs REST e JSON': 20,
  'Git e Documentação': 15,
  'IA Generativa': 10,
};

function parseCompetencies(wb) {
  const entrev = rowsOf(wb, 'Avaliação Entrevista');
  // Linha de cabecalho com "Candidato" + criterios.
  const headerIdx = findRow(entrev, (c, row) => /Candidato/i.test(c) && row.some((x) => /\(0-3\)/.test(String(x))));
  const comps = [];
  if (headerIdx >= 0) {
    const header = entrev[headerIdx];
    header.forEach((cell) => {
      const label = clean(cell);
      if (/\(0-3\)/.test(String(cell))) {
        const name = label.replace(/\(0-3\)/, '').trim();
        comps.push(name);
      }
    });
  }
  // Distribui pesos garantindo soma 100%.
  let items = comps.map((name) => ({ name, weight: DEFAULT_WEIGHTS[name] ?? null }));
  const known = items.filter((i) => i.weight != null);
  if (known.length !== items.length || items.length === 0) {
    // Fallback: pesos iguais.
    const w = items.length ? Math.floor(100 / items.length) : 0;
    items = items.map((i, idx) => ({ name: i.name, weight: idx === items.length - 1 ? 100 - w * (items.length - 1) : w }));
  } else {
    const total = known.reduce((s, i) => s + i.weight, 0);
    if (total !== 100 && items.length) {
      items[0].weight += 100 - total; // ajusta diferenca na primeira
    }
  }
  return items;
}

// Candidatos a partir da aba "Pipeline" (ou "Painel" como fallback).
function parseCandidates(wb) {
  const pipeline = rowsOf(wb, 'Pipeline');
  const headerIdx = findRow(pipeline, (c, row) => /^N[ºo°]?$/i.test(c) && row.some((x) => /Nome/i.test(String(x))));
  const out = [];
  if (headerIdx >= 0) {
    const header = pipeline[headerIdx].map((h) => clean(h).toLowerCase());
    const col = (re) => header.findIndex((h) => re.test(h));
    const cNome = col(/nome/);
    const cCidade = col(/cidade/);
    const cTel = col(/telefone/);
    const cMail = col(/mail/);
    for (let i = headerIdx + 1; i < pipeline.length; i++) {
      const row = pipeline[i];
      const name = clean(row[cNome]);
      if (!name) continue;
      // Para de ler ao encontrar linha de legenda/rodape.
      if (/STATUS ENTREVISTA|op[çc][õo]es/i.test(name)) break;
      out.push({
        name,
        city: cCidade >= 0 ? clean(row[cCidade]) : '',
        phone: cTel >= 0 ? clean(row[cTel]) : '',
        email: cMail >= 0 ? clean(row[cMail]) : '',
      });
    }
  }
  return out;
}

function parse(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const job = parseJob(wb);
  const competencies = parseCompetencies(wb);
  const candidates = parseCandidates(wb);
  const warnings = [];
  if (competencies.length < 4 || competencies.length > 6) {
    warnings.push(`Foram detectadas ${competencies.length} competencias; a vaga exige entre 4 e 6.`);
  }
  const total = competencies.reduce((s, c) => s + c.weight, 0);
  if (Math.abs(total - 100) > 0.01) warnings.push(`Pesos somam ${total}% (ajuste para 100%).`);
  if (!candidates.length) warnings.push('Nenhum candidato encontrado na aba Pipeline.');
  return { job, competencies, candidates, warnings, sheets: wb.SheetNames };
}

module.exports = { parse };
