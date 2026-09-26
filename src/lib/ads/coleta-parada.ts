import "server-only";

import { dataNoBrasil } from "@/lib/date-br";
import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AdPlatform } from "@/types/database";
import type { IntegracaoParada } from "./aviso-da-coleta";

/* Os tipos e o texto do aviso moram em `aviso-da-coleta.ts`, que é puro
   e por isso testável de mesa. Aqui fica só a medição, que precisa de
   service_role. */
export type { CausaDaParada, IntegracaoParada } from "./aviso-da-coleta";

/* =====================================================================
   Quais contas pararam de trazer dado
   ---------------------------------------------------------------------
   O QUE ISTO CONSERTA, e custou caro. Em 18/09/2026 a conta de Facebook
   que autorizava a carteira inteira foi restringida pela Meta. Os tokens
   morreram todos juntos, com erro 190, e a coleta de mídia paga parou.

   NINGUÉM SOUBE POR QUATRO DIAS. O sistema tinha o sintoma gravado em
   `client_integrations.sync_error` desde a primeira madrugada, e nada
   levava aquilo a um ser humano: a tela só conta quando alguém abre, e
   o relatório de 15–21/09 chegou à fila somando quatro dias de dado
   rotulados como sete. Só em 22/09 alguém desconfiou.

   Por que ficou invisível tanto tempo: `last_synced_at` era escrito
   TAMBÉM no caminho de falha, então as 46 integrações mortas exibiam
   "sincronizado hoje às 10:05". Esse defeito foi consertado em
   `recordFailure`; este arquivo é a outra metade — fazer a falha SAIR do
   sistema em vez de esperar ser encontrada.

   ONDE SAI: no aviso diário de saldo, que já vai para o grupo de
   trabalho e já é lido. Mensagem nova seria mais um canal para alguém
   silenciar; e as duas coisas se lêem juntas, porque a projeção de
   "quantos dias restam" é calculada sobre o gasto de `daily_metrics` —
   com a coleta parada, ela envelhece sem avisar.
   ===================================================================== */

/**
 * Dias sem dado que ainda não são notícia.
 *
 * DOIS, e não um: o cron roda uma vez por dia e pode falhar sozinho — um
 * limite de um dia dispararia a cada rodada perdida, e um aviso que grita
 * por acidente é um aviso que a equipe aprende a ignorar. Dois dias são
 * duas rodadas, o que já não é acidente.
 *
 * Não atrasa o caso que importa: token morto grava `sync_error` na
 * primeira madrugada e entra pelo caminho rápido, no dia seguinte.
 */
const DIAS_TOLERADOS = 2;

/**
 * Os códigos que só uma reautorização resolve.
 *
 * Separados dos outros porque a AÇÃO é diferente, e é a ação que decide
 * se o aviso serve: "reautorizar" é tarefa de alguém agora, com nome e
 * botão; "erro da plataforma" é investigação. Misturar os dois produz
 * uma lista onde ninguém sabe o que fazer com a própria linha.
 */
const PEDEM_REAUTORIZACAO = new Set(["auth_expired", "not_configured"]);

export async function coletaParada(): Promise<IntegracaoParada[]> {
  if (isDemoMode) return [];

  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("client_integrations")
    .select(
      /* LITERAL, nunca concatenado — o tipo do retorno é inferido do
         texto do select em tempo de compilação. */
      "client_id, platform, external_account_id, last_synced_at, sync_error, authorized_by_name, clients!inner(name, status)",
    )
    .eq("is_active", true);

  /* ERRO DE CONSULTA NÃO PODE VIRAR "ESTÁ TUDO BEM". Devolver `[]` aqui
     faria o aviso jurar que a coleta está em pé justamente quando o
     banco recusou a pergunta — e este módulo existe por causa de quatro
     dias de silêncio. Lançar deixa o cron gravar o motivo na resposta,
     que é visível; o `try/catch` da etapa impede que isto derrube o
     aviso de saldo. */
  if (error) {
    throw new Error(`Coleta parada: consulta recusada pelo banco — ${error.message}`);
  }

  const hoje = dataNoBrasil();
  const paradas: IntegracaoParada[] = [];

  /* `as unknown as` porque o PostgREST tipa o embed como array mesmo
     quando a relação é um-para-um — é o mesmo contorno de
     `instagram-vinculado.ts`. */
  for (const linha of (data ?? []) as unknown as {
    client_id: string;
    platform: AdPlatform;
    external_account_id: string | null;
    last_synced_at: string | null;
    sync_error: string | null;
    authorized_by_name: string | null;
    clients?: { name?: string; status?: string } | null;
  }[]) {
    /* ⚠️ ATIVO **E** EM ONBOARDING, e aqui esta função DIVERGE de
       propósito do alerta de saldo, que filtra só `active`.

       A divergência tem razão: o alerta de saldo precisa de um saldo
       informado à mão, coisa que cliente em onboarding raramente tem —
       incluí-lo ali só produziria linhas "não sei". Aqui basta existir
       integração coletando, e é o caso: cliente em onboarding já tem
       campanha rodando. Deixá-lo de fora significaria descobrir a coleta
       quebrada no PRIMEIRO relatório dele, que é a pior hora possível.

       Pausado e encerrado ficam de fora: não coletam por decisão nossa,
       e listá-los inventaria urgência. */
    if (!["active", "onboarding"].includes(linha.clients?.status ?? "")) continue;

    /* `pending:` FICA DE FORA. É consentimento dado sem conta de anúncio
       escolhida: coleta nenhuma, mas por cadastro incompleto, não por
       coleta interrompida. O cartão do cliente já mostra isso como
       "autorizado — falta escolher a conta", e jogar aqui misturaria
       pendência de cadastro com queda de produção. */
    if ((linha.external_account_id ?? "").startsWith("pending:")) continue;
    if (!linha.external_account_id) continue;

    const diasSemDado = linha.last_synced_at
      ? diasEntre(dataNoBrasil(linha.last_synced_at), hoje)
      : null;

    /* ⚠️ O ERRO VEM PRIMEIRO, e é o caminho rápido. `sync_error` aparece
       na primeira madrugada em que a plataforma recusa; esperar o
       contador de dias custaria justamente os dias que este módulo
       existe para não perder. */
    if (linha.sync_error) {
      const codigo = linha.sync_error.match(/^\[([a-z_]+)\]/)?.[1] ?? "";
      paradas.push({
        clientId: linha.client_id,
        clientName: linha.clients?.name ?? linha.client_id,
        platform: linha.platform,
        causa: PEDEM_REAUTORIZACAO.has(codigo) ? "reautorizar" : "erro",
        detalhe: linha.sync_error.replace(/^\[[a-z_]+\]\s*/, "") || null,
        diasSemDado,
        autorizadoPor: linha.authorized_by_name,
      });
      continue;
    }

    /* Sem erro e sem dado: a rodada não chegou nesta conta. Acontece
       quando o cron estoura o teto de tempo antes de terminar a
       carteira — silencioso por natureza, porque não há falha para
       gravar em lugar nenhum. */
    if (diasSemDado === null || diasSemDado > DIAS_TOLERADOS) {
      paradas.push({
        clientId: linha.client_id,
        clientName: linha.clients?.name ?? linha.client_id,
        platform: linha.platform,
        causa: "sem_dado",
        detalhe: null,
        diasSemDado,
        autorizadoPor: linha.authorized_by_name,
      });
    }
  }

  /* Mais tempo parada primeiro: é a que já estragou mais relatório.
     `null` (nunca coletou) vai na frente de todas. */
  return paradas.sort(
    (a, b) => (b.diasSemDado ?? 9999) - (a.diasSemDado ?? 9999),
  );
}

/** Dias inteiros entre duas datas YYYY-MM-DD, no fuso do Brasil. */
function diasEntre(deISO: string, ateISO: string): number {
  const de = Date.parse(`${deISO}T12:00:00Z`);
  const ate = Date.parse(`${ateISO}T12:00:00Z`);
  return Math.round((ate - de) / 86_400_000);
}
