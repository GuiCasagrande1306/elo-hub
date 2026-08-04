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
  | "local_business"
  | "launch"
  | "saas"
  | "infoproduct"
  | "b2b_services"
  | "other";

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
  tax_id: string | null;
  slug: string;
  segment: ClientSegment;
  status: ClientStatus;
  logo_url: string | null;
  brand_primary: string | null;
  brand_secondary: string | null;
  brand_font: string | null;
  website: string | null;
  contact_name: string | null;
  contact_email: string | null;
  whatsapp_phone: string | null;
  persona: ClientPersona;
  monthly_fee_cents: number;
  contract_start: string | null;
  owner_id: string | null;
  /** Dia do mês (1-28) do envio automático; null quando não agendado. */
  report_day: number | null;
  report_enabled: boolean;
  created_at: string;
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
  created_at: string;
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

export interface Task {
  id: string;
  client_id: string | null;
  project_id: string | null;
  title: string;
  content: RichTextDoc;
  status: TaskStatus;
  priority: TaskPriority;
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
  | "aov"
  | "reach";

export type ReportSectionType =
  | "cover"
  | "kpi_grid"
  | "trend_chart"
  | "platform_split"
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
