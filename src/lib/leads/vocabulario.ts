import type { LeadSource, LeadStageKind } from "@/types/database";

/* =====================================================================
   Vocabulário do CRM de leads
   ---------------------------------------------------------------------
   Origem, motivo de descarte e as contas do funil. Fonte única: quadro,
   fila de triagem, ficha do lead e o cabeçalho de métricas leem daqui.

   ⚠️ AS ETAPAS NÃO ESTÃO NESTE ARQUIVO, e a diferença em relação ao CRM
   comercial (`lib/crm/stages.ts`) é proposital. Lá as etapas são um
   `enum` no banco, iguais para todo mundo — é o funil da Elo. Aqui cada
   cliente tem as próprias linhas em `lead_stages`, com nome e cor que
   ele escolhe. Uma lista fixa aqui seria uma segunda verdade que
   divergiria da primeira renomeação.
   ===================================================================== */

/* ------------------------------------------------------------------ */
/* Origem                                                              */
/* ------------------------------------------------------------------ */

export const ORIGENS_LEAD: { id: LeadSource; label: string }[] = [
  { id: "manual", label: "Cadastro manual" },
  { id: "meta_ads", label: "Meta Ads" },
  { id: "google_ads", label: "Google Ads" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "instagram", label: "Instagram" },
  { id: "site", label: "Site" },
  { id: "indicacao", label: "Indicação" },
  { id: "telefone", label: "Telefone" },
  { id: "outro", label: "Outro" },
];

export const ORIGEM_LEAD_LABEL: Record<LeadSource, string> = Object.fromEntries(
  ORIGENS_LEAD.map((o) => [o.id, o.label]),
) as Record<LeadSource, string>;

/** As que vieram de mídia paga — o recorte que a triagem existe para julgar. */
export const ORIGENS_PAGAS: LeadSource[] = ["meta_ads", "google_ads"];

/* ------------------------------------------------------------------ */
/* Motivo do descarte                                                  */
/* ------------------------------------------------------------------ */

export interface MotivoDescarte {
  /** É ISTO que vai para `lead_deals.lost_reason`. Ver abaixo. */
  id: string;
  label: string;
  /**
   * Este motivo acusa a SEGMENTAÇÃO, não o atendimento.
   *
   * É a razão de o campo existir. "Sumiu depois de responder" é falha de
   * follow-up e não diz nada sobre o anúncio; "mora fora da região" e
   * "dado falso" dizem que a verba comprou a pessoa errada. Separar os
   * dois é o que transforma a fila de descartados em decisão de mídia —
   * sem isso, o número agregado mistura problema de vendas com problema
   * de campanha e não serve para mexer em nenhum dos dois.
   */
  culpaDaSegmentacao: boolean;
  /** Aparece sob o botão, na hora de escolher. */
  dica?: string;
}

/**
 * Lista fechada, e curta de propósito.
 *
 * Texto livre aqui produziria trinta grafias de "não tinha perfil" e
 * nenhuma contagem possível no fim do mês — que é exatamente o número
 * que justifica o campo.
 *
 * ⚠️ O QUE VAI PARA O BANCO É O `id`, não o `label`. `lost_reason` é
 * `text` livre (a migration 56 não fechou o domínio), então nada impede
 * gravar o rótulo — mas rótulo é decisão de interface e muda: no dia em
 * que "Não é perfil" virar "Fora do público-alvo", toda contagem
 * histórica se parte em duas. O slug é estável; o rótulo é traduzido na
 * leitura por `rotuloDoMotivo`, que devolve o texto cru quando não
 * reconhece — assim um motivo vindo de fora do sistema aparece na tela
 * em vez de sumir.
 */
export const MOTIVOS_DESCARTE: MotivoDescarte[] = [
  {
    id: "fora_da_regiao",
    label: "Fora da região atendida",
    culpaDaSegmentacao: true,
    dica: "Mora onde o cliente não atende",
  },
  {
    id: "sem_perfil",
    label: "Não é perfil",
    culpaDaSegmentacao: true,
    dica: "Procura outra coisa, ou não se encaixa no que é vendido",
  },
  {
    id: "so_curiosidade",
    label: "Só curiosidade",
    culpaDaSegmentacao: true,
    dica: "Perguntou preço e não tinha intenção nenhuma",
  },
  {
    id: "dado_falso",
    label: "Dado falso ou trote",
    culpaDaSegmentacao: true,
    dica: "Telefone inexistente, nome inventado, clique acidental",
  },
  {
    id: "sem_condicao",
    label: "Sem condição de pagar",
    culpaDaSegmentacao: true,
    dica: "Tem o perfil, mas não cabe no bolso",
  },
  {
    id: "duplicado",
    label: "Lead repetido",
    culpaDaSegmentacao: false,
    dica: "Já existe no funil",
  },
  {
    id: "sem_retorno",
    label: "Sumiu / não respondeu",
    culpaDaSegmentacao: false,
    dica: "Foi abordado e nunca voltou",
  },
  {
    id: "concorrente",
    label: "Fechou com concorrente",
    culpaDaSegmentacao: false,
  },
  { id: "outro", label: "Outro", culpaDaSegmentacao: false },
];

const MOTIVO_POR_ID = new Map(MOTIVOS_DESCARTE.map((m) => [m.id, m]));

/**
 * Rótulo de um motivo gravado.
 *
 * Devolve o valor cru quando não reconhece — um motivo antigo, ou vindo
 * de uma ingestão externa, aparece na tela em vez de virar um espaço em
 * branco que ninguém consegue explicar.
 */
export function rotuloDoMotivo(valor: string | null): string | null {
  if (!valor) return null;
  return MOTIVO_POR_ID.get(valor)?.label ?? valor;
}

export function motivoAcusaSegmentacao(valor: string | null): boolean {
  if (!valor) return false;
  return MOTIVO_POR_ID.get(valor)?.culpaDaSegmentacao ?? false;
}

/* ------------------------------------------------------------------ */
/* Etapas — helpers sobre as linhas que vieram do banco                */
/* ------------------------------------------------------------------ */

export function ehEtapaAberta(kind: LeadStageKind): boolean {
  return kind === "aberto";
}

/**
 * A cor da coluna, com reserva.
 *
 * `lead_stages.color` é anulável, e coluna sem marcador fica visualmente
 * órfã ao lado das que têm. O cinza neutro não compete com as cores
 * escolhidas e deixa claro que aquela etapa não recebeu uma.
 */
export function corDaEtapa(color: string | null): string {
  return color ?? "#94A3B8";
}

/* ------------------------------------------------------------------ */
/* Contas do funil                                                     */
/* ------------------------------------------------------------------ */

export interface ResumoDoFunil {
  total: number;
  abertos: number;
  ganhos: number;
  descartados: number;
  /** Ganhos ÷ fechados. `null` quando nada fechou — ver abaixo. */
  aproveitamento: number | null;
  /** Soma de `value_cents` do que está aberto. */
  emAberto: number;
  /** Soma de `value_cents` do que foi ganho. */
  ganho: number;
  /** Descartes cujo motivo acusa a segmentação. */
  descartePorSegmentacao: number;
}

/**
 * O resumo do topo da tela.
 *
 * ⚠️ `aproveitamento` é `null`, e não 0, quando nada fechou ainda. Zero
 * por cento é uma afirmação — "vocês não converteram nenhum" — e o
 * primeiro dia de uso de um CRM mostraria isso a um cliente que ainda
 * não teve tempo de fechar nada. `null` vira travessão na tela.
 */
export function resumirFunil(
  leads: { stage_id: string; value_cents: number; lost_reason: string | null }[],
  kindDaEtapa: (stageId: string) => LeadStageKind,
): ResumoDoFunil {
  let abertos = 0;
  let ganhos = 0;
  let descartados = 0;
  let emAberto = 0;
  let ganho = 0;
  let descartePorSegmentacao = 0;

  for (const lead of leads) {
    const kind = kindDaEtapa(lead.stage_id);
    if (kind === "ganho") {
      ganhos += 1;
      ganho += lead.value_cents;
    } else if (kind === "perdido") {
      descartados += 1;
      if (motivoAcusaSegmentacao(lead.lost_reason)) descartePorSegmentacao += 1;
    } else {
      abertos += 1;
      emAberto += lead.value_cents;
    }
  }

  const fechados = ganhos + descartados;

  return {
    total: leads.length,
    abertos,
    ganhos,
    descartados,
    aproveitamento: fechados === 0 ? null : ganhos / fechados,
    emAberto,
    ganho,
    descartePorSegmentacao,
  };
}

/* ------------------------------------------------------------------ */

/**
 * Telefone como o banco aceita: só dígitos.
 *
 * `lead_contacts.phone` tem check `^[0-9]{10,15}$` e o índice único de
 * deduplicação é sobre essa coluna. Guardar com máscara faz
 * "(47) 9 9999-9999" e "47999999999" virarem duas pessoas — e a
 * deduplicação, que é o motivo de o contato existir separado do lead,
 * nunca acontece.
 *
 * Devolve `null` quando o que sobrou não cabe no check, para que a
 * gravação recuse antes de o Postgres recusar com texto cru.
 */
export function apenasDigitos(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const digitos = valor.replace(/\D/g, "");
  if (digitos.length < 10 || digitos.length > 15) return null;
  return digitos;
}

/** Máscara de leitura para telefone brasileiro guardado só com dígitos. */
export function formatarTelefone(digitos: string | null): string | null {
  if (!digitos) return null;

  // 11 dígitos = celular com DDD; 10 = fixo com DDD. Fora disso (número
  // internacional, por exemplo) é melhor mostrar cru do que mascarar errado.
  if (digitos.length === 11) {
    return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 7)}-${digitos.slice(7)}`;
  }
  if (digitos.length === 10) {
    return `(${digitos.slice(0, 2)}) ${digitos.slice(2, 6)}-${digitos.slice(6)}`;
  }
  return digitos;
}
