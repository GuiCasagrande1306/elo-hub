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
 * (só compras, ou erro na leitura). Sem conversão no período, ou ações
 * de tipos diferentes, viram "Conversões": somar ligação com rota sob o
 * nome de uma delas
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
  /* Sem conversão no período o cartão continua mostrando a linha (ver
     `metricasComNumero`), e o nome do template ("Leads", "Mensagens")
     prometeria o que o Google não mede. */
  if (!data || data.length === 0) return rotulosDe(GENERICO);

  const nomes = new Map<string, Nome>();
  for (const linha of data) {
    const nome = nomeDaAcao(linha.action_name, linha.category);
    if (!nome) return null;
    nomes.set(nome.plural, nome);
  }

  return rotulosDe(nomes.size === 1 ? [...nomes.values()][0] : GENERICO);
}

function rotulosDe(nome: Nome): Partial<Record<MetricKey, string>> {
  const custo = `Custo por ${nome.singular}`;
  return { results: nome.plural, leads: nome.plural, cpa: custo, cpl: custo };
}

/* =====================================================================
   Ligações, rotas e visitas à loja, cada uma no seu cartão
   ---------------------------------------------------------------------
   Pedido da Padá e da Kalik (03/11/2026): o cartão do Google dizia
   "Conversões", e o dono da loja quer saber quantos LIGARAM e quantos
   pediram rota. Na Kalik, outubro: 219 cliques para ligar, 165 rotas e
   84 visitas à loja dentro de um "Conversões 303".

   Ação local do Perfil da Empresa só existe em `all_conversions` (ver
   `categorias-google.ts`); a ação que é conversão de verdade vem em
   `conversions`. Por isso o número de cada cartão é `conversions` quando
   a ação tem alguma na janela, e `all_conversions` quando não tem —
   a Kalik tem 84 visitas à loja em `conversions` e 169 em `all`, e o
   que o Google mostra na coluna principal é 84.
   ===================================================================== */

export interface AcaoDoGoogle {
  chave: string;
  label: string;
  atual: number;
  anterior: number;
  /** Entra no relatório automático. Com métricas escolhidas, vale a escolha. */
  automatica: boolean;
}

const ACOES_LOCAIS: { chave: string; label: string; casa: (nome: string, cat: string | null) => boolean }[] = [
  {
    chave: "google_ligacoes",
    label: "Ligações",
    casa: (n, c) => c === "PHONE_CALL_LEAD" || /call|ligar|liga[cç]/i.test(n),
  },
  { chave: "google_rotas", label: "Rotas", casa: (n, c) => c === "GET_DIRECTIONS" || /direction/i.test(n) },
  { chave: "google_visitas_loja", label: "Visitas à loja", casa: (_n, c) => c === "STORE_VISIT" },
];

/** Negócio local vê ligação e rota mesmo zeradas: zero ali é a notícia. */
const SEMPRE_NO_NEGOCIO_LOCAL = new Set(["google_ligacoes", "google_rotas"]);

export async function acoesDoGoogle(
  clientId: string,
  segmento: string | null,
  anteriorInicio: string,
  inicio: string,
  fim: string,
): Promise<AcaoDoGoogle[]> {
  if (isDemoMode) return [];

  const { data, error } = await createSupabaseAdminClient()
    .from("google_conversion_daily")
    .select("metric_date, action_name, category, conversions, all_conversions")
    .eq("client_id", clientId)
    .gte("metric_date", anteriorInicio)
    .lte("metric_date", fim);

  if (error) {
    console.error("[relatorio] ações do Google:", error.message);
    return [];
  }

  return ACOES_LOCAIS.flatMap(({ chave, label, casa }): AcaoDoGoogle[] => {
    const linhas = (data ?? []).filter((l) => casa(l.action_name ?? "", l.category));
    const usaPrincipal = linhas.some((l) => Number(l.conversions) > 0);
    const soma = (de: string, ate: string) =>
      linhas
        .filter((l) => l.metric_date >= de && l.metric_date <= ate)
        .reduce((s, l) => s + Number(usaPrincipal ? l.conversions : l.all_conversions), 0);

    const atual = soma(inicio, fim);
    const anterior = soma(anteriorInicio, diaAntes(inicio));
    const automatica =
      atual > 0 || anterior > 0 || (segmento === "local_business" && SEMPRE_NO_NEGOCIO_LOCAL.has(chave));
    return [{ chave, label, atual, anterior, automatica }];
  });
}

function diaAntes(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
