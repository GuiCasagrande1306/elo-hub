import type { DealStage, LostReason } from "@/types/database";
import { ETAPAS } from "./stages";

/* =====================================================================
   As contas do funil, derivadas de `crm_stage_events`
   ---------------------------------------------------------------------
   NADA AQUI É DIGITADO. Conversão, tempo em etapa e tempo de ciclo saem
   das passagens de etapa que o trigger grava — a aplicação não escreve
   nem corrige um evento sequer, e a tabela não tem policy de insert
   justamente para isso ser verdade e não promessa.

   O módulo anterior tinha a mesma história gravada como frase em
   português dentro de `crm_activities.body`. Nenhuma destas funções
   seria escrevível em cima daquilo sem fazer parsing de prosa.

   `null` QUANDO NÃO DÁ PARA SABER, nunca zero. "Conversão de 0%" e
   "ninguém passou por aqui ainda" são afirmações diferentes, e a
   primeira faz alguém mexer num funil que está só vazio.
   ===================================================================== */

export interface EventoDeEtapa {
  deal_id: string;
  /** `null` no evento de criação. */
  from_stage: DealStage | null;
  to_stage: DealStage;
  changed_at: string;
}

/** Ordem no funil. 'perdido' fica FORA: perder não é avançar. */
const ORDEM: DealStage[] = [
  "novo",
  "contato",
  "reuniao",
  "proposta",
  "negociacao",
  "ganho",
];

const ordemDe = (s: DealStage): number => ORDEM.indexOf(s);

const DIA = 86_400_000;

/* ------------------------------------------------------------------ */
/* Conversão por etapa                                                 */
/* ------------------------------------------------------------------ */

export interface DegrauDoFunil {
  etapa: DealStage;
  label: string;
  /** Negócios que chegaram a esta etapa ou passaram dela. */
  alcancaram: number;
  /** Fração que seguiu para a etapa seguinte. `null` no último degrau. */
  conversao: number | null;
}

/**
 * O funil de verdade: quantos chegaram a cada etapa e quanto passou.
 *
 * ⚠️ QUEM CHEGOU À PROPOSTA PASSOU POR CONTATO, mesmo sem ninguém ter
 * clicado em "Contato feito". Contar só os eventos literais produziria
 * conversão acima de 100% na primeira vez que alguém arrastasse um
 * cartão de "Novo" direto para "Proposta" — e isso acontece toda semana
 * com lead de indicação que já chega quente. Aqui cada negócio conta
 * pela etapa MAIS AVANÇADA que alcançou, o que torna a série monótona
 * por construção.
 *
 * Voltar de etapa não apaga o que já foi alcançado: um negócio que foi
 * à proposta e voltou para contato passou pela proposta, e o funil
 * histórico tem que dizer isso.
 */
export function funil(eventos: EventoDeEtapa[]): DegrauDoFunil[] {
  const maiorOrdem = new Map<string, number>();

  for (const e of eventos) {
    const o = ordemDe(e.to_stage);
    if (o < 0) continue; // 'perdido' não avança
    maiorOrdem.set(e.deal_id, Math.max(maiorOrdem.get(e.deal_id) ?? 0, o));
  }

  const alcancaram = ORDEM.map(
    (_, i) => [...maiorOrdem.values()].filter((o) => o >= i).length,
  );

  return ORDEM.map((etapa, i) => ({
    etapa,
    label: ETAPAS.find((e) => e.id === etapa)?.label ?? etapa,
    alcancaram: alcancaram[i],
    conversao:
      i === ORDEM.length - 1 || alcancaram[i] === 0
        ? null
        : alcancaram[i + 1] / alcancaram[i],
  }));
}

/* ------------------------------------------------------------------ */
/* Tempo                                                               */
/* ------------------------------------------------------------------ */

/** Os intervalos de um negócio, etapa a etapa, em ordem. */
function intervalos(
  eventos: EventoDeEtapa[],
): { deal_id: string; etapa: DealStage; dias: number; fechado: boolean }[] {
  const porDeal = new Map<string, EventoDeEtapa[]>();
  for (const e of eventos) {
    const lista = porDeal.get(e.deal_id) ?? [];
    lista.push(e);
    porDeal.set(e.deal_id, lista);
  }

  const saida: { deal_id: string; etapa: DealStage; dias: number; fechado: boolean }[] = [];
  const agora = Date.now();

  for (const [deal_id, lista] of porDeal) {
    const ord = [...lista].sort((a, b) => a.changed_at.localeCompare(b.changed_at));

    for (let i = 0; i < ord.length; i++) {
      const inicio = new Date(ord[i].changed_at).getTime();
      const proximo = ord[i + 1];
      const fim = proximo ? new Date(proximo.changed_at).getTime() : agora;

      saida.push({
        deal_id,
        etapa: ord[i].to_stage,
        dias: Math.max(0, (fim - inicio) / DIA),
        fechado: Boolean(proximo),
      });
    }
  }

  return saida;
}

export interface TempoNaEtapa {
  etapa: DealStage;
  label: string;
  /** Média de dias até sair da etapa. `null` sem nenhuma saída medida. */
  mediaDias: number | null;
  /** Quantas passagens COMPLETAS sustentam a média. */
  amostra: number;
}

/**
 * Quanto tempo um negócio fica em cada etapa, em média.
 *
 * ⚠️ SÓ INTERVALOS FECHADOS. Um negócio que entrou em "Proposta" hoje
 * tem zero dias na etapa, e incluí-lo puxaria a média para baixo toda
 * vez que o funil recebesse movimento — a métrica melhoraria sozinha
 * quanto mais gente estivesse parada. `amostra` vai junto para quem lê
 * saber se a média se sustenta em três casos ou em trinta.
 */
export function tempoPorEtapa(eventos: EventoDeEtapa[]): TempoNaEtapa[] {
  const fechados = intervalos(eventos).filter((i) => i.fechado);

  return ORDEM.filter((e) => e !== "ganho").map((etapa) => {
    const meus = fechados.filter((i) => i.etapa === etapa);
    return {
      etapa,
      label: ETAPAS.find((e) => e.id === etapa)?.label ?? etapa,
      mediaDias: meus.length
        ? meus.reduce((a, i) => a + i.dias, 0) / meus.length
        : null,
      amostra: meus.length,
    };
  });
}

export interface TempoDeCiclo {
  /** Média de dias da entrada até o ganho. `null` sem negócio ganho. */
  mediaDias: number | null;
  amostra: number;
}

/**
 * Da entrada do lead até o contrato assinado.
 *
 * Só negócios GANHOS. Incluir os perdidos misturaria duas perguntas —
 * "quanto tempo leva para vender" e "quanto tempo leva para desistir" —
 * e a segunda costuma ser muito maior, o que faria o número servir para
 * nada.
 */
export function tempoDeCiclo(eventos: EventoDeEtapa[]): TempoDeCiclo {
  const porDeal = new Map<string, EventoDeEtapa[]>();
  for (const e of eventos) {
    const lista = porDeal.get(e.deal_id) ?? [];
    lista.push(e);
    porDeal.set(e.deal_id, lista);
  }

  const ciclos: number[] = [];

  for (const lista of porDeal.values()) {
    const ord = [...lista].sort((a, b) => a.changed_at.localeCompare(b.changed_at));
    const ganho = ord.find((e) => e.to_stage === "ganho");
    if (!ganho || !ord[0]) continue;

    const dias =
      (new Date(ganho.changed_at).getTime() - new Date(ord[0].changed_at).getTime()) /
      DIA;
    ciclos.push(Math.max(0, dias));
  }

  return {
    mediaDias: ciclos.length
      ? ciclos.reduce((a, d) => a + d, 0) / ciclos.length
      : null,
    amostra: ciclos.length,
  };
}

/* ------------------------------------------------------------------ */
/* Onde a venda morre                                                  */
/* ------------------------------------------------------------------ */

export interface MorteNoFunil {
  /** A etapa de onde o negócio saiu para 'perdido'. */
  etapa: DealStage;
  label: string;
  perdidos: number;
}

/**
 * De qual etapa os negócios saíram para "Perdido".
 *
 * Responde uma pergunta que o motivo de perda não responde: perder na
 * proposta e perder no primeiro contato são problemas diferentes, e
 * "Preço" significa coisas opostas nos dois casos. Os dois cortes juntos
 * é que dizem o que mudar.
 */
export function ondeMorre(eventos: EventoDeEtapa[]): MorteNoFunil[] {
  const contagem = new Map<DealStage, number>();

  for (const e of eventos) {
    if (e.to_stage !== "perdido" || !e.from_stage) continue;
    contagem.set(e.from_stage, (contagem.get(e.from_stage) ?? 0) + 1);
  }

  return [...contagem.entries()]
    .map(([etapa, perdidos]) => ({
      etapa,
      label: ETAPAS.find((x) => x.id === etapa)?.label ?? etapa,
      perdidos,
    }))
    .sort((a, b) => b.perdidos - a.perdidos);
}

export interface MotivoContado {
  motivo: LostReason;
  perdidos: number;
}

/** Contagem simples dos motivos — vem de `crm_deals`, não dos eventos. */
export function motivosDePerda(
  deals: { stage: DealStage; lost_reason: LostReason | null }[],
): MotivoContado[] {
  const contagem = new Map<LostReason, number>();

  for (const d of deals) {
    if (d.stage !== "perdido" || !d.lost_reason) continue;
    contagem.set(d.lost_reason, (contagem.get(d.lost_reason) ?? 0) + 1);
  }

  return [...contagem.entries()]
    .map(([motivo, perdidos]) => ({ motivo, perdidos }))
    .sort((a, b) => b.perdidos - a.perdidos);
}
