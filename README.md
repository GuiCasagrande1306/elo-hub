# Elo Hub

Sistema de gestão para agência de marketing 360: performance de mídia paga,
operação de tarefas e relatórios automatizados com envio por WhatsApp.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 ·
shadcn/ui (Base UI) · Supabase (Postgres + Auth + Realtime + Storage) ·
Motion · Recharts · TipTap · dnd-kit · @react-pdf/renderer

---

## Rodando

```bash
npm install && npm run dev
```

Abre em `http://localhost:5210`. **Sem nenhuma configuração, o sistema sobe em
modo demo**: autenticação desligada e um dataset de exemplo com 4 clientes,
120 dias de métricas, 11 tarefas e 6 criativos. É o suficiente para avaliar a
interface inteira e gerar PDFs de verdade.

Para conectar ao banco real, copie `.env.example` para `.env.local` e preencha
as credenciais do Supabase — o modo é derivado da presença delas, não há flag
para virar.

### Provisionando o Supabase

```bash
npx supabase login
npx supabase link --project-ref <ref-do-projeto>
npx supabase db push
```

`db push` aplica as três migrations na ordem do timestamp do nome. Depois,
para provar que o isolamento entre colaboradores funciona (sem saída = passou):

```bash
psql "$DATABASE_URL" -f supabase/tests/rls.sql
```

O **primeiro usuário cadastrado vira admin** automaticamente; os seguintes
entram como colaboradores.

---

## Estrutura

```
supabase/
  migrations/
    20260803000001_schema.sql    tabelas, enums, índices, triggers
    20260803000002_rls.sql       policies + funções de autorização
    20260803000003_realtime_storage.sql
  tests/rls.sql                  asserções de isolamento entre usuários

src/
  proxy.ts                       ← "middleware" (renomeado no Next 16):
                                   renova sessão e barra rota privada

  app/
    layout.tsx                   fontes, tema, Toaster
    login/                       autenticação
    (app)/                       grupo autenticado (shell + sidebar)
      layout.tsx
      page.tsx                   visão geral consolidada
      clientes/[slug]/page.tsx   ← dashboard do cliente
      tarefas/
        page.tsx
        actions.ts               Server Actions do módulo de tarefas
      relatorios/
        page.tsx                 templates + histórico
        novo/page.tsx            composição e envio
      performance/               comparação da carteira
      configuracoes/             equipe, papéis, integrações
    api/
      reports/generate/route.ts  ← pipeline PDF + WhatsApp
      reports/preview/route.ts   PDF sem gravar nada
      cron/sync-ads/route.ts     ← rodada de sync (protegida por CRON_SECRET)

  components/
    dashboard/                   ClientDashboard, KpiCard, Sparkline,
                                 TrendChart, PlatformSplit, AdGallery
    tasks/                       Board (Kanban), List, Dialog, editor
    reports/                     ReportComposer
    layout/                      AppShell, Sidebar, PageHeader
    ui/                          shadcn/ui

  lib/
    env.ts                       modo demo vs. real, segredos de servidor
    data.ts                      camada de acesso — TODA leitura sob RLS
    format.ts                    pt-BR; centavos → moeda numa borda só
    metrics/kpi.ts               ← motor de KPI e semântica de tendência
    reports/
      payload.ts                 congela os números do relatório
      orchestrator.ts            ← máquina de estados da geração/envio
      pdf/document.tsx           documento em @react-pdf/renderer
      pdf/render.ts              adaptadores react-pdf | puppeteer
    ads/
      normalize.ts               micros/decimal → centavos; guarda de moeda
      google-ads.ts              searchStream + OAuth refresh
      meta-ads.ts                Graph Insights + paginação
      sync.ts                    ← orquestrador da rodada
    whatsapp/index.ts            Cloud API (oficial) | Evolution
    supabase/{client,server,admin}.ts
    mock/data.ts                 dataset determinístico do modo demo

  hooks/use-realtime.ts          assinatura + revalidação no servidor
  types/database.ts              tipos de domínio
```

---

## Decisões que sustentam o sistema

### A autorização vive no banco, não na aplicação

Toda leitura passa por `src/lib/data.ts`, que usa o cliente Supabase com a
chave anon e o JWT do usuário. Nenhuma página tem `if (role === "admin")`
decidindo o que mostrar: a query simplesmente volta filtrada.

A consequência prática é que **Server Actions não precisam checar permissão**.
Um `UPDATE` numa linha que o usuário não pode ver atinge zero linhas — sem
erro, sem efeito. Isso continua valendo se alguém chamar a action fora da
interface, o que uma checagem na aplicação não garante.

Regra implementada para colaborador: **a tarefa só existe se ele estiver em
`task_assignees`**. Ter acesso ao cliente não basta — é assim que colegas de
conta não veem tarefa um do outro.

`integration_secrets` (tokens de Google/Meta) tem RLS ligada e **nenhuma
policy**: nem um admin logado alcança os tokens via API. Só o backend, com
`service_role`.

### Um único motor de métrica alimenta tela e PDF

`src/lib/metrics/kpi.ts` é a única fonte de cálculo. O dashboard e o
renderizador de PDF chamam as mesmas funções, então o relatório enviado ao
cliente não tem como divergir do que o gestor vê no painel.

Duas regras moram ali:

- **`betterWhen`** — a cor da tendência segue a interpretação do indicador,
  não o sinal do número. CPA subindo 12% aparece em vermelho, mesmo sendo
  variação positiva.
- **Base zero não vira infinito** — período anterior zerado devolve `null`, e
  a interface escreve "sem base de comparação" em vez de "+∞%".

### O relatório é congelado, não recalculado

As plataformas reprocessam dados (a Meta ajusta conversões por até 28 dias).
O payload inteiro é gravado em `report_history.snapshot` antes da renderização,
o que torna o relatório auditável e imune a reprocessamento.

O pipeline persiste **cada transição** de estado antes de executá-la:

```
queued → generating → ready → sending → sent
             ↓           ↓        ↓
           failed     failed   failed
```

Falha no envio não destrói o PDF: `storage_path` continua válido, então
reenviar não exige gerar de novo.

### Dinheiro em centavos

Inteiro em todo o sistema — banco, API e estado. A divisão por 100 acontece
uma única vez, em `src/lib/format.ts`. Elimina a classe inteira de bugs de
arredondamento em soma de gasto de mídia.

Nas integrações isso exige atenção: a Meta manda `spend` como string decimal
(`"123.45"`), o Google manda `cost_micros` (1 real = 1.000.000). As duas
conversões estão comentadas nas rotas de sync.

---

## PWA

Instalável em iOS e Android. Feito com o suporte nativo do Next
(`app/manifest.ts` + `public/sw.js` + registro no cliente), **sem plugin**.

`@ducanh2912/next-pwa` foi descartado por incompatibilidade real, não por
preferência: ele depende de `workbox-webpack-plugin`, e o Next 16 usa
Turbopack por padrão — o hook `webpack()` do next.config não roda nesse
caminho. O plugin não daria erro, apenas não geraria service worker nenhum.

**O service worker não faz cache de dados, de propósito.** Este é um painel
financeiro: mostrar um investimento desatualizado sem aviso é pior que
mostrar erro, porque vira decisão errada de verba. O SW guarda só a casca
e os assets versionados do Next (`/_next/static/*`, imutáveis por hash), e
ignora `/api/*` por completo — que também evita servir dado de uma sessão
para outra depois de troca de usuário no mesmo aparelho. Sem rede, a
navegação cai em `/offline`, que diz claramente o que houve.

Ícones em `public/icon-*.png` (`any` + `maskable`) e `src/app/apple-icon.png`
(convenção de metadados do Next, gera o `<link rel="apple-touch-icon">`).
Para regerar: `bash scripts/make-icons.sh` (macOS). O desenho é
geométrico (retângulos), sem dependência de fonte instalada.

## Notas de integração

**WhatsApp.** Dois provedores atrás da mesma interface. A Cloud API oficial só
permite iniciar conversa fora da janela de 24h com **template aprovado** — e
relatório mensal quase sempre cai fora dessa janela, então o fluxo real é
template primeiro, documento depois (`sendTemplateMessage`). A Evolution API
dispensa template, mas opera sobre o WhatsApp Web e o número pode ser banido.

**PDF.** `react-pdf` é o padrão: roda em qualquer runtime Node, saída vetorial,
sem binário externo. `PDF_ENGINE=puppeteer` troca para renderização de HTML com
Chromium, com fidelidade visual maior e custo operacional maior. A dependência
é opcional e carregada em runtime — o projeto compila sem ela.

A fonte do PDF é a Helvetica embutida, que usa codificação WinAnsi e **não tem
glifos como ▲/▼** (saem como "²" e "¼"). Para usar Inter ou Satoshi, registrar
o `.ttf` a partir do disco — nunca por URL, porque uma falha de rede derrubaria
a geração inteira.

**Google Ads / Meta Ads.** As rotas de sync estão estruturadas com o contrato,
a query GAQL e o mapeamento para `daily_metrics` prontos; a chamada real está
atrás da checagem de credenciais e degrada com resposta explícita. Ativar
quando o developer token do Google e o `ads_read` da Meta forem aprovados.

---

## O que ainda não está pronto

- **Busca global (⌘K)** — o gatilho existe na topbar, sem implementação.
- **Comentários em tarefa** — tabela, RLS e contador prontos; falta a UI.
- **Convite de usuário** — o provisionamento acontece no signup; não há tela
  para convidar alguém e atribuir contas.
- **Página `/relatorios/[id]/print`** — necessária apenas se adotar o motor
  Puppeteer.
- **Agregação da visão geral** — hoje é uma query por cliente em paralelo.
  Com carteira grande, virar uma RPC agregada no Postgres.
