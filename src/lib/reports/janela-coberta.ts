/* =====================================================================
   A janela do relatório está coberta pelo dado?
   ---------------------------------------------------------------------
   A trava anterior da estação de comando reagia a UMA coisa: zero linha
   de métrica no período. Ela existia porque um mês nunca sincronizado
   exibia R$ 0,00 e o botão de enviar ficava liberado.

   O QUE ELA NÃO VIA. Em 22/09/2026, 46 das 52 integrações Meta estavam
   com o token invalidado desde o dia 18 — e havia linhas, só que
   velhas. A Dispare Visão Esportiva tinha dado até 18/09; um relatório
   de 15–21/09 somaria QUATRO dias, imprimiria R$ 92,43 e carimbaria
   "últimos 7 dias" na capa do PDF e na mensagem do WhatsApp. Nenhum
   aviso, porque `linhas > 0`.

   ⚠️ DIA SEM LINHA NÃO É DIA SEM DADO, e é por isso que contar dias não
   resolve sozinho. A Meta não devolve linha para dia sem veiculação:
   uma conta pausada no fim de semana tem cinco de sete dias, e está
   certa. Barrar por contagem produziria alarme falso justamente em quem
   não tem problema nenhum — e alarme falso repetido é como uma trava
   real passa a ser ignorada.

   QUEM SEPARA OS DOIS CASOS É A COLETA. Se ela falhou, ou se a última
   rodada bem-sucedida terminou antes do fim do período, os dias que
   faltam são NÃO APURADOS e o envio para. Se ela está em dia, os dias
   que faltam são dias sem anúncio, e o texto apenas informa.

   Puro de propósito: é decisão de interface, e decisão de interface que
   mora dentro do componente não tem como ser conferida sem clicar. Ver
   `scripts/teste-janela-coberta.mts`.
   ===================================================================== */

export interface SaudeDaColeta {
  /** `sync_error` gravado em alguma integração ativa da conta. */
  comErro: boolean;
  /**
   * Data em Brasília da última sincronização BEM-SUCEDIDA, a mais
   * antiga entre as integrações ativas. `null` = nenhuma completou.
   *
   * Só é confiável porque `recordFailure` parou de escrever
   * `last_synced_at` na falha, em 22/09/2026 — antes disso ele dizia
   * "hoje" para conta parada havia um mês.
   */
  ate: string | null;
}

export interface EstadoDaJanela {
  /** O dado acaba antes do fim do período — vale avisar. */
  incompleta: boolean;
  /**
   * E a coleta confessa que o buraco é dela. Aqui o envio para: o que
   * sairia seria um período somado pela metade sob o rótulo inteiro.
   */
  naoApurada: boolean;
}

export function estadoDaJanela(entrada: {
  /** Fim do período escolhido, YYYY-MM-DD. */
  fim: string;
  /** Hoje em Brasília, YYYY-MM-DD. */
  hoje: string;
  /** Último dia do período que tem linha. `null` = nenhum. */
  ultimoDiaComDado: string | null;
  /** A trava antiga: zero linha no período. Ela avisa por conta dela. */
  semDado: boolean;
  sincronizacao: SaudeDaColeta;
}): EstadoDaJanela {
  const { fim, hoje, ultimoDiaComDado, semDado, sincronizacao } = entrada;
  if (!fim) return { incompleta: false, naoApurada: false };

  /* O ÚLTIMO DIA QUE JÁ DEVERIA ESTAR FECHADO.
     -----------------------------------------------------------------
     A primeira versão desta regra dispensava a janela inteira quando
     ela terminava hoje — "período aberto ainda está recebendo dado".
     Medido na hora: um período de 28/08 a hoje, com a coleta parada
     havia cinco dias, passava calado. A desculpa vale para HOJE, que
     de fato ainda está entrando; não para os cinco dias fechados atrás
     dele.

     Então a cobertura é medida contra ONTEM quando o período alcança
     hoje, e contra o próprio fim quando ele já passou. */
  const ontem = umDiaAntes(hoje);
  const alvo = fim >= hoje ? ontem : fim;

  const incompleta =
    !semDado && ultimoDiaComDado !== null && ultimoDiaComDado < alvo;

  /* `ate === null` entra como atraso: nenhuma sincronização completou,
     então nada garante que a janela foi coberta. A comparação é com o
     mesmo `alvo` — exigir sincronização posterior a hoje num período
     que vai até hoje barraria todo mundo, todo dia. */
  const coletaAtrasada =
    sincronizacao.comErro ||
    sincronizacao.ate === null ||
    sincronizacao.ate <= alvo;

  return { incompleta, naoApurada: incompleta && coletaAtrasada };
}

/** O dia anterior, em YYYY-MM-DD. `Date` em UTC para não pular por fuso. */
function umDiaAntes(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
