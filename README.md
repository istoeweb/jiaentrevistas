# Sistema de Avaliação Estruturada de Entrevistas (MVP)

Sistema web para planejar entrevistas, aplicar perguntas padronizadas, registrar
evidências, calcular pontuações ponderadas e comparar candidatos com critérios
objetivos ligados ao cargo.

**Stack:** Node.js + Express + **PostgreSQL** (driver `pg`, compatível com
**Supabase**) + front-end em HTML/CSS/JS puro. Autenticação JWT com controle de
acesso por perfil.

## Requisitos

- Node.js 18+ (testado no Node 24).
- Um banco **PostgreSQL** — local (ex.: Docker) ou **Supabase**.

## Configuração do banco (`.env`)

Copie `.env.example` para `.env` e defina a `DATABASE_URL`.

```powershell
Copy-Item .env.example .env
```

**Postgres local com Docker:**

```powershell
docker run -d --name jia-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=jia -p 5433:5432 postgres:16
# .env -> DATABASE_URL=postgres://postgres:postgres@localhost:5433/jia
```

**Supabase:** no painel do projeto, em *Database → Connection string*, copie a
string (prefira o *Connection Pooler*, porta 6543) e coloque em `DATABASE_URL`.
O SSL é habilitado automaticamente para hosts remotos.

## Instalação e execução

```powershell
npm install
npm run seed     # cria o schema e popula usuários/competências/perguntas
npm start        # sobe o servidor em http://localhost:3000
```

O schema é criado automaticamente (idempotente) no `seed` e no `start`.
Acesse http://localhost:3000 e faça login.

### Usuários de exemplo (após o seed)

| Perfil        | E-mail                | Senha       |
|---------------|-----------------------|-------------|
| Administrador | admin@empresa.com     | admin123    |
| RH/Recrutador | rh@empresa.com        | rh123       |
| Entrevistador | igor@empresa.com      | entrev123   |
| Entrevistador | bea@empresa.com       | entrev123   |
| Gestor        | gestor@empresa.com    | gestor123   |
| Auditor       | auditor@empresa.com   | auditor123  |

## Testes de aceite

```powershell
# Aponte para um banco de teste isolado antes de rodar:
$env:DATABASE_URL='postgres://postgres:postgres@localhost:5433/jia_test'
node src\seed.js; npm test
```

O teste em [`test/acceptance.test.js`](test/acceptance.test.js) valida os 10
critérios de aceite do MVP via API.

## Fluxo principal

1. **RH** cria a vaga → define de 4 a 6 competências com pesos que somam 100%.
2. Monta o **roteiro** com perguntas (STAR/CAR/SOAR/situacional/incidente crítico/
   Topgrading) e o **congela** (versão imutável com snapshot dos pesos).
3. Cadastra **candidatos** e agenda **entrevistas** — todos recebem o mesmo roteiro.
4. Cada **entrevistador** registra resumo, evidências, nota 1–5 ou N/A e
   justificativa; salva como rascunho e depois **envia** (fica bloqueado).
   O formulário tem dois modos: **rápido** (uma nota + justificativa por
   competência, aplicadas às suas perguntas) e **detalhado** (pergunta a pergunta),
   alternáveis por um botão.
5. O sistema calcula: `nota média da competência`, `(média ÷ 5) × peso` e a
   `pontuação final` (soma). Só há pontuação final quando todas as competências
   obrigatórias têm nota.
6. **RH/Gestor** consolidam, comparam candidatos, exportam CSV e registram a
   **decisão** (responsável, data e justificativa) sem alterar as notas originais.

## Importação de planilha (.xlsx)

RH/Admin podem importar um processo seletivo existente pela tela **Importar
planilha**. O parser lê o layout SENAI-SP / Jornada de IA:

| Aba da planilha        | O que é importado                                               |
|------------------------|-----------------------------------------------------------------|
| **Painel**             | Vaga: título, área, requisitos obrigatórios/desejáveis, atividades (responsabilidades), soft skills |
| **Avaliação Entrevista** | Competências (critérios 0–3) com pesos e nota de corte (normalizada para 0–100) |
| **Pipeline**           | Candidatos: nome, e-mail, telefone, cidade/UF                   |

Fluxo: selecionar o arquivo → **pré-visualização editável** (título, pesos das
competências ajustáveis para somar 100%, lista de candidatos) → **Importar tudo**.
São criados a vaga, as competências vinculadas com peso, uma pergunta recomendada
(STAR) por competência e todos os candidatos. Endpoints: `POST /api/import/preview`
e `POST /api/import/commit` (arquivo em base64 no campo `data`).

> Campos sensíveis que não devem influenciar a avaliação (ex.: idade, sexo) **não**
> são importados, em linha com os princípios de LGPD e não-viés do sistema.

## Regras de negócio implementadas

- Pesos das competências devem somar 100% e ficam **travados** após congelar o
  roteiro ou após a primeira avaliação enviada.
- Toda nota exige **justificativa**; N/A ("não foi possível avaliar") **nunca**
  vira zero e é contabilizado separadamente.
- Avaliações são **independentes** — as notas dos demais ficam ocultas até o envio.
- Avaliação enviada fica **bloqueada**; alterações posteriores são **emendas** que
  exigem justificativa e ficam na **trilha de auditoria**.
- Divergências relevantes entre entrevistadores são sinalizadas no relatório.
- Controle de acesso por perfil (ex.: entrevistador não vê relatórios
  consolidados; auditor é somente leitura e não registra decisões).
- Arredondamento apenas na exibição final.

## Estrutura

```
server.js              # bootstrap do Express e montagem das rotas
src/db.js              # conexão Postgres (pool pg) + schema + camada async
src/auth.js            # JWT + middlewares de RBAC
src/audit.js           # registro de auditoria
src/import.js          # parser da planilha .xlsx (vaga, competências, candidatos)
src/scoring.js         # cálculo de médias e pontuação ponderada
src/seed.js            # dados iniciais
src/routes/*.js        # APIs: auth, users, competencies, questions, jobs,
                       #        scripts, candidates, evaluations, reports,
                       #        decisions, audit, import
public/                # front-end (index.html, app.js, styles.css)
test/acceptance.test.js
```

## Fora do escopo do MVP

Análise de vídeo/voz/emoções, geração automática de notas por IA, decisão
automática de contratação, integração com folha, testes psicológicos e portal
público de candidatura — conforme especificação.

## Notas de segurança / LGPD

Autenticação e RBAC, senhas com hash (bcrypt), trilha de auditoria e cabeçalhos
básicos de segurança estão implementados. Para produção, adicionar TLS
(criptografia em trânsito), criptografia em repouso, política de retenção/exclusão
de dados, backup/recuperação e revisão de conformidade LGPD.
