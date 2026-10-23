import "server-only";

import { isDemoMode } from "@/lib/env";
import type { MetricKey } from "@/types/database";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* =====================================================================
   O nome real da conversão do Google no relatório
   ---------------------------------------------------------------------
   O template dá UM nome para a conversão da conta inteira — no negócio
   local, "Visitas ao perfil", que é o que a Meta mede. O cartão do Google
   herdava esse nome para outra coisa: na Belz (16–22/10/2026) as "14
   visitas ao perfil" do Google eram 14 cliques em "Ligar" no Perfil da
   Empresa ("Business profile - Call").

   O nome sai das ações que o Google registrou no período
   (`google_conversion_daily`), pelo nome da ação e pela categoria.
   ===================================================================== */

type Nome = { plural: string; singular: string };

const PELO_NOME: [RegExp, Nome][] = [
  [/call|ligar|liga[cç]/i, { plural: "Ligações", singular: "ligação" }],
  [/direction|rota/i, { plural: "Rotas", singular: "rota" }],
  [/website|site/i, { plural: "Cliques no site", singular: "clique no site" }],
  [/whatsapp/i, { plural: "Conversas no WhatsApp", singular: "conversa" }],
];

const PELA_CATEGORIA: Record<string, Nome> = {
  PHONE_CALL_LEAD: { plural: "Ligações", singular: "ligação" },
  CONTACT: { plural: "Contatos", singular: "contato" },
  GET_DIRECTIONS: { plural: "Rotas", singular: "rota" },
  SUBMIT_LEAD_FORM: { plural: "Formulários", singular: "formulário" },
  BOOK_APPOINTMENT: { plural: "Agendamentos", singular: "agendamento" },
  REQUEST_QUOTE: { plural: "Orçamentos", singular: "orçamento" },
  SIGNUP: { plural: "Cadastros", singular: "cadastro" },
};

const GENERICO: Nome = { plural: "Conversões", singular: "conversão" };

/** `null` para compra: aí o nome do template ("Pedidos", "Vendas") já serve. */
function nomeDaAcao(acao: string | null, categoria: string | null): Nome | null {
  if (categoria === "PURCHASE") return null;
  for (const [padrao, nome] of PELO_NOME) if (acao && padrao.test(acao)) return nome;
  return (categoria && PELA_CATEGORIA[categoria]) || GENERICO;
}

/**
 * Rótulos para o cartão do Google, ou `null` para manter os do template
 * (sem conversão no período, ou só compras). Ações de tipos diferentes
 * viram "Conversões": somar ligação com rota sob o nome de uma delas
 * repetiria o erro que este arquivo corrige.
 */
export async function rotulosDoGoogle(
  clientId: string,
  inicio: string,
  fim: string,
): Promise<Partial<Record<MetricKey, string>> | null> {
  if (isDemoMode) return null;

  const { data, error } = await createSupabaseAdminClient()
    .from("google_conversion_daily")
    .select("action_name, category, conversions")
    .eq("client_id", clientId)
    .gte("metric_date", inicio)
    .lte("metric_date", fim)
    .gt("conversions", 0);

  if (error) {
    console.error("[relatorio] conversões do Google:", error.message);
    return null;
  }
  if (!data || data.length === 0) return null;

  const nomes = new Map<string, Nome>();
  for (const linha of data) {
    const nome = nomeDaAcao(linha.action_name, linha.category);
    if (!nome) return null;
    nomes.set(nome.plural, nome);
  }

  const nome = nomes.size === 1 ? [...nomes.values()][0] : GENERICO;
  const custo = `Custo por ${nome.singular}`;
  return { results: nome.plural, leads: nome.plural, cpa: custo, cpl: custo };
}
