import type { KpiResult } from "@/lib/metrics/kpi";
import type { MetricKey } from "@/types/database";

/* =====================================================================
   A mensagem que acompanha o relatório
   ---------------------------------------------------------------------
   UM TEXTO SÓ, E ELE É ESTE. Até 23/08/2026 existiam dois: o que a
   estação de comando mostrava em "Texto para o cliente" e o que o
   WhatsApp de fato despachava junto do PDF. Mesmos números, outra voz —
   e "21 resultados" onde a conta chama de pedidos. Quem operava
   conferia uma coisa e enviava outra, sem meio de perceber.

   EDITÁVEL DESDE 27/08/2026. O texto vem de `report_message_settings`
   (migration 73) e o padrão abaixo é só o de fábrica — o que a linha do
   banco tem na primeira instalação e o que o botão "Restaurar padrão"
   reescreve. Mudar a voz da agência não exige mais deploy.

   OS NÚMEROS VOLTARAM EM 01/09/2026, e a forma como voltaram é o
   assunto principal deste arquivo.
   ---------------------------------------------------------------------
   Eles tinham saído em 27/08 por um motivo medido: a legenda dividia
   pelo gasto da CONTA INTEIRA enquanto os cartões do PDF dividiam pela
   CAMPANHA DE ORIGEM, e oito de 54 contas mandavam texto e anexo
   discordando no mesmo envio — Satö com 8,11x na mensagem e 12,35x no
   arquivo; The Boris Burguer 2,22x contra 5,25x. O número da legenda é
   o primeiro que o cliente lê.

   O DEFEITO ERA A SEGUNDA CONTA, NÃO O NÚMERO. A legenda antiga
   recalculava tudo a partir de `{spendCents, conversions, revenueCents}`
   — uma implementação paralela à do documento, livre para divergir e
   divergindo em silêncio. Agora ela não calcula nada: recebe
   `LinhaDeNumero[]` já formatado, extraído de `payload.kpis`, que são
   OS MESMOS OBJETOS que o react-pdf imprime nos cartões da capa. Não há
   como o texto discordar do anexo porque não há dois lugares fazendo a
   conta — há um, e o outro lê o resultado. Ver `linhasDaLegenda`.

   O SELO VEM JUNTO, e ele é a peça que faltava em agosto. Quando custo
   ou retorno saem de um recorte, a linha carrega "(de 1 campanha)" —
   a mesma frase, palavra por palavra, que o PDF imprime sob o cartão.
   Era essa qualificação que não existia no texto: sem ela, um retorno
   de 12,35x ao lado de "Investimento: R$ 551,90" parece erro de conta
   para quem refaz na calculadora e acha 8,11. Com ela, o cliente lê a
   mesma ressalva nos dois lugares.

   ⚠️ NUNCA ACRESCENTE UM MARCADOR QUE CALCULE. `{numeros}` é a única
   porta para valor numérico, e ela é abastecida pelo payload. Um
   `{roas}` que dividisse receita por gasto aqui reabriria exatamente a
   divergência de agosto, e ela reaparece calada — ninguém confere
   legenda contra anexo depois de enviados.

   ⚠️ "ÚLTIMOS 7 DIAS" SÓ QUANDO SÃO SETE, e é a substituição que
   garante. É a mesma regra que derrubou o primeiro seletor de período
   da estação: ele trocava a frase sem trocar os números. Fora da janela
   semanal a mensagem diz as datas, que é a coisa mais simples que
   continua sendo verdade — e por isso o período é MARCADOR, não texto
   digitado.

   PURO DE PROPÓSITO: sem `server-only`, sem banco. Roda no navegador
   para a prévia e no servidor no envio, e é a mesma função nos dois —
   quem busca o texto e os números é quem chama.

   SEM EMOJI E SEM `*negrito*` no padrão. O asterisco do WhatsApp não
   aparece na prévia, então o que a equipe confere não é o que o cliente
   lê. Quem editar pode usar; é escolha de quem escreve.
   ===================================================================== */

/** O texto de fábrica. Igual ao `update` da migration 75. */
export const MENSAGEM_PADRAO = `Olá! Aqui está o nosso relatório de performance {periodo}.

{numeros}

O detalhamento completo está no PDF em anexo. Qualquer dúvida, é só chamar por aqui.`;

/**
 * Os marcadores que a substituição conhece.
 *
 * Exportado porque a tela de edição os lista para quem escreve — uma
 * lista aqui e outra na interface divergiriam no primeiro marcador
 * novo, e o sintoma seria um `{marcador}` cru chegando ao cliente.
 */
export const MARCADORES = [
  {
    chave: "{periodo}",
    descricao: 'Vira "dos últimos 7 dias" ou "de 20 – 21 de agosto de 2026"',
  },
  { chave: "{cliente}", descricao: "O nome da conta" },
  {
    chave: "{numeros}",
    descricao:
      "Os mesmos números dos cartões do PDF, um por linha, com os rótulos da conta",
  },
] as const;

/**
 * Uma linha do bloco de números.
 *
 * TUDO JÁ VEM PRONTO: rótulo e valor chegam formatados de quem montou o
 * relatório. Este arquivo não sabe dividir, arredondar nem escolher
 * unidade — e é justamente o que o impede de discordar do PDF.
 */
export interface LinhaDeNumero {
  /** O rótulo do template: "Pedidos", "Custo por lead", "Faturamento". */
  label: string;
  /** Já formatado por `computeKpi`: "R$ 551,90", "12,35x", "30". */
  valor: string;
  /**
   * Quantas campanhas o número isolou. `null` = conta inteira, e aí não
   * há selo — dizer "de 3 campanhas" quando são todas sugere um recorte
   * que não houve.
   */
  origem: number | null;
}

export interface ResumoParaCliente {
  /** "18 – 24 de agosto de 2026", já formatado por `formatPeriod`. */
  periodoLabel: string;
  /**
   * Quantos dias a janela cobre.
   *
   * Só decide entre "dos últimos 7 dias" e a data por extenso. Não
   * entra em conta nenhuma — nenhuma conta é feita aqui.
   */
  dias: number;
  /** O nome da conta, para `{cliente}`. */
  cliente: string;
  /**
   * As linhas de `{numeros}`.
   *
   * Opcional porque nem todo caminho tem relatório em mãos: a linha de
   * histórico sem snapshot (relatório anterior a 20/08/2026) sabe o
   * período mas não os números. Ali o marcador some junto com a linha
   * em branco que o cercava, em vez de sair um bloco vazio.
   */
  numeros?: LinhaDeNumero[];
}

/** A janela semanal, a única que ganha nome próprio na frase. */
const SEMANA = 7;

/** Como `{periodo}` é lido em voz alta. */
export function janelaEmPalavras(r: {
  periodoLabel: string;
  dias: number;
}): string {
  return r.dias === SEMANA
    ? "dos últimos 7 dias"
    : /* "de 1 – 26 de agosto de 2026". A preposição fica aqui e não no
         rótulo porque `formatPeriod` também é usado em cabeçalho de
         tabela, onde "de" sobrando ficaria estranho. */
      `de ${r.periodoLabel}`;
}

/**
 * O selo do recorte, na MESMA frase que o PDF imprime.
 *
 * Copiar a formatação seria o começo da próxima divergência, então
 * quando mudar uma, mude as duas: `SeloDeOrigem` em `pdf/document.tsx`.
 *
 * ⚠️ TESTA POR `typeof`, E NÃO POR `=== null`. O tipo promete
 * `number | null`, mas metade da entrada vem de `report_history.snapshot`
 * — JSON gravado por uma versão anterior do código, que o TypeScript
 * não valida. Medido em 01/09/2026: das 11 linhas do histórico, 5 têm
 * KPIs sem o campo `origem`, gravados antes de 27/08, e uma delas
 * estava em `ready`, esperando na fila. Com `=== null`, um clique em
 * "Enviar" mandaria "(de undefined campanhas)" ao cliente.
 */
function selo(origem: number | null | undefined): string {
  if (typeof origem !== "number") return "";
  return ` (de ${origem} ${origem === 1 ? "campanha" : "campanhas"})`;
}

/**
 * O bloco de `{numeros}`.
 *
 * Marcador do WhatsApp: o "•" é literal, não formatação — o app não tem
 * lista, e um hífen no começo da linha some no meio do texto.
 */
export function formatarNumeros(linhas: LinhaDeNumero[]): string {
  return linhas.map((l) => `• ${l.label}: ${l.valor}${selo(l.origem)}`).join("\n");
}

/**
 * As métricas que o cliente lê na legenda do WhatsApp.
 *
 * UM SUBCONJUNTO, E ELE É CURTO. Os templates carregam de 6 a 8
 * métricas, e as de diagnóstico — CTR, CPC, CPM, impressões, ticket
 * médio — existem para quem gerencia a campanha. Numa mensagem de
 * WhatsApp elas empurram para baixo os três números que o dono do
 * negócio abre o celular para ver, e ainda soam a jargão de agência.
 * Continuam no PDF, que é onde quem quiser o detalhe vai olhar.
 *
 * Fora daqui de propósito: `ctr`, `cpc`, `cpm`, `impressions`, `aov`.
 */
const NA_LEGENDA = new Set<MetricKey>([
  "spend",
  "revenue",
  "leads",
  "results",
  "cpl",
  "cpa",
  "roas",
]);

/**
 * As linhas de `{numeros}` — lidas dos KPIs, nunca recalculadas.
 *
 * ESTA FUNÇÃO É A GARANTIA DE QUE TEXTO E ANEXO CONCORDAM. Ela não faz
 * conta nenhuma: pega `label`, `formatted` e `origem` dos MESMOS
 * objetos `KpiResult` que o react-pdf imprime nos cartões da capa. Se
 * um dia o custo do PDF mudar de denominador outra vez, a legenda muda
 * junto no mesmo commit, porque é o mesmo dado.
 *
 * Foi a ausência disto que produziu o defeito de 27/08/2026: a legenda
 * antiga recebia totais crus e dividia por conta própria, e oito contas
 * mandaram ROAS diferente no texto e no arquivo.
 *
 * A ORDEM É A DO PDF, não uma minha. A grade já vem na sequência que o
 * template definiu, e é a sequência dos cartões — quem compara a
 * mensagem com a capa encontra os números na mesma ordem.
 *
 * INDEFINIDO NÃO ENTRA. `formatted` é "—" quando a razão não tem
 * denominador no período; "• Custo por pedido: —" no WhatsApp lê como
 * falha do sistema. O PDF tem espaço para explicar o traço, a legenda
 * não — então ela omite a linha, que é mais curto e não mente.
 */
export function linhasDaLegenda(kpis: KpiResult[]): LinhaDeNumero[] {
  return kpis
    .filter((k) => NA_LEGENDA.has(k.key) && !k.indefinido)
    .map((k) => ({
      label: k.label,
      valor: k.formatted,
      /* NORMALIZADO, não copiado. Snapshot antigo não tem o campo e
         entrega `undefined` — ver a nota em `selo`. Aqui ele vira
         `null`, que é "conta inteira": a leitura certa, porque o
         isolamento por campanha de origem nem existia quando aquele
         relatório foi gerado. */
      origem: typeof k.origem === "number" ? k.origem : null,
    }));
}

/**
 * O texto final, com os marcadores resolvidos.
 *
 * `template` opcional para que a prévia e os testes não precisem ir ao
 * banco. Em produção quem chama passa o que está gravado — ver
 * `getMensagemDoCliente`.
 *
 * Substituição GLOBAL: o mesmo marcador pode aparecer duas vezes num
 * texto escrito à mão, e resolver só a primeira deixaria um `{cliente}`
 * cru na mensagem que vai ao cliente.
 */
export function mensagemDoCliente(
  r: ResumoParaCliente,
  template: string = MENSAGEM_PADRAO,
): string {
  return (
    template
      .replaceAll("{periodo}", janelaEmPalavras(r))
      .replaceAll("{cliente}", r.cliente)
      .replaceAll("{numeros}", formatarNumeros(r.numeros ?? []))
      /* `{numeros}` VAZIO DEIXA UM BURACO. O padrão cerca o marcador de
         linhas em branco; sem números, a substituição por "" produz
         três quebras seguidas e a mensagem chega ao cliente com um vão
         no meio. Colapsar aqui resolve para qualquer texto escrito à
         mão, e nenhuma legenda de WhatsApp quer duas linhas vazias
         seguidas de propósito. */
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
