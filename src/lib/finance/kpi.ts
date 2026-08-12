import { dataNoBrasil } from "@/lib/date-br";
import { agenciaPropriaDe, ehTerceirizado } from "@/lib/validation/client";
import type {
  AgencyContract,
  Client,
  FinancialTransaction,
  MonthlySummary,
} from "@/types/database";

/* =====================================================================
   Indicadores financeiros
   ---------------------------------------------------------------------
   Regra que atravessa o arquivo: SALDO é caixa REALIZADO, previsão é
   outra coisa. Misturar os dois num número só é como uma agência acha
   que tem dinheiro que ainda não entrou.

     Saldo em caixa      → só `status = 'paid'`
     Entradas previstas  → `pending` de receita, ainda no prazo
     Contas a pagar      → `pending` de despesa
     Em atraso           → `pending` com `due_date` já vencido

   MRR NÃO sai desta tabela. Receita recorrente é o contratado com os
   clientes ativos (`client_financials.monthly_fee_cents`), não a soma do que foi
   faturado no mês — um mês com dois pagamentos adiantados inflaria o
   MRR e faria a agência achar que cresceu.

   E o contratado vem de DUAS tabelas. Cliente terceirizado não tem
   honorário próprio: quem paga é a agência parceira, um valor só em
   `agency_contracts`. Somar apenas `client_financials` deixaria de fora
   a maior linha da carteira — em 09/08/2026, as cinco agências cobriam
   26 dos 47 clientes ativos — e o MRR apareceria pela metade.
   ===================================================================== */

export interface FinanceSnapshot {
  /** Receita recorrente mensal contratada, em centavos. */
  mrrCents: number;
  /**
   * O QUE O MRR SOMOU — devolvido junto porque o rótulo do card errava.
   *
   * Ele dizia "47 contas ativas" ao lado de um número que soma 26 linhas
   * (os diretos mais as agências). Quem dividisse um pelo outro para
   * achar o ticket médio erraria em quase metade: R$ 825 em vez de
   * R$ 1.492. O número estava certo e o texto embaixo dele descrevia
   * outra população.
   *
   * Sai do MESMO passo que calcula a soma, então não há como os dois
   * divergirem de novo.
   */
  mrrCobertura: {
    /** Clientes ativos faturados direto pela Elo. */
    diretos: number;
    /** Contratos de agência — cada um cobre vários clientes. */
    agencias: number;
    /** Contas ativas no total, incluindo as cobertas pelas agências. */
    contasAtivas: number;
  };
  /** Entradas menos saídas já liquidadas. Pode ser negativo. */
  balanceCents: number;
  /** Receita pendente com vencimento no futuro. */
  expectedIncomeCents: number;
  /** Despesa pendente. */
  payableCents: number;
  /** Receita pendente já vencida — inadimplência. */
  overdueIncomeCents: number;
  overdueCount: number;
  /** Proporção do previsto que virou atraso (0–1). */
  defaultRate: number;
}

/* `dataNoBrasil()` e não `toISOString()`: em UTC, das 21h às 24h de
   Brasília o "hoje" já é amanhã, e `isOverdue` marcaria como VENCIDA uma
   cobrança que ainda vence hoje — três horas de "atraso" falso por dia,
   na tela de dinheiro. */
const todayISO = () => dataNoBrasil();

export function buildFinanceSnapshot(
  transactions: FinancialTransaction[],
  clients: Client[],
  /* Honorários vêm de `client_financials`, tabela de admin — não mais
     de uma coluna em `clients`, que hoje é legível por toda a equipe.
     Indexado por client_id para não custar O(n²) na soma. */
  fees: Map<string, number>,
  /* Honorário das agências parceiras. Passou a carregar `agency` e
     `is_own` além do valor: a soma continua olhando só os valores, mas
     é daqui que sai QUEM é a agência própria — antes um literal no
     código, agora dado do cadastro. */
  agencias: Pick<AgencyContract, "monthly_fee_cents" | "agency" | "is_own">[],
  today = todayISO(),
): FinanceSnapshot {
  let paidIncome = 0;
  let paidExpense = 0;
  let expectedIncome = 0;
  let payable = 0;
  let overdueIncome = 0;
  let overdueCount = 0;

  for (const t of transactions) {
    if (t.status === "canceled") continue;

    if (t.status === "paid") {
      if (t.type === "income") paidIncome += t.amount_cents;
      else paidExpense += t.amount_cents;
      continue;
    }

    // status === "pending"
    const vencido = t.due_date < today;

    if (t.type === "income") {
      expectedIncome += t.amount_cents;
      if (vencido) {
        overdueIncome += t.amount_cents;
        overdueCount += 1;
      }
    } else {
      payable += t.amount_cents;
    }
  }

  /* Cliente terceirizado é PULADO aqui, não somado com valor zero: ele
     tem honorário gravado em `client_financials` de quando era faturado
     direto, e somá-lo contaria a mesma receita duas vezes — uma na linha
     dele, outra no contrato da agência. */
  const ativos = clients.filter((c) => c.status === "active");
  const propria = agenciaPropriaDe(agencias);
  const diretos = ativos.filter((c) => !ehTerceirizado(c, propria));

  const mrrClientes = diretos.reduce(
    (acc, c) => acc + (fees.get(c.id) ?? 0),
    0,
  );

  const mrrAgencias = agencias.reduce((acc, a) => acc + a.monthly_fee_cents, 0);

  return {
    mrrCents: mrrClientes + mrrAgencias,
    mrrCobertura: {
      diretos: diretos.length,
      agencias: agencias.length,
      contasAtivas: ativos.length,
    },
    balanceCents: paidIncome - paidExpense,
    expectedIncomeCents: expectedIncome,
    payableCents: payable,
    overdueIncomeCents: overdueIncome,
    overdueCount,
    // Divisor zero devolve 0, não NaN — mês sem previsão não é 100% de
    // inadimplência.
    defaultRate: expectedIncome === 0 ? 0 : overdueIncome / expectedIncome,
  };
}

/* ------------------------------------------------------------------ */
/* Série do gráfico                                                    */
/* ------------------------------------------------------------------ */

export interface CashflowPoint {
  month: string;
  /** Rótulo curto: "ago/26". */
  label: string;
  entradas: number;
  saidas: number;
  liquido: number;
  /** Acumulado até o mês — a curva de tendência. */
  acumulado: number;
}

/**
 * Converte o resumo mensal do Postgres em pontos de gráfico.
 *
 * A moeda vira REAIS aqui porque o eixo do Recharts precisa de número
 * comparável; a formatação para exibição continua saindo de
 * `lib/format.ts`. É o único lugar do módulo que divide por 100.
 */
export function buildCashflowSeries(rows: MonthlySummary[]): CashflowPoint[] {
  let acumulado = 0;

  return rows.map((row) => {
    const entradas = row.income_cents / 100;
    const saidas = row.expense_cents / 100;
    acumulado += row.net_cents / 100;

    return {
      month: row.month,
      label: monthLabel(row.month),
      entradas,
      saidas,
      liquido: row.net_cents / 100,
      acumulado,
    };
  });
}

function monthLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return new Intl.DateTimeFormat("pt-BR", {
    month: "short",
    year: "2-digit",
  })
    .format(d)
    .replace(".", "");
}

/* ------------------------------------------------------------------ */
/* Rótulos                                                             */
/* ------------------------------------------------------------------ */

export const CATEGORY_LABELS: Record<
  FinancialTransaction["category"],
  string
> = {
  client_fee: "Honorário",
  project_fee: "Projeto",
  ad_spend: "Verba de mídia",
  salary: "Folha",
  contractor: "Freelancer / PJ",
  software: "Software",
  office: "Estrutura",
  tax: "Impostos",
  other: "Outros",
};

export const STATUS_LABELS: Record<FinancialTransaction["status"], string> = {
  pending: "Pendente",
  paid: "Baixado",
  canceled: "Cancelado",
};

export const TYPE_LABELS: Record<FinancialTransaction["type"], string> = {
  income: "Entrada",
  expense: "Saída",
};

/** Um lançamento pendente com vencimento passado. */
export function isOverdue(t: FinancialTransaction, today = todayISO()): boolean {
  return t.status === "pending" && t.due_date < today;
}
