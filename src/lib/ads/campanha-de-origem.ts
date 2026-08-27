import { objetivoDoCriativo } from "./creative-goal";
import { VISITA_AO_PERFIL } from "./conversion-action";

/* =====================================================================
   Campanha de origem: de onde o resultado veio
   ---------------------------------------------------------------------
   O custo por resultado e o ROAS eram divididos pelo gasto da CONTA
   INTEIRA. Medido na Satö, 17–23/08/2026:

     04 | CONVERSÃO       R$335,08 · 20 compras · R$4.138,21
     03 | RECONHECIMENTO  R$ 40,00 ·  2 compras · R$  336,60
     01 | TRÁFEGO         R$106,66 ·  0
     02 | WHATSAPP        R$ 68,55 ·  0

   Somando tudo: R$25,01 por compra, ROAS 8,13. Isolando a campanha que
   existe para vender: R$16,75 e 12,35. Os outros R$215,21 pagam alcance
   e atendimento — não são custo de compra, e somá-los faz uma conta
   lucrativa parecer no prejuízo.

   O QUE ESTE ARQUIVO DECIDE é só uma coisa: quais linhas de
   `daily_metrics` entram na conta de custo e de ROAS. O VOLUME não passa
   por aqui — quantas compras e quanta receita continuam sendo da conta
   inteira, porque a venda que veio da campanha de alcance é venda de
   verdade e sumir com ela seria mentir para menos.

   A REGRA: a campanha entra quando a FAMÍLIA dela bate com a família da
   conversão que esta conta mede. Família sai de `objetivoDoCriativo`,
   que já classifica objetivo e meta de otimização em "Vendas",
   "Cadastros", "Mensagens", "Tráfego", "Alcance"… e que já era usada
   para o selo do criativo no PDF.
   ===================================================================== */

/**
 * A família de campanha que produz cada tipo de conversão.
 *
 * Os rótulos são os que `objetivoDoCriativo` devolve — mudar um lá sem
 * mudar aqui faz o isolamento parar de casar, em silêncio. O teste em
 * `scripts/teste-campanha-de-origem.mts` trava esse par.
 *
 * VISITA AO PERFIL FICA DE FORA de propósito, com `null`. Ela é medida
 * pelo campo `instagram_profile_visits`, que TODA campanha alimenta —
 * inclusive a de alcance, que é justamente a que mais traz visita. A
 * decisão é antiga e está escrita em `conversion-action.ts`; isolar aqui
 * a contradiria. Medido: 16 contas `local_business`, todas com 100% das
 * visitas fora de qualquer família de conversão.
 */
const FAMILIA_DA_CONVERSAO: Record<string, string | null> = {
  "offsite_conversion.fb_pixel_purchase": "Vendas",
  "offsite_conversion.fb_pixel_initiate_checkout": "Vendas",
  "offsite_conversion.fb_pixel_add_to_cart": "Vendas",
  "offsite_conversion.fb_pixel_lead": "Cadastros",
  "onsite_conversion.lead_grouped": "Cadastros",
  "offsite_conversion.fb_pixel_complete_registration": "Cadastros",
  "onsite_conversion.messaging_conversation_started_7d": "Mensagens",
  landing_page_view: "Tráfego",
  [VISITA_AO_PERFIL]: null,
};

/** As famílias que contam como origem, para os tipos que esta conta mede. */
export function familiasDeOrigem(tiposDeConversao: string[]): Set<string> {
  const familias = new Set<string>();
  for (const tipo of tiposDeConversao) {
    const f = FAMILIA_DA_CONVERSAO[tipo];
    if (f) familias.add(f);
  }
  return familias;
}

/** O mínimo que a regra precisa saber de uma linha. */
export interface LinhaDeCampanha {
  objective: string | null;
  optimization_goal: string | null;
  conversions: number;
}

/**
 * Esta linha é de uma campanha de origem?
 *
 * NULO É "NÃO SEI", NÃO "NENHUM", e é o caso que mais importa acertar:
 * cai aqui o Google Ads (que não tem `objective` equivalente), a linha
 * gravada antes da migration 69 e a campanha que a Meta devolve sem o
 * campo. Nesses casos o critério vira o único disponível — a campanha
 * PRODUZIU o resultado? —, que erra para o lado seguro: no pior caso o
 * custo volta a ser o de hoje, nunca some.
 */
export function ehDeOrigem(
  linha: LinhaDeCampanha,
  familias: Set<string>,
): boolean {
  /* Sem família alvo (visita ao perfil) não há o que isolar. */
  if (familias.size === 0) return true;

  if (linha.objective === null && linha.optimization_goal === null) {
    return Number(linha.conversions) > 0;
  }

  const familia = objetivoDoCriativo(linha.optimization_goal, linha.objective);
  return familia !== null && familias.has(familia);
}

export interface TotaisDeOrigem {
  spendCents: number;
  conversions: number;
  revenueCents: number;
  /** Quantas campanhas distintas entraram. Alimenta o selo "N campanhas". */
  campanhas: number;
  /**
   * `false` quando a regra foi desligada e o total voltou a ser a conta
   * inteira. A tela não desenha selo nesse caso — dizer "1 campanha"
   * quando são todas é pior do que não dizer nada.
   */
  isolado: boolean;
}

/**
 * Soma só as campanhas de origem, com a rede de segurança.
 *
 * Origem sem gasto OU sem resultado desliga o isolamento e devolve a
 * conta inteira: é o número de hoje — pior que o isolado, melhor que um
 * traço no relatório do cliente.
 */
export function totaisDeOrigem<
  T extends LinhaDeCampanha & {
    campaign_id: string;
    spend_cents: number;
    revenue_cents: number;
  },
>(linhas: T[], tiposDeConversao: string[]): TotaisDeOrigem {
  const familias = familiasDeOrigem(tiposDeConversao);

  const tudo = somar(linhas);

  if (familias.size === 0) {
    return { ...tudo, isolado: false };
  }

  /* A DECISÃO É POR CAMPANHA, NÃO POR LINHA, e a diferença só aparece no
     ramo de objetivo nulo — que é onde o critério vira "produziu o
     resultado?". `daily_metrics` tem uma linha por DIA: decidindo linha
     a linha, a campanha sem objetivo entrava na conta nos dias em que
     converteu e saía nos dias em que só gastou. O gasto dela vinha
     recortado pelos dias bons, e o custo por resultado saía barato
     demais — errando exatamente para o lado que ninguém desconfia.

     Medido em 25/08/2026: quatro campanhas ficaram sem objetivo depois
     do backfill, e uma delas é a "04 | VENDAS" do Seu Parma, com
     R$1.754 e 83 conversões em 51 dias. Nenhum desses dias é igual aos
     outros. */
  const porCampanha = new Map<string, T[]>();
  for (const l of linhas) {
    const lista = porCampanha.get(l.campaign_id);
    if (lista) lista.push(l);
    else porCampanha.set(l.campaign_id, [l]);
  }

  const daOrigem: T[] = [];
  for (const doCampaign of porCampanha.values()) {
    const agregada: LinhaDeCampanha = {
      /* O objetivo é atributo da campanha e se repete em toda linha; o
         primeiro que não for nulo vale pelo conjunto. Linha antiga sem
         backfill convive com linha nova no mesmo período. */
      objective: doCampaign.find((l) => l.objective !== null)?.objective ?? null,
      optimization_goal:
        doCampaign.find((l) => l.optimization_goal !== null)?.optimization_goal ??
        null,
      conversions: doCampaign.reduce((s, l) => s + Number(l.conversions), 0),
    };

    if (ehDeOrigem(agregada, familias)) daOrigem.push(...doCampaign);
  }

  const origem = somar(daOrigem);

  /* A REDE DE SEGURANÇA. Medido na carteira em 25/08/2026, 41 contas com
     conversão no mês: 20 passariam a isolar, e DUAS ficariam com origem
     vazia — Istituto Burgo (196 conversas, zero campanha de família
     "Mensagens": os leads chegam por campanhas de engajamento) e Way
     Coonecta (86 conversas, R$81 de origem sem nenhuma conversa nela).
     Sem isto, essas duas mostrariam custo "—" e ROAS infinito no
     relatório do cliente. */
  if (origem.spendCents === 0 || origem.conversions === 0) {
    return { ...tudo, isolado: false };
  }

  /* PISO DE REPRESENTATIVIDADE, e ele é a segunda metade da rede.
     -----------------------------------------------------------------
     A checagem acima só desliga o isolamento quando a origem está
     VAZIA. Bastava uma conversão e um centavo para o subconjunto virar
     o denominador oficial do relatório do cliente — e quando a
     classificação erra a campanha que de fato gera o resultado, o
     número da capa sai de uma fração desprezível da conta enquanto o
     card ao lado mostra o volume inteiro.

     Medido na Way Coonecta, 01–26/08/2026:

         01 | ENGAJAMENTO WHATSAPP    R$ 1.504,11   68 leads   (fora)
         post impulsionado            R$   238,52    8 leads   (fora)
         04 | TRÁFEGO SITE            R$   151,79    0 leads   (fora)
         Leads Proteção Veicular      R$    16,86    2 leads   ORIGEM

     Dois leads de setenta e oito, e o PDF imprimiria "Custo por lead
     R$ 8,43" ao lado de "Leads: 78". O custo real é R$ 24,50. O selo
     "de 1 campanha" conta campanhas, não a fatia de resultado que ficou
     de fora — nada no documento revelava o recorte.

     A MAIORIA DOS RESULTADOS é o critério, e não uma fatia de gasto: a
     campanha de origem existe para explicar de onde vem o RESULTADO. Se
     ela responde por menos da metade dele, ela não é a origem daquela
     conta — a classificação não descreve esse caso, e o denominador
     honesto volta a ser a conta inteira.

     Medido na janela semanal de 18–24/08, 15 contas isolam: catorze têm
     a origem respondendo por 91% a 100% dos resultados, e só a Feijoada
     Lá De Casa fica abaixo (33%) — ali a diferença era de R$ 3. O piso
     não mexe em nenhuma conta em que a regra estava funcionando. */
  if (origem.conversions * 2 < tudo.conversions) {
    return { ...tudo, isolado: false };
  }

  /* Só é "isolado" se sobrou algo de fora. Uma conta em que TODA
     campanha é de venda — e existem: Atacado de Pratas, 100% — está
     certa dos dois jeitos, e anunciar isolamento ali sugere um recorte
     que não houve. */
  return { ...origem, isolado: origem.spendCents < tudo.spendCents };
}

function somar<
  T extends {
    campaign_id: string;
    spend_cents: number;
    revenue_cents: number;
    conversions: number;
  },
>(linhas: T[]): Omit<TotaisDeOrigem, "isolado"> {
  const campanhas = new Set<string>();
  let spendCents = 0;
  let conversions = 0;
  let revenueCents = 0;

  for (const l of linhas) {
    campanhas.add(l.campaign_id);
    spendCents += l.spend_cents;
    conversions += Number(l.conversions);
    revenueCents += l.revenue_cents;
  }

  return { spendCents, conversions, revenueCents, campanhas: campanhas.size };
}
