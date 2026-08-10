/**
 * Tipos de domínio do Elo Hub.
 *
 * Espelham 1:1 as tabelas de `supabase/migrations/0001_schema.sql`.
 * Em produção, regenerar com:
 *   npx supabase gen types typescript --project-id <ref> > src/types/supabase.ts
 * e reexportar daqui. Mantemos este arquivo escrito à mão para que o
 * projeto compile e rode antes de existir um projeto Supabase.
 */

export type UserRole = "admin" | "collaborator";
export type AccessLevel = "viewer" | "editor" | "manager";

export type ClientStatus = "lead" | "onboarding" | "active" | "paused" | "churned";

export type ClientSegment =
  | "ecommerce"
  | "delivery"
  | "leads"
  | "local_business";

export type ProjectStatus = "planning" | "active" | "on_hold" | "done" | "archived";

export type TaskStatus = "backlog" | "todo" | "in_progress" | "review" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type AdPlatform =
  | "google_ads"
  | "meta_ads"
  | "tiktok_ads"
  | "linkedin_ads"
  | "organic";

export type ReportStatus =
  | "draft"
  | "queued"
  | "generating"
  | "ready"
  | "sending"
  | "sent"
  | "failed";

export type DeliveryChannel = "whatsapp" | "email" | "link";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  job_title: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface Client {
  id: string;
  name: string;
  legal_name: string | null;
  slug: string;
  segment: ClientSegment;
  status: ClientStatus;
  logo_url: string | null;
  brand_primary: string | null;
  /** Agência que detém o contrato. "Elo Marketing" = conta própria. */
  agency_partner: string;
  brand_secondary: string | null;
  brand_font: string | null;
  website: string | null;
  contact_name: string | null;
  contact_email: string | null;
  whatsapp_phone: string | null;
  persona: ClientPersona;
  contract_start: string | null;
  owner_id: string | null;
  /** Dia do mês (1-28) do envio automático; null quando não agendado. */
  report_day: number | null;
  report_enabled: boolean;
  /** Dia útil da rotina: 1=segunda … 5=sexta. NULL = sem rotina. */
  optimization_day: number | null;
  created_at: string;
}

/**
 * Dados contratuais — tabela SEPARADA, com policy de admin.
 *
 * Saíram de `clients` quando a carteira virou legível por toda a
 * equipe: RLS é por linha, não por coluna, então a única forma de
 * esconder honorário e CNPJ de um colaborador é não os guardar na
 * tabela que ele pode ler.
 */
export interface ClientFinancials {
  client_id: string;
  monthly_fee_cents: number;
  tax_id: string | null;
  /**
   * Dia do vencimento do honorário, 1–28. Limitado a 28 pelo mesmo
   * motivo do `report_day`: fevereiro existe, e vencimento no dia 30
   * nunca chegaria. `null` = cliente sem cobrança recorrente, e o job
   * mensal o ignora.
   */
  billing_day: number | null;
}

/** Uma rodada da esteira de otimização. */
export interface OptimizationEntry {
  id: string;
  client_id: string;
  collaborator_id: string | null;
  notes: string;
  report_sent: boolean;
  goal_projection: number | null;
  created_at: string;
  /** Resolvido na leitura, para a lista mostrar quem fez. */
  collaborator?: Pick<Profile, "id" | "full_name"> | null;
}

/** Briefing estratégico. Alimenta o contexto dos insights do relatório. */
export interface ClientPersona {
  summary?: string;
  age_range?: string;
  pains?: string[];
  desires?: string[];
  objections?: string[];
  tone_of_voice?: string;
  main_offer?: string;
  average_ticket_cents?: number;
}

/**
 * Meta de um cliente para um período.
 *
 * Os campos `*_override` existem para os casos em que o número da
 * plataforma está errado (lead que era spam, venda fechada por
 * telefone). Nulo = usar o valor calculado de `daily_metrics`. Ver a
 * justificativa em `supabase/migrations/20260803000005_client_goals.sql`.
 */
export interface ClientGoal {
  id: string;
  client_id: string;
  period_start: string;
  period_end: string;
  planned_budget_cents: number;
  planned_results: number;
  /**
   * Unidade de `planned_results`: `"count"` = conversões, `"revenue"` =
   * centavos. `null` são metas anteriores à coluna, e todas eram
   * contagem. Ver a migration 20260806000025 e `lib/metrics/goal-metric`.
   */
  results_metric: "count" | "revenue" | null;
  executed_budget_cents_override: number | null;
  executed_results_override: number | null;
  override_reason: string | null;
  notes: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* Financeiro — visível apenas para admin (RLS)                        */
/* ------------------------------------------------------------------ */

export type TransactionType = "income" | "expense";
export type TransactionStatus = "pending" | "paid" | "canceled";

export type TransactionCategory =
  | "client_fee"
  | "project_fee"
  | "ad_spend"
  | "salary"
  | "contractor"
  | "software"
  | "office"
  | "tax"
  | "other";

export interface FinancialTransaction {
  id: string;
  type: TransactionType;
  category: TransactionCategory;
  status: TransactionStatus;
  /** Sempre positivo — o sinal do fluxo vem de `type`. */
  amount_cents: number;
  description: string;
  client_id: string | null;
  due_date: string;
  paid_date: string | null;
  provider: string | null;
  external_id: string | null;
  /**
   * Origem + mês do lançamento gerado pelo job de recorrência
   * (`cliente:<uuid>:2026-09`). Único no banco: é o que impede o job de
   * cobrar duas vezes ao rodar de novo. `null` em lançamento avulso.
   */
  recurrence_key: string | null;
  created_at: string;
}

/**
 * Despesa que se repete todo mês: folha, assinaturas, impostos.
 *
 * Não é lançamento — é o MOLDE do lançamento. Quem vira linha em
 * `financial_transactions` é o que o job materializa a partir daqui.
 */
export interface RecurringExpense {
  id: string;
  description: string;
  category: TransactionCategory;
  /** Sempre positivo, como em `financial_transactions`. */
  amount_cents: number;
  billing_day: number;
  /**
   * Desligada em vez de apagada: assinatura cancelada em março não pode
   * sumir do fluxo de caixa de janeiro.
   */
  is_active: boolean;
  created_at: string;
}

/**
 * Honorário cobrado DA AGÊNCIA parceira — um valor só para todos os
 * clientes dela.
 *
 * Espelha `ClientFinancials`, mas a chave é o nome da agência e não um
 * `client_id`: agência não é cliente, e criar um cliente-fantasma para
 * segurar o honorário a colocaria na contagem de contas ativas, na
 * Performance e no seletor de relatórios. Ver a migration 31.
 */
export interface AgencyContract {
  /** Espelha `clients.agency_partner`. Chave primária. */
  agency: string;
  monthly_fee_cents: number;
  /** 1–28, ou `null` para "sem cobrança recorrente" — o job pula. */
  billing_day: number | null;
  notes: string | null;
}

/** Uma linha do gráfico de fluxo de caixa. */
export interface MonthlySummary {
  month: string;
  income_cents: number;
  expense_cents: number;
  net_cents: number;
}

export interface Project {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  color: string | null;
  starts_at: string | null;
  ends_at: string | null;
  owner_id: string | null;
}

/** Documento do TipTap (ProseMirror). Tipagem frouxa de propósito. */
export interface RichTextDoc {
  type: "doc";
  content?: unknown[];
}

export const TASK_COLOR_TAGS = [
  "rosa",
  "laranja",
  "ambar",
  "verde",
  "azul",
  "roxo",
  "cinza",
] as const;

export type TaskColorTag = (typeof TASK_COLOR_TAGS)[number];

export interface Task {
  id: string;
  client_id: string | null;
  project_id: string | null;
  title: string;
  content: RichTextDoc;
  status: TaskStatus;
  /** Derivada de `criticality` por trigger. Não editar direto. */
  priority: TaskPriority;
  /** 1–10. Fonte da verdade da importância. */
  criticality: number;
  /** Tempo FECHADO em segundos. Não inclui o cronômetro em curso. */
  tracked_seconds: number;
  /** Quando o cronômetro ligou. null = parado. */
  timer_started_at: string | null;
  /** Marcação pessoal de cor. Token do tema, não hex. */
  color_tag: TaskColorTag | null;
  position: number;
  due_date: string | null;
  completed_at: string | null;
  progress: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Tarefa com relações resolvidas — formato consumido pela UI. */
export interface TaskWithRelations extends Task {
  assignees: Profile[];
  checklist: ChecklistItem[];
  client?: Pick<Client, "id" | "name" | "brand_primary"> | null;
  project?: Pick<Project, "id" | "name" | "color"> | null;
  comment_count?: number;
}

export interface ChecklistItem {
  id: string;
  task_id: string;
  content: string;
  is_done: boolean;
  position: number;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface DailyMetric {
  id: string;
  client_id: string;
  platform: AdPlatform;
  metric_date: string;
  campaign_id: string;
  campaign_name: string | null;
  spend_cents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue_cents: number;
}

export interface AdCreative {
  id: string;
  client_id: string;
  platform: AdPlatform;
  external_ad_id: string;
  campaign_name: string | null;
  ad_name: string | null;
  thumbnail_url: string | null;
  storage_path: string | null;
  destination_url: string | null;
  headline: string | null;
  primary_text: string | null;
  call_to_action: string | null;
  is_active: boolean;
  spend_cents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  period_start: string | null;
  period_end: string | null;
}

/** Chaves de métrica que um template pode pedir. */
export type MetricKey =
  | "spend"
  | "results"
  | "cpa"
  | "revenue"
  | "roas"
  | "ctr"
  | "cpc"
  | "cpm"
  | "impressions"
  | "clicks"
  | "leads"
  | "cpl"
  | "aov";

/* `reach` foi REMOVIDA de propósito. Alcance é deduplicado pela
   plataforma e não é somável entre dias; `daily_metrics` não tem a
   coluna, e o código estimava `impressões × 0,62` — um número inventado
   impresso como "Alcance" no relatório do cliente. Se um dia for
   necessário, tem que vir do endpoint da Meta, com coluna própria. */

export type ReportSectionType =
  | "cover"
  | "kpi_grid"
  | "trend_chart"
  | "platform_split"
  /**
   * Uma PÁGINA POR PLATAFORMA, com o quadro completo de métricas e as
   * campanhas daquele canal.
   *
   * Diferente de `platform_split`, que só mostra a fatia do orçamento:
   * a participação esconde que o Google entregou o dobro de resultados
   * com metade do investimento.
   */
  | "platform_detail"
  | "campaign_table"
  | "ad_gallery"
  | "insights"
  | "next_steps";

export interface ReportSection {
  type: ReportSectionType;
  title: string;
  options?: Record<string, unknown>;
}

export interface ReportTemplate {
  id: string;
  name: string;
  description: string | null;
  segment: ClientSegment | null;
  metrics: MetricKey[];
  /**
   * Sobrescreve o rótulo da métrica no PDF.
   *
   * O mesmo número — `conversions` — é "Vendas" no e-commerce, "Pedidos"
   * no delivery, "Leads" na captação e "Contatos" no negócio local. Sem
   * isto o relatório diz "Resultados" para todos, e o cliente não
   * reconhece o próprio negócio no que recebeu.
   */
  metric_labels: Partial<Record<MetricKey, string>>;
  sections: ReportSection[];
  theme: { accent?: string; cover?: "solid" | "gradient" };
  is_default: boolean;
  is_archived: boolean;
}

export interface ReportHistory {
  id: string;
  client_id: string;
  template_id: string | null;
  title: string;
  period_start: string;
  period_end: string;
  status: ReportStatus;
  error_message: string | null;
  storage_path: string | null;
  public_url: string | null;
  page_count: number | null;
  channel: DeliveryChannel | null;
  recipient: string | null;
  delivered_at: string | null;
  generated_by: string | null;
  provider_message_id: string | null;
  /**
   * Números congelados no momento da geração. É o que torna o relatório
   * auditável: as plataformas reprocessam conversões por semanas, então
   * reconsultar depois daria outro número.
   */
  snapshot: Record<string, unknown>;
  /** true quando gerado pelo cron; impede disparo duplicado do período. */
  is_automated: boolean;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* Mídias sociais                                                      */
/* ------------------------------------------------------------------ */

export type SocialNetwork =
  | "instagram"
  | "facebook"
  | "linkedin"
  | "tiktok"
  | "youtube"
  | "x"
  | "pinterest"
  | "threads"
  | "google_business";

/**
 * Formato da peça — descrito pelo ATIVO, não pelo nome comercial.
 *
 * A primeira versão listava `reels`, `shorts` e `video` como coisas
 * diferentes. São o mesmo arquivo: um vídeo 9:16. O resultado é que
 * NENHUM dos sete formatos servia para postar um vertical em Instagram,
 * Facebook, TikTok e YouTube ao mesmo tempo — que é o fluxo mais comum
 * que existe. Escolher "Reels" avisava sobre TikTok e YouTube; escolher
 * "Vídeo" avisava sobre Instagram; "Shorts" avisava sobre três.
 *
 * Agora um formato é um ativo, e o nome que cada rede dá a ele é
 * apelido — ver `apelidoDoFormato` em `@/lib/social/networks`.
 */
export type SocialFormat =
  | "video_vertical"
  | "video_horizontal"
  | "imagem"
  | "carrossel"
  | "stories"
  | "artigo";

/**
 * Trâmite EDITORIAL da peça.
 *
 * Não existe "publicado" nesta lista, e não é esquecimento: publicação é
 * medida em `SocialPostTarget`, uma linha por rede. Ver o cabeçalho da
 * migration 33 e `situacaoDoPost` em `@/lib/social/post-status`.
 */
export type SocialPostStatus =
  | "rascunho"
  | "em_aprovacao"
  | "ajustes"
  | "aprovado"
  | "arquivado";

export type SocialTargetStatus = "pendente" | "publicado" | "falhou";

export interface SocialAccount {
  client_id: string;
  network: SocialNetwork;
  /** Sem o `@`. A interface adiciona na hora de exibir. */
  handle: string;
  profile_url: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SocialPostTarget {
  id: string;
  post_id: string;
  network: SocialNetwork;
  /** `null` = herda a legenda do post. `""` = vai sem legenda. */
  caption_override: string | null;
  status: SocialTargetStatus;
  published_at: string | null;
  published_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SocialPost {
  id: string;
  client_id: string;
  title: string;
  caption: string;
  format: SocialFormat;
  media_urls: string[];
  /** `null` = pauta sem data. Estado legítimo, não pendência. */
  scheduled_at: string | null;
  status: SocialPostStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SocialPostComment {
  id: string;
  post_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  author?: Pick<Profile, "id" | "full_name" | "avatar_url"> | null;
}

/** Post com relações resolvidas — formato consumido pela UI. */
export interface SocialPostWithRelations extends SocialPost {
  targets: SocialPostTarget[];
  client?: Pick<Client, "id" | "name" | "brand_primary" | "logo_url"> | null;
  author?: Pick<Profile, "id" | "full_name" | "avatar_url"> | null;
  approver?: Pick<Profile, "id" | "full_name"> | null;
  comment_count?: number;
}
