import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { mesCorrenteBR } from "@/lib/date-br";
import { ehTerceirizado } from "@/lib/validation/client";
import type {
  AgencyContract,
  Client,
  ClientFinancials,
  RecurringExpense,
  TransactionCategory,
} from "@/types/database";

/* =====================================================================
   Materialização da recorrência
   ---------------------------------------------------------------------
   GERAR LINHAS, NÃO CALCULAR NA HORA.

   Seria mais barato somar `monthly_fee_cents` dos clientes ativos toda
   vez que a página abre. Mas aí não existe onde registrar que o D'Rancho
   pagou dia 12 em vez do dia 3, que a folha desse mês saiu com um
   adiantamento a menos, ou que uma assinatura foi cobrada em dobro pelo
   fornecedor. Valor calculado não tem estado; linha materializada tem —
   é o que permite baixa parcial, atraso e desconto pontual.

   O preço é a duplicidade: um job que cria dezenas de cobranças por mês
   e roda duas vezes cria o dobro. Por isso `recurrence_key` — ver abaixo.

   QUEM É COBRADO não é a lista de clientes ativos. Cliente terceirizado
   por agência parceira não gera cobrança própria: quem paga é a agência,
   um valor só. São duas origens de entrada, `cliente:` e `agencia:`, e
   nenhum cliente pertence às duas.
   ===================================================================== */

/**
 * Mês corrente no fuso de São Paulo, como `YYYY-MM`.
 *
 * Delegado a `mesCorrenteBR` em vez de recortar `new Date()` aqui: o
 * servidor da Vercel roda em UTC, e das 21h à meia-noite o mês vira um
 * dia antes. Todo dia 30 às 22h o job criaria o mês seguinte.
 */
export function mesCorrente(quando: Date = new Date()): string {
  return mesCorrenteBR(quando).referencia;
}

/** `2026-12` → `2027-01`. */
export function proximoMes(mes: string): string {
  const [ano, m] = mes.split("-").map(Number);
  return m === 12
    ? `${ano + 1}-01`
    : `${ano}-${String(m + 1).padStart(2, "0")}`;
}

const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMesValido(mes: string): boolean {
  return MES_VALIDO.test(mes);
}

/**
 * Rótulo humano do mês: `2026-09` → "setembro de 2026".
 *
 * Ancorado ao dia 15 ao meio-dia porque a descrição vai para dentro do
 * lançamento e não pode escorregar de mês por causa de fuso.
 */
export function rotuloMes(mes: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(`${mes}-15T12:00:00-03:00`));
}

/**
 * Vencimento a partir do mês e do dia contratado.
 *
 * `billing_day` é limitado a 28 no banco, então não existe o caso de
 * "dia 31 em fevereiro" para tratar aqui. O limite mora no schema de
 * propósito: um clamp em JavaScript resolveria a data e deixaria a linha
 * do contrato dizendo 31 para sempre.
 */
export function vencimento(mes: string, dia: number): string {
  return `${mes}-${String(dia).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* A chave que impede cobrar duas vezes                                */
/* ------------------------------------------------------------------ */

/**
 * Identidade determinística de "esta origem, neste mês".
 *
 * `cliente:9f3a…:2026-09` / `agencia:Bagano:2026-09` / `despesa:1b7c…:2026-09`
 *
 * O banco tem `unique (recurrence_key)`, então a segunda tentativa de
 * criar a mesma cobrança falha sozinha — não depende de o job lembrar de
 * checar antes. É o que torna seguro rodar isto todo dia, e é a razão de
 * o cron poder ser burro: reexecução manual, retry da Vercel depois de
 * timeout e clique duplo no botão convergem para o mesmo resultado.
 *
 * A agência é identificada pelo NOME, não por uuid, porque é assim que
 * ela é chaveada em `agency_contracts` e em `clients.agency_partner`.
 * Consequência a saber: renomear uma agência faz a cobrança do mês
 * corrente ser emitida de novo com a chave nova. Não duplica valor a
 * receber sem aviso — as duas linhas aparecem em Gestão —, mas é o
 * motivo de renomear parceria ser operação para começo de mês.
 */
export function chaveRecorrencia(
  origem: "cliente" | "agencia" | "despesa",
  id: string,
  mes: string,
): string {
  return `${origem}:${id}:${mes}`;
}

/* ------------------------------------------------------------------ */
/* Construção das linhas — pura, para poder ser conferida              */
/* ------------------------------------------------------------------ */

export interface LinhaPrevista {
  type: "income" | "expense";
  category: TransactionCategory;
  status: "pending";
  amount_cents: number;
  description: string;
  client_id: string | null;
  due_date: string;
  recurrence_key: string;
}

/** Contrato ou despesa que o job não conseguiu materializar, e por quê. */
export interface Pulado {
  quem: string;
  motivo: string;
}

export interface PlanoDoMes {
  linhas: LinhaPrevista[];
  pulados: Pulado[];
}

/**
 * Decide o que o mês deve conter. Sem tocar no banco, de propósito: é a
 * parte que dá para conferir lendo, e a que erra caro.
 */
export function planejarMes(
  mes: string,
  clientes: Client[],
  financeiros: Map<string, Pick<ClientFinancials, "monthly_fee_cents" | "billing_day">>,
  despesas: RecurringExpense[],
  agencias: AgencyContract[],
): PlanoDoMes {
  const linhas: LinhaPrevista[] = [];
  const pulados: Pulado[] = [];

  /* Quantos clientes ativos cada agência cobre. Não é estatística: é o
     que transforma "Bagano sem honorário" em "Bagano sem honorário, 11
     clientes sem cobrança" — a diferença entre um aviso e um alarme. */
  const cobertos = new Map<string, number>();

  /* --- Entradas: honorário de cliente ativo ----------------------- */
  for (const cliente of clientes) {
    /* Só cliente ATIVO gera cobrança. Churn e pausado continuam na
       carteira para efeito de histórico, e faturá-los seria o pior erro
       possível deste job — cobrança de quem cancelou. */
    if (cliente.status !== "active") continue;

    /* TERCEIRIZADO NÃO GERA COBRANÇA PRÓPRIA. Quem paga é a agência, um
       valor só que cobre todos os clientes dela, e cobrar os dois lados
       seria faturar a mesma operação duas vezes.

       O teste é contra `AGENCIA_PROPRIA` e não contra a existência de
       contrato: agência recém-criada, ainda sem linha em
       `agency_contracts`, precisa cair aqui do mesmo jeito — e vai
       aparecer logo abaixo em `pulados`, com o número de clientes que
       ficaram sem cobrança. Amarrar o desvio ao contrato faria a agência
       nova faturar cliente a cliente sem ninguém perceber. */
    if (ehTerceirizado(cliente)) {
      const agencia = cliente.agency_partner;
      cobertos.set(agencia, (cobertos.get(agencia) ?? 0) + 1);
      continue;
    }

    const financeiro = financeiros.get(cliente.id);

    if (!financeiro || financeiro.monthly_fee_cents <= 0) {
      pulados.push({ quem: cliente.name, motivo: "sem honorário definido" });
      continue;
    }

    /* Sem dia de vencimento não dá para inventar um. Chutar "dia 5"
       encheria o fluxo de caixa de datas falsas, e a inadimplência
       passaria a medir o chute. */
    if (!financeiro.billing_day) {
      pulados.push({ quem: cliente.name, motivo: "sem dia de cobrança" });
      continue;
    }

    linhas.push({
      type: "income",
      category: "client_fee",
      status: "pending",
      amount_cents: financeiro.monthly_fee_cents,
      description: `Honorário ${cliente.name} · ${rotuloMes(mes)}`,
      client_id: cliente.id,
      due_date: vencimento(mes, financeiro.billing_day),
      recurrence_key: chaveRecorrencia("cliente", cliente.id, mes),
    });
  }

  /* --- Entradas: honorário de agência parceira -------------------- */

  /* A UNIÃO de quem tem contrato com quem aparece na carteira. Iterar só
     os contratos deixaria a agência sem linha cadastrada invisível — e
     ela é exatamente o caso perigoso, porque os clientes dela já foram
     pulados ali em cima. */
  const nomes = [
    ...new Set([...cobertos.keys(), ...agencias.map((a) => a.agency)]),
  ].sort();

  const contratos = new Map(agencias.map((a) => [a.agency, a]));

  for (const nome of nomes) {
    const contrato = contratos.get(nome);
    const clientes = cobertos.get(nome) ?? 0;

    if (!contrato || contrato.monthly_fee_cents <= 0 || !contrato.billing_day) {
      /* Sem cliente atrás, agência sem valor é parceria encerrada ou
         ainda não iniciada — não é pendência e não vira aviso. Com
         cliente atrás, é receita sumindo. */
      if (clientes > 0) {
        pulados.push({
          quem: `${nome} (agência)`,
          motivo: `${motivoDaAgencia(contrato)} — ${clientes} ${
            clientes === 1 ? "cliente fica" : "clientes ficam"
          } sem cobrança`,
        });
      }
      continue;
    }

    linhas.push({
      type: "income",
      category: "client_fee",
      status: "pending",
      amount_cents: contrato.monthly_fee_cents,
      /* "(agência)" no texto porque a linha fica em Gestão lado a lado
         com honorário de cliente, sem `client_id` para desempatar. */
      description: `Honorário ${nome} (agência) · ${rotuloMes(mes)}`,
      client_id: null,
      due_date: vencimento(mes, contrato.billing_day),
      recurrence_key: chaveRecorrencia("agencia", nome, mes),
    });
  }

  /* --- Saídas: folha, assinaturas, impostos ----------------------- */
  for (const despesa of despesas) {
    if (!despesa.is_active) continue;

    linhas.push({
      type: "expense",
      category: despesa.category,
      status: "pending",
      amount_cents: despesa.amount_cents,
      description: `${despesa.description} · ${rotuloMes(mes)}`,
      client_id: null,
      due_date: vencimento(mes, despesa.billing_day),
      recurrence_key: chaveRecorrencia("despesa", despesa.id, mes),
    });
  }

  return { linhas, pulados };
}

/** Por que a agência não gerou cobrança, na ordem em que se resolve. */
function motivoDaAgencia(contrato: AgencyContract | undefined): string {
  if (!contrato) return "sem contrato cadastrado";
  if (contrato.monthly_fee_cents <= 0) return "sem honorário definido";
  return "sem dia de cobrança";
}

/* ------------------------------------------------------------------ */
/* Escrita                                                             */
/* ------------------------------------------------------------------ */

export interface ResultadoMaterializacao {
  mes: string;
  /** Linhas efetivamente criadas agora. */
  criadas: number;
  /** Linhas que já existiam — a prova de que a chave está funcionando. */
  jaExistiam: number;
  pulados: Pulado[];
  entradasCents: number;
  saidasCents: number;
}

/**
 * Cria os lançamentos previstos do mês.
 *
 * Roda com `service_role` porque quem chama é o cron, sem usuário na
 * ponta — a policy `financial_admin_only` recusaria. Quando a chamada
 * vem da interface, a autorização é checada na server action ANTES de
 * chegar aqui.
 *
 * `ignoreDuplicates` traduz para `on conflict do nothing`, e o
 * `.select()` devolve SÓ o que entrou de fato. Daí sai a contagem
 * `criadas` × `jaExistiam`: rodar duas vezes seguidas tem de dar
 * `criadas: 0` na segunda. É o teste que vale antes de confiar no job.
 */
export async function materializarMes(
  mes: string,
): Promise<ResultadoMaterializacao> {
  if (!isMesValido(mes)) {
    throw new Error(`Mês inválido: ${mes}. Esperado YYYY-MM.`);
  }

  const supabase = createSupabaseAdminClient();

  const [clientes, financeiros, despesas, agencias] = await Promise.all([
    /* `agency_partner` não é enfeite: é ele que decide se o cliente é
       faturado direto ou coberto pela agência. Sem a coluna aqui, todo
       terceirizado voltaria a ser cobrado individualmente. */
    supabase.from("clients").select("id, name, status, agency_partner"),
    supabase
      .from("client_financials")
      .select("client_id, monthly_fee_cents, billing_day"),
    supabase
      .from("recurring_expenses")
      .select("*")
      .eq("is_active", true),
    supabase
      .from("agency_contracts")
      .select("agency, monthly_fee_cents, billing_day, notes"),
  ]);

  if (clientes.error) throw clientes.error;
  if (financeiros.error) throw financeiros.error;
  if (despesas.error) throw despesas.error;

  /* PARAR é a resposta certa aqui. Sem a tabela, as duas saídas possíveis
     são ruins de formas diferentes: seguir sem ela cobraria os 22
     terceirizados individualmente, e tratá-la como vazia pularia os 22
     sem emitir nada no lugar. As duas geram um mês errado que parece
     certo. O erro nomeia o arquivo porque quem lê isto é o log do cron. */
  if (agencias.error) {
    throw new Error(
      agencias.error.code === "42P01"
        ? "Tabela `agency_contracts` não existe: rode a migration 20260808000031_contratos_de_agencia.sql antes de emitir o mês."
        : agencias.error.message,
    );
  }

  const { linhas, pulados } = planejarMes(
    mes,
    (clientes.data ?? []) as Client[],
    new Map(
      (financeiros.data ?? []).map((f) => [
        f.client_id as string,
        {
          monthly_fee_cents: f.monthly_fee_cents as number,
          billing_day: f.billing_day as number | null,
        },
      ]),
    ),
    (despesas.data ?? []) as RecurringExpense[],
    (agencias.data ?? []) as AgencyContract[],
  );

  const totais = {
    entradasCents: linhas
      .filter((l) => l.type === "income")
      .reduce((acc, l) => acc + l.amount_cents, 0),
    saidasCents: linhas
      .filter((l) => l.type === "expense")
      .reduce((acc, l) => acc + l.amount_cents, 0),
  };

  if (linhas.length === 0) {
    return { mes, criadas: 0, jaExistiam: 0, pulados, ...totais };
  }

  const { data, error } = await supabase
    .from("financial_transactions")
    .upsert(linhas, {
      onConflict: "recurrence_key",
      ignoreDuplicates: true,
    })
    .select("id");

  if (error) throw error;

  const criadas = data?.length ?? 0;

  return {
    mes,
    criadas,
    jaExistiam: linhas.length - criadas,
    pulados,
    ...totais,
  };
}
