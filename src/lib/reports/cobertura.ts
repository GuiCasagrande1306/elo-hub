import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dataNoBrasil } from "@/lib/date-br";
import { isDemoMode } from "@/lib/env";
import { estadoDaJanela, type EstadoDaJanela } from "./janela-coberta";

/* =====================================================================
   A janela deste relatório está coberta pelo dado?
   ---------------------------------------------------------------------
   A estação de comando já pergunta isso antes de liberar o botão, com
   os números que ela tem na tela. Este arquivo responde a mesma
   pergunta no SERVIDOR, para os caminhos em que não há tela:

     • o robô da madrugada, que prepara os relatórios do dia
     • a fila, que despacha um relatório já preparado

   ⚠️ O ROBÔ NÃO ENVIA, e é por isso que a fila entra aqui. Ele chama o
   orquestrador com `deliver: "none"`: gera, arquiva e para. Quem aperta
   o botão é sempre uma pessoa — e, até 22/09/2026, a pessoa que apertava
   na FILA não passava por trava nenhuma. A trava da estação cobria só
   quem gerava por lá.

   O caso que isto impede é o mesmo de sempre: em 22/09/2026, 46 das 52
   integrações Meta estavam com o token invalidado desde o dia 18. O robô
   preparou relatórios de 15–21/09 com quatro dias de dado, eles
   apareceram na fila como prontos, e nada dizia que a semana estava pela
   metade.

   A REGRA É A MESMA FUNÇÃO da tela — `estadoDaJanela`, com teste de
   mesa. Duas implementações da mesma decisão divergiriam, e o sintoma
   seria a tela barrando e a fila deixando passar.

   SERVICE_ROLE porque o robô não tem sessão. Não há vazamento: quem
   chega aqui já provou que enxerga a conta, pela RLS, antes de pedir o
   envio.
   ===================================================================== */

export interface Cobertura extends EstadoDaJanela {
  /** Último dia da janela com linha de métrica. `null` = nenhuma. */
  ultimoDiaComDado: string | null;
  /** Nenhuma linha no período — o caso que a trava antiga já pegava. */
  semDado: boolean;
}

export async function coberturaDaJanela(
  clientId: string,
  inicio: string,
  fim: string,
): Promise<Cobertura> {
  const vazio = {
    incompleta: false,
    naoApurada: false,
    ultimoDiaComDado: null,
    semDado: false,
  };
  if (isDemoMode) return vazio;

  const admin = createSupabaseAdminClient();

  /* A MAIOR data, não a lista inteira: uma janela de um mês com carteira
     grande traria milhares de linhas para calcular um máximo. */
  const [{ data: ultima }, { data: integracoes }] = await Promise.all([
    admin
      .from("daily_metrics")
      .select("metric_date")
      .eq("client_id", clientId)
      .gte("metric_date", inicio)
      .lte("metric_date", fim)
      .order("metric_date", { ascending: false })
      .limit(1),
    admin
      .from("client_integrations")
      .select("sync_error, last_synced_at")
      .eq("client_id", clientId)
      .eq("is_active", true),
  ]);

  const ultimoDiaComDado =
    (ultima?.[0]?.metric_date as string | undefined) ?? null;

  /* A conta pode ter Meta e Google. Erro em qualquer uma compromete a
     janela, e a data que vale é a MAIS ANTIGA: a janela só está coberta
     quando todas cobriram. */
  const linhas = (integracoes ?? []) as {
    sync_error: string | null;
    last_synced_at: string | null;
  }[];

  const comErro = linhas.some((l) => Boolean(l.sync_error));
  const datas = linhas.map((l) =>
    l.last_synced_at ? dataNoBrasil(l.last_synced_at) : null,
  );

  /* Uma integração que NUNCA sincronizou derruba a garantia inteira, por
     isso `null` vence a comparação em vez de ser ignorado. Sem nenhum
     nulo, vale a data mais antiga. */
  const ate = datas.includes(null)
    ? null
    : ([...datas].sort()[0] as string | undefined) ?? null;

  /* Conta sem integração ativa nenhuma: não há coleta para estar
     atrasada, e o relatório é de dado importado à mão ou antigo. Deixa
     passar — barrar aqui pararia um caso legítimo por falta de
     informação, que é o oposto do que esta trava existe para fazer. */
  if ((integracoes ?? []).length === 0) {
    return { ...vazio, ultimoDiaComDado, semDado: ultimoDiaComDado === null };
  }

  const semDado = ultimoDiaComDado === null;

  return {
    ...estadoDaJanela({
      fim,
      hoje: dataNoBrasil(),
      ultimoDiaComDado,
      semDado,
      sincronizacao: { comErro, ate },
    }),
    ultimoDiaComDado,
    semDado,
  };
}
