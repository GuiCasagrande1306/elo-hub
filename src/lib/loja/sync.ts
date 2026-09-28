import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dataNoBrasil, mesCorrenteBR } from "@/lib/date-br";
import { isDemoMode } from "@/lib/env";
import { pedidosDaJanela } from "./magazord";

/* =====================================================================
   Sincronização do faturamento da loja
   ---------------------------------------------------------------------
   ⚠️ REPROCESSA A JANELA INTEIRA A CADA RODADA, e isto é obrigatório —
   não é desperdício.

   O status do pedido MUDA depois que ele nasce. Um pedido criado no dia
   20 como "Em Análise" vira "Confirmado" no dia 22 quando o boleto
   compensa, e passa a contar no faturamento do DIA 20. Uma
   sincronização incremental que só olhasse os dias novos jamais
   corrigiria o dia 20 — o faturamento do mês ficaria subestimado para
   sempre, e a diferença cresceria com o volume de boleto e PIX.

   Medido em setembro/2026 no Atacado de Pratas: 6 pedidos ficaram em
   análise e 31 foram cancelados. Os que compensarem depois mudam o
   passado; os que forem cancelados também. Só reprocessando o mês a
   foto fica certa.

   É a mesma razão pela qual a sincronização de anúncios roda em
   `mode=month` — reatribuição retroativa da plataforma.

   `last_synced_at` SÓ É ESCRITO QUANDO DADO ENTRA, e `sync_error` some
   na rodada que dá certo. Escrever a data na falha foi o defeito que
   deixou 46 contas de anúncio dizendo "sincronizado hoje" enquanto
   estavam paradas havia quatro dias.
   ===================================================================== */

export interface ResultadoDaSincronizacao {
  clientId: string;
  clientName: string;
  ok: boolean;
  diasGravados: number;
  pedidosPagos: number;
  receitaCents: number;
  erro?: string;
}

export async function sincronizarLojas(opcoes?: {
  /** Um cliente só — usado pelo backfill e pelo botão avulso. */
  clientId?: string;
  /** Janela explícita. Sem ela, o mês corrente. */
  range?: { inicio: string; fim: string };
}): Promise<ResultadoDaSincronizacao[]> {
  if (isDemoMode) return [];

  const admin = createSupabaseAdminClient();

  let consulta = admin
    .from("store_integrations")
    .select("id, client_id, base_url, clients!inner(name), store_secrets(access_token)")
    .eq("is_active", true);

  if (opcoes?.clientId) consulta = consulta.eq("client_id", opcoes.clientId);

  const { data, error } = await consulta;

  /* Consulta recusada não pode virar "nenhuma loja para sincronizar" —
     é o mesmo erro que fez as contas do Google sumirem do alerta de
     saldo em 19/08/2026, quando uma coluna ausente virou lista vazia. */
  if (error) {
    throw new Error(`Sincronização de lojas: ${error.message}`);
  }

  const mes = mesCorrenteBR();
  const janela = opcoes?.range ?? {
    inicio: mes.start,
    /* Até HOJE e não até o fim do mês: pedir dias que ainda não
       aconteceram não traz nada e, em algumas APIs, esvazia a janela
       inteira. */
    fim: dataNoBrasil(),
  };

  const linhas = (data ?? []) as unknown as {
    id: string;
    client_id: string;
    base_url: string;
    clients?: { name?: string } | null;
    store_secrets?: { access_token?: string | null } | null;
  }[];

  const resultados: ResultadoDaSincronizacao[] = [];

  for (const loja of linhas) {
    const nome = loja.clients?.name ?? loja.client_id;
    const token = loja.store_secrets?.access_token;

    if (!token || !loja.base_url) {
      resultados.push({
        clientId: loja.client_id,
        clientName: nome,
        ok: false,
        diasGravados: 0,
        pedidosPagos: 0,
        receitaCents: 0,
        erro: "sem token ou sem endereço",
      });
      continue;
    }

    const resultado = await pedidosDaJanela(
      loja.base_url,
      token,
      janela.inicio,
      janela.fim,
    );

    /* `null` = não apurou. NUNCA gravar zeros nesse caso: zerar o
       faturamento do mês porque a API não respondeu é o desfecho que
       este módulo inteiro existe para evitar. */
    if (!resultado) {
      await admin
        .from("store_integrations")
        .update({ sync_error: "Não foi possível consultar os pedidos." })
        .eq("id", loja.id);

      resultados.push({
        clientId: loja.client_id,
        clientName: nome,
        ok: false,
        diasGravados: 0,
        pedidosPagos: 0,
        receitaCents: 0,
        erro: "API não respondeu ou recusou",
      });
      continue;
    }

    /* ⚠️ APAGA A JANELA ANTES DE REGRAVAR. Um dia que TINHA pedido e
       passou a não ter — o único do dia foi cancelado — não aparece na
       resposta nova, e um upsert simples deixaria a linha velha de pé,
       com faturamento que não existe mais. */
    await admin
      .from("store_daily")
      .delete()
      .eq("client_id", loja.client_id)
      .gte("metric_date", janela.inicio)
      .lte("metric_date", janela.fim);

    const payload = resultado.dias.map((d) => ({
      client_id: loja.client_id,
      metric_date: d.data,
      orders_paid: d.pedidosPagos,
      revenue_cents: d.receitaCents,
      orders_dropped: d.pedidosDescartados,
      synced_at: new Date().toISOString(),
    }));

    if (payload.length > 0) {
      const { error: erroUpsert } = await admin
        .from("store_daily")
        .upsert(payload, { onConflict: "client_id,metric_date" });

      if (erroUpsert) {
        await admin
          .from("store_integrations")
          .update({ sync_error: `Falha ao gravar: ${erroUpsert.message}` })
          .eq("id", loja.id);

        resultados.push({
          clientId: loja.client_id,
          clientName: nome,
          ok: false,
          diasGravados: 0,
          pedidosPagos: 0,
          receitaCents: 0,
          erro: erroUpsert.message,
        });
        continue;
      }
    }

    await admin
      .from("store_integrations")
      .update({
        last_synced_at: new Date().toISOString(),
        sync_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", loja.id);

    resultados.push({
      clientId: loja.client_id,
      clientName: nome,
      ok: true,
      diasGravados: payload.length,
      pedidosPagos: resultado.dias.reduce((a, d) => a + d.pedidosPagos, 0),
      receitaCents: resultado.dias.reduce((a, d) => a + d.receitaCents, 0),
    });
  }

  return resultados;
}
