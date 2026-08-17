import type { DealOrigem, DealStage, LostReason } from "@/types/database";

/* =====================================================================
   Vocabulário do funil
   ---------------------------------------------------------------------
   Fonte única de etapa, origem e motivo de perda. O banco tem `check`
   nos mesmos valores (migration 44), mas ele só impede o valor
   fantasma — rótulo, ordem e cor moram aqui, porque são decisão de
   interface e mudam sem migration.

   Quadro, lista, ficha do negócio e as métricas do topo leem deste
   arquivo. Duas listas escritas à mão divergem no primeiro dia em que
   alguém renomeia uma etapa só na tela que estava editando.
   ===================================================================== */

export interface EtapaDef {
  id: DealStage;
  label: string;
  /** Marcador da coluna — só o ponto é colorido, como no quadro de tarefas. */
  dot: string;
  /** Peso para a previsão ponderada. Ver `valorPonderado`. */
  probabilidade: number;
}

/**
 * As etapas, na ordem do funil.
 *
 * 'ganho' e 'perdido' são ETAPAS, não um campo separado de status. Num
 * quadro de vendas, ganhar é mover o cartão até o fim — separar o
 * desfecho numa coluna própria obrigaria a mesma informação a existir em
 * dois lugares, e o primeiro update que esquecesse um deles produziria
 * um negócio "em negociação" já fechado.
 */
export const ETAPAS: EtapaDef[] = [
  { id: "novo", label: "Novo lead", dot: "bg-muted-foreground/45", probabilidade: 0.1 },
  { id: "contato", label: "Contato feito", dot: "bg-chart-5", probabilidade: 0.2 },
  { id: "reuniao", label: "Reunião agendada", dot: "bg-chart-3", probabilidade: 0.4 },
  { id: "proposta", label: "Proposta enviada", dot: "bg-chart-4", probabilidade: 0.6 },
  { id: "negociacao", label: "Negociação", dot: "bg-warning", probabilidade: 0.8 },
  { id: "ganho", label: "Ganho", dot: "bg-positive", probabilidade: 1 },
  { id: "perdido", label: "Perdido", dot: "bg-negative", probabilidade: 0 },
];

/** As que contam como "em negociação": nem ganhas, nem perdidas. */
export const ETAPAS_ABERTAS = ETAPAS.filter(
  (e) => e.id !== "ganho" && e.id !== "perdido",
);

export const ETAPA_LABEL: Record<DealStage, string> = Object.fromEntries(
  ETAPAS.map((e) => [e.id, e.label]),
) as Record<DealStage, string>;

export function ehAberta(stage: DealStage): boolean {
  return stage !== "ganho" && stage !== "perdido";
}

/* ------------------------------------------------------------------ */

export const ORIGENS: { id: DealOrigem; label: string }[] = [
  { id: "indicacao", label: "Indicação" },
  { id: "instagram", label: "Instagram" },
  { id: "trafego_pago", label: "Tráfego pago" },
  { id: "prospeccao", label: "Prospecção ativa" },
  { id: "site", label: "Site" },
  { id: "evento", label: "Evento" },
  { id: "outro", label: "Outro" },
];

export const ORIGEM_LABEL: Record<DealOrigem, string> = Object.fromEntries(
  ORIGENS.map((o) => [o.id, o.label]),
) as Record<DealOrigem, string>;

/**
 * Motivos de perda, fechados numa lista curta.
 *
 * Texto livre aqui produz cinquenta grafias de "achou caro" e nenhuma
 * conta possível no fim do trimestre. A lista responde a pergunta que
 * justifica o campo: onde a venda morre, e o que dá para mudar.
 */
export const MOTIVOS_PERDA: { id: LostReason; label: string }[] = [
  { id: "preco", label: "Preço" },
  { id: "timing", label: "Momento errado" },
  { id: "concorrente", label: "Foi para concorrente" },
  { id: "sem_retorno", label: "Sumiu / sem retorno" },
  { id: "nao_qualificado", label: "Não era perfil" },
  { id: "outro", label: "Outro" },
];

export const MOTIVO_LABEL: Record<LostReason, string> = Object.fromEntries(
  MOTIVOS_PERDA.map((m) => [m.id, m.label]),
) as Record<LostReason, string>;

/* ------------------------------------------------------------------ */
/* Contas do funil                                                     */
/* ------------------------------------------------------------------ */

/**
 * Valor de um negócio para efeito de funil: doze meses de mensalidade
 * mais o setup.
 *
 * ⚠️ POR QUE DOZE MESES, e não a mensalidade pura. Um contrato de
 * R$ 2.000/mês e um projeto único de R$ 2.000 não valem a mesma coisa
 * para a agência, e somar os dois campos crus faria o quadro tratá-los
 * como iguais. Doze meses é a convenção de mercado para valor de
 * contrato anual, e deixa a comparação honesta.
 *
 * A previsão de RECORRENTE, que é outra pergunta, usa
 * `monthly_fee_cents` sozinho — ver o cabeçalho da tela.
 */
export function valorDoNegocio(deal: {
  monthly_fee_cents: number;
  setup_fee_cents: number;
}): number {
  return deal.monthly_fee_cents * 12 + deal.setup_fee_cents;
}

/**
 * Valor ponderado pela probabilidade da etapa — o "weighted pipeline"
 * do Pipedrive.
 *
 * Somar o valor cru de tudo que está aberto produz um número que ninguém
 * acredita: cinquenta leads recém-chegados viram "R$ 3 milhões em
 * negociação". Ponderar pela etapa dá uma previsão que dá para levar
 * para uma reunião.
 */
export function valorPonderado(deal: {
  stage: DealStage;
  monthly_fee_cents: number;
  setup_fee_cents: number;
}): number {
  const peso = ETAPAS.find((e) => e.id === deal.stage)?.probabilidade ?? 0;
  return Math.round(valorDoNegocio(deal) * peso);
}
