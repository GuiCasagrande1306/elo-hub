/* =====================================================================
   Quais cartões cada cliente vê no relatório
   ---------------------------------------------------------------------
   Pedido de 03/11/2026: um cliente quer CPM, outro não; um quer
   seguidores, outro só mensagens. A escolha fica em
   `clients.report_metrics` e o time edita pela aba "Relatório" do
   Configurar — o Bernardo, colaborador, sem depender de admin.

   Plataforma sem escolha = automático: a regra de sempre, que mostra o
   que teve número no período (`metricasComNumero`). Com escolha, sai
   exatamente a lista, na ordem do catálogo, mesmo com zero — escolher
   uma métrica é dizer que o cliente quer vê-la.

   Sem "server-only": o catálogo é o mesmo na tela e no relatório.
   ===================================================================== */

export type PlataformaDoRelatorio = "meta_ads" | "google_ads";

/** `null` / plataforma ausente = automático. */
export type MetricasDoRelatorio = Partial<Record<PlataformaDoRelatorio, string[]>>;

const BASE = [
  { key: "spend", label: "Investimento" },
  { key: "impressions", label: "Impressões" },
  { key: "clicks", label: "Cliques" },
  { key: "ctr", label: "CTR" },
  { key: "cpc", label: "CPC" },
  { key: "cpm", label: "CPM" },
  { key: "results", label: "Resultados (a conversão da conta)" },
  { key: "cpa", label: "Custo por resultado" },
  { key: "revenue", label: "Receita / Faturamento" },
  { key: "roas", label: "ROAS" },
];

export const CATALOGO_DE_METRICAS: Record<PlataformaDoRelatorio, { key: string; label: string }[]> = {
  meta_ads: [
    ...BASE,
    { key: "meta_mensagens", label: "Mensagens" },
    { key: "meta_custo_mensagem", label: "Custo por mensagem" },
    { key: "meta_seguidores", label: "Seguidores no Instagram" },
  ],
  google_ads: [
    ...BASE,
    { key: "google_ligacoes", label: "Ligações" },
    { key: "google_rotas", label: "Rotas" },
    { key: "google_visitas_loja", label: "Visitas à loja" },
  ],
};

/** Só chaves do catálogo, sem repetição, na ordem do catálogo. */
export function metricasValidas(plataforma: PlataformaDoRelatorio, chaves: string[]): string[] {
  const pedidas = new Set(chaves);
  return CATALOGO_DE_METRICAS[plataforma].map((m) => m.key).filter((k) => pedidas.has(k));
}
