import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTextMessage } from "@/lib/whatsapp";
import { instanceNameFor } from "@/lib/whatsapp/session";
import { serverEnv } from "@/lib/env";
import type { RelatorioDeDisparo } from "./schedule";

/* =====================================================================
   "Os relatórios das 9h estão prontos"
   ---------------------------------------------------------------------
   O robô PREPARA; quem envia é uma pessoa. Essa decisão é antiga e
   continua valendo — o PDF sai do WhatsApp de quem clicou, não de um
   número da agência, e ninguém quer um relatório indo para o grupo do
   cliente sem alguém ter olhado.

   O que faltava era o aviso. Um PDF pronto às 8h só vira conversa
   quando alguém abre a tela de relatórios e repara — e a tela não avisa
   nada sozinha. Na prática o documento esperava até alguém lembrar.

   REAPROVEITA O CANAL DO AVISO DE SALDO, de propósito. Já existe um
   grupo interno escolhido e um remetente configurado em
   `balance_alert_settings`; criar uma segunda configuração significaria
   duas telas, duas chances de esquecer, e um dia em que um dos dois
   canais está apontando para o grupo errado.

   SILENCIOSO QUANDO NÃO HÁ O QUE DIZER. Rodada sem nada preparado não
   manda mensagem — o gatilho roda de hora em hora, e um "nenhum
   relatório nesta hora" 24 vezes por dia é o jeito mais rápido de o
   grupo silenciar a notificação.
   ===================================================================== */

export interface ResultadoDoAviso {
  enviado: boolean;
  motivo?: string;
  destino?: string;
}

export async function avisarRelatoriosProntos(
  disparo: RelatorioDeDisparo,
): Promise<ResultadoDoAviso> {
  if (disparo.preparados.length === 0 && disparo.falhas.length === 0) {
    return { enviado: false, motivo: "nada preparado nesta rodada" };
  }

  const admin = createSupabaseAdminClient();

  const { data: config } = await admin
    .from("balance_alert_settings")
    .select("group_jid, group_name, sender_id")
    .eq("id", true)
    .maybeSingle();

  if (!config?.group_jid || !config.sender_id) {
    /* Não é erro: é configuração que ainda não foi feita. O relatório
       continua pronto na tela, e quem abrir vai encontrá-lo. */
    return { enviado: false, motivo: "nenhum grupo interno escolhido" };
  }

  const envio = await sendTextMessage(
    config.group_jid,
    montarAviso(disparo),
    instanceNameFor(config.sender_id),
  );

  return envio.success
    ? { enviado: true, destino: config.group_name ?? config.group_jid }
    : { enviado: false, motivo: envio.error ?? "falha no envio" };
}

/* ------------------------------------------------------------------ */

/**
 * O texto do aviso.
 *
 * SEM EMOJI E SEM ENFEITE — mesma régua do aviso de saldo: vai para um
 * grupo de trabalho e concorre com conversa de verdade.
 *
 * AS FALHAS VÊM JUNTO, e antes do link. Um relatório que não gerou é a
 * única linha que exige ação hoje; enterrá-la depois de oito nomes que
 * deram certo é a forma mais confiável de ela passar batido.
 */
function montarAviso(disparo: RelatorioDeDisparo): string {
  const linhas: string[] = [];

  if (disparo.falhas.length > 0) {
    linhas.push(
      disparo.falhas.length === 1
        ? "1 relatório NÃO gerou:"
        : `${disparo.falhas.length} relatórios NÃO geraram:`,
    );
    for (const f of disparo.falhas) {
      /* `erro` é a mensagem técnica; `motivo`, a explicação em
         português. A segunda quando existe — o grupo não precisa do
         código de erro do Postgres. */
      const porque = f.motivo ?? f.erro;
      linhas.push(`- ${f.nome}${porque ? ` (${porque})` : ""}`);
    }
    linhas.push("");
  }

  if (disparo.preparados.length > 0) {
    linhas.push(
      disparo.preparados.length === 1
        ? "1 relatório pronto para enviar:"
        : `${disparo.preparados.length} relatórios prontos para enviar:`,
    );
    for (const p of disparo.preparados) {
      linhas.push(`- ${p.nome}`);
    }
    linhas.push("");
    linhas.push(
      `Confira e dispare em ${serverEnv.appUrl.replace(/\/$/, "")}/relatorios`,
    );
  }

  return linhas.join("\n").trim();
}
