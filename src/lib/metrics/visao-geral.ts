import type { ClientWithGoal } from "@/lib/data";
import type { GoalStatus } from "@/lib/metrics/goals";

/* =====================================================================
   Visão geral da carteira — meta x executado
   ---------------------------------------------------------------------
   Pedido de 21/11/2026: a visão geral mostrava investimento e
   faturamento somados, "que não servem para decidir nada". Agora ela
   responde: quantas contas estão no ritmo da meta, quanto da verba já
   saiu, quais grupos (segmento, squad, agência) estão adiantados ou
   atrasados e quais contas puxam cada ponta.

   O RITMO É O DO CARD DO CLIENTE: `progress.results` (`buildGoalProgress`)
   — executado ÷ esperado para hoje. Recalcular aqui faria a visão geral
   discordar da página da conta.

   Leads e faturamento não se somam: grupos comparam % do ritmo, nunca a
   soma dos resultados. Dinheiro só soma conta em real — a Marlenes Hair
   gasta em dólar (ver `clients.ad_currency`).
   ===================================================================== */

export interface ContaNaMeta {
  id: string;
  nome: string;
  slug: string;
  cor: string | null;
  segmento: string;
  squad: string;
  agencia: string;
  /** Status de resultado do card; "sem-meta" quando não há meta de resultados. */
  status: GoalStatus;
  /** Executado ÷ esperado para hoje. `null` = sem meta ou cedo demais para ler. */
  ritmo: number | null;
  metaLabel: string | null;
  executadoLabel: string | null;
  /** Dinheiro em centavos; zero para conta fora do real (não soma com BRL). */
  verbaPlanejada: number;
  gasto: number;
  verbaEsperada: number;
}

export const SEGMENTOS: Record<string, string> = {
  ecommerce: "E-commerce",
  delivery: "Delivery",
  leads: "Leads",
  local_business: "Negócio local",
};

/** Bons para a meta de resultados (o resto é atraso ou falta de meta). */
const NO_RITMO = new Set<GoalStatus>(["no-ritmo", "acelerado", "batida"]);

export function noRitmo(c: ContaNaMeta): boolean {
  return NO_RITMO.has(c.status);
}

export function contaNaMeta(r: ClientWithGoal): ContaNaMeta {
  const res = r.progress?.results ?? null;
  const verba = r.progress?.budget ?? null;
  const emReal = (r.client.ad_currency ?? "BRL") === "BRL";
  const status: GoalStatus = res && res.planned > 0 ? res.status : "sem-meta";
  return {
    id: r.client.id,
    nome: r.client.name,
    slug: r.client.slug,
    cor: r.client.brand_primary,
    segmento: SEGMENTOS[r.client.segment] ?? r.client.segment,
    squad: r.client.ficha?.perfil?.squad?.trim() || "Sem squad",
    agencia: r.client.agency_partner?.trim() || "Elo Marketing",
    status,
    ritmo: status === "sem-meta" ? null : (res?.pacing?.ratio ?? null),
    metaLabel: status === "sem-meta" ? null : res!.plannedLabel,
    executadoLabel: status === "sem-meta" ? null : res!.executedLabel,
    verbaPlanejada: emReal ? (verba?.planned ?? 0) : 0,
    gasto: emReal ? r.computedSpendCents : 0,
    verbaEsperada: emReal && verba ? (verba.pacing?.expected ?? verba.planned * (verba.elapsed ?? 0)) : 0,
  };
}

export interface ResumoDaCarteira {
  total: number;
  comMeta: number;
  noRitmo: number;
  atrasadas: number;
  semMeta: number;
  verbaPlanejada: number;
  verbaEsperada: number;
  gasto: number;
}

export function resumir(contas: ContaNaMeta[]): ResumoDaCarteira {
  const comMeta = contas.filter((c) => c.status !== "sem-meta");
  const bons = comMeta.filter(noRitmo).length;
  return {
    total: contas.length,
    comMeta: comMeta.length,
    noRitmo: bons,
    atrasadas: comMeta.length - bons,
    semMeta: contas.length - comMeta.length,
    verbaPlanejada: soma(contas, (c) => c.verbaPlanejada),
    verbaEsperada: soma(contas, (c) => c.verbaEsperada),
    gasto: soma(contas, (c) => c.gasto),
  };
}

export interface Grupo extends ResumoDaCarteira {
  nome: string;
  /**
   * Média do ritmo das contas com leitura, cada uma limitada a 150%:
   * uma conta em 400% sozinha não pode esconder três atrasadas.
   */
  ritmoMedio: number | null;
}

export type Agrupamento = "segmento" | "squad" | "agencia";

/** Grupos do mais adiantado ao mais atrasado; sem leitura vão para o fim. */
export function agrupar(contas: ContaNaMeta[], por: Agrupamento): Grupo[] {
  const mapa = new Map<string, ContaNaMeta[]>();
  for (const c of contas) mapa.set(c[por], [...(mapa.get(c[por]) ?? []), c]);
  return [...mapa]
    .map(([nome, lista]) => {
      const lidos = lista.map((c) => c.ritmo).filter((r): r is number => r !== null);
      return {
        nome,
        ...resumir(lista),
        ritmoMedio: lidos.length ? lidos.reduce((s, r) => s + Math.min(r, 1.5), 0) / lidos.length : null,
      };
    })
    .sort((a, b) => (b.ritmoMedio ?? -1) - (a.ritmoMedio ?? -1) || a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * As N mais adiantadas (no ritmo, ≥ 90% do esperado) e as N mais
 * atrasadas (abaixo de 90%). Separar pelo limiar, e não pela posição,
 * impede que uma conta em 39% apareça como "adiantada" numa carteira
 * pequena.
 */
export function pontas(contas: ContaNaMeta[], n = 5): { adiantadas: ContaNaMeta[]; atrasadas: ContaNaMeta[] } {
  const lidas = contas.filter((c) => c.ritmo !== null);
  return {
    adiantadas: lidas.filter((c) => c.ritmo! >= 0.9).sort((a, b) => b.ritmo! - a.ritmo!).slice(0, n),
    atrasadas: lidas.filter((c) => c.ritmo! < 0.9).sort((a, b) => a.ritmo! - b.ritmo!).slice(0, n),
  };
}

function soma(contas: ContaNaMeta[], f: (c: ContaNaMeta) => number): number {
  return contas.reduce((s, c) => s + f(c), 0);
}

/** Cor pela régua do card: no ritmo a partir de 90% do esperado. */
export function corDoRitmo(r: number | null): string {
  if (r === null) return "bg-muted-foreground/40";
  if (r >= 0.9) return "bg-positive";
  if (r >= 0.7) return "bg-warning";
  return "bg-negative";
}

export function textoDoRitmo(r: number | null): string {
  if (r === null) return "text-muted-foreground";
  if (r >= 0.9) return "text-positive";
  if (r >= 0.7) return "text-warning";
  return "text-negative";
}
