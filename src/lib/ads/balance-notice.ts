import "server-only";

import { dataNoBrasil } from "@/lib/date-br";
import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatCurrency } from "@/lib/format";
import { sendTextMessage } from "@/lib/whatsapp";
import { instanceNameFor } from "@/lib/whatsapp/session";
import { getBalanceAlertsAsSystem, type BalanceAlert } from "./balances";

/* =====================================================================
   O aviso diário de saldo
   ---------------------------------------------------------------------
   O QUE ELE CONSERTA. A conta de dias existia e estava certa; o aviso
   não existia. Quem quisesse saber que uma conta zera amanhã precisava
   abrir a página e olhar — o que só acontece depois de alguém
   desconfiar, que é tarde.

   O QUE ENTRA NA MENSAGEM: só `critical` e `stale`. Atenção (até 7 dias)
   fica de fora de propósito — mandar todo dia uma lista de contas que
   estão bem é o caminho conhecido para a equipe parar de ler o aviso, e
   aí o crítico chega junto e passa batido.

   O QUE NÃO ENTRA: `unknown`. Conta sem saldo informado é pendência de
   cadastro, não risco de queda — e são 23 delas. Uma lista de 23 linhas
   dizendo "não sei" todo dia seria exatamente o ruído que faz o aviso
   ser silenciado.
   ===================================================================== */

export interface ResultadoDoAviso {
  enviado: boolean;
  motivo?: string;
  destino?: string;
  criticas?: number;
  desatualizadas?: number;
}

export async function enviarAvisoDeSaldo(): Promise<ResultadoDoAviso> {
  if (isDemoMode) return { enviado: false, motivo: "modo demonstração" };

  const admin = createSupabaseAdminClient();
  const hoje = dataNoBrasil();

  const { data: config } = await admin
    .from("balance_alert_settings")
    .select("group_jid, group_name, sender_id, last_sent_on")
    .eq("id", true)
    .maybeSingle();

  if (!config?.group_jid || !config.sender_id) {
    return { enviado: false, motivo: "nenhum grupo escolhido para o aviso" };
  }

  /* TRAVA DE REPETIÇÃO antes de qualquer trabalho: reexecutar o cron no
     mesmo dia não pode mandar o aviso de novo. */
  if (config.last_sent_on === hoje) {
    return { enviado: false, motivo: "aviso de hoje já foi enviado" };
  }

  const alertas = await getBalanceAlertsAsSystem();
  const criticas = alertas.filter((a) => a.status === "critical");
  const desatualizadas = alertas.filter((a) => a.status === "stale");

  if (criticas.length === 0 && desatualizadas.length === 0) {
    /* NADA A DIZER É NOTÍCIA BOA, e não se manda notícia boa todo dia.
       Também não marca `last_sent_on`: se uma conta virar crítica às
       15h, o aviso de amanhã de manhã ainda é o primeiro do assunto. */
    return { enviado: false, motivo: "nenhuma conta crítica ou desatualizada" };
  }

  const texto = montarMensagem(criticas, desatualizadas);
  const envio = await sendTextMessage(
    config.group_jid,
    texto,
    instanceNameFor(config.sender_id),
  );

  if (!envio.success) {
    return { enviado: false, motivo: envio.error ?? "falha no envio" };
  }

  await admin
    .from("balance_alert_settings")
    .update({ last_sent_on: hoje, updated_at: new Date().toISOString() })
    .eq("id", true);

  return {
    enviado: true,
    destino: config.group_name ?? config.group_jid,
    criticas: criticas.length,
    desatualizadas: desatualizadas.length,
  };
}

/**
 * A mensagem.
 *
 * Sem emoji e sem enfeite: vai para um grupo de trabalho e concorre com
 * conversa. O que precisa saltar é o nome da conta e quantos dias
 * restam — nessa ordem, porque a primeira pergunta de quem lê é "qual
 * conta é a minha".
 */
function montarMensagem(
  criticas: BalanceAlert[],
  desatualizadas: BalanceAlert[],
): string {
  const linhas: string[] = ["*Saldo de mídia — atenção hoje*", ""];

  if (criticas.length > 0) {
    linhas.push(
      criticas.length === 1
        ? "*1 conta prestes a zerar:*"
        : `*${criticas.length} contas prestes a zerar:*`,
    );

    for (const a of criticas) {
      const quando =
        a.daysLeft === 0 ? "acaba hoje" : a.daysLeft === 1 ? "1 dia" : `${a.daysLeft} dias`;

      /* A FORMA DE RECARGA VAI NA LINHA porque decide quem age. "Pix"
         é tarefa para alguém agora; "cartão" pede conferir a cobrança,
         não fazer o pagamento. Sem isso, quem lê o grupo tem de abrir o
         painel só para descobrir o que fazer. */
      const comoRecarrega =
        a.formaDeRecarga === "pix"
          ? " · Pix, recarregar"
          : a.formaDeRecarga === "cartao"
            ? " · cartão, conferir cobrança"
            : "";

      linhas.push(
        `• ${a.clientName} (${a.platform === "meta_ads" ? "Meta" : "Google"}) — ` +
          `${formatCurrency(a.currentBalance ?? 0)}, ${quando}${comoRecarrega}`,
      );
    }
    linhas.push("");
  }

  if (desatualizadas.length > 0) {
    linhas.push(
      desatualizadas.length === 1
        ? "*1 conta com leitura vencida* (segue veiculando, mas o saldo do painel não vale):"
        : `*${desatualizadas.length} contas com leitura vencida* (seguem veiculando, mas o saldo do painel não vale):`,
    );

    for (const a of desatualizadas) {
      const idade =
        a.diasDesdeLeitura === null
          ? ""
          : ` — lido há ${a.diasDesdeLeitura} ${a.diasDesdeLeitura === 1 ? "dia" : "dias"}`;

      linhas.push(
        `• ${a.clientName} (${a.platform === "meta_ads" ? "Meta" : "Google"})${idade}`,
      );
    }
    linhas.push("");
  }

  linhas.push("Conferir em Alertas de saldo.");

  return linhas.join("\n");
}
