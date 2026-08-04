/**
 * Dataset de demonstração.
 *
 * Existe para que a interface rode e possa ser avaliada antes de haver
 * um projeto Supabase provisionado. Assim que `.env.local` recebe as
 * credenciais, `src/lib/data.ts` deixa de olhar para este arquivo.
 *
 * ⚠️ Determinismo é obrigatório: gerador com semente fixa, nunca
 * `Math.random()`. Valor diferente entre servidor e cliente produz erro
 * de hidratação no React.
 */

import type {
  AdCreative,
  AdPlatform,
  Client,
  ClientGoal,
  DailyMetric,
  Profile,
  Project,
  ReportHistory,
  ReportTemplate,
  TaskWithRelations,
} from "@/types/database";

/* ------------------------------------------------------------------ */
/* Gerador pseudoaleatório determinístico (mulberry32)                  */
/* ------------------------------------------------------------------ */

function seeded(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Data-base fixa no início do dia — evita divergência servidor/cliente. */
const TODAY = (() => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
})();

function daysAgo(n: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function daysAhead(n: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return d.toISOString();
}

/* ------------------------------------------------------------------ */
/* Equipe                                                              */
/* ------------------------------------------------------------------ */

export const demoProfiles: Profile[] = [
  {
    id: "u-admin",
    email: "guilherme@marketingelo.com.br",
    full_name: "Guilherme Casagrande",
    avatar_url: null,
    job_title: "Head de Performance",
    role: "admin",
    is_active: true,
    created_at: daysAgo(400),
  },
  {
    id: "u-marina",
    email: "marina@marketingelo.com.br",
    full_name: "Marina Duarte",
    avatar_url: null,
    job_title: "Gestora de Tráfego",
    role: "collaborator",
    is_active: true,
    created_at: daysAgo(220),
  },
  {
    id: "u-rafael",
    email: "rafael@marketingelo.com.br",
    full_name: "Rafael Nogueira",
    avatar_url: null,
    job_title: "Designer",
    role: "collaborator",
    is_active: true,
    created_at: daysAgo(180),
  },
  {
    id: "u-bea",
    email: "beatriz@marketingelo.com.br",
    full_name: "Beatriz Lima",
    avatar_url: null,
    job_title: "Social Media",
    role: "collaborator",
    is_active: true,
    created_at: daysAgo(90),
  },
];

export const demoCurrentUser: Profile = demoProfiles[0];

/* ------------------------------------------------------------------ */
/* Clientes                                                            */
/* ------------------------------------------------------------------ */

export const demoClients: Client[] = [
  {
    id: "c-verdi",
    name: "Verdi Cosméticos",
    legal_name: "Verdi Indústria de Cosméticos Ltda.",
    tax_id: "12.345.678/0001-90",
    slug: "verdi",
    segment: "ecommerce",
    status: "active",
    logo_url: null,
    brand_primary: "#2F6F4E",
    brand_secondary: "#E8D9C0",
    brand_font: "Inter",
    website: "https://verdicosmeticos.com.br",
    contact_name: "Juliana Verdi",
    contact_email: "juliana@verdicosmeticos.com.br",
    whatsapp_phone: "+5548999110022",
    persona: {
      summary:
        "Mulheres de 28 a 45 anos, classe B, que buscam skincare natural e valorizam origem dos ingredientes.",
      age_range: "28–45",
      pains: ["Pele sensível", "Produtos com química pesada"],
      desires: ["Rotina simples", "Marca com propósito"],
      objections: ["Preço acima da farmácia", "Dúvida se funciona"],
      tone_of_voice: "Acolhedor, técnico na medida",
      main_offer: "Kit Rotina Completa",
      average_ticket_cents: 18900,
    },
    monthly_fee_cents: 450000,
    contract_start: daysAgo(300),
    report_day: 5,
    report_enabled: true,
    owner_id: "u-admin",
    created_at: daysAgo(300),
  },
  {
    id: "c-atlas",
    name: "Atlas Odontologia",
    legal_name: "Clínica Atlas Odontologia S/S",
    tax_id: "98.765.432/0001-10",
    slug: "atlas",
    segment: "local_business",
    status: "active",
    logo_url: null,
    brand_primary: "#1E4E8C",
    brand_secondary: "#F2F5F9",
    brand_font: "Inter",
    website: "https://atlasodonto.com.br",
    contact_name: "Dr. Henrique Atlas",
    contact_email: "contato@atlasodonto.com.br",
    whatsapp_phone: "+5548999220033",
    persona: {
      summary:
        "Adultos 30–55 da Grande Florianópolis buscando implante e harmonização, sensíveis a parcelamento.",
      age_range: "30–55",
      pains: ["Medo de dentista", "Custo alto"],
      desires: ["Resultado natural", "Atendimento humanizado"],
      tone_of_voice: "Confiável e próximo",
      main_offer: "Avaliação gratuita",
      average_ticket_cents: 320000,
    },
    monthly_fee_cents: 380000,
    contract_start: daysAgo(210),
    report_day: 12,
    report_enabled: true,
    owner_id: "u-marina",
    created_at: daysAgo(210),
  },
  {
    id: "c-nord",
    name: "Nord Performance",
    legal_name: "Nord Educação Digital Ltda.",
    tax_id: "11.222.333/0001-44",
    slug: "nord",
    segment: "launch",
    status: "active",
    logo_url: null,
    brand_primary: "#111827",
    brand_secondary: "#7BF178",
    brand_font: "Inter",
    website: "https://nordperformance.com",
    contact_name: "Camila Nord",
    contact_email: "camila@nordperformance.com",
    whatsapp_phone: "+5548999330044",
    persona: {
      summary:
        "Profissionais de 25 a 40 anos que querem migrar para carreira em dados e aceitam curso online intensivo.",
      age_range: "25–40",
      pains: ["Estagnação salarial"],
      desires: ["Recolocação em 6 meses"],
      tone_of_voice: "Direto e ambicioso",
      main_offer: "Turma Q3",
      average_ticket_cents: 249700,
    },
    monthly_fee_cents: 620000,
    contract_start: daysAgo(120),
    report_day: null,
    report_enabled: false,
    owner_id: "u-admin",
    created_at: daysAgo(120),
  },
  {
    id: "c-lumen",
    name: "Lumen Arquitetura",
    legal_name: "Lumen Projetos e Arquitetura ME",
    tax_id: "55.666.777/0001-88",
    slug: "lumen",
    segment: "b2b_services",
    status: "onboarding",
    logo_url: null,
    brand_primary: "#8A6E4B",
    brand_secondary: "#FAF7F2",
    brand_font: "Inter",
    website: "https://lumenarq.com.br",
    contact_name: "Pedro Lumen",
    contact_email: "pedro@lumenarq.com.br",
    whatsapp_phone: "+5548999440055",
    persona: {
      summary: "Casais 35–50 construindo casa de alto padrão em condomínio.",
      tone_of_voice: "Sofisticado e sereno",
      main_offer: "Projeto executivo completo",
      average_ticket_cents: 4500000,
    },
    monthly_fee_cents: 290000,
    contract_start: daysAgo(25),
    report_day: null,
    report_enabled: false,
    owner_id: "u-marina",
    created_at: daysAgo(25),
  },
];

/* ------------------------------------------------------------------ */
/* Métricas diárias                                                    */
/* ------------------------------------------------------------------ */

/**
 * Gera 120 dias de histórico por cliente × plataforma.
 * A curva tem tendência, sazonalidade semanal e ruído — sem isso os
 * gráficos ficam retos e o painel não se parece com dado real.
 */
function generateMetrics(): DailyMetric[] {
  const rows: DailyMetric[] = [];

  const config: Record<
    string,
    {
      platforms: AdPlatform[];
      baseSpend: number;
      cvr: number;
      ticket: number;
      trend: number;
      seed: number;
    }
  > = {
    "c-verdi": {
      platforms: ["meta_ads", "google_ads"],
      baseSpend: 38000,
      cvr: 0.031,
      ticket: 18900,
      trend: 0.0028,
      seed: 11,
    },
    "c-atlas": {
      platforms: ["meta_ads", "google_ads"],
      baseSpend: 24000,
      cvr: 0.052,
      ticket: 0,
      trend: 0.0015,
      seed: 23,
    },
    "c-nord": {
      platforms: ["meta_ads", "google_ads"],
      baseSpend: 71000,
      cvr: 0.024,
      ticket: 249700,
      trend: 0.0045,
      seed: 37,
    },
    "c-lumen": {
      platforms: ["meta_ads"],
      baseSpend: 9500,
      cvr: 0.019,
      ticket: 0,
      trend: -0.0008,
      seed: 53,
    },
  };

  for (const [clientId, cfg] of Object.entries(config)) {
    const rand = seeded(cfg.seed);

    for (const platform of cfg.platforms) {
      // Google costuma custar mais por clique e converter melhor (intenção).
      const platformSpendFactor = platform === "google_ads" ? 0.62 : 1;
      const platformCvrFactor = platform === "google_ads" ? 1.35 : 1;

      for (let i = 119; i >= 0; i--) {
        const date = daysAgo(i);
        const dow = new Date(`${date}T12:00:00`).getDay();

        // Fim de semana rende menos em B2B/serviço, mais em e-commerce.
        const weekend = dow === 0 || dow === 6;
        const weekendFactor = weekend
          ? clientId === "c-verdi"
            ? 1.08
            : 0.72
          : 1;

        const trendFactor = 1 + cfg.trend * (119 - i);
        const noise = 0.82 + rand() * 0.36;

        const spendCents = Math.round(
          cfg.baseSpend * platformSpendFactor * weekendFactor * trendFactor * noise,
        );

        const cpcCents = Math.round((180 + rand() * 220) * (platform === "google_ads" ? 1.4 : 1));
        const clicks = Math.max(1, Math.round(spendCents / cpcCents));
        const impressions = Math.round(clicks / (0.011 + rand() * 0.014));

        const cvr = cfg.cvr * platformCvrFactor * (0.75 + rand() * 0.5);
        const conversions = Math.round(clicks * cvr * 10) / 10;

        const revenueCents =
          cfg.ticket > 0
            ? Math.round(conversions * cfg.ticket * (0.85 + rand() * 0.35))
            : 0;

        rows.push({
          id: `${clientId}-${platform}-${date}`,
          client_id: clientId,
          platform,
          metric_date: date,
          campaign_id: "_all",
          campaign_name: null,
          spend_cents: spendCents,
          impressions,
          clicks,
          conversions,
          revenue_cents: revenueCents,
        });
      }
    }
  }

  return rows;
}

export const demoMetrics: DailyMetric[] = generateMetrics();

/* ------------------------------------------------------------------ */
/* Criativos                                                           */
/* ------------------------------------------------------------------ */

/**
 * Miniaturas como SVG inline em data URI.
 * Em produção estas imagens vêm do Storage (`ad-thumbs`), copiadas da
 * Meta/Google — as URLs originais da Meta expiram em poucas horas, então
 * o relatório em PDF quebraria se apontasse direto para lá.
 */
function thumb(bg: string, fg: string, label: string, sub: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="${bg}"/><stop offset="100%" stop-color="${fg}"/>
</linearGradient></defs>
<rect width="400" height="400" fill="url(#g)"/>
<circle cx="316" cy="84" r="120" fill="#ffffff" opacity="0.10"/>
<circle cx="72" cy="330" r="86" fill="#000000" opacity="0.10"/>
<text x="36" y="214" font-family="Inter,Helvetica,Arial,sans-serif" font-size="38" font-weight="700" fill="#ffffff">${label}</text>
<text x="36" y="256" font-family="Inter,Helvetica,Arial,sans-serif" font-size="21" fill="#ffffff" opacity="0.82">${sub}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const demoCreatives: AdCreative[] = [
  {
    id: "ad-1",
    client_id: "c-verdi",
    platform: "meta_ads",
    external_ad_id: "23861234567890",
    campaign_name: "[VENDAS] Kit Rotina — Advantage+",
    ad_name: "Depoimento Juliana 30s",
    thumbnail_url: thumb("#2F6F4E", "#8FCF9E", "Kit Rotina", "Depoimento real"),
    storage_path: null,
    destination_url: "https://verdicosmeticos.com.br/kit-rotina",
    headline: "Sua pele merece uma rotina de verdade",
    primary_text:
      "3 passos, 12 minutos por dia. O Kit Rotina Completa da Verdi foi formulado para pele sensível — sem álcool, sem parabenos, com ativos que você consegue pronunciar. Frete grátis acima de R$ 199.",
    call_to_action: "Comprar agora",
    is_active: true,
    spend_cents: 412300,
    impressions: 284910,
    clicks: 6142,
    conversions: 214,
    period_start: daysAgo(29),
    period_end: daysAgo(0),
  },
  {
    id: "ad-2",
    client_id: "c-verdi",
    platform: "meta_ads",
    external_ad_id: "23861234567891",
    campaign_name: "[VENDAS] Kit Rotina — Advantage+",
    ad_name: "Carrossel Ingredientes",
    thumbnail_url: thumb("#1F5138", "#C9E7B7", "Ingredientes", "Carrossel 5 cards"),
    storage_path: null,
    destination_url: "https://verdicosmeticos.com.br/ingredientes",
    headline: "O que tem dentro importa",
    primary_text:
      "Aloe orgânica, niacinamida e óleo de pracaxi. Deslize para ver de onde vem cada ingrediente do seu skincare.",
    call_to_action: "Saiba mais",
    is_active: true,
    spend_cents: 268900,
    impressions: 201440,
    clicks: 4108,
    conversions: 121,
    period_start: daysAgo(29),
    period_end: daysAgo(0),
  },
  {
    id: "ad-3",
    client_id: "c-verdi",
    platform: "google_ads",
    external_ad_id: "pmax-8891",
    campaign_name: "PMax — Catálogo Skincare",
    ad_name: "Asset group — Rotina",
    thumbnail_url: thumb("#3B6E52", "#DCEBD4", "PMax", "Catálogo completo"),
    storage_path: null,
    destination_url: "https://verdicosmeticos.com.br",
    headline: "Skincare natural com entrega em 48h",
    primary_text:
      "Linha completa Verdi. Dermatologicamente testada, vegana e produzida em Santa Catarina.",
    call_to_action: "Ver produtos",
    is_active: true,
    spend_cents: 331200,
    impressions: 176520,
    clicks: 5390,
    conversions: 187,
    period_start: daysAgo(29),
    period_end: daysAgo(0),
  },
  {
    id: "ad-4",
    client_id: "c-atlas",
    platform: "meta_ads",
    external_ad_id: "23861234567892",
    campaign_name: "[LEADS] Implante — Raio 12km",
    ad_name: "Antes e depois — Implante",
    thumbnail_url: thumb("#1E4E8C", "#7FA8DA", "Implante", "Antes e depois"),
    storage_path: null,
    destination_url: "https://atlasodonto.com.br/implante",
    headline: "Volte a sorrir sem medo",
    primary_text:
      "Implante com anestesia computadorizada e avaliação gratuita. Parcelamos em até 24x. Atendemos toda a Grande Florianópolis.",
    call_to_action: "Agendar avaliação",
    is_active: true,
    spend_cents: 198400,
    impressions: 132880,
    clicks: 3211,
    conversions: 168,
    period_start: daysAgo(29),
    period_end: daysAgo(0),
  },
  {
    id: "ad-5",
    client_id: "c-nord",
    platform: "meta_ads",
    external_ad_id: "23861234567893",
    campaign_name: "[CAPTAÇÃO] Turma Q3 — Lookalike 1%",
    ad_name: "VSL Camila 90s",
    thumbnail_url: thumb("#111827", "#7BF178", "Turma Q3", "VSL 90 segundos"),
    storage_path: null,
    destination_url: "https://nordperformance.com/inscricao",
    headline: "De atendimento a dados em 6 meses",
    primary_text:
      "A Nord formou 1.240 alunos que migraram para a área de dados. Inscrições da Turma Q3 abertas — aula inaugural gratuita.",
    call_to_action: "Inscrever-se",
    is_active: true,
    spend_cents: 892700,
    impressions: 611200,
    clicks: 14980,
    conversions: 402,
    period_start: daysAgo(29),
    period_end: daysAgo(0),
  },
  {
    id: "ad-6",
    client_id: "c-nord",
    platform: "google_ads",
    external_ad_id: "search-4412",
    campaign_name: "Search — Curso de Dados",
    ad_name: "RSA — Marca + Genérico",
    thumbnail_url: thumb("#0B1220", "#4C6EF5", "Search", "Anúncio responsivo"),
    storage_path: null,
    destination_url: "https://nordperformance.com",
    headline: "Curso de Dados com mentoria | Nord",
    primary_text:
      "Formação completa em análise de dados. Turmas reduzidas, projeto real no portfólio.",
    call_to_action: "Ver turmas",
    is_active: true,
    spend_cents: 546100,
    impressions: 188340,
    clicks: 9822,
    conversions: 311,
    period_start: daysAgo(29),
    period_end: daysAgo(0),
  },
];

/* ------------------------------------------------------------------ */
/* Projetos e tarefas                                                  */
/* ------------------------------------------------------------------ */

export const demoProjects: Project[] = [
  {
    id: "p-verdi-blackfriday",
    client_id: "c-verdi",
    name: "Black Friday 2026",
    description: "Campanha completa: criativos, LP e mídia.",
    status: "active",
    color: "#2F6F4E",
    starts_at: daysAgo(20),
    ends_at: daysAgo(-45),
    owner_id: "u-admin",
  },
  {
    id: "p-nord-q3",
    client_id: "c-nord",
    name: "Lançamento Turma Q3",
    description: "Captação, aquecimento e carrinho.",
    status: "active",
    color: "#7BF178",
    starts_at: daysAgo(30),
    ends_at: daysAgo(-15),
    owner_id: "u-admin",
  },
  {
    id: "p-atlas-mensal",
    client_id: "c-atlas",
    name: "Operação mensal",
    description: "Rotina de mídia e conteúdo.",
    status: "active",
    color: "#1E4E8C",
    starts_at: daysAgo(210),
    ends_at: null,
    owner_id: "u-marina",
  },
];

function doc(text: string) {
  return {
    type: "doc" as const,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

interface TaskSeed {
  id: string;
  title: string;
  body: string;
  client: string;
  project: string | null;
  status: TaskWithRelations["status"];
  priority: TaskWithRelations["priority"];
  due: number | null;
  assignees: string[];
  checklist: [string, boolean][];
}

const taskSeeds: TaskSeed[] = [
  {
    id: "t-1",
    title: "Roteiro dos 4 criativos de Black Friday",
    body: "Cada roteiro precisa abrir com a dor nos 3 primeiros segundos. Referência: o depoimento da Juliana, que segurou 62% de retenção.",
    client: "c-verdi",
    project: "p-verdi-blackfriday",
    status: "in_progress",
    priority: "high",
    due: 2,
    assignees: ["u-bea", "u-rafael"],
    checklist: [
      ["Levantar objeções no SAC", true],
      ["Roteiro 1 — Prova social", true],
      ["Roteiro 2 — Antes e depois", true],
      ["Roteiro 3 — Unboxing", false],
      ["Roteiro 4 — Oferta direta", false],
    ],
  },
  {
    id: "t-2",
    title: "Subir públicos de lookalike 1% — Turma Q3",
    body: "Base de compradores dos últimos 180 dias, excluir quem já converteu na Q2.",
    client: "c-nord",
    project: "p-nord-q3",
    status: "todo",
    priority: "urgent",
    due: 0,
    assignees: ["u-marina"],
    checklist: [
      ["Exportar base do Hotmart", true],
      ["Subir na Meta", false],
      ["Criar espelho no Google", false],
    ],
  },
  {
    id: "t-3",
    title: "Revisar copy da LP de implante",
    body: "A seção de preço está gerando objeção. Testar ancoragem por parcela.",
    client: "c-atlas",
    project: "p-atlas-mensal",
    status: "review",
    priority: "medium",
    due: 4,
    assignees: ["u-bea"],
    checklist: [
      ["Reescrever headline", true],
      ["Ajustar bloco de preço", true],
      ["Aprovar com o cliente", false],
    ],
  },
  {
    id: "t-4",
    title: "Relatório mensal — Verdi Cosméticos",
    body: "Fechar números até dia 3 e enviar por WhatsApp com o resumo executivo.",
    client: "c-verdi",
    project: null,
    status: "todo",
    priority: "high",
    due: 1,
    assignees: ["u-admin"],
    checklist: [
      ["Conferir conversões no GA4", false],
      ["Escrever leitura do time", false],
      ["Gerar e enviar PDF", false],
    ],
  },
  {
    id: "t-5",
    title: "Setup de rastreamento — Lumen Arquitetura",
    body: "GTM, eventos de formulário e API de conversões da Meta.",
    client: "c-lumen",
    project: null,
    status: "backlog",
    priority: "medium",
    due: 9,
    assignees: ["u-marina"],
    checklist: [
      ["Instalar GTM", false],
      ["Mapear eventos", false],
      ["Validar CAPI", false],
    ],
  },
  {
    id: "t-6",
    title: "Ajustar orçamento das campanhas de Search",
    body: "CPA subiu 18% na semana. Realocar verba do genérico para marca.",
    client: "c-nord",
    project: "p-nord-q3",
    status: "in_progress",
    priority: "urgent",
    due: -1,
    assignees: ["u-marina", "u-admin"],
    checklist: [
      ["Analisar termos de busca", true],
      ["Negativar termos ruins", false],
      ["Rebalancear orçamento", false],
    ],
  },
  {
    id: "t-7",
    title: "Produzir 8 estáticos para remarketing",
    body: "Formato 1:1 e 4:5, com variação de headline.",
    client: "c-verdi",
    project: "p-verdi-blackfriday",
    status: "todo",
    priority: "medium",
    due: 6,
    assignees: ["u-rafael"],
    checklist: [
      ["Definir grid", true],
      ["Exportar 1:1", false],
      ["Exportar 4:5", false],
    ],
  },
  {
    id: "t-8",
    title: "Onboarding Lumen — reunião de briefing",
    body: "Coletar branding, acessos e histórico de mídia.",
    client: "c-lumen",
    project: null,
    status: "done",
    priority: "high",
    due: -6,
    assignees: ["u-marina", "u-admin"],
    checklist: [
      ["Agendar call", true],
      ["Preencher persona", true],
      ["Solicitar acessos", true],
    ],
  },
  {
    id: "t-9",
    title: "Testar 3 novas headlines no PMax",
    body: "Focar em prazo de entrega, que apareceu como principal dúvida.",
    client: "c-verdi",
    project: null,
    status: "backlog",
    priority: "low",
    due: 14,
    assignees: ["u-marina"],
    checklist: [["Escrever variações", false]],
  },
  {
    id: "t-10",
    title: "Aprovar peças da aula inaugural",
    body: "Card, stories e capa do YouTube.",
    client: "c-nord",
    project: "p-nord-q3",
    status: "review",
    priority: "high",
    due: 3,
    assignees: ["u-rafael", "u-bea"],
    checklist: [
      ["Card feed", true],
      ["Stories", true],
      ["Capa YouTube", false],
    ],
  },
  {
    id: "t-11",
    title: "Documentar processo de fechamento mensal",
    body: "Passo a passo para qualquer gestor conseguir fechar o relatório.",
    client: "c-atlas",
    project: "p-atlas-mensal",
    status: "done",
    priority: "low",
    due: -12,
    assignees: ["u-admin"],
    checklist: [
      ["Escrever fluxo", true],
      ["Revisar com o time", true],
    ],
  },
];

export const demoTasks: TaskWithRelations[] = taskSeeds.map((seed, index) => {
  const client = demoClients.find((c) => c.id === seed.client)!;
  const project = demoProjects.find((p) => p.id === seed.project) ?? null;
  const total = seed.checklist.length;
  const done = seed.checklist.filter(([, isDone]) => isDone).length;

  return {
    id: seed.id,
    client_id: seed.client,
    project_id: seed.project,
    title: seed.title,
    content: doc(seed.body),
    status: seed.status,
    priority: seed.priority,
    position: (index + 1) * 1000,
    due_date: seed.due === null ? null : daysAhead(seed.due),
    completed_at: seed.status === "done" ? daysAhead(-2) : null,
    progress:
      seed.status === "done"
        ? 100
        : total === 0
          ? 0
          : Math.round((done / total) * 100),
    created_by: "u-admin",
    created_at: daysAhead(-20),
    updated_at: daysAhead(-1),
    assignees: seed.assignees.map(
      (id) => demoProfiles.find((p) => p.id === id)!,
    ),
    checklist: seed.checklist.map(([content, isDone], i) => ({
      id: `${seed.id}-c${i}`,
      task_id: seed.id,
      content,
      is_done: isDone,
      position: (i + 1) * 1000,
    })),
    client: { id: client.id, name: client.name, brand_primary: client.brand_primary },
    project: project
      ? { id: project.id, name: project.name, color: project.color }
      : null,
    comment_count: index % 3,
  };
});

/* ------------------------------------------------------------------ */
/* Metas do mês corrente                                               */
/*                                                                     */
/* Os valores são escolhidos para exercitar TODOS os estados do card:  */
/* no ritmo, acelerado, atrasado, estourado e sem meta. Um dataset em  */
/* que tudo está verde esconde exatamente os casos que o design        */
/* precisa comunicar bem.                                              */
/* ------------------------------------------------------------------ */

/**
 * Ciclo de 30 dias iniciado há 25 — ou seja, ~83% decorrido.
 *
 * Não uso o mês-calendário de propósito: rodando a demonstração no dia 3
 * o ciclo teria 8% decorrido, todas as barras ficariam quase vazias e
 * nenhum dos estados de ritmo apareceria. Ciclo de contrato que não
 * coincide com o mês também é o caso comum numa agência.
 */
const cycleStart = daysAgo(25);
const cycleEnd = (() => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + 5);
  return d.toISOString().slice(0, 10);
})();

/** Soma o que o gerador produziu para o cliente dentro do ciclo. */
function cycleActuals(clientId: string) {
  const rows = demoMetrics.filter(
    (m) =>
      m.client_id === clientId &&
      m.metric_date >= cycleStart &&
      m.metric_date <= cycleEnd,
  );
  return {
    spend: rows.reduce((acc, r) => acc + r.spend_cents, 0),
    results: rows.reduce((acc, r) => acc + Number(r.conversions), 0),
  };
}

/**
 * As metas são DERIVADAS do executado, com um multiplicador escolhido
 * para produzir cada estado do card. É dado de demonstração construído
 * de propósito: um conjunto em que tudo está verde esconderia justamente
 * os casos que o design precisa comunicar bem.
 *
 *   Verdi → investimento no ritmo, meta de resultados superada
 *   Atlas → resultados atrasados (com override do CRM)
 *   Nord  → orçamento ESTOURADO
 *   Lumen → sem meta nenhuma
 */
function makeGoal(
  id: string,
  clientId: string,
  budgetMultiplier: number,
  resultsMultiplier: number,
  extra: Partial<ClientGoal> = {},
): ClientGoal {
  const actual = cycleActuals(clientId);
  return {
    id,
    client_id: clientId,
    period_start: cycleStart,
    period_end: cycleEnd,
    planned_budget_cents: Math.round(actual.spend * budgetMultiplier),
    planned_results: Math.round(actual.results * resultsMultiplier),
    executed_budget_cents_override: null,
    executed_results_override: null,
    override_reason: null,
    notes: null,
    created_at: cycleStart,
    ...extra,
  };
}

export const demoGoals: ClientGoal[] = [
  // Gastou ~83% do planejado com ~83% do ciclo → no ritmo.
  // Resultados acima da meta → barra verde de superação.
  makeGoal("g-verdi", "c-verdi", 1.2, 0.86, {
    notes: "Meta alinhada com a projeção de Black Friday.",
  }),

  // Meta de contatos alta demais para o ritmo atual → atrasado.
  // O override simula o CRM tendo descartado leads duplicados.
  makeGoal("g-atlas", "c-atlas", 1.18, 1.9, {
    executed_results_override: Math.round(cycleActuals("c-atlas").results * 0.62),
    override_reason: "CRM descartou contatos duplicados e spam.",
  }),

  // Planejado abaixo do que já foi gasto → estouro de orçamento.
  makeGoal("g-nord", "c-nord", 0.82, 1.05, {
    notes: "Verba extra aprovada na semana do carrinho.",
  }),

  // Lumen fica SEM meta de propósito — o card precisa ter um estado
  // digno para a conta que ainda está em onboarding.
];

/* ------------------------------------------------------------------ */
/* Relatórios                                                          */
/* ------------------------------------------------------------------ */

export const demoTemplates: ReportTemplate[] = [
  {
    id: "rt-ecom",
    name: "E-commerce — Performance & ROAS",
    description:
      "Foco em receita, ROAS e ticket médio. Quebra por campanha e galeria dos criativos que mais venderam.",
    segment: "ecommerce",
    metrics: ["spend", "revenue", "roas", "results", "cpa", "aov"],
    sections: [
      { type: "cover", title: "Relatório de Performance" },
      { type: "kpi_grid", title: "Visão geral do período" },
      {
        type: "trend_chart",
        title: "Evolução de investimento x receita",
        options: { series: ["spend", "revenue"] },
      },
      { type: "platform_split", title: "Distribuição por canal" },
      { type: "ad_gallery", title: "Criativos em destaque", options: { limit: 6 } },
      { type: "insights", title: "Leitura do time" },
      { type: "next_steps", title: "Próximos passos" },
    ],
    theme: { accent: "#7BF178", cover: "gradient" },
    is_default: true,
    is_archived: false,
  },
  {
    id: "rt-local",
    name: "Negócio Local — Geração de Contatos",
    description:
      "Volume de contatos, custo por contato e alcance geográfico. Ideal para clínicas, serviços e varejo físico.",
    segment: "local_business",
    metrics: ["spend", "results", "cpa", "reach", "ctr"],
    sections: [
      { type: "cover", title: "Relatório de Resultados" },
      { type: "kpi_grid", title: "Resumo do mês" },
      { type: "trend_chart", title: "Contatos por dia", options: { series: ["results"] } },
      { type: "platform_split", title: "De onde vieram os contatos" },
      { type: "ad_gallery", title: "Anúncios no ar", options: { limit: 4 } },
      { type: "insights", title: "O que observamos" },
      { type: "next_steps", title: "Plano para o próximo ciclo" },
    ],
    theme: { accent: "#7BF178", cover: "solid" },
    is_default: true,
    is_archived: false,
  },
  {
    id: "rt-launch",
    name: "Lançamento — Captação & Conversão",
    description:
      "Estrutura por fase do lançamento, com CPL e CAC por etapa.",
    segment: "launch",
    metrics: ["spend", "leads", "cpl", "results", "cpa", "roas"],
    sections: [
      { type: "cover", title: "Relatório de Lançamento" },
      { type: "kpi_grid", title: "Números do lançamento" },
      {
        type: "trend_chart",
        title: "Captação diária",
        options: { series: ["results", "spend"] },
      },
      { type: "ad_gallery", title: "Criativos de captação", options: { limit: 8 } },
      { type: "insights", title: "Diagnóstico" },
      { type: "next_steps", title: "Ajustes recomendados" },
    ],
    theme: { accent: "#7BF178", cover: "gradient" },
    is_default: true,
    is_archived: false,
  },
  {
    id: "rt-default",
    name: "Padrão — Visão Executiva",
    description: "Genérico de uma página: três KPIs, tendência e criativos ativos.",
    segment: null,
    metrics: ["spend", "results", "cpa"],
    sections: [
      { type: "cover", title: "Relatório de Mídia Paga" },
      { type: "kpi_grid", title: "Indicadores" },
      { type: "trend_chart", title: "Evolução", options: { series: ["spend", "results"] } },
      { type: "ad_gallery", title: "Anúncios ativos", options: { limit: 4 } },
      { type: "next_steps", title: "Próximos passos" },
    ],
    theme: { accent: "#7BF178", cover: "solid" },
    is_default: true,
    is_archived: false,
  },
];

export const demoReports: ReportHistory[] = [
  {
    id: "rh-1",
    client_id: "c-verdi",
    template_id: "rt-ecom",
    title: "Verdi Cosméticos — Junho/2026",
    period_start: daysAgo(60),
    period_end: daysAgo(31),
    status: "sent",
    is_automated: false,
    provider_message_id: null,
    snapshot: {},
    error_message: null,
    storage_path: "c-verdi/rh-1.pdf",
    public_url: null,
    page_count: 6,
    channel: "whatsapp",
    recipient: "+5548999110022",
    delivered_at: daysAhead(-29),
    generated_by: "u-admin",
    created_at: daysAhead(-29),
  },
  {
    id: "rh-2",
    client_id: "c-nord",
    template_id: "rt-launch",
    title: "Nord Performance — Captação Q3",
    period_start: daysAgo(45),
    period_end: daysAgo(16),
    status: "sent",
    is_automated: false,
    provider_message_id: null,
    snapshot: {},
    error_message: null,
    storage_path: "c-nord/rh-2.pdf",
    public_url: null,
    page_count: 7,
    channel: "whatsapp",
    recipient: "+5548999330044",
    delivered_at: daysAhead(-14),
    generated_by: "u-admin",
    created_at: daysAhead(-14),
  },
  {
    id: "rh-3",
    client_id: "c-atlas",
    template_id: "rt-local",
    title: "Atlas Odontologia — Julho/2026",
    period_start: daysAgo(30),
    period_end: daysAgo(1),
    status: "ready",
    is_automated: false,
    provider_message_id: null,
    snapshot: {},
    error_message: null,
    storage_path: "c-atlas/rh-3.pdf",
    public_url: null,
    page_count: 5,
    channel: null,
    recipient: null,
    delivered_at: null,
    generated_by: "u-marina",
    created_at: daysAhead(-1),
  },
];
