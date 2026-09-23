'use strict';

const state = { token: localStorage.getItem('token') || null, user: null };

async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw Object.assign(new Error((data && data.error) || 'Erro'), { data, status: res.status });
  return data;
}

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const round2 = (n) => (n == null ? '—' : (Math.round(n * 100) / 100).toString().replace('.', ','));

const ROLE_LABELS = { admin: 'Administrador', rh: 'RH/Recrutador', entrevistador: 'Entrevistador', gestor: 'Gestor da vaga', auditor: 'Auditor' };
const METHODS = ['STAR', 'CAR', 'SOAR', 'situacional', 'incidente_critico', 'Topgrading'];

// ---- Navegacao por perfil ----
const NAV = [
  { id: 'dashboard', label: 'Início', roles: ['admin', 'rh', 'entrevistador', 'gestor', 'auditor'] },
  { id: 'jobs', label: 'Vagas', roles: ['admin', 'rh', 'gestor', 'auditor'] },
  { id: 'competencies', label: 'Competências', roles: ['admin', 'rh', 'gestor', 'auditor'] },
  { id: 'questions', label: 'Perguntas', roles: ['admin', 'rh', 'gestor', 'auditor'] },
  { id: 'candidates', label: 'Candidatos', roles: ['admin', 'rh', 'gestor', 'auditor'] },
  { id: 'import', label: 'Importar planilha', roles: ['admin', 'rh'] },
  { id: 'myinterviews', label: 'Minhas entrevistas', roles: ['admin', 'rh', 'entrevistador', 'gestor'] },
  { id: 'reports', label: 'Relatórios', roles: ['admin', 'rh', 'gestor', 'auditor'] },
  { id: 'users', label: 'Usuários', roles: ['admin'] },
  { id: 'audit', label: 'Auditoria', roles: ['admin', 'rh', 'gestor', 'auditor'] },
];
const can = (roles) => state.user && roles.includes(state.user.role);
const isRH = () => can(['admin', 'rh']);

// ---- Auth ----
async function doLogin() {
  el('loginError').innerHTML = '';
  try {
    const r = await api('POST', '/auth/login', { email: el('loginEmail').value, password: el('loginPassword').value });
    state.token = r.token; state.user = r.user;
    localStorage.setItem('token', r.token);
    showApp();
  } catch (e) {
    el('loginError').innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}
function logout() {
  state.token = null; state.user = null; localStorage.removeItem('token');
  el('app').classList.add('hidden'); el('login').classList.remove('hidden');
}

async function boot() {
  el('loginBtn').onclick = doLogin;
  el('loginPassword').onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
  el('logoutBtn').onclick = logout;
  window.addEventListener('hashchange', route);
  if (state.token) {
    try { const r = await api('GET', '/auth/me'); state.user = r.user; showApp(); }
    catch { logout(); }
  }
}

function showApp() {
  el('login').classList.add('hidden');
  el('app').classList.remove('hidden');
  el('userInfo').innerHTML = `${esc(state.user.name)}<br><span class="tag">${ROLE_LABELS[state.user.role]}</span>`;
  const nav = el('nav');
  nav.innerHTML = NAV.filter((n) => can(n.roles)).map((n) => `<a data-view="${n.id}">${n.label}</a>`).join('');
  nav.querySelectorAll('a').forEach((a) => a.onclick = () => { location.hash = a.dataset.view; });
  if (!location.hash) location.hash = 'dashboard';
  route();
}

// ---- Router ----
const views = {};
function route() {
  const [view, ...rest] = (location.hash.slice(1) || 'dashboard').split('/');
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  const fn = views[view] || views.dashboard;
  fn(rest).catch((e) => { el('main').innerHTML = `<div class="error">${esc(e.message)}</div>`; });
}
const setMain = (html) => { el('main').innerHTML = html; };
const flash = (msg, kind = 'success') => `<div class="${kind}">${esc(msg)}</div>`;

// ---- Modal ----
function modal(html) {
  el('modalRoot').innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
  el('modalRoot').querySelector('.modal-bg').onclick = (e) => { if (e.target.classList.contains('modal-bg')) closeModal(); };
}
function closeModal() { el('modalRoot').innerHTML = ''; }

// ================= DASHBOARD =================
views.dashboard = async () => {
  let jobs = [];
  try { jobs = await api('GET', '/jobs'); } catch {}
  setMain(`
    <div class="topbar"><div><h2>Bem-vindo, ${esc(state.user.name)}</h2>
    <div class="muted">Perfil: ${ROLE_LABELS[state.user.role]}</div></div></div>
    <div class="grid3">
      ${card('Vagas', jobs.length, 'jobs')}
      ${state.user.role === 'entrevistador' ? card('Minhas entrevistas', '→', 'myinterviews') : ''}
      ${isRH() ? card('Nova vaga', '+', 'jobs') : ''}
    </div>
    <div class="card">
      <h3>Como funciona</h3>
      <ol class="muted">
        <li>RH cadastra a vaga e define 4–6 competências com pesos que somam 100%.</li>
        <li>Monta o roteiro com perguntas e o congela (versão imutável).</li>
        <li>Cadastra candidatos e agenda entrevistas com o mesmo roteiro.</li>
        <li>Cada entrevistador registra evidências, notas (1–5) ou N/A e justificativas.</li>
        <li>O sistema calcula médias e a pontuação ponderada; RH/Gestor consolidam e decidem.</li>
      </ol>
    </div>`);
  el('main').querySelectorAll('[data-go]').forEach((c) => c.onclick = () => location.hash = c.dataset.go);
};
const card = (title, value, go) => `<div class="card" data-go="${go}" style="cursor:pointer">
  <div class="muted">${title}</div><div style="font-size:28px;font-weight:700">${value}</div></div>`;

// ================= COMPETENCIES =================
views.competencies = async () => {
  const comps = await api('GET', '/competencies');
  setMain(`
    <div class="topbar"><h2>Banco de Competências</h2>
      ${isRH() ? '<button id="newComp">Nova competência</button>' : ''}</div>
    <div id="compList">${comps.map((c) => `
      <div class="list-item" data-id="${c.id}">
        <div class="row"><strong>${esc(c.name)}</strong><span class="spacer"></span>
        <span class="chip info">${esc(c.areas || 'Geral')}</span></div>
        <div class="muted">${esc(c.description || '')}</div>
      </div>`).join('') || '<div class="muted">Nenhuma competência.</div>'}</div>`);
  if (isRH()) el('newComp').onclick = () => compForm();
  el('compList').querySelectorAll('.list-item').forEach((it) => it.onclick = () => compView(Number(it.dataset.id)));
};

async function compView(id) {
  const c = await api('GET', '/competencies/' + id);
  const scale = c.scale || {};
  modal(`
    <div class="row"><h3>${esc(c.name)}</h3><span class="spacer"></span>
      ${isRH() ? '<button class="ghost small" id="editComp">Editar</button>' : ''}
      <button class="ghost small" onclick="closeModal()">Fechar</button></div>
    <p>${esc(c.description || '')}</p>
    <label>Comportamentos esperados</label><div>${esc(c.expected_behaviors || '—')}</div>
    <div class="grid2"><div><label>Evidências positivas</label><div>${esc(c.positive_evidence || '—')}</div></div>
    <div><label>Evidências negativas</label><div>${esc(c.negative_evidence || '—')}</div></div></div>
    <label>Escala 1–5</label>
    <table>${[1,2,3,4,5].map((n) => `<tr><td><span class="chip">${n}</span></td><td>${esc(scale[n] || '—')}</td></tr>`).join('')}</table>
    <label>Perguntas recomendadas</label>
    ${(c.questions||[]).map((q)=>`<div class="tag" style="display:block;margin:3px 0">${esc(q.text)} <span class="muted">(${q.methodology})</span></div>`).join('') || '<span class="muted">Nenhuma</span>'}
  `);
  if (isRH()) el('editComp').onclick = () => compForm(c);
}

function compForm(c = null) {
  const s = c && c.scale ? c.scale : {};
  modal(`
    <h3>${c ? 'Editar' : 'Nova'} competência</h3>
    <label>Nome</label><input id="f_name" value="${esc(c?.name || '')}" />
    <label>Descrição</label><textarea id="f_desc">${esc(c?.description || '')}</textarea>
    <label>Comportamentos esperados</label><textarea id="f_beh">${esc(c?.expected_behaviors || '')}</textarea>
    <div class="grid2">
      <div><label>Evidências positivas</label><textarea id="f_pos">${esc(c?.positive_evidence || '')}</textarea></div>
      <div><label>Evidências negativas</label><textarea id="f_neg">${esc(c?.negative_evidence || '')}</textarea></div>
    </div>
    <label>Áreas/cargos</label><input id="f_areas" value="${esc(c?.areas || '')}" />
    <label>Descrições da escala (1 a 5)</label>
    ${[1,2,3,4,5].map((n)=>`<div class="row" style="margin-bottom:4px"><span class="chip">${n}</span>
      <input id="f_s${n}" value="${esc(s[n]||'')}" placeholder="Descrição do nível ${n}" /></div>`).join('')}
    <div id="compErr"></div>
    <div class="row" style="margin-top:12px"><button id="saveComp">Salvar</button>
      <button class="ghost" onclick="closeModal()">Cancelar</button></div>`);
  el('saveComp').onclick = async () => {
    const scale = {}; [1,2,3,4,5].forEach((n)=>{ const v = el('f_s'+n).value.trim(); if (v) scale[n]=v; });
    const body = { name: el('f_name').value, description: el('f_desc').value, expected_behaviors: el('f_beh').value,
      positive_evidence: el('f_pos').value, negative_evidence: el('f_neg').value, areas: el('f_areas').value, scale };
    try {
      if (c) await api('PATCH', '/competencies/' + c.id, body); else await api('POST', '/competencies', body);
      closeModal(); views.competencies();
    } catch (e) { el('compErr').innerHTML = flash(e.message, 'error'); }
  };
}

// ================= QUESTIONS =================
views.questions = async () => {
  const [qs, comps] = await Promise.all([api('GET', '/questions'), api('GET', '/competencies')]);
  const cmap = Object.fromEntries(comps.map((c) => [c.id, c.name]));
  setMain(`
    <div class="topbar"><h2>Banco de Perguntas</h2>
      ${isRH() ? '<button id="newQ">Nova pergunta</button>' : ''}</div>
    <div class="card"><table><thead><tr><th>Pergunta</th><th>Metodologia</th><th>Competência</th><th>Status</th><th></th></tr></thead>
    <tbody>${qs.map((q) => `<tr>
      <td>${esc(q.text)}</td><td><span class="tag">${q.methodology}</span></td>
      <td>${esc(cmap[q.competency_id] || '—')}</td>
      <td><span class="chip ${q.status === 'ativa' ? 'ok' : 'danger'}">${q.status}</span></td>
      <td>${isRH() ? `<button class="ghost small" data-edit="${q.id}">Editar</button>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhuma pergunta.</td></tr>'}</tbody></table></div>`);
  if (isRH()) {
    el('newQ').onclick = () => qForm(null, comps);
    el('main').querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => {
      qForm(qs.find((x) => x.id === Number(b.dataset.edit)), comps);
    });
  }
};

function qForm(q, comps) {
  modal(`
    <h3>${q ? 'Editar' : 'Nova'} pergunta</h3>
    <label>Texto</label><textarea id="q_text">${esc(q?.text || '')}</textarea>
    <label>Metodologia</label><select id="q_meth">${METHODS.map((m)=>`<option ${q?.methodology===m?'selected':''}>${m}</option>`).join('')}</select>
    <label>Competência</label><select id="q_comp"><option value="">—</option>
      ${comps.map((c)=>`<option value="${c.id}" ${q?.competency_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select>
    <label>Perguntas de aprofundamento</label><textarea id="q_follow">${esc(q?.follow_ups || '')}</textarea>
    <label>Indicadores esperados</label><textarea id="q_ind">${esc(q?.expected_indicators || '')}</textarea>
    <label>Status</label><select id="q_status"><option value="ativa" ${q?.status!=='inativa'?'selected':''}>ativa</option><option value="inativa" ${q?.status==='inativa'?'selected':''}>inativa</option></select>
    <div id="qErr"></div>
    <div class="row" style="margin-top:12px"><button id="saveQ">Salvar</button><button class="ghost" onclick="closeModal()">Cancelar</button></div>`);
  el('saveQ').onclick = async () => {
    const body = { text: el('q_text').value, methodology: el('q_meth').value,
      competency_id: el('q_comp').value ? Number(el('q_comp').value) : null,
      follow_ups: el('q_follow').value, expected_indicators: el('q_ind').value, status: el('q_status').value };
    try {
      if (q) await api('PATCH', '/questions/' + q.id, body); else await api('POST', '/questions', body);
      closeModal(); views.questions();
    } catch (e) { el('qErr').innerHTML = flash(e.message, 'error'); }
  };
}

// ================= JOBS =================
views.jobs = async (rest) => {
  if (rest[0]) return jobDetail(Number(rest[0]));
  const jobs = await api('GET', '/jobs');
  setMain(`
    <div class="topbar"><h2>Vagas</h2>${isRH() ? '<button id="newJob">Nova vaga</button>' : ''}</div>
    ${jobs.map((j) => `<div class="list-item" data-id="${j.id}">
      <div class="row"><strong>${esc(j.title)}</strong>
        <span class="chip info">${esc(j.area || '')}</span>
        <span class="chip ${statusChip(j.status)}">${esc(j.status)}</span>
        ${j.locked ? '<span class="chip warn">travada</span>' : ''}
        <span class="spacer"></span>
        <span class="muted">${j.competencies.length} competências · pesos ${j.competencies.reduce((s,c)=>s+c.weight,0)}%</span>
      </div></div>`).join('') || '<div class="muted">Nenhuma vaga.</div>'}`);
  if (isRH()) el('newJob').onclick = () => jobForm();
  el('main').querySelectorAll('.list-item').forEach((it) => it.onclick = () => location.hash = 'jobs/' + it.dataset.id);
};
const statusChip = (s) => ({ rascunho: '', aberta: 'info', em_entrevistas: 'warn', encerrada: 'danger', pendente: '', em_avaliacao: 'warn', aprovado: 'ok', reprovado: 'danger', desistente: '' }[s] || '');

function jobForm(j = null) {
  modal(`
    <h3>${j ? 'Editar' : 'Nova'} vaga</h3>
    <label>Título</label><input id="j_title" value="${esc(j?.title || '')}" />
    <div class="grid2"><div><label>Área</label><input id="j_area" value="${esc(j?.area || '')}" /></div>
    <div><label>Nota mínima geral</label><input id="j_min" type="number" value="${j?.min_score ?? 50}" /></div></div>
    <label>Descrição</label><textarea id="j_desc">${esc(j?.description || '')}</textarea>
    <label>Responsabilidades</label><textarea id="j_resp">${esc(j?.responsibilities || '')}</textarea>
    <div class="grid2"><div><label>Requisitos obrigatórios</label><textarea id="j_req">${esc(j?.required_requirements || '')}</textarea></div>
    <div><label>Requisitos desejáveis</label><textarea id="j_des">${esc(j?.desired_requirements || '')}</textarea></div></div>
    <label>Critérios eliminatórios (objetivos, ligados ao cargo)</label><textarea id="j_elim">${esc(j?.eliminatory_criteria || '')}</textarea>
    <div id="jErr"></div>
    <div class="row" style="margin-top:12px"><button id="saveJob">Salvar</button><button class="ghost" onclick="closeModal()">Cancelar</button></div>`);
  el('saveJob').onclick = async () => {
    const body = { title: el('j_title').value, area: el('j_area').value, min_score: Number(el('j_min').value),
      description: el('j_desc').value, responsibilities: el('j_resp').value,
      required_requirements: el('j_req').value, desired_requirements: el('j_des').value,
      eliminatory_criteria: el('j_elim').value };
    try {
      const r = j ? await api('PATCH', '/jobs/' + j.id, body) : await api('POST', '/jobs', body);
      closeModal(); location.hash = 'jobs/' + (j ? j.id : r.id); route();
    } catch (e) { el('jErr').innerHTML = flash(e.message, 'error'); }
  };
}

async function jobDetail(id) {
  const [job, comps, scriptsRaw] = await Promise.all([api('GET', '/jobs/' + id), api('GET', '/competencies'), Promise.resolve(null)]);
  const total = job.competencies.reduce((s, c) => s + c.weight, 0);
  setMain(`
    <div class="topbar"><div><h2>${esc(job.title)}</h2>
      <div class="muted">${esc(job.area || '')} · nota mínima ${job.min_score}
        <span class="chip ${statusChip(job.status)}">${job.status}</span>
        ${job.locked ? '<span class="chip warn">travada (pesos/critérios imutáveis)</span>' : ''}</div></div>
      <div class="row">${isRH() && !job.locked ? '<button class="ghost" id="editJob">Editar</button>' : ''}
        <button class="ghost" onclick="location.hash='jobs'">Voltar</button></div></div>

    <div class="grid2">
      <div class="card"><h3>Descrição & requisitos</h3>
        <div class="muted">Responsabilidades</div><div>${esc(job.responsibilities || '—')}</div>
        <div class="muted" style="margin-top:8px">Requisitos obrigatórios</div><div>${esc(job.required_requirements || '—')}</div>
        <div class="muted" style="margin-top:8px">Requisitos desejáveis</div><div>${esc(job.desired_requirements || '—')}</div>
        <div class="muted" style="margin-top:8px">Critérios eliminatórios</div><div>${esc(job.eliminatory_criteria || '—')}</div>
      </div>
      <div class="card"><div class="row"><h3>Competências & pesos</h3><span class="spacer"></span>
        <span class="chip ${Math.abs(total-100)<0.01?'ok':'danger'}">Σ ${total}%</span></div>
        <table><tbody>${job.competencies.map((c)=>`<tr><td>${esc(c.name)}</td>
          <td style="width:120px"><div class="bar"><i style="width:${c.weight}%"></i></div></td>
          <td style="width:60px">${c.weight}%</td></tr>`).join('') || '<tr><td class="muted">Nenhuma competência definida.</td></tr>'}</tbody></table>
        ${isRH() && !job.locked ? '<button class="ghost small" id="editComps" style="margin-top:10px">Definir competências e pesos</button>' : ''}
      </div>
    </div>

    <div class="card"><div class="row"><h3>Roteiros</h3><span class="spacer"></span>
      ${isRH() && !job.locked && Math.abs(total-100)<0.01 && job.competencies.length>=4 ? '<button id="newScript">Criar roteiro</button>' : ''}</div>
      <table><thead><tr><th>Versão</th><th>Status</th><th>Congelado em</th><th></th></tr></thead>
      <tbody>${(job.scripts||[]).map((s)=>`<tr><td>v${s.version}</td>
        <td><span class="chip ${s.status==='congelado'?'ok':'warn'}">${s.status}</span></td>
        <td>${s.frozen_at ? fmtDateTime(s.frozen_at) : '—'}</td>
        <td><button class="ghost small" data-script="${s.id}">Abrir</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhum roteiro.</td></tr>'}</tbody></table>
      ${job.competencies.length<4 ? '<div class="muted" style="margin-top:8px">Defina de 4 a 6 competências (soma 100%) para criar o roteiro.</div>' : ''}
    </div>`);

  if (isRH() && !job.locked) {
    const eb = el('editJob'); if (eb) eb.onclick = () => jobForm(job);
    const ec = el('editComps'); if (ec) ec.onclick = () => jobCompForm(job, comps);
    const ns = el('newScript'); if (ns) ns.onclick = () => createScript(job.id);
  }
  el('main').querySelectorAll('[data-script]').forEach((b) => b.onclick = () => scriptDetail(Number(b.dataset.script), job));
}

function jobCompForm(job, comps) {
  const current = job.competencies.map((c) => ({ competency_id: c.competency_id, weight: c.weight }));
  let rows = current.length ? current : [{ competency_id: '', weight: 25 }, { competency_id: '', weight: 25 }, { competency_id: '', weight: 25 }, { competency_id: '', weight: 25 }];
  function render() {
    const total = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
    modal(`
      <h3>Competências e pesos — ${esc(job.title)}</h3>
      <p class="muted">Entre 4 e 6 competências; os pesos devem somar 100%.</p>
      <div id="rows">${rows.map((r, i) => `<div class="row" style="margin-bottom:6px">
        <select data-i="${i}" class="c_sel">${['<option value="">Selecione…</option>'].concat(comps.map((c)=>`<option value="${c.id}" ${Number(r.competency_id)===c.id?'selected':''}>${esc(c.name)}</option>`)).join('')}</select>
        <input type="number" class="c_w" data-i="${i}" value="${r.weight}" style="width:90px" /> %
        <button class="ghost small c_del" data-i="${i}">✕</button></div>`).join('')}</div>
      <div class="row"><button class="ghost small" id="addRow" ${rows.length>=6?'disabled':''}>+ competência</button>
        <span class="spacer"></span><span class="chip ${Math.abs(total-100)<0.01?'ok':'danger'}">Σ ${total}%</span></div>
      <div id="jcErr"></div>
      <div class="row" style="margin-top:12px"><button id="saveJC">Salvar</button><button class="ghost" onclick="closeModal()">Cancelar</button></div>`);
    el('modalRoot').querySelectorAll('.c_sel').forEach((s)=>s.onchange=()=>{ rows[Number(s.dataset.i)].competency_id = s.value; });
    el('modalRoot').querySelectorAll('.c_w').forEach((w)=>w.oninput=()=>{ rows[Number(w.dataset.i)].weight = Number(w.value); render(); });
    el('modalRoot').querySelectorAll('.c_del').forEach((b)=>b.onclick=()=>{ rows.splice(Number(b.dataset.i),1); render(); });
    el('addRow').onclick = () => { rows.push({ competency_id: '', weight: 0 }); render(); };
    el('saveJC').onclick = async () => {
      try {
        const payload = rows.map((r)=>({ competency_id: Number(r.competency_id), weight: Number(r.weight) }));
        await api('PUT', `/jobs/${job.id}/competencies`, { competencies: payload });
        closeModal(); jobDetail(job.id);
      } catch (e) { el('jcErr').innerHTML = flash(e.message, 'error'); }
    };
  }
  render();
}

async function createScript(jobId) {
  modal(`<h3>Novo roteiro</h3><label>Instruções gerais ao entrevistador</label>
    <textarea id="s_instr"></textarea><div id="sErr"></div>
    <div class="row" style="margin-top:12px"><button id="saveScript">Criar</button><button class="ghost" onclick="closeModal()">Cancelar</button></div>`);
  el('saveScript').onclick = async () => {
    try {
      const r = await api('POST', '/scripts', { job_id: jobId, instructions: el('s_instr').value });
      closeModal(); const job = await api('GET', '/jobs/' + jobId); scriptDetail(r.id, job);
    } catch (e) { el('sErr').innerHTML = flash(e.message, 'error'); }
  };
}

async function scriptDetail(scriptId, job) {
  const [script, allQuestions] = await Promise.all([api('GET', '/scripts/' + scriptId), api('GET', '/questions?status=ativa')]);
  const frozen = script.status === 'congelado';
  setMain(`
    <div class="topbar"><div><h2>Roteiro v${script.version} — ${esc(job.title)}</h2>
      <div class="muted"><span class="chip ${frozen?'ok':'warn'}">${script.status}</span>
      ${frozen ? 'Versão congelada e imutável' : 'Rascunho — adicione perguntas e congele'}</div></div>
      <button class="ghost" onclick="location.hash='jobs/${job.id}'">Voltar à vaga</button></div>
    <div class="card"><label>Instruções</label><div>${esc(script.instructions || '—')}</div></div>
    <div class="card"><div class="row"><h3>Perguntas do roteiro</h3><span class="spacer"></span>
      ${isRH() && !frozen ? '<button class="ghost small" id="editSQ">Definir perguntas</button>' : ''}
      ${isRH() && !frozen ? '<button id="freezeBtn">Congelar roteiro</button>' : ''}</div>
      <table><thead><tr><th>#</th><th>Pergunta</th><th>Competência</th><th>Método</th><th>Tempo</th></tr></thead>
      <tbody>${script.questions.map((q,i)=>`<tr><td>${i+1}</td><td>${esc(q.question_text)}</td>
        <td>${esc(q.competency_name)}</td><td><span class="tag">${q.methodology}</span></td>
        <td>${q.suggested_minutes?q.suggested_minutes+' min':'—'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhuma pergunta.</td></tr>'}</tbody></table></div>`);
  if (isRH() && !frozen) {
    el('editSQ').onclick = () => scriptQForm(script, job, allQuestions);
    el('freezeBtn').onclick = async () => {
      if (!confirm('Congelar torna o roteiro imutável. Continuar?')) return;
      try { await api('POST', `/scripts/${scriptId}/freeze`, {}); const j = await api('GET','/jobs/'+job.id); scriptDetail(scriptId, j); }
      catch (e) { alert(e.message + (e.data?.problems ? '\n' + e.data.problems.join('\n') : '')); }
    };
  }
}

function scriptQForm(script, job, allQuestions) {
  let rows = script.questions.map((q) => ({ question_id: q.question_id, competency_id: q.competency_id, suggested_minutes: q.suggested_minutes || 10, interviewer_instructions: q.interviewer_instructions || '' }));
  const compOpts = job.competencies.map((c) => `<option value="${c.competency_id}">${esc(c.name)}</option>`).join('');
  function render() {
    modal(`
      <h3>Perguntas do roteiro</h3>
      <p class="muted">Vincule perguntas às competências da vaga. Toda competência obrigatória precisa de ao menos uma pergunta.</p>
      <div>${rows.map((r,i)=>`<div class="q-block">
        <div class="row"><strong>#${i+1}</strong><span class="spacer"></span><button class="ghost small r_del" data-i="${i}">Remover</button></div>
        <label>Pergunta</label>
        <select class="r_q" data-i="${i}">${['<option value="">Selecione…</option>'].concat(allQuestions.map((q)=>`<option value="${q.id}" ${r.question_id===q.id?'selected':''}>${esc(q.text.slice(0,70))}</option>`)).join('')}</select>
        <div class="grid2"><div><label>Competência</label><select class="r_c" data-i="${i}">${['<option value="">—</option>'].concat(job.competencies.map((c)=>`<option value="${c.competency_id}" ${r.competency_id===c.competency_id?'selected':''}>${esc(c.name)}</option>`)).join('')}</select></div>
        <div><label>Tempo (min)</label><input type="number" class="r_m" data-i="${i}" value="${r.suggested_minutes}" /></div></div>
        <label>Instruções ao entrevistador</label><input class="r_ins" data-i="${i}" value="${esc(r.interviewer_instructions)}" />
      </div>`).join('')}</div>
      <button class="ghost small" id="addQ">+ pergunta</button>
      <div id="sqErr"></div>
      <div class="row" style="margin-top:12px"><button id="saveSQ">Salvar</button><button class="ghost" onclick="closeModal()">Cancelar</button></div>`);
    const sync = () => {
      el('modalRoot').querySelectorAll('.r_q').forEach((s)=>rows[Number(s.dataset.i)].question_id = s.value?Number(s.value):null);
      el('modalRoot').querySelectorAll('.r_c').forEach((s)=>rows[Number(s.dataset.i)].competency_id = s.value?Number(s.value):null);
      el('modalRoot').querySelectorAll('.r_m').forEach((s)=>rows[Number(s.dataset.i)].suggested_minutes = Number(s.value));
      el('modalRoot').querySelectorAll('.r_ins').forEach((s)=>rows[Number(s.dataset.i)].interviewer_instructions = s.value);
    };
    // Auto preenche competencia ao escolher pergunta.
    el('modalRoot').querySelectorAll('.r_q').forEach((s)=>s.onchange=()=>{
      sync(); const q = allQuestions.find((x)=>x.id===Number(s.value));
      const i = Number(s.dataset.i);
      if (q && q.competency_id && job.competencies.some((c)=>c.competency_id===q.competency_id)) rows[i].competency_id = q.competency_id;
      render();
    });
    el('modalRoot').querySelectorAll('.r_del').forEach((b)=>b.onclick=()=>{ sync(); rows.splice(Number(b.dataset.i),1); render(); });
    el('addQ').onclick = () => { sync(); rows.push({ question_id: null, competency_id: null, suggested_minutes: 10, interviewer_instructions: '' }); render(); };
    el('saveSQ').onclick = async () => {
      sync();
      const clean = rows.filter((r)=>r.question_id && r.competency_id).map((r,i)=>({ ...r, order_index: i }));
      if (!clean.length) { el('sqErr').innerHTML = flash('Adicione ao menos uma pergunta com competência.', 'error'); return; }
      try { await api('PUT', `/scripts/${script.id}/questions`, { questions: clean }); closeModal(); scriptDetail(script.id, job); }
      catch (e) { el('sqErr').innerHTML = flash(e.message, 'error'); }
    };
  }
  render();
}

// ================= CANDIDATES =================
views.candidates = async (rest) => {
  if (rest[0]) return candidateDetail(Number(rest[0]));
  const [cands, jobs] = await Promise.all([api('GET', '/candidates'), api('GET', '/jobs')]);
  const jmap = Object.fromEntries(jobs.map((j) => [j.id, j.title]));
  setMain(`
    <div class="topbar"><h2>Candidatos</h2>
      <div class="row">${isRH() ? '<button class="ghost" onclick="location.hash=\'import\'">Importar planilha</button>' : ''}
      ${isRH() ? '<button id="newCand">Novo candidato</button>' : ''}</div></div>
    <div class="card"><table><thead><tr><th>Nome</th><th>Vaga</th><th>E-mail</th><th>Cidade</th><th>Situação</th><th>1º contato</th><th>Confirmou</th><th>Convite</th></tr></thead>
    <tbody>${cands.map((c)=>`<tr class="clickable" data-id="${c.id}" style="cursor:pointer">
      <td>${esc(c.name)}</td><td>${esc(jmap[c.job_id]||'')}</td><td>${esc(c.email||'—')}</td><td>${esc(c.city||'—')}</td>
      <td><span class="chip ${statusChip(c.status)}">${c.status}</span></td>
      <td id="fc-${c.id}">${c.first_contact_at ? fmtDateTime(c.first_contact_at) : '<span class="muted">—</span>'}</td>
      <td style="text-align:center"><input type="checkbox" class="confirm-chk" data-confirm="${c.id}" ${c.interview_confirmed_at ? 'checked' : ''}
        style="width:auto;cursor:pointer" title="${c.interview_confirmed_at ? 'Confirmada em ' + fmtDateTime(c.interview_confirmed_at) : 'Marcar como confirmada'}" />
        <span class="confirm-date muted" id="cf-${c.id}" style="font-size:11px">${c.interview_confirmed_at ? fmtDateTime(c.interview_confirmed_at) : ''}</span></td>
      <td><div class="row" style="gap:4px;flex-wrap:nowrap">
        ${c.phone ? `<button class="small wa-btn" data-wa="${c.id}" title="Convite por WhatsApp">💬</button>` : ''}
        <button class="small email-btn" data-email="${c.id}" title="Convite por e-mail">✉️ E-mail</button>
      </div></td>
      </tr>`).join('') || '<tr><td colspan="8" class="muted">Nenhum candidato.</td></tr>'}</tbody></table></div>`);
  if (isRH()) el('newCand').onclick = () => candForm(jobs);
  // Botao WhatsApp: nao dispara a navegacao da linha.
  el('main').querySelectorAll('.wa-btn').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const c = cands.find((x) => x.id === Number(b.dataset.wa));
    whatsappInvite(c, jmap[c.job_id] || '');
  });
  // Botao de convite por e-mail.
  el('main').querySelectorAll('.email-btn').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const c = cands.find((x) => x.id === Number(b.dataset.email));
    emailInvite(c, jmap[c.job_id] || '');
  });
  // Checkbox de confirmacao da entrevista.
  el('main').querySelectorAll('.confirm-chk').forEach((chk) => {
    chk.onclick = (e) => e.stopPropagation();
    chk.onchange = async (e) => {
      e.stopPropagation();
      const id = Number(chk.dataset.confirm);
      const c = cands.find((x) => x.id === id);
      try {
        const r = await api('POST', `/candidates/${id}/confirm`, { confirmed: chk.checked });
        c.interview_confirmed_at = r.interview_confirmed_at;
        const dateEl = el('cf-' + id);
        if (dateEl) dateEl.textContent = r.interview_confirmed_at ? fmtDateTime(r.interview_confirmed_at) : '';
        chk.title = r.interview_confirmed_at ? 'Confirmada em ' + fmtDateTime(r.interview_confirmed_at) : 'Marcar como confirmada';
      } catch (err) {
        chk.checked = !chk.checked; // reverte em caso de erro
        alert('Erro ao atualizar confirmação: ' + err.message);
      }
    };
  });
  el('main').querySelectorAll('[data-id]').forEach((r) => r.onclick = () => location.hash = 'candidates/' + r.dataset.id);
};

// Formata timestamp UTC do SQLite ("YYYY-MM-DD HH:MM:SS") para o fuso de
// São Paulo (America/Sao_Paulo) no formato "DD/MM/YYYY HH:MM".
function fmtDateTime(s) {
  if (!s) return '—';
  let iso = String(s).includes('T') ? String(s) : String(s).replace(' ', 'T');
  if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(iso)) iso += 'Z'; // valores do SQLite são UTC
  const d = new Date(iso);
  if (isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d);
}

// Sanitiza telefone para formato wa.me (apenas digitos; assume Brasil se faltar DDI).
function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length <= 11) d = '55' + d; // adiciona DDI Brasil quando ausente
  return d;
}

// Modal de convite: nome vem do candidato; agenda e preenchida aqui.
function whatsappInvite(cand, jobTitle) {
  const firstName = (cand.name || '').split(' ')[0];
  modal(`
    <h3>Convite por WhatsApp — ${esc(cand.name)}</h3>
    <p class="muted">Telefone: ${esc(cand.phone || '—')}. Preencha os dados do convite; o nome é preenchido automaticamente.</p>
    <div class="grid2">
      <div><label>Data</label><input id="wa_data" placeholder="ex.: 25/09/2026" /></div>
      <div><label>Horário</label><input id="wa_hora" placeholder="ex.: 14h00" /></div>
    </div>
    <label>Formato / local</label>
    <input id="wa_local" value="Presencial — Distrito Tecnológico do SENAI, São Bernardo do Campo" />
    <div class="grid2">
      <div><label>Duração aproximada</label><input id="wa_dur" value="45 minutos" /></div>
      <div><label>Prazo para confirmar</label><input id="wa_prazo" placeholder="ex.: 23/09/2026" /></div>
    </div>
    <label>Vaga</label><input id="wa_vaga" value="Técnico em Programação Full Stack" />
    <label>Prévia da mensagem</label>
    <textarea id="wa_preview" style="min-height:220px"></textarea>
    <div id="waErr"></div>
    <div class="row" style="margin-top:12px">
      <button id="wa_open">Abrir no WhatsApp</button>
      <button class="ghost" id="wa_copy">Copiar mensagem</button>
      <button class="ghost" onclick="closeModal()">Fechar</button>
    </div>`);

  const build = () => {
    const g = (id) => el(id).value.trim();
    const msg =
`Olá, *${firstName || cand.name}*! Tudo bem?

Sou *Caio Rodrigues*, do *Distrito Tecnológico do SENAI*. Analisamos seu perfil e gostaríamos de convidá-lo(a) para uma entrevista para a vaga de *${g('wa_vaga') || 'Técnico em Programação Full Stack'}*, no setor de *Software e Inteligência Artificial*.

📅 *Data:* ${g('wa_data') || '[data]'}

🕐 *Horário:* ${g('wa_hora') || '[horário]'}

📍 *Formato/local:* ${g('wa_local') || '[presencial, endereço ou link]'}

⏱️ *Duração aproximada:* ${g('wa_dur') || '[duração]'}

Você poderia confirmar sua disponibilidade até *${g('wa_prazo') || '[prazo]'}*? Caso esse horário não seja possível, avise-nos para verificarmos outra opção.

Obrigado!

*Caio Rodrigues – SENAI*`;
    return msg;
  };
  const refresh = () => { el('wa_preview').value = build(); };
  ['wa_data', 'wa_hora', 'wa_local', 'wa_dur', 'wa_prazo', 'wa_vaga'].forEach((id) => el(id).oninput = refresh);
  refresh();

  el('wa_open').onclick = async () => {
    const num = waNumber(cand.phone);
    const text = encodeURIComponent(el('wa_preview').value);
    const url = num ? `https://wa.me/${num}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url, '_blank');
    // Marca a data do primeiro contato (mantem o primeiro registro).
    try {
      const r = await api('POST', `/candidates/${cand.id}/first-contact`, {});
      cand.first_contact_at = r.first_contact_at;
      const cell = el('fc-' + cand.id);
      if (cell) cell.textContent = fmtDateTime(r.first_contact_at);
      el('waErr').innerHTML = flash(r.already
        ? 'Primeiro contato já registrado em ' + fmtDateTime(r.first_contact_at) + '.'
        : 'Primeiro contato registrado em ' + fmtDateTime(r.first_contact_at) + '.');
    } catch (e) {
      el('waErr').innerHTML = flash('Convite aberto, mas não foi possível registrar o primeiro contato: ' + e.message, 'error');
    }
  };
  el('wa_copy').onclick = async () => {
    try { await navigator.clipboard.writeText(el('wa_preview').value); el('waErr').innerHTML = flash('Mensagem copiada.'); }
    catch { el('waErr').innerHTML = flash('Não foi possível copiar automaticamente; selecione o texto da prévia.', 'error'); }
  };
}

// Modal de convite por e-mail: mensagem padrão preenchida com dados do candidato.
function emailInvite(cand, jobTitle) {
  const firstName = (cand.name || '').split(' ')[0];
  modal(`
    <h3>Convite por e-mail — ${esc(cand.name)}</h3>
    <p class="muted">Destinatário: ${esc(cand.email || '— (sem e-mail cadastrado)')}. O nome é preenchido automaticamente.</p>
    <label>Assunto</label>
    <input id="em_subject" value="Convite para entrevista — Técnico em Programação Full Stack | Distrito Tecnológico do SENAI" />
    <div class="grid2">
      <div><label>Data</label><input id="em_data" placeholder="ex.: 25/09/2026" /></div>
      <div><label>Horário</label><input id="em_hora" placeholder="ex.: 14h00" /></div>
    </div>
    <div class="grid2">
      <div><label>Formato</label><input id="em_formato" placeholder="presencial/on-line" value="presencial" /></div>
      <div><label>Duração aproximada</label><input id="em_dur" value="45 minutos" /></div>
    </div>
    <label>Local ou link</label>
    <input id="em_local" value="Distrito Tecnológico do SENAI, São Bernardo do Campo" />
    <div class="grid2">
      <div><label>Prazo para confirmar</label><input id="em_prazo" placeholder="ex.: 23/09/2026" /></div>
      <div><label>Vaga</label><input id="em_vaga" value="Técnico em Programação Full Stack" /></div>
    </div>
    <label>Prévia da mensagem</label>
    <textarea id="em_preview" style="min-height:240px"></textarea>
    <div id="emErr"></div>
    <div class="row" style="margin-top:12px">
      <button id="em_copy">Copiar mensagem</button>
      <button class="ghost" id="em_open">Abrir no e-mail</button>
      <button class="ghost" onclick="closeModal()">Fechar</button>
    </div>`);

  const build = () => {
    const g = (id) => el(id).value.trim();
    return `Olá, **${firstName || cand.name}**! Tudo bem?

Analisamos seu perfil e gostaríamos de convidá-lo(a) para uma entrevista referente à vaga de **${g('em_vaga') || 'Técnico em Programação Full Stack'}**, para atuação no setor de **Software e Inteligência Artificial do Distrito Tecnológico do SENAI**.

**Data:** ${g('em_data') || '[data]'}

**Horário:** ${g('em_hora') || '[horário]'}

**Formato:** ${g('em_formato') || '[presencial/on-line]'}

**Local ou link:** ${g('em_local') || '[endereço/link]'}

**Duração aproximada:** ${g('em_dur') || '[duração]'}

Pedimos, por gentileza, que confirme sua disponibilidade até **${g('em_prazo') || '[prazo]'}**. Caso não possa comparecer no horário indicado, informe-nos para verificarmos outra possibilidade.

Atenciosamente,`;
  };
  const refresh = () => { el('em_preview').value = build(); };
  ['em_data', 'em_hora', 'em_formato', 'em_dur', 'em_local', 'em_prazo', 'em_vaga'].forEach((id) => el(id).oninput = refresh);
  refresh();

  el('em_copy').onclick = async () => {
    try { await navigator.clipboard.writeText(el('em_preview').value); el('emErr').innerHTML = flash('Mensagem copiada.'); }
    catch { el('emErr').innerHTML = flash('Não foi possível copiar automaticamente; selecione o texto da prévia.', 'error'); }
  };
  el('em_open').onclick = () => {
    const to = encodeURIComponent(cand.email || '');
    const subject = encodeURIComponent(el('em_subject').value);
    const body = encodeURIComponent(el('em_preview').value);
    window.open(`mailto:${to}?subject=${subject}&body=${body}`, '_blank');
  };
}

function candForm(jobs) {
  modal(`<h3>Novo candidato</h3>
    <label>Nome</label><input id="c_name" />
    <label>Vaga</label><select id="c_job">${jobs.map((j)=>`<option value="${j.id}">${esc(j.title)}</option>`).join('')}</select>
    <div class="grid2"><div><label>E-mail</label><input id="c_email" type="email" /></div>
      <div><label>Telefone</label><input id="c_phone" /></div></div>
    <label>Cidade / UF</label><input id="c_city" />
    <label>Informações profissionais (evite dados pessoais irrelevantes)</label><textarea id="c_info"></textarea>
    <label>Etapa atual</label><input id="c_stage" value="Triagem" />
    <div id="cErr"></div>
    <div class="row" style="margin-top:12px"><button id="saveCand">Salvar</button><button class="ghost" onclick="closeModal()">Cancelar</button></div>`);
  el('saveCand').onclick = async () => {
    try {
      const r = await api('POST', '/candidates', { name: el('c_name').value, job_id: Number(el('c_job').value),
        email: el('c_email').value, phone: el('c_phone').value, city: el('c_city').value,
        professional_info: el('c_info').value, stage: el('c_stage').value });
      closeModal(); location.hash = 'candidates/' + r.id; route();
    } catch (e) { el('cErr').innerHTML = flash(e.message, 'error'); }
  };
}

async function candidateDetail(id) {
  const [cand, users] = await Promise.all([api('GET', '/candidates/' + id), isRH() ? api('GET', '/users') : Promise.resolve([])]);
  const job = await api('GET', '/jobs/' + cand.job_id);
  const frozenScript = (job.scripts || []).find((s) => s.status === 'congelado');
  let report = null, decisions = [];
  if (can(['admin','rh','gestor','auditor'])) {
    try { report = await api('GET', '/reports/candidates/' + id); } catch {}
    try { decisions = await api('GET', '/decisions/candidates/' + id); } catch {}
  }
  setMain(`
    <div class="topbar"><div><h2>${esc(cand.name)}</h2>
      <div class="muted">${esc(job.title)} · etapa ${esc(cand.stage||'—')}
      <span class="chip ${statusChip(cand.status)}">${cand.status}</span></div></div>
      <div class="row">${isRH() ? '<button class="ghost" id="editCand">Editar</button>' : ''}
        <button class="ghost" onclick="location.hash='candidates'">Voltar</button></div></div>

    <div class="card"><label>Informações profissionais</label><div>${esc(cand.professional_info || '—')}</div>
      <div class="grid3" style="margin-top:8px">
        <div><label>E-mail</label><div>${esc(cand.email || '—')}</div></div>
        <div><label>Telefone</label><div>${esc(cand.phone || '—')}</div></div>
        <div><label>Cidade / UF</label><div>${esc(cand.city || '—')}</div></div>
      </div>
      <div style="margin-top:8px"><label>Data do primeiro contato</label><div>${cand.first_contact_at ? fmtDateTime(cand.first_contact_at) : '—'}</div></div></div>

    <div class="card"><div class="row"><h3>Entrevistas</h3><span class="spacer"></span>
      ${isRH() && frozenScript ? '<button id="newInterview">Agendar entrevista</button>' : ''}
      ${isRH() && !frozenScript ? '<span class="muted">Congele um roteiro na vaga para agendar.</span>' : ''}</div>
      ${cand.interviews.map((iv)=>`<div class="list-item" style="cursor:default">
        <div class="row"><strong>Roteiro v${iv.script_version}</strong>
        <span class="muted">${esc(iv.scheduled_at||'sem data')}</span><span class="spacer"></span>
        ${(iv.interviewers||[]).map((u)=>`<span class="tag">${esc(u.name)}</span>`).join(' ')}
        ${iv.interviewers.some((u)=>u.id===state.user.id)||state.user.role==='admin' ? `<button class="small" onclick="location.hash='myinterviews/${iv.id}'">Avaliar</button>` : ''}
        </div></div>`).join('') || '<div class="muted">Nenhuma entrevista agendada.</div>'}
    </div>

    ${report ? renderReportCard(report) : ''}
    ${report ? renderDecisionCard(cand, report, decisions) : ''}`);

  if (isRH()) {
    el('editCand').onclick = () => candEditForm(cand, job);
    const ni = el('newInterview'); if (ni) ni.onclick = () => interviewForm(cand, users.filter((u)=>['entrevistador','rh','gestor','admin'].includes(u.role)));
  }
  if (report && can(['admin','rh','gestor'])) {
    const db = el('decideBtn'); if (db) db.onclick = () => submitDecision(id);
    const eb = el('evidenceBtn'); if (eb) eb.onclick = () => showEvidence(id);
  } else if (report) {
    const eb = el('evidenceBtn'); if (eb) eb.onclick = () => showEvidence(id);
  }
}

function renderReportCard(r) {
  return `<div class="card"><div class="row"><h3>Resultado consolidado</h3><span class="spacer"></span>
    <button class="ghost small" id="evidenceBtn">Ver evidências</button></div>
    ${!r.complete ? `<div class="error">Avaliação incompleta — competências obrigatórias sem nota: ${r.missing_mandatory.map(esc).join(', ')}</div>` : ''}
    <table><thead><tr><th>Competência</th><th>Peso</th><th>Média</th><th>Ponderado</th><th>N/A</th><th></th></tr></thead>
    <tbody>${r.competencies.map((c)=>`<tr>
      <td>${esc(c.name)} ${c.mandatory?'':'<span class="tag">opcional</span>'}</td>
      <td>${c.weight}%</td>
      <td>${c.assessed?round2(c.average):'<span class="chip warn">sem evidência</span>'}</td>
      <td>${c.weighted_result!=null?round2(c.weighted_result):'—'}</td>
      <td>${c.na_count||0}</td>
      <td>${c.divergence?'<span class="chip danger">divergência</span>':''}</td></tr>`).join('')}</tbody>
    <tfoot><tr><th colspan="3">Pontuação final</th>
      <th>${r.complete?round2(r.final_score):'<span class="muted">pendente</span>'}</th>
      <th colspan="2">${r.meets_min_score==null?'':(r.meets_min_score?'<span class="chip ok">atende mínimo</span>':'<span class="chip danger">abaixo do mínimo</span>')}</th></tr></tfoot>
    </table></div>`;
}

function renderDecisionCard(cand, report, decisions) {
  return `<div class="card"><h3>Decisão final</h3>
    ${decisions.map((d)=>`<div class="list-item" style="cursor:default">
      <span class="chip ${statusChip(d.outcome)}">${d.outcome}</span>
      <strong> ${esc(d.decided_by_name)}</strong> <span class="muted">${fmtDateTime(d.decided_at)}</span>
      <div>${esc(d.justification)}</div></div>`).join('') || '<div class="muted">Sem decisão registrada.</div>'}
    ${can(['admin','rh','gestor']) ? '<button id="decideBtn" style="margin-top:10px">Registrar decisão</button>' : ''}</div>`;
}

async function showEvidence(id) {
  const rows = await api('GET', `/reports/candidates/${id}/evidence`);
  modal(`<div class="row"><h3>Evidências e justificativas</h3><span class="spacer"></span><button class="ghost small" onclick="closeModal()">Fechar</button></div>
    ${rows.length ? rows.map((r)=>`<div class="q-block">
      <div class="row"><span class="tag">${esc(r.competency)}</span><span class="spacer"></span>
      ${r.not_assessable?'<span class="chip warn">N/A</span>':`<span class="chip info">nota ${r.score}</span>`}
      <span class="muted">${esc(r.interviewer)}</span></div>
      <div class="muted" style="margin-top:6px">${esc(r.question)}</div>
      <div><strong>Resposta:</strong> ${esc(r.answer_summary||'—')}</div>
      <div><strong>Evidência:</strong> ${esc(r.evidence||'—')}</div>
      <div><strong>Justificativa:</strong> ${esc(r.justification||'—')}</div></div>`).join('') : '<div class="muted">Nenhuma avaliação enviada.</div>'}`);
}

function submitDecision(id) {
  modal(`<h3>Registrar decisão</h3>
    <label>Resultado</label><select id="d_out"><option value="aprovado">Aprovado</option><option value="reprovado">Reprovado</option><option value="standby">Standby</option></select>
    <label>Justificativa (obrigatória)</label><textarea id="d_just"></textarea>
    <div id="dErr"></div>
    <div class="row" style="margin-top:12px"><button id="saveDec">Registrar</button><button class="ghost" onclick="closeModal()">Cancelar</button></div>`);
  el('saveDec').onclick = async () => {
    try { await api('POST', '/decisions/candidates/' + id, { outcome: el('d_out').value, justification: el('d_just').value });
      closeModal(); candidateDetail(id);
    } catch (e) { el('dErr').innerHTML = flash(e.message + (e.data?.missing_mandatory ? ': ' + e.data.missing_mandatory.join(', ') : ''), 'error'); }
  };
}

function candEditForm(cand, job) {
  modal(`<h3>Editar candidato</h3>
    <label>Nome</label><input id="ce_name" value="${esc(cand.name)}" />
    <div class="grid2"><div><label>E-mail</label><input id="ce_email" value="${esc(cand.email||'')}" /></div>
      <div><label>Telefone</label><input id="ce_phone" value="${esc(cand.phone||'')}" /></div></div>
    <label>Cidade / UF</label><input id="ce_city" value="${esc(cand.city||'')}" />
    <label>Etapa</label><input id="ce_stage" value="${esc(cand.stage||'')}" />
    <label>Situação</label><select id="ce_status">${['pendente','em_avaliacao','aprovado','reprovado','desistente'].map((s)=>`<option ${cand.status===s?'selected':''}>${s}</option>`).join('')}</select>
    <label>Informações profissionais</label><textarea id="ce_info">${esc(cand.professional_info||'')}</textarea>
    <div id="ceErr"></div>
    <div class="row" style="margin-top:12px"><button id="saveCE">Salvar</button><button class="ghost" onclick="closeModal()">Cancelar</button></div>`);
  el('saveCE').onclick = async () => {
    try { await api('PATCH', '/candidates/' + cand.id, { name: el('ce_name').value, email: el('ce_email').value,
      phone: el('ce_phone').value, city: el('ce_city').value, stage: el('ce_stage').value,
      status: el('ce_status').value, professional_info: el('ce_info').value });
      closeModal(); candidateDetail(cand.id);
    } catch (e) { el('ceErr').innerHTML = flash(e.message, 'error'); }
  };
}

function interviewForm(cand, interviewers) {
  let selected = [];
  modal(`<h3>Agendar entrevista — ${esc(cand.name)}</h3>
    <p class="muted">Usa o roteiro congelado mais recente da vaga (mesmo para todos os candidatos).</p>
    <label>Data/hora</label><input id="iv_when" type="datetime-local" />
    <label>Entrevistadores</label>
    <div id="ivList">${interviewers.map((u)=>`<label class="row" style="text-transform:none"><input type="checkbox" style="width:auto" data-uid="${u.id}" /> ${esc(u.name)} <span class="tag">${ROLE_LABELS[u.role]}</span></label>`).join('')}</div>
    <div id="ivErr"></div>
    <div class="row" style="margin-top:12px"><button id="saveIV">Agendar</button><button class="ghost" onclick="closeModal()">Cancelar</button></div>`);
  el('saveIV').onclick = async () => {
    selected = Array.from(el('ivList').querySelectorAll('input:checked')).map((c) => Number(c.dataset.uid));
    try {
      const when = el('iv_when').value ? el('iv_when').value.replace('T', ' ') : null;
      await api('POST', `/candidates/${cand.id}/interviews`, { interviewers: selected, scheduled_at: when });
      closeModal(); candidateDetail(cand.id);
    } catch (e) { el('ivErr').innerHTML = flash(e.message, 'error'); }
  };
}

// ================= MY INTERVIEWS / EVALUATION =================
views.myinterviews = async (rest) => {
  if (rest[0]) return evaluateInterview(Number(rest[0]));
  // Lista entrevistas onde sou entrevistador (deriva de candidatos).
  const cands = await api('GET', '/candidates');
  const rows = [];
  for (const c of cands) {
    const detail = await api('GET', '/candidates/' + c.id);
    for (const iv of detail.interviews) {
      if (iv.interviewers.some((u) => u.id === state.user.id) || state.user.role === 'admin') {
        rows.push({ iv, cand: detail });
      }
    }
  }
  setMain(`<div class="topbar"><h2>Minhas entrevistas</h2></div>
    ${rows.length ? rows.map(({iv,cand})=>`<div class="list-item" data-iv="${iv.id}">
      <div class="row"><strong>${esc(cand.name)}</strong><span class="muted">Roteiro v${iv.script_version} · ${esc(iv.scheduled_at||'sem data')}</span>
      <span class="spacer"></span><button class="small">Registrar avaliação</button></div></div>`).join('')
      : '<div class="muted">Você não é entrevistador de nenhuma entrevista.</div>'}`);
  el('main').querySelectorAll('[data-iv]').forEach((it)=>it.onclick=()=>location.hash='myinterviews/'+it.dataset.iv);
};

async function evaluateInterview(interviewId) {
  const data = await api('GET', `/api/evaluations/interviews/${interviewId}/mine`.replace('/api',''));
  const ev = data.evaluation;
  const submitted = ev.status === 'enviada';

  // Estado por pergunta (fonte unica de verdade para ambos os modos).
  const answers = {};
  data.questions.forEach((q) => {
    const a = q.answer || {};
    answers[q.script_question_id] = {
      answer_summary: a.answer_summary || '',
      evidence: a.evidence || '',
      score: a.score ?? null,
      not_assessable: (a.not_assessable === 1 || a.not_assessable === true) ? 1 : 0,
      justification: a.justification || '',
      notes: a.notes || '',
    };
  });

  // Agrupa perguntas por competencia (para o modo rápido).
  const groups = [];
  const byComp = {};
  data.questions.forEach((q) => {
    if (!byComp[q.competency_id]) {
      byComp[q.competency_id] = { competency_id: q.competency_id, competency_name: q.competency_name, questions: [] };
      groups.push(byComp[q.competency_id]);
    }
    byComp[q.competency_id].questions.push(q);
  });

  // Modo padrão: rápido (mais veloz). Avaliações enviadas usam o detalhado (com emenda).
  let quickMode = !submitted;

  function collect() {
    return data.questions.map((q) => {
      const a = answers[q.script_question_id];
      return {
        script_question_id: q.script_question_id,
        answer_summary: a.answer_summary,
        evidence: a.evidence,
        score: a.not_assessable ? null : (a.score ?? null),
        not_assessable: a.not_assessable ? true : false,
        justification: a.justification,
        notes: a.notes,
      };
    });
  }

  // Representante de uma competência (primeira pergunta) para o modo rápido.
  const rep = (g) => answers[g.questions[0].script_question_id];

  function render(saveMsg) {
    setMain(`
      <div class="topbar"><div><h2>Avaliação da entrevista</h2>
        <div class="muted">Sua avaliação é independente. <span class="chip ${submitted?'ok':'warn'}">${ev.status}</span></div></div>
        <div class="row">
          ${!submitted ? `<button class="ghost small" id="toggleMode">${quickMode?'Modo detalhado (por pergunta)':'Modo rápido (por competência)'}</button>` : ''}
          <button class="ghost" onclick="history.back()">Voltar</button></div></div>
      ${saveMsg || ''}
      ${submitted ? '<div class="success">Avaliação enviada e bloqueada. Alterações exigem justificativa (emenda) e ficam na auditoria.</div>' : ''}
      ${quickMode
        ? `<div class="muted" style="margin-bottom:10px">Modo rápido: uma nota e justificativa por competência, aplicadas às perguntas correspondentes.</div>
           <div id="qs">${groups.map((g, idx) => renderGroup(g, idx)).join('')}</div>`
        : `<div id="qs">${data.questions.map((q, idx) => renderQ(q, idx)).join('')}</div>`}
      ${!submitted ? `<div class="row"><button id="saveDraft" class="ghost">Salvar rascunho</button>
        <button id="submitEval">Enviar avaliação</button>
        <span class="muted">O rascunho pode ser salvo quantas vezes quiser antes do envio.</span></div>` : ''}`);
    bind();
  }

  // ----- Modo rápido: bloco por competência -----
  function renderGroup(g, idx) {
    const a = rep(g);
    const na = a.not_assessable === 1;
    return `<div class="q-block" data-comp="${g.competency_id}">
      <div class="row"><strong>${idx+1}. ${esc(g.competency_name)}</strong>
        <span class="tag">${g.questions.length} pergunta(s)</span></div>
      <details style="margin:6px 0"><summary class="muted" style="cursor:pointer">Ver perguntas desta competência</summary>
        <ul class="muted" style="margin:6px 0">${g.questions.map((q)=>`<li>${esc(q.question_text)}</li>`).join('')}</ul></details>
      <label>Nota da competência</label>
      <div class="score-btns">
        ${[1,2,3,4,5].map((n)=>`<button class="g_score ${!na&&a.score===n?'sel':''}" data-n="${n}">${n}</button>`).join('')}
        <button class="g_na ${na?'sel':''}">N/A — não foi possível avaliar</button>
      </div>
      <label>Evidências observadas</label><textarea class="g_ev">${esc(a.evidence||'')}</textarea>
      <label>Justificativa (obrigatória para nota)</label><textarea class="g_just">${esc(a.justification||'')}</textarea>
    </div>`;
  }

  // ----- Modo detalhado: bloco por pergunta -----
  function renderQ(q, idx) {
    const a = answers[q.script_question_id];
    const na = a.not_assessable === 1;
    return `<div class="q-block" data-sq="${q.script_question_id}">
      <div class="row"><strong>#${idx+1}</strong> <span class="tag">${esc(q.competency_name)}</span>
        <span class="tag">${q.methodology}</span></div>
      <div style="margin:6px 0">${esc(q.question_text)}</div>
      ${q.interviewer_instructions?`<div class="muted">Instrução: ${esc(q.interviewer_instructions)}</div>`:''}
      ${q.expected_indicators?`<div class="muted">Indicadores esperados: ${esc(q.expected_indicators)}</div>`:''}
      <label>Resumo da resposta</label><textarea class="a_sum" ${submitted?'disabled':''}>${esc(a.answer_summary||'')}</textarea>
      <label>Evidências observadas</label><textarea class="a_ev" ${submitted?'disabled':''}>${esc(a.evidence||'')}</textarea>
      <label>Nota</label>
      <div class="score-btns">
        ${[1,2,3,4,5].map((n)=>`<button class="a_score ${!na&&a.score===n?'sel':''}" data-n="${n}" ${submitted?'disabled':''}>${n}</button>`).join('')}
        <button class="a_na ${na?'sel':''}" ${submitted?'disabled':''}>N/A — não foi possível avaliar</button>
      </div>
      <label>Justificativa (obrigatória para nota)</label><textarea class="a_just" ${submitted?'disabled':''}>${esc(a.justification||'')}</textarea>
      <label>Observações adicionais</label><textarea class="a_notes" ${submitted?'disabled':''}>${esc(a.notes||'')}</textarea>
      ${submitted?`<button class="ghost small a_amend" data-sq="${q.script_question_id}">Emendar (com justificativa)</button>`:''}
    </div>`;
  }

  function bind() {
    // Modo rápido: aplica valores a todas as perguntas da competência.
    document.querySelectorAll('.q-block[data-comp]').forEach((block) => {
      const compId = Number(block.dataset.comp);
      const g = byComp[compId];
      const apply = (patch) => g.questions.forEach((q) => Object.assign(answers[q.script_question_id], patch));
      block.querySelectorAll('.g_score').forEach((b) => b.onclick = () => {
        apply({ score: Number(b.dataset.n), not_assessable: 0 });
        block.querySelectorAll('.g_score').forEach((x)=>x.classList.toggle('sel', x===b));
        block.querySelector('.g_na').classList.remove('sel');
      });
      const gna = block.querySelector('.g_na');
      if (gna) gna.onclick = () => {
        apply({ not_assessable: 1, score: null });
        block.querySelectorAll('.g_score').forEach((x)=>x.classList.remove('sel'));
        gna.classList.add('sel');
      };
      const gev = block.querySelector('.g_ev'); if (gev) gev.oninput = () => apply({ evidence: gev.value });
      const gj = block.querySelector('.g_just'); if (gj) gj.oninput = () => apply({ justification: gj.value });
    });

    // Modo detalhado: por pergunta.
    document.querySelectorAll('.q-block[data-sq]').forEach((block) => {
      const sq = Number(block.dataset.sq);
      const a = answers[sq];
      block.querySelectorAll('.a_score').forEach((b) => b.onclick = () => {
        a.score = Number(b.dataset.n); a.not_assessable = 0;
        block.querySelectorAll('.a_score').forEach((x)=>x.classList.toggle('sel', x===b));
        block.querySelector('.a_na').classList.remove('sel');
      });
      const naBtn = block.querySelector('.a_na');
      if (naBtn) naBtn.onclick = () => {
        a.not_assessable = 1; a.score = null;
        block.querySelectorAll('.a_score').forEach((x)=>x.classList.remove('sel'));
        naBtn.classList.add('sel');
      };
      const sum = block.querySelector('.a_sum'); if (sum) sum.oninput = () => a.answer_summary = sum.value;
      const evv = block.querySelector('.a_ev'); if (evv) evv.oninput = () => a.evidence = evv.value;
      const just = block.querySelector('.a_just'); if (just) just.oninput = () => a.justification = just.value;
      const notes = block.querySelector('.a_notes'); if (notes) notes.oninput = () => a.notes = notes.value;
      const amend = block.querySelector('.a_amend');
      if (amend) amend.onclick = () => amendAnswer(ev.id, sq, block);
    });

    const tm = el('toggleMode'); if (tm) tm.onclick = () => { quickMode = !quickMode; render(); };
    const sd = el('saveDraft'); if (sd) sd.onclick = async () => {
      try { await api('PUT', `/evaluations/${ev.id}/answers`, { answers: collect() }); render(flash('Rascunho salvo.')); }
      catch (e) { render(flash(e.message, 'error')); }
    };
    const se = el('submitEval'); if (se) se.onclick = async () => {
      try {
        await api('PUT', `/evaluations/${ev.id}/answers`, { answers: collect() });
        await api('POST', `/evaluations/${ev.id}/submit`, {});
        location.reload();
      } catch (e) {
        render(flash(e.message + (e.data?.problems ? ' — ' + e.data.problems.length + ' pendência(s)' : ''), 'error'));
      }
    };
  }
  render();
}

function amendAnswer(evId, sq, block) {
  const na = block.querySelector('.a_na').classList.contains('sel');
  const scoreBtn = block.querySelector('.a_score.sel');
  modal(`<h3>Emendar resposta</h3>
    <p class="muted">Alterações após o envio exigem justificativa e ficam registradas na auditoria. As notas originais são preservadas no histórico.</p>
    <label>Nova nota</label>
    <div class="score-btns" id="am_scores">${[1,2,3,4,5].map((n)=>`<button data-n="${n}" class="${scoreBtn&&Number(scoreBtn.dataset.n)===n?'sel':''}">${n}</button>`).join('')}
      <button id="am_na" class="${na?'sel':''}">N/A</button></div>
    <label>Justificativa da nota</label><textarea id="am_just">${esc(block.querySelector('.a_just').value)}</textarea>
    <label>Motivo da alteração (obrigatório)</label><textarea id="am_reason"></textarea>
    <div id="amErr"></div>
    <div class="row" style="margin-top:12px"><button id="saveAmend">Salvar emenda</button><button class="ghost" onclick="closeModal()">Cancelar</button></div>`);
  let newScore = scoreBtn ? Number(scoreBtn.dataset.n) : null, newNa = na;
  el('am_scores').querySelectorAll('button[data-n]').forEach((b)=>b.onclick=()=>{ newScore=Number(b.dataset.n); newNa=false;
    el('am_scores').querySelectorAll('button').forEach((x)=>x.classList.toggle('sel',x===b)); });
  el('am_na').onclick = () => { newNa=true; newScore=null; el('am_scores').querySelectorAll('button').forEach((x)=>x.classList.toggle('sel',x===el('am_na'))); };
  el('saveAmend').onclick = async () => {
    try {
      await api('POST', `/evaluations/${evId}/amend`, { script_question_id: sq, score: newScore, not_assessable: newNa, justification: el('am_just').value, reason: el('am_reason').value });
      closeModal(); location.reload();
    } catch (e) { el('amErr').innerHTML = flash(e.message, 'error'); }
  };
}

// ================= IMPORT (planilha) =================
views.import = async () => {
  setMain(`
    <div class="topbar"><h2>Importar planilha de processo seletivo</h2></div>
    <div class="card">
      <p class="muted">Selecione a planilha (.xlsx). O sistema lê as abas Painel, Pipeline e
      Avaliação Entrevista para criar a <strong>vaga</strong> (requisitos), as
      <strong>competências com pesos</strong> e os <strong>candidatos</strong>.</p>
      <input type="file" id="xlsxFile" accept=".xlsx,.xls" />
      <div id="impErr"></div>
    </div>
    <div id="impPreview"></div>`);
  el('xlsxFile').onchange = onPickFile;
};

let importPayload = null; // { data(base64), job, competencies, candidates }

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',').pop());
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function onPickFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  el('impErr').innerHTML = '';
  el('impPreview').innerHTML = '<div class="muted">Lendo planilha…</div>';
  try {
    const data = await readFileAsBase64(file);
    const parsed = await api('POST', '/import/preview', { data });
    importPayload = { data, job: parsed.job, competencies: parsed.competencies.map((c) => ({ ...c })), candidates: parsed.candidates };
    renderImportPreview(parsed.warnings);
  } catch (err) {
    el('impPreview').innerHTML = '';
    el('impErr').innerHTML = flash(err.message, 'error');
  }
}

function renderImportPreview(warnings) {
  const p = importPayload;
  const total = p.competencies.reduce((s, c) => s + Number(c.weight || 0), 0);
  el('impPreview').innerHTML = `
    ${(warnings && warnings.length) ? `<div class="error">${warnings.map(esc).join('<br>')}</div>` : ''}
    <div class="grid2">
      <div class="card"><h3>Vaga</h3>
        <label>Título</label><input id="imp_title" value="${esc(p.job.title)}" />
        <div class="grid2"><div><label>Área</label><input id="imp_area" value="${esc(p.job.area || '')}" /></div>
          <div><label>Nota mínima</label><input id="imp_min" type="number" value="${p.job.min_score || 0}" /></div></div>
        <label>Requisitos obrigatórios</label><textarea id="imp_req">${esc(p.job.required_requirements || '')}</textarea>
        <label>Diferenciais</label><textarea id="imp_des">${esc(p.job.desired_requirements || '')}</textarea>
        <label>Responsabilidades</label><textarea id="imp_resp">${esc(p.job.responsibilities || '')}</textarea>
      </div>
      <div class="card"><div class="row"><h3>Competências & pesos</h3><span class="spacer"></span>
        <span class="chip ${Math.abs(total-100)<0.01?'ok':'danger'}" id="imp_sum">Σ ${total}%</span></div>
        <p class="muted">Entre 4 e 6 competências; os pesos devem somar 100% (ajuste se necessário).</p>
        <div id="imp_comps">${p.competencies.map((c, i) => `
          <div class="row" style="margin-bottom:6px">
            <input class="imp_cn" data-i="${i}" value="${esc(c.name)}" />
            <input class="imp_cw" data-i="${i}" type="number" value="${c.weight}" style="width:90px" /> %
            <button class="ghost small imp_cd" data-i="${i}">✕</button>
          </div>`).join('')}</div>
        <button class="ghost small" id="imp_addc" ${p.competencies.length>=6?'disabled':''}>+ competência</button>
      </div>
    </div>
    <div class="card"><div class="row"><h3>Candidatos (${p.candidates.length})</h3></div>
      <table><thead><tr><th>Nome</th><th>E-mail</th><th>Telefone</th><th>Cidade</th></tr></thead>
      <tbody>${p.candidates.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.email||'')}</td>
        <td>${esc(c.phone||'')}</td><td>${esc(c.city||'')}</td></tr>`).join('')}</tbody></table>
    </div>
    <div id="impCommitErr"></div>
    <div class="row"><button id="imp_commit">Importar tudo</button>
      <span class="muted">Cria a vaga, ${p.competencies.length} competências e ${p.candidates.length} candidatos.</span></div>`;

  const syncComps = () => {
    el('impPreview').querySelectorAll('.imp_cn').forEach((n) => p.competencies[Number(n.dataset.i)].name = n.value);
    el('impPreview').querySelectorAll('.imp_cw').forEach((w) => p.competencies[Number(w.dataset.i)].weight = Number(w.value));
  };
  el('impPreview').querySelectorAll('.imp_cw').forEach((w) => w.oninput = () => { syncComps(); renderImportPreview(warnings); });
  el('impPreview').querySelectorAll('.imp_cd').forEach((b) => b.onclick = () => { syncComps(); p.competencies.splice(Number(b.dataset.i), 1); renderImportPreview(warnings); });
  el('imp_addc').onclick = () => { syncComps(); p.competencies.push({ name: 'Nova competência', weight: 0 }); renderImportPreview(warnings); };

  el('imp_commit').onclick = async () => {
    syncComps();
    const job = { ...p.job, title: el('imp_title').value, area: el('imp_area').value,
      min_score: Number(el('imp_min').value), required_requirements: el('imp_req').value,
      desired_requirements: el('imp_des').value, responsibilities: el('imp_resp').value };
    try {
      const r = await api('POST', '/import/commit', { data: p.data, job, competencies: p.competencies, candidates: p.candidates });
      importPayload = null;
      setMain(`${flash(`Importação concluída: vaga criada com ${r.competencies_created} competências e ${r.candidates_created} candidatos.`)}
        <div class="row"><button onclick="location.hash='jobs/${r.job_id}'">Abrir vaga</button>
        <button class="ghost" onclick="location.hash='candidates'">Ver candidatos</button></div>`);
    } catch (err) {
      el('impCommitErr').innerHTML = flash(err.message, 'error');
    }
  };
}

// ================= REPORTS =================
views.reports = async (rest) => {
  const jobs = await api('GET', '/jobs');
  const jobId = rest[0] ? Number(rest[0]) : (jobs[0] && jobs[0].id);
  setMain(`
    <div class="topbar"><h2>Relatórios & Comparação</h2>
      <select id="repJob" style="width:280px">${jobs.map((j)=>`<option value="${j.id}" ${j.id===jobId?'selected':''}>${esc(j.title)}</option>`).join('')}</select></div>
    <div id="repBody"></div>`);
  el('repJob').onchange = () => location.hash = 'reports/' + el('repJob').value;
  if (!jobId) { el('repBody').innerHTML = '<div class="muted">Nenhuma vaga.</div>'; return; }
  const comp = await api('GET', `/reports/jobs/${jobId}/comparison`);
  const compNames = comp.results[0] ? comp.results[0].competencies.map((c) => c.name) : [];
  el('repBody').innerHTML = `
    <div class="card"><div class="row"><h3>Comparação de candidatos</h3><span class="spacer"></span>
      <a href="/api/reports/jobs/${jobId}/export.csv" id="csvLink"><button class="ghost small">Exportar CSV</button></a></div>
      <div class="muted">Nota mínima da vaga: ${comp.job.min_score}</div>
      <table><thead><tr><th>#</th><th>Candidato</th>${compNames.map((n)=>`<th>${esc(n)}</th>`).join('')}<th>Final</th><th>Status</th></tr></thead>
      <tbody>${comp.results.map((r,i)=>`<tr>
        <td>${i+1}</td>
        <td><a onclick="location.hash='candidates/${r.candidate.id}'" style="cursor:pointer">${esc(r.candidate.name)}</a></td>
        ${r.competencies.map((c)=>`<td>${c.assessed?round2(c.average):'<span class="muted">N/A</span>'}${c.divergence?' <span class="chip danger">div</span>':''}</td>`).join('')}
        <td><strong>${r.complete?round2(r.final_score):'<span class="muted">pend.</span>'}</strong></td>
        <td>${r.meets_min_score==null?'<span class="chip warn">incompleto</span>':(r.meets_min_score?'<span class="chip ok">atende</span>':'<span class="chip danger">abaixo</span>')}</td>
      </tr>`).join('') || `<tr><td colspan="9" class="muted">Sem candidatos.</td></tr>`}</tbody></table>
      <div class="muted" style="margin-top:8px">"div" indica divergência relevante entre entrevistadores. "pend." = competência obrigatória sem avaliação.</div>
    </div>`;
  // Garante header de auth no download via fetch.
  const link = el('csvLink');
  if (link) link.onclick = async (e) => {
    e.preventDefault();
    const res = await fetch(`/api/reports/jobs/${jobId}/export.csv`, { headers: { Authorization: 'Bearer ' + state.token } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `vaga_${jobId}_comparacao.csv`; a.click();
    URL.revokeObjectURL(url);
  };
};

// ================= USERS =================
views.users = async () => {
  const users = await api('GET', '/users');
  setMain(`<div class="topbar"><h2>Usuários</h2><button id="newUser">Novo usuário</button></div>
    <div class="card"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th><th></th></tr></thead>
    <tbody>${users.map((u)=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
      <td>${ROLE_LABELS[u.role]}</td><td><span class="chip ${u.status==='ativo'?'ok':'danger'}">${u.status}</span></td>
      <td><button class="ghost small" data-edit="${u.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`);
  el('newUser').onclick = () => userForm(null);
  el('main').querySelectorAll('[data-edit]').forEach((b)=>b.onclick=()=>userForm(users.find((u)=>u.id===Number(b.dataset.edit))));
};

function userForm(u) {
  const roles = Object.keys(ROLE_LABELS);
  modal(`<h3>${u?'Editar':'Novo'} usuário</h3>
    <label>Nome</label><input id="u_name" value="${esc(u?.name||'')}" />
    <label>E-mail</label><input id="u_email" value="${esc(u?.email||'')}" ${u?'disabled':''} />
    <label>Perfil</label><select id="u_role">${roles.map((r)=>`<option value="${r}" ${u?.role===r?'selected':''}>${ROLE_LABELS[r]}</option>`).join('')}</select>
    ${u?`<label>Status</label><select id="u_status"><option value="ativo" ${u.status==='ativo'?'selected':''}>ativo</option><option value="inativo" ${u.status==='inativo'?'selected':''}>inativo</option></select>`:''}
    <label>Senha ${u?'(deixe em branco para manter)':''}</label><input id="u_pass" type="password" />
    <div id="uErr"></div>
    <div class="row" style="margin-top:12px"><button id="saveUser">Salvar</button><button class="ghost" onclick="closeModal()">Cancelar</button></div>`);
  el('saveUser').onclick = async () => {
    try {
      if (u) {
        const body = { name: el('u_name').value, role: el('u_role').value, status: el('u_status').value };
        if (el('u_pass').value) body.password = el('u_pass').value;
        await api('PATCH', '/users/' + u.id, body);
      } else {
        await api('POST', '/users', { name: el('u_name').value, email: el('u_email').value, role: el('u_role').value, password: el('u_pass').value });
      }
      closeModal(); views.users();
    } catch (e) { el('uErr').innerHTML = flash(e.message, 'error'); }
  };
}

// ================= AUDIT =================
views.audit = async () => {
  const logs = await api('GET', '/audit?limit=300');
  setMain(`<div class="topbar"><h2>Trilha de Auditoria</h2></div>
    <div class="card"><table><thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>Motivo</th><th></th></tr></thead>
    <tbody>${logs.map((a)=>`<tr><td>${fmtDateTime(a.created_at)}</td><td>${esc(a.user_name||'—')}</td>
      <td><span class="tag">${esc(a.action)}</span></td><td>${esc(a.entity||'')} ${a.entity_id||''}</td>
      <td>${esc(a.reason||'')}</td>
      <td>${a.old_value||a.new_value?`<button class="ghost small" data-log='${esc(JSON.stringify({o:a.old_value,n:a.new_value}))}'>Ver</button>`:''}</td>
    </tr>`).join('')}</tbody></table></div>`);
  el('main').querySelectorAll('[data-log]').forEach((b)=>b.onclick=()=>{
    const d = JSON.parse(b.dataset.log);
    modal(`<div class="row"><h3>Detalhe da alteração</h3><span class="spacer"></span><button class="ghost small" onclick="closeModal()">Fechar</button></div>
      <label>Valor anterior</label><pre style="white-space:pre-wrap">${esc(d.o||'—')}</pre>
      <label>Novo valor</label><pre style="white-space:pre-wrap">${esc(d.n||'—')}</pre>`);
  });
};

window.closeModal = closeModal;
boot();
