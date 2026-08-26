"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";

import { isDemoMode } from "@/lib/env";
import { brandColorFromName } from "@/lib/brand-color";
import { dataNoBrasil, mesCorrenteBR } from "@/lib/date-br";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  defaultGoalMetricFor,
  parseGoalInput,
} from "@/lib/metrics/goal-metric";
import {
  clientFormSchema,

  parseCurrencyToCents,
  newClientSchema,
  toClientPayload,
  type NewClientValues,
} from "@/lib/validation/client";
import type { Client, ClientSegment } from "@/types/database";

/**
 * Cadastro de novo cliente.
 *
 * Delega para a função `create_client_with_setup`, que grava cliente,
 * meta e integrações numa ÚNICA transação. Três inserts separados daqui
 * deixariam lixo permanente se o segundo falhasse — um cliente sem meta
 * ou sem integração, que ninguém percebe até o card aparecer vazio.
 *
 * A RPC é SECURITY INVOKER, então cada INSERT lá dentro continua sob
 * RLS. Desde a migration 23 toda a equipe cadastra — mas editar e
 * apagar seguem restritos a admin. Não há checagem de papel aqui de
 * propósito: quem decide é o banco, não a aplicação.
 */
export type CreateClientResult =
  | { ok: true; client: Pick<Client, "id" | "name" | "slug"> }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createClientAction(
  input: NewClientValues,
): Promise<CreateClientResult> {
  // Revalida no servidor: Server Action é endpoint HTTP público, o
  // payload não é confiável só por ter vindo do nosso formulário.
  const parsed = newClientSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: "Confira os campos destacados.",
      fieldErrors: z_flatten(parsed.error),
    };
  }

  const values = parsed.data;

  if (isDemoMode) {
    const { demoClients, demoGoals } = await import("@/lib/mock/data");
    const slug = slugify(
      values.name,
      demoClients.map((c) => c.slug),
    );
    // Um id só: calcular `Date.now()` duas vezes devolveria um id
    // diferente do que foi gravado se o milissegundo virasse no meio.
    const id = `c-${Date.now()}`;
    const payload = toClientPayload(values);

    demoClients.push({
      id,
      name: values.name,
      legal_name: null,
      slug,
      segment: values.segment,
      status: values.status,
      logo_url: null,
      brand_primary: brandColorFromName(values.name),
      agency_partner: values.agencyPartner,
      brand_secondary: null,
      brand_font: null,
      website: values.website ?? null,
      contact_name: values.contactName ?? null,
      contact_email: values.contactEmail ?? null,
      whatsapp_phone: values.whatsappPhone ?? null,
      persona: {},
      contract_start: new Date().toISOString().slice(0, 10),
      // Cliente novo entra sem envio automático: o dia é combinado em
      // contrato, e ligar por padrão mandaria relatório para um grupo
      // que talvez ainda nem exista.
      report_day: null,
      report_enabled: false,
      report_hour: 8,
      optimization_day: values.optimizationDay
        ? Number(values.optimizationDay)
        : null,
      owner_id: "u-admin",
      created_at: new Date().toISOString(),
    });

    // A RPC cria a meta na mesma transação; o modo demo precisa fazer o
    // mesmo, senão o usuário preenche orçamento e resultados e o card
    // aparece dizendo "definir meta do período".
    if (payload.p_planned_budget_cents > 0 || payload.p_planned_results > 0) {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const iso = (d: Date) => d.toISOString().slice(0, 10);

      demoGoals.push({
        id: `g-${id}`,
        client_id: id,
        period_start: iso(start),
        period_end: iso(end),
        planned_budget_cents: payload.p_planned_budget_cents,
        planned_results: payload.p_planned_results,
        /* Espelha o trigger `client_goals_default_metric`: no banco a
           unidade vem do segmento no INSERT, e o modo demo precisa
           gravar a mesma coisa ou o card demo lê centavos como
           contagem. */
        results_metric: defaultGoalMetricFor(values.segment).key,
        executed_budget_cents_override: null,
        executed_results_override: null,
        override_reason: null,
        notes: null,
        created_at: iso(now),
      });
    }

    revalidatePath("/clientes");
    return { ok: true, client: { id, name: values.name, slug } };
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .rpc("create_client_with_setup", toClientPayload(values))
    .single();

  if (error) {
    // 42501 = violação de policy. Traduzimos porque a mensagem crua do
    // Postgres não diz nada a quem está preenchendo um formulário.
    if (error.code === "42501") {
      return {
        ok: false,
        error:
          "O banco recusou o cadastro. Recarregue e tente de novo; se persistir, avise um administrador.",
      };
    }
    return { ok: false, error: error.message };
  }

  const client = data as Client;

  /* A RPC não conhece `agency_partner` — a coluna nasceu depois, com
     default 'Elo Marketing'. Ajustar aqui em vez de recriar a função
     evita mexer numa transação que já grava cliente, meta e integração
     juntos. Só escreve quando difere do default: terceirização é a
     minoria da carteira.

     Falhar aqui não desfaz o cadastro — o cliente existe e cai na
     agência padrão, que é corrigível na tela de ajustes. */
  if (values.agencyPartner !== "Elo Marketing") {
    await supabase
      .from("clients")
      .update({ agency_partner: values.agencyPartner })
      .eq("id", client.id);
  }

  // A listagem também recebe o evento de Realtime (`clients` está na
  // publicação), mas revalidar garante o dado novo mesmo se o socket
  // tiver caído — o cliente precisa aparecer, não "geralmente aparecer".
  revalidatePath("/clientes");
  revalidatePath("/");

  return {
    ok: true,
    client: { id: client.id, name: client.name, slug: client.slug },
  };
}

/* ------------------------------------------------------------------ */

/** Espelha a geração de slug da RPC, para o modo demo. */
function slugify(name: string, taken: string[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "cliente";

  let slug = base;
  let suffix = 1;
  while (taken.includes(slug)) {
    suffix += 1;
    slug = `${base}-${suffix}`;
  }
  return slug;
}

function z_flatten(error: ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_");
    (result[key] ??= []).push(issue.message);
  }
  return result;
}

/**
 * Define a conta de anúncios de uma integração já autorizada.
 *
 * O OAuth grava o token antes de saber QUAL conta usar — a pessoa
 * autoriza o Facebook dela, que pode ter várias contas de anúncio.
 * Este passo fecha o vínculo.
 */
export async function setAdAccountId(input: {
  clientId: string;
  platform: "meta_ads" | "google_ads";
  externalAccountId: string;
}): Promise<
  { ok: true; warning?: string } | { ok: false; error: string }
> {
  const valor = input.externalAccountId.trim();

  if (!valor) {
    return { ok: false, error: "Informe o ID da conta." };
  }

  /* Meta usa `act_<numero>`; Google usa 10 dígitos com ou sem hífen.
     Validar aqui evita uma sincronização que falha só no dia seguinte,
     quando o cron rodar e ninguém estiver olhando. */
  const formatoOk =
    input.platform === "meta_ads"
      ? /^act_\d{6,}$/.test(valor)
      : /^\d{3}-?\d{3}-?\d{4}$/.test(valor);

  if (!formatoOk) {
    return {
      ok: false,
      error:
        input.platform === "meta_ads"
          ? 'A conta do Meta tem o formato "act_123456789".'
          : 'O Customer ID do Google tem 10 dígitos, como "123-456-7890".',
    };
  }

  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();

  const { error, count } = await supabase
    .from("client_integrations")
    .update(
      {
        external_account_id:
          input.platform === "google_ads" ? valor.replace(/-/g, "") : valor,
        sync_error: null,
      },
      { count: "exact" },
    )
    .eq("client_id", input.clientId)
    .eq("platform", input.platform);

  if (error) return { ok: false, error: error.message };

  /* ZERO LINHAS NÃO É SUCESSO, e sem esta guarda era: um `update` que
     não casa nada devolve `error: null`, a action respondia `ok: true` e
     a tela dizia "Conta vinculada" sobre um vínculo que não existe.

     O caso não é hipotético. A linha de `client_integrations` nasce no
     OAUTH — `saveIntegrationTokens` a cria com o marcador `pending:` e o
     token —, e este passo só TROCA o marcador pela conta escolhida. Um
     cliente que nunca autorizou não tem linha para trocar.

     Medido em 25/08/2026: onze clientes sem conta ligada, oito deles sem
     integração nenhuma, quatro com conta ATIVA na Meta e gasto real
     invisível para o painel — Terras Altas com R$9.316 e Till Burguer
     com R$3.161 de histórico. Não dá para provar que todos caíram aqui,
     mas é o único caminho no sistema que devolve "deu certo" sem ter
     feito nada. */
  if (count === 0) {
    return {
      ok: false,
      error:
        input.platform === "meta_ads"
          ? 'Este cliente ainda não autorizou o Meta. Clique em "Vincular" para conectar a conta do Facebook antes de informar o ID.'
          : 'Este cliente ainda não autorizou o Google Ads. Clique em "Vincular" antes de informar o Customer ID.',
    };
  }

  /* Puxa os números AGORA.
     ---------------------------------------------------------------
     Vincular a conta e buscar as métricas eram passos separados, e o
     único gatilho do sync era o cron das 06:20. Quem conectava um
     cliente durante o dia via o card seguir zerado até a manhã
     seguinte — sem erro, sem aviso, com cara de integração quebrada.
     Foi exatamente o que aconteceu no Brazzo Pizza.

     Falhar aqui NÃO invalida o vínculo: a conta já está gravada e o
     cron reprocessa amanhã. Por isso o erro do sync vira aviso e não
     desfaz nada — e o `catch` existe porque uma exceção da Meta não
     pode derrubar um vínculo que já foi persistido. */
  let syncAviso: string | undefined;
  try {
    const { syncAllClients } = await import("@/lib/ads/sync");
    const r = await syncAllClients({ mode: "month", clientId: input.clientId });
    if (r.failed > 0) {
      syncAviso =
        r.results.find((x) => !x.ok)?.message ??
        "Conta vinculada, mas a primeira sincronização falhou.";
    }
  } catch {
    syncAviso = "Conta vinculada, mas não consegui buscar os números agora.";
  }

  revalidatePath("/clientes");
  revalidatePath("/performance");
  return syncAviso ? { ok: true, warning: syncAviso } : { ok: true };
}

/**
 * Marca a conta como pré-paga ou pós-paga.
 *
 * Só conta pré-paga entra no alerta de saldo. O padrão do banco é
 * `postpaid`, então conta nova nasce fora do alerta — errar para o lado
 * do silêncio é melhor que para o do alarme falso, que treina a equipe
 * a ignorar a tela.
 */
export async function setBillingType(input: {
  clientId: string;
  platform: "meta_ads" | "google_ads";
  billingType: "prepaid" | "postpaid";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("client_integrations")
    .update({ billing_type: input.billingType })
    .eq("client_id", input.clientId)
    .eq("platform", input.platform);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/clientes");
  revalidatePath("/alertas-saldo");
  return { ok: true };
}

/**
 * Liga e desliga uma plataforma para este cliente.
 *
 * A coluna `is_active` sempre existiu e SEMPRE ESTEVE LIGADA — 60 de 60
 * integrações em 25/08/2026 — porque nunca houve tela para desligá-la.
 * O efeito aparecia no aviso diário de saldo: contas que a agência
 * deliberadamente não roda numa plataforma apareciam como "R$ 0,00,
 * acaba hoje", quinze delas de uma vez, e o aviso que deveria apontar
 * três urgências virava uma lista que ninguém lê até o fim.
 *
 * ⚠️ DESLIGAR PARA MAIS DO QUE O ALERTA. `is_active` é o mesmo filtro
 * que a sincronização usa (`lib/ads/sync.ts`), o saldo, a estrutura de
 * campanhas e a checagem de Instagram. Plataforma desligada deixa de
 * trazer número novo. O histórico já sincronizado FICA — vive em
 * `daily_metrics`, que não é tocado aqui —, então relatório de período
 * passado continua correto.
 *
 * É o comportamento certo para o caso real ("este cliente não roda
 * Google"), e é por isso que a tela diz isso em vez de prometer só
 * silenciar um aviso.
 */
export async function setIntegrationActive(input: {
  clientId: string;
  platform: "meta_ads" | "google_ads";
  active: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("client_integrations")
    .update({ is_active: input.active })
    .eq("client_id", input.clientId)
    .eq("platform", input.platform);

  if (error) {
    return {
      ok: false,
      error:
        error.code === "42501"
          ? "O banco recusou a alteração. Fale com um administrador."
          : error.message,
    };
  }

  revalidatePath("/clientes");
  revalidatePath("/alertas-saldo");
  return { ok: true };
}

/**
 * Define a meta do período corrente.
 *
 * `upsert` em `(client_id, period_start)`, que é a chave única da
 * tabela: mexer na meta do mês é editar a linha existente, não empilhar
 * uma nova. Sem isso o card leria a mais antiga e ignoraria a correção.
 *
 * O período é o MÊS CIVIL. Meta de mídia se acerta com fatura, e fatura
 * fecha no mês — deixar o usuário escolher datas soltas criaria metas
 * sobrepostas que nenhum gráfico saberia somar.
 */
export async function setClientGoal(input: {
  clientId: string;
  plannedBudget: string;
  plannedResults: string;
  /**
   * Segmento da conta, para saber se `plannedResults` chegou em reais
   * ou em unidades. Vem do formulário porque é lá que o rótulo do campo
   * foi escolhido — buscar o segmento aqui abriria a chance de gravar
   * numa unidade diferente da que o usuário viu escrita na tela.
   */
  segment: ClientSegment;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const orcamento = parseCurrencyToCents(input.plannedBudget);
  const metrica = defaultGoalMetricFor(input.segment);
  const resultados = parseGoalInput(metrica, input.plannedResults);

  if (orcamento === null) {
    return { ok: false, error: "Informe o orçamento previsto." };
  }
  if (resultados === null) {
    return { ok: false, error: `Informe a ${metrica.inputLabel.toLowerCase()}.` };
  }

  /* Mês no fuso de São Paulo. `new Date(y, m, 1)` + `toISOString()`
     constrói no fuso do servidor e formata em UTC: na Vercel, às 22h de
     31 de agosto isso grava a meta em setembro. */
  const { start: inicio, end: fim } = mesCorrenteBR();

  if (isDemoMode) {
    const { demoGoals } = await import("@/lib/mock/data");
    const atual = demoGoals.find(
      (g) => g.client_id === input.clientId && g.period_start === inicio,
    );
    if (atual) {
      atual.planned_budget_cents = orcamento;
      atual.planned_results = resultados;
      atual.results_metric = metrica.key;
    } else {
      demoGoals.push({
        id: `g-${Date.now()}`,
        client_id: input.clientId,
        period_start: inicio,
        period_end: fim,
        planned_budget_cents: orcamento,
        planned_results: resultados,
        results_metric: metrica.key,
        executed_budget_cents_override: null,
        executed_results_override: null,
        override_reason: null,
        notes: null,
        created_at: dataNoBrasil(),
      });
    }
    revalidatePath("/clientes");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from("client_goals").upsert(
    {
      client_id: input.clientId,
      period_start: inicio,
      period_end: fim,
      planned_budget_cents: orcamento,
      planned_results: resultados,
      /* Explícito no upsert, porque o trigger do banco só preenche no
         INSERT — sem isto, editar a meta de uma conta que virou de
         contagem para faturamento gravaria centavos numa linha ainda
         marcada como contagem. */
      results_metric: metrica.key,
    },
    { onConflict: "client_id,period_start" },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/clientes");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Grava o cadastro inteiro da conta, de uma vez.
 *
 * Substitui `updateClientSettings`, que cobria só um punhado de campos e
 * deixava `status` e `agency_partner` sem nenhuma tela — dava para
 * filtrar por eles na listagem e não dava para mudá-los em lugar nenhum.
 *
 * O `slug` NÃO está aqui e não deve entrar: ele é a URL da conta e já
 * saiu em link compartilhado e em PDF entregue. `name` mudou de ideia e
 * agora é editável — corrigir um nome digitado errado no cadastro é
 * necessidade real, e o nome não é chave de nada.
 *
 * `status` não aceita `churned`: o schema restringe a lista, e encerrar
 * contrato continua sendo `setClientChurned`, com aviso próprio.
 *
 * Sem checagem de papel aqui, como no resto do módulo: quem decide é a
 * policy `clients_update`. O `.select()` existe para transformar em
 * recusa explícita o update que a RLS barrou — sem ele voltaria "salvo"
 * sobre uma conta intacta.
 */
export type SaveClientResult =
  | {
      ok: true;
      /**
       * A troca de nicho mudou a unidade da meta e o alvo de resultados
       * foi zerado. A tela avisa — zerar calado faria a conta aparecer
       * sem meta amanhã sem ninguém saber por quê.
       */
      metaZerada?: boolean;
    }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function saveClientProfile(
  input: unknown,
): Promise<SaveClientResult> {
  const parsed = clientFormSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
      fieldErrors: z_flatten(parsed.error),
    };
  }

  const v = parsed.data;

  const campos = {
    name: v.name.trim(),
    legal_name: v.legalName.trim() || null,
    segment: v.segment,
    status: v.status,
    agency_partner: v.agencyPartner,
    website: v.website.trim() || null,
    contact_name: v.contactName.trim() || null,
    contact_email: v.contactEmail.trim() || null,
    whatsapp_phone: v.whatsappPhone.trim() || null,
    /* NÃO escreve `report_enabled` nem `report_day`. Escrever daqui
       apagaria o que a tela de agenda gravou: este formulário nunca
       soube de `report_weekday`, a agenda semanal, então salvar o
       cadastro de um cliente semanal zerava o agendamento dele sem
       aviso. Quem manda na agenda é `salvarAgendaDeRelatorio`. */
    optimization_day: v.optimizationDay,
  };

  if (isDemoMode) {
    const { demoClients, demoGoals } = await import("@/lib/mock/data");
    const alvo = demoClients.find((c) => c.id === v.clientId);
    if (!alvo) return { ok: false, error: "Cliente não encontrado." };

    const zerou = mudouUnidadeDaMeta(alvo.segment, v.segment);
    Object.assign(alvo, campos);

    if (zerou) {
      const { start } = mesCorrenteBR();
      for (const g of demoGoals) {
        if (g.client_id !== v.clientId || g.period_start < start) continue;
        g.results_metric = defaultGoalMetricFor(v.segment).key;
        g.planned_results = 0;
      }
    }

    revalidatePath("/clientes");
    return { ok: true, metaZerada: zerou };
  }

  const supabase = await createSupabaseServerClient();

  /* O segmento ANTERIOR, antes do update sobrescrever. Sem ele não há
     como saber se a unidade da meta mudou — e comparar depois compararia
     o novo com ele mesmo. */
  const { data: antes } = await supabase
    .from("clients")
    .select("segment")
    .eq("id", v.clientId)
    .single();

  const { data, error } = await supabase
    .from("clients")
    .update(campos)
    .eq("id", v.clientId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Você não tem permissão para editar esta conta.",
    };
  }

  /* --- A meta acompanha o nicho ------------------------------------
     Trocar de delivery para negócio local troca a unidade do alvo: de
     reais para conversas. A meta gravada continuaria apontando para
     `revenue_cents`, coluna que uma conta de negócio local nunca
     preenche — e a barra ficaria em 0% para sempre, sem erro nenhum.

     O alvo é ZERADO, não convertido: R$ 5.000,00 não vira um número de
     conversas, e reinterpretar os centavos como contagem produziria
     "500.000 conversas" — a mesma classe de defeito que fez uma meta de
     80 pedidos ser lida como R$ 0,80.

     `>= mês corrente`: mês fechado é histórico e mantém a unidade em que
     foi cumprido. O orçamento fica — dinheiro é dinheiro nos dois
     nichos. */
  const zerou = mudouUnidadeDaMeta(antes?.segment, v.segment);

  if (zerou) {
    const { start } = mesCorrenteBR();
    await supabase
      .from("client_goals")
      .update({
        results_metric: defaultGoalMetricFor(v.segment).key,
        planned_results: 0,
      })
      .eq("client_id", v.clientId)
      .gte("period_start", start);
  }

  revalidatePath("/clientes");
  revalidatePath("/relatorios");
  revalidatePath("/esteira");
  revalidatePath("/");
  return { ok: true, metaZerada: zerou };
}

/**
 * A troca de nicho muda a unidade do alvo de resultados?
 *
 * Compara os PADRÕES dos dois segmentos, não os segmentos: sair de
 * `leads` para `local_business` troca o rótulo (de "Leads" para
 * "Visitas ao perfil") mas os dois contam unidades, então o número continua
 * válido e não há nada a zerar.
 */
function mudouUnidadeDaMeta(
  antes: ClientSegment | null | undefined,
  depois: ClientSegment,
): boolean {
  if (!antes || antes === depois) return false;
  return defaultGoalMetricFor(antes).key !== defaultGoalMetricFor(depois).key;
}

/* =====================================================================
   Encerrar e reabrir contrato
   ---------------------------------------------------------------------
   Encerrar NÃO apaga nada. Muda o status para `churned`, e com isso a
   conta sai da listagem principal e aparece em /clientes/encerrados.
   Métricas, metas, relatórios e histórico continuam inteiros — é o que
   permite responder "quanto essa conta rendeu enquanto durou?" depois
   do cancelamento, e é o que torna a ação reversível num clique.

   É de propósito que isto seja um caminho separado de
   `updateClientSettings`: encerrar contrato não é ajuste de formulário,
   é decisão comercial, e misturar as duas coisas faria um salvamento
   distraído mudar o estado da conta.
   ===================================================================== */
export async function setClientChurned(input: {
  clientId: string;
  churned: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const novo = input.churned ? "churned" : "active";

  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    const alvo = demoClients.find((c) => c.id === input.clientId);
    if (!alvo) return { ok: false, error: "Cliente não encontrado." };
    alvo.status = novo;
    revalidatePath("/clientes");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  /* `.select()` para saber se a linha foi mesmo alterada: sem ele, um
     update barrado pela RLS volta sem erro e com zero linhas, e a tela
     diria "encerrado" sobre uma conta que continua ativa. */
  const { data, error } = await supabase
    .from("clients")
    .update({ status: novo })
    .eq("id", input.clientId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "Você não tem permissão para alterar esta conta." };
  }

  revalidatePath("/clientes");
  revalidatePath("/clientes/encerrados");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Apaga o cliente e TUDO que pende dele.
 *
 * As foreign keys são `on delete cascade`: vão junto métricas diárias,
 * metas, histórico de relatórios, otimizações da esteira, criativos e
 * integrações. Não há lixeira e não há desfazer.
 *
 * Por isso a interface exige o nome digitado e o banco exige admin
 * (`clients_delete` usa `app.is_admin()`, desde a migration 2 — a 23 e a
 * 24 abriram criar e editar para a equipe, e deixaram apagar de fora
 * justamente por causa do cascade).
 *
 * NÃO usa `service_role`: a checagem de papel tem que continuar sendo do
 * Postgres. Se um colaborador chamar esta action direto, a policy
 * devolve zero linhas e o retorno abaixo transforma isso em recusa
 * explícita — em vez do "apagado com sucesso" sobre um cliente intacto.
 */
export async function deleteClient(input: {
  clientId: string;
  /** Nome digitado pelo usuário, conferido contra o cadastro. */
  confirmName: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    const i = demoClients.findIndex((c) => c.id === input.clientId);
    if (i < 0) return { ok: false, error: "Cliente não encontrado." };
    if (demoClients[i].name.trim() !== input.confirmName.trim()) {
      return { ok: false, error: "O nome digitado não confere." };
    }
    demoClients.splice(i, 1);
    revalidatePath("/clientes");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  /* Confere o nome CONTRA O BANCO, não contra o que a tela mandou. A
     confirmação só vale alguma coisa se o texto esperado vier de uma
     fonte que o chamador não controla. */
  const { data: cliente } = await supabase
    .from("clients")
    .select("name")
    .eq("id", input.clientId)
    .maybeSingle();

  if (!cliente) return { ok: false, error: "Cliente não encontrado." };

  if (cliente.name.trim() !== input.confirmName.trim()) {
    return { ok: false, error: "O nome digitado não confere." };
  }

  const { data, error } = await supabase
    .from("clients")
    .delete()
    .eq("id", input.clientId)
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Apagar cliente é restrito a administradores.",
    };
  }

  revalidatePath("/clientes");
  revalidatePath("/clientes/encerrados");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Grava a URL da logo do cliente.
 *
 * O upload em si acontece no browser, direto no Storage, sob a policy
 * `storage_brand_write` — que exige `can_write_client` na pasta. Aqui
 * só persistimos a URL resultante; a policy `clients_update` barra
 * quem não pode escrever na conta.
 *
 * `null` remove a referência. O arquivo antigo permanece no bucket de
 * propósito: PDF já entregue aponta para ele, e apagar quebraria a capa
 * de um relatório que o cliente ainda pode abrir.
 */
export async function setClientLogo(input: {
  clientId: string;
  logoUrl: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (isDemoMode) {
    const { demoClients } = await import("@/lib/mock/data");
    const alvo = demoClients.find((c) => c.id === input.clientId);
    if (alvo) alvo.logo_url = input.logoUrl;
    revalidatePath("/clientes");
    return { ok: true };
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("clients")
    .update({ logo_url: input.logoUrl })
    .eq("id", input.clientId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/clientes");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Escolhe qual evento do pixel conta como conversão nesta conta.
 *
 * `null` devolve ao padrão do segmento — e-commerce conta compra, leads
 * conta formulário, negócio local conta visita ao perfil. Só vale para
 * o Meta: no Google a conversão é configurada na própria conta, e o
 * provider lê o que vier de lá.
 *
 * Sem isto, `meta-ads.ts` procurava sempre por `..._lead`. Numa loja
 * virtual não achava nada e o relatório imprimia zero conversão e zero
 * receita — número plausível, e errado.
 */
export async function setConversionAction(input: {
  clientId: string;
  /** `null` = voltar ao padrão do segmento. */
  actionType: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const valor = input.actionType?.trim() || null;

  /* Os action_type da Graph API são ascii com ponto e underscore.
     Barrar o resto evita gravar um rótulo colado sem querer, que só
     apareceria como "0 conversões" semanas depois. */
  if (valor !== null && !/^[a-z0-9._]{3,80}$/i.test(valor)) {
    return { ok: false, error: "Tipo de conversão inválido." };
  }

  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("client_integrations")
    .update({ conversion_action_type: valor })
    .eq("client_id", input.clientId)
    .eq("platform", "meta_ads");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/clientes");
  return { ok: true };
}

/**
 * Registra o saldo disponível lido no painel da plataforma.
 *
 * A Graph API não entrega a carteira — `balance` é o acumulado a pagar,
 * que sobe conforme veicula. Medido no Nuur: API devolveu R$ 23,34
 * enquanto o painel mostrava R$ 341,77.
 *
 * Guarda o valor E o dia da leitura. O gasto posterior é descontado de
 * `daily_metrics`, então o saldo continua correto sem ninguém reanotar:
 * só a âncora é manual.
 */
export async function setAccountFunds(input: {
  clientId: string;
  platform: "meta_ads" | "google_ads";
  /** Texto do formulário: "341,77". Vazio limpa o registro. */
  funds: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const bruto = input.funds.trim();

  if (bruto === "") {
    if (isDemoMode) return { ok: true };
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("client_integrations")
      .update({ funds_cents: null, funds_recorded_at: null })
      .eq("client_id", input.clientId)
      .eq("platform", input.platform);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/alertas-saldo");
    return { ok: true };
  }

  const cents = parseCurrencyToCents(bruto);
  if (cents === null || cents < 0) {
    return { ok: false, error: "Valor inválido. Use algo como 341,77." };
  }

  if (isDemoMode) return { ok: true };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("client_integrations")
    .update({
      funds_cents: cents,
      // Data de HOJE em São Paulo: o gasto do próprio dia já estava
      // refletido no número que a pessoa acabou de ler no painel.
      funds_recorded_at: dataNoBrasil(),
    })
    .eq("client_id", input.clientId)
    .eq("platform", input.platform);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/alertas-saldo");
  revalidatePath("/clientes");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Conexão do Instagram para o EloChat                                 */
/* ------------------------------------------------------------------ */

/**
 * Diz se o Instagram deste cliente está pronto para automação de direct.
 *
 * CHECAGEM DE PAPEL OBRIGATÓRIA aqui, diferente das ações vizinhas: o
 * verificador lê `instagram_secrets` com `service_role` e portanto
 * ATRAVESSA o RLS. Sem o `role !== "admin"` abaixo, qualquer sessão
 * autenticada provocaria uma consulta usando o token de um cliente.
 *
 * SOB DEMANDA, não no carregamento da página: é uma ida ao
 * `graph.instagram.com` por cliente, e o resultado quase nunca muda
 * entre duas aberturas da tela.
 */
export async function checkInstagramAction(input: {
  clientId: string;
}): Promise<
  | { ok: true; dados: import("@/lib/instagram/elochat-scopes").PermissoesInstagram }
  | { ok: false; error: string }
> {
  const { getCurrentUser } = await import("@/lib/supabase/server");
  const user = await getCurrentUser();

  if (!user) return { ok: false, error: "Sessão expirada." };
  if (user.role !== "admin") {
    return { ok: false, error: "Apenas administradores podem verificar." };
  }

  /* A demonstração devolve o estado de uma conta AINDA NÃO CONECTADA,
     que é o de todos os clientes hoje. Todo número desta tela já é
     fabricado e o crachá "Modo demo" fica no cabeçalho o tempo inteiro;
     o que não pode é a demonstração esconder a tela que ela existe para
     demonstrar. */
  if (isDemoMode) {
    const { ESCOPOS_ELOCHAT } = await import("@/lib/instagram/elochat-scopes");
    return {
      ok: true,
      dados: {
        conectado: false,
        isReadyForEloChat: false,
        missingPermissions: [...ESCOPOS_ELOCHAT],
        granted: [],
        username: null,
        expiresAt: null,
        error: null,
        checkedAt: new Date().toISOString(),
      },
    };
  }

  const { checkInstagramConnection } = await import(
    "@/lib/instagram/connection"
  );
  return { ok: true, dados: await checkInstagramConnection(input.clientId) };
}
