import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import { syncAllClients } from "@/lib/ads/sync";
import { dispatchScheduledReports } from "@/lib/reports/schedule";
import { materializarMes, mesCorrente } from "@/lib/finance/recurrence";

/**
 * GET /api/cron/daily
 *
 * A rodada diária inteira, em sequência: emite a recorrência do mês,
 * sincroniza as plataformas e GERA os relatórios de quem tem hoje como
 * dia combinado — e para aí. O envio é manual: uma pessoa confere o PDF
 * em /relatorios e dispara pelo próprio WhatsApp.
 *
 * POR QUE UMA ROTA SÓ, E NÃO DUAS
 * ---------------------------------------------------------------------
 * O desenho natural seria extrair de madrugada e gerar de manhã — dois
 * agendamentos. O plano Hobby da Vercel aceita UM cron por dia, e recusa
 * o deploy quando há mais. Então a sequência acontece dentro de uma
 * invocação: sincroniza, e só então gera.
 *
 * A ordem não é estética. Gerar antes de sincronizar produziria um PDF
 * com os números de ontem no lugar dos de hoje — e o relatório sairia
 * assinado como "fechado". Errado e silencioso.
 *
 * Ao migrar para Pro, separar é trivial: `?etapa=recorrencia`, `?etapa=sync`
 * e `?etapa=envio` já dividem o trabalho, bastando apontar um cron para
 * cada. `?etapa=recorrencia` também é o jeito de conferir a emissão do
 * mês sem esperar a rodada completa.
 *
 * AUTENTICAÇÃO
 * Com `CRON_SECRET` definido, a Vercel envia `Authorization: Bearer` nas
 * invocações de cron. Sem o header, a rota recusa: sem isso qualquer um
 * dispararia envio de relatório para os grupos dos clientes.
 */
export const runtime = "nodejs";

// O teto real é do plano: Hobby corta em 60s. Declarar mais não aumenta
// o limite — mas mantém a rota correta quando o projeto virar Pro. O
// orçamento do disparo é passado explicitamente abaixo.
export const maxDuration = 300;

export const dynamic = "force-dynamic";

/** Orçamento da geração. Conservador de propósito: ver nota acima. */
const ORCAMENTO_ENVIO_MS = 45_000;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");

  if (!serverEnv.cronSecret) {
    return NextResponse.json(
      {
        error: "CRON_SECRET não configurado.",
        hint: "Defina a variável no painel da Vercel para habilitar o cron.",
      },
      { status: 503 },
    );
  }

  if (auth !== `Bearer ${serverEnv.cronSecret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const etapa = searchParams.get("etapa");

  /* Cada etapa decide sozinha se roda, em vez de encadear `!==`. Com
     três etapas, `etapa !== "envio"` já deixava de significar "é a vez
     do sync" — passava a incluir qualquer nome novo que aparecesse. */
  const rodar = (nome: string) => etapa === null || etapa === nome;

  /* ⚠️ O RELÓGIO COMEÇA AQUI, não no início da fase de relatórios.
     A trava de orçamento em `dispatchScheduledReports` media a partir do
     momento em que ELA era chamada, e por isso "37s restantes" era uma
     afirmação sobre um tempo que já tinha sido gasto por quem rodou
     antes. Com o sync consumindo boa parte do teto real da função, a
     trava autorizava seis relatórios num espaço que comportava um — e
     os que não terminavam ficavam presos em `generating`. */
  const inicioDaRequisicao = Date.now();

  const resposta: Record<string, unknown> = { etapa: etapa ?? "completa" };

  /* --- 0. Recorrência ---------------------------------------------------
     Emite os honorários e as despesas fixas do mês corrente.

     RODA TODO DIA, não só no dia 1º. Não é desperdício: `recurrence_key`
     é única no banco, então a partir do segundo dia do mês a passagem
     não cria nada e devolve `criadas: 0`. O ganho é que um cliente
     cadastrado no dia 12 entra no faturamento no dia 13, em vez de ficar
     de fora do mês inteiro — e um deploy quebrado no dia 1º deixa de
     custar a cobrança de todo mundo.

     PRIMEIRO na sequência, e envolto em try/catch por isso: falha de
     token do Meta não pode impedir a agência de faturar, e uma falha
     aqui não pode impedir o relatório do cliente de sair. As três etapas
     são independentes de propósito. */
  if (rodar("recorrencia")) {
    try {
      resposta.recorrencia = await materializarMes(mesCorrente());
    } catch (error) {
      resposta.recorrencia = {
        erro: error instanceof Error ? error.message : "falha desconhecida",
      };
    }
  }

  /* --- 1. Preparo dos PDFs ---------------------------------------------
     ⚠️ ANTES DO SYNC, e a ordem é o conserto.

     A sincronização roda sobre a carteira inteira e não tem orçamento
     nenhum; os relatórios rodavam depois, com o que sobrasse de um teto
     que a trava deles nem enxergava. Na prática o sync consumia o tempo
     e a fase de relatórios começava condenada.

     Inverter é de graça porque o relatório NÃO PRECISA do dado de hoje:
     a janela é "30 dias terminando ONTEM" (`janelaAte` em
     `schedule.ts`). O que o sync traz nesta rodada só entra no relatório
     de amanhã em diante.

     O sync perde a prioridade, e isso é aceitável: ele é incremental,
     roda em `mode=month` e recupera no dia seguinte o que não couber.
     Relatório atrasado, não — a data combinada com o cliente passa. */
  if (rodar("envio")) {
    // `?dia=N` permite conferir o preparo de um cliente sem esperar
    // chegar a data combinada. Protegido pelo mesmo CRON_SECRET, e a
    // trava de duplicidade continua valendo: conferir hoje não impede
    // a geração real no dia certo, porque o período será outro.
    const dia = Number(searchParams.get("dia"));

    // `?orcamentoMs=` existe para medir capacidade: com um valor baixo
    // dá para ver quantos clientes cabem antes de a trava adiar o resto,
    // sem esperar a carteira crescer para descobrir na prática.
    const orcamento = Number(searchParams.get("orcamentoMs"));

    /* O orçamento é o que SOBROU do teto, não um número fixo. Sem
       descontar o decorrido, a conta ignorava tudo o que rodou antes
       nesta mesma invocação. O piso de 10s evita pedir uma janela
       negativa quando as etapas anteriores estouraram sozinhas — nesse
       caso a trava adia todo mundo, que é o desfecho correto. */
    const decorrido = Date.now() - inicioDaRequisicao;
    const restante = Math.max(ORCAMENTO_ENVIO_MS - decorrido, 10_000);

    resposta.relatorios = await dispatchScheduledReports({
      budgetMs:
        Number.isFinite(orcamento) && orcamento > 0
          ? Math.min(Math.max(orcamento, 10_000), 280_000)
          : restante,
      diaForcado:
        Number.isInteger(dia) && dia >= 1 && dia <= 28 ? dia : undefined,
    });
  }

  /* --- 2. Sincronização -------------------------------------------
     Depois dos relatórios, de propósito — ver a nota acima. Fica com o
     tempo que sobrar do teto da função; o que não couber hoje entra na
     rodada de amanhã, porque `mode=month` reprocessa o mês inteiro. */
  if (rodar("sync")) {
    // `mode=month` porque a rodada diária também precisa capturar
    // reatribuições retroativas das plataformas.
    resposta.sync = await syncAllClients({ mode: "month" });
  }

  // 200 mesmo com falhas parciais, pelo mesmo motivo de `sync-ads`: o
  // job RODOU. Um 500 marcaria a invocação inteira como falha e
  // esconderia os clientes que foram atendidos. O detalhe vai no corpo,
  // e cada relatório com problema fica gravado em `report_history` com
  // status 'failed' e a mensagem do provedor.
  return NextResponse.json(resposta, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
