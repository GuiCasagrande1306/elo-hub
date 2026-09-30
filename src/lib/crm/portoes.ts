import type { DealOrigem, DealStage } from "@/types/database";

/* =====================================================================
   Os portões do funil — o que cada etapa exige para ser alcançada
   ---------------------------------------------------------------------
   FONTE ÚNICA. A migration 82 tem os mesmos requisitos como `check`, e o
   banco é a rede: garante que nenhum caminho — script, SQL na mão, um
   bug numa action futura — produza um negócio em "Proposta" sem valor.
   Mas quem produz a MENSAGEM é este arquivo, porque um erro de check
   chega como `violates check constraint "crm_deals_portao_proposta"`, e
   isso não é coisa que se mostre para quem está vendendo.

   Mudou aqui, muda lá. São seis regras curtas justamente para o
   espelhamento ser barato — `teste-portoes.mts` pina cada uma.

   POR QUE O ATRITO FICA AQUI, E NÃO NO CADASTRO
   ---------------------------------------------------------------------
   O CRM anterior pedia sete campos para criar um lead e nada para
   movê-lo. Passou 44 dias no ar com zero negócios. Ninguém preenche
   valor de proposta no dia em que o lead chega; todo mundo preenche no
   dia em que manda a proposta. Criar custa um campo — a empresa. Cada
   etapa cobra o que ela precisa, quando aquilo importa.

   'NOVO' E 'PERDIDO' NÃO TÊM PORTÃO, e os dois por motivos opostos.
   Entrar tem que ser de graça, senão o lead não entra. E perder tem que
   ser de graça porque exigir qualificação para registrar uma perda faz
   a equipe deixar o negócio apodrecendo em "Proposta" em vez de marcar
   que morreu — apagando exatamente o dado que o motivo de perda existe
   para colher. A única coisa que 'perdido' pede é o motivo.
   ===================================================================== */

/** O recorte de um negócio que os portões sabem ler. */
export interface DealParaPortao {
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  owner_id: string | null;
  service: string | null;
  monthly_fee_cents: number;
  setup_fee_cents: number;
  expected_close_date: string | null;
  next_action: string | null;
  next_action_at: string | null;
  lost_reason: string | null;
  origem: DealOrigem;
  referred_by: string | null;
}

/** Identificador do que falta — a tela usa para focar o campo certo. */
export type CampoDoPortao =
  | "contato"
  | "responsavel"
  | "proposta"
  | "previsao"
  | "proxima_acao"
  | "motivo"
  | "indicacao";

export interface Exigencia {
  campo: CampoDoPortao;
  /** O que pedir, em uma linha, na voz de quem pergunta. */
  pergunta: string;
  /** Por que a etapa precisa disso. Aparece abaixo, em cinza. */
  porque: string;
}

interface Regra extends Exigencia {
  /** `true` quando o negócio JÁ satisfaz a exigência. */
  satisfeita: (d: DealParaPortao) => boolean;
  /** Etapas em que a regra não vale. */
  dispensadaEm: DealStage[];
}

/**
 * As regras, na ordem em que o funil as cobra.
 *
 * CUMULATIVAS por construção: cada uma declara em quais etapas NÃO vale,
 * então "Proposta" carrega tudo que "Contato" e "Reunião" pediram. Uma
 * lista por etapa repetiria as mesmas linhas quatro vezes e a quarta
 * cópia seria a que alguém esqueceria de atualizar.
 */
const REGRAS: Regra[] = [
  {
    campo: "contato",
    pergunta: "Como falamos com essa empresa?",
    porque:
      "Telefone ou e-mail. Marcar “contato feito” sem ter como contatar deixa o negócio parado sem ninguém perceber.",
    satisfeita: (d) => Boolean(d.contact_phone || d.contact_email),
    dispensadaEm: ["novo", "perdido"],
  },
  {
    campo: "indicacao",
    pergunta: "Quem indicou?",
    porque:
      "A indicação é um dos dois canais reais da agência. Sem o nome, não dá para agradecer nem saber qual cliente traz gente.",
    satisfeita: (d) => d.origem !== "indicacao" || Boolean(d.referred_by),
    dispensadaEm: ["novo", "perdido"],
  },
  {
    campo: "responsavel",
    pergunta: "Quem vai nessa reunião, e com quem fala?",
    porque:
      "Reunião sem responsável não acontece, e sem o nome de quem atende do outro lado não há quem cobrar.",
    satisfeita: (d) => Boolean(d.owner_id && d.contact_name),
    dispensadaEm: ["novo", "contato", "perdido"],
  },
  {
    campo: "proposta",
    pergunta: "Qual serviço e por quanto?",
    porque:
      "Proposta sem valor não é proposta — e é o que faz a previsão de receita mentir.",
    satisfeita: (d) =>
      Boolean(d.service) && (d.monthly_fee_cents > 0 || d.setup_fee_cents > 0),
    dispensadaEm: ["novo", "contato", "reuniao", "perdido"],
  },
  {
    campo: "previsao",
    pergunta: "Quando isso fecha?",
    porque:
      "Em negociação já dá para estimar. É esta data que transforma o funil em previsão de caixa.",
    satisfeita: (d) => Boolean(d.expected_close_date),
    dispensadaEm: ["novo", "contato", "reuniao", "proposta", "perdido"],
  },
  {
    campo: "proxima_acao",
    pergunta: "Qual é o próximo passo, e quando?",
    porque:
      "É a única regra que impede o funil de apodrecer: sem ela, negócio esquecido não aparece em lista nenhuma.",
    satisfeita: (d) => Boolean(d.next_action && d.next_action_at),
    dispensadaEm: ["novo", "ganho", "perdido"],
  },
  {
    campo: "motivo",
    pergunta: "Por que perdemos?",
    porque:
      "É a única informação que o funil produz de graça: onde a venda morre, e o que dá para mudar.",
    satisfeita: (d) => Boolean(d.lost_reason),
    dispensadaEm: ["novo", "contato", "reuniao", "proposta", "negociacao", "ganho"],
  },
];

/**
 * O que falta para este negócio poder estar nesta etapa.
 *
 * Array VAZIO quer dizer liberado — nunca `null`, para quem chama poder
 * escrever `if (faltando.length)` sem checar nulo antes.
 */
export function oQueFalta(
  deal: DealParaPortao,
  destino: DealStage,
): Exigencia[] {
  return REGRAS.filter(
    (r) => !r.dispensadaEm.includes(destino) && !r.satisfeita(deal),
  ).map(({ campo, pergunta, porque }) => ({ campo, pergunta, porque }));
}

/** Atalho para quem só quer saber se pode. */
export function podeIrPara(deal: DealParaPortao, destino: DealStage): boolean {
  return oQueFalta(deal, destino).length === 0;
}

/**
 * Sugestão de próxima ação ao entrar numa etapa.
 *
 * ⚠️ EXISTE PARA "OBRIGATÓRIO" NÃO VIRAR "DIGITADO". Exigir o próximo
 * passo em toda movimentação é o que mantém o funil vivo, e também é o
 * caminho mais curto para a equipe abandonar o sistema de novo. Com o
 * campo chegando preenchido com o passo óbvio daquela etapa, a
 * exigência custa um Enter — e quem quiser escrever outra coisa
 * escreve.
 */
export function acaoSugerida(destino: DealStage): {
  texto: string;
  emDias: number;
} | null {
  switch (destino) {
    case "contato":
      return { texto: "Retomar conversa", emDias: 3 };
    case "reuniao":
      return { texto: "Realizar a reunião", emDias: 2 };
    case "proposta":
      return { texto: "Cobrar retorno da proposta", emDias: 4 };
    case "negociacao":
      return { texto: "Fechar condições", emDias: 3 };
    default:
      return null;
  }
}
