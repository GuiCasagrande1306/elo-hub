import type {
  FinancialTransaction,
  MonthlySummary,
  TransactionCategory,
} from "@/types/database";

/**
 * Dataset financeiro de demonstração.
 *
 * Construído para exercitar o que o painel precisa mostrar bem:
 * crescimento ao longo de 12 meses, sazonalidade (dezembro forte,
 * janeiro fraco), despesa fixa e variável, e — o mais importante —
 * INADIMPLÊNCIA real, porque um dataset em que tudo foi pago esconde
 * exatamente o indicador que o dono da agência abre o painel para ver.
 *
 * Determinístico: gerador com semente, nunca Math.random(), senão
 * servidor e cliente divergem e o React acusa erro de hidratação.
 */

function seeded(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TODAY = (() => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
})();

const iso = (d: Date) => d.toISOString().slice(0, 10);

function monthStart(offset: number): Date {
  const d = new Date(TODAY.getFullYear(), TODAY.getMonth() + offset, 1);
  return d;
}

const CLIENTES = [
  { id: "c-verdi", nome: "Verdi Cosméticos", fee: 450000 },
  { id: "c-atlas", nome: "Atlas Odontologia", fee: 380000 },
  { id: "c-nord", nome: "Nord Performance", fee: 620000 },
  { id: "c-lumen", nome: "Lumen Arquitetura", fee: 290000 },
];

/**
 * Despesas fixas dimensionadas em ~68% da receita recorrente.
 *
 * A primeira versão somava R$ 22,5 mil contra R$ 14,5 mil de MRR — uma
 * agência estruturalmente deficitária. O painel ficava com saldo
 * negativo e a "Tendência de crescimento" despencando, contradizendo o
 * próprio título e impedindo avaliar o design. Dado de demonstração
 * precisa ser plausível, não só preencher a tela.
 */
const DESPESAS_FIXAS: {
  cat: TransactionCategory;
  desc: string;
  cents: number;
}[] = [
  { cat: "salary", desc: "Folha de pagamento", cents: 620_000 },
  { cat: "contractor", desc: "Freelancers de design e vídeo", cents: 180_000 },
  { cat: "software", desc: "Ferramentas (Meta, GA4, Figma, Slack)", cents: 95_000 },
  { cat: "office", desc: "Coworking e infraestrutura", cents: 120_000 },
  { cat: "tax", desc: "Simples Nacional", cents: 190_000 },
];

function build(): FinancialTransaction[] {
  const rand = seeded(97);
  const out: FinancialTransaction[] = [];
  let n = 0;

  const push = (t: Omit<FinancialTransaction, "id" | "created_at">) => {
    out.push({ ...t, id: `ft-${++n}`, created_at: t.due_date });
  };

  // 12 meses fechados + o mês corrente.
  for (let offset = -11; offset <= 0; offset++) {
    const inicio = monthStart(offset);
    const mesCorrente = offset === 0;

    // Crescimento composto suave + sazonalidade de fim de ano.
    const crescimento = 1 + 0.021 * (offset + 11);
    const mes = inicio.getMonth();
    const sazonal = mes === 11 ? 1.28 : mes === 0 ? 0.82 : 1;

    /* --- Receitas: honorário de cada cliente ----------------------- */
    for (const cliente of CLIENTES) {
      const venc = new Date(inicio);
      venc.setDate(10);

      const valor = Math.round(cliente.fee * crescimento * sazonal);

      // ~9% dos honorários atrasam. Nos meses fechados o atraso acaba
      // sendo pago; no mês corrente ele fica pendente e vira o número
      // de inadimplência do painel.
      const atrasa = rand() < 0.09;

      push({
        type: "income",
        category: "client_fee",
        status: mesCorrente && atrasa ? "pending" : "paid",
        amount_cents: valor,
        description: `Honorário mensal — ${cliente.nome}`,
        client_id: cliente.id,
        due_date: iso(venc),
        paid_date:
          mesCorrente && atrasa
            ? null
            : iso(addDays(venc, atrasa ? 12 : Math.floor(rand() * 3))),
        provider: "asaas",
        external_id: `pay_${cliente.id}_${iso(venc)}`,
        provider_payload: null as never,
      } as Omit<FinancialTransaction, "id" | "created_at">);
    }

    // Projeto pontual em alguns meses.
    if (rand() < 0.45) {
      const venc = new Date(inicio);
      venc.setDate(20);
      push({
        type: "income",
        category: "project_fee",
        status: mesCorrente ? "pending" : "paid",
        amount_cents: Math.round((280_000 + rand() * 520_000) * crescimento),
        description: "Projeto pontual — landing page + tráfego",
        client_id: CLIENTES[Math.floor(rand() * CLIENTES.length)].id,
        due_date: iso(venc),
        paid_date: mesCorrente ? null : iso(addDays(venc, 4)),
        provider: null,
        external_id: null,
      } as Omit<FinancialTransaction, "id" | "created_at">);
    }

    /* --- Despesas fixas -------------------------------------------- */
    for (const despesa of DESPESAS_FIXAS) {
      const venc = new Date(inicio);
      venc.setDate(5);

      // Folha e impostos crescem junto com a operação; o resto é estável.
      const fator =
        despesa.cat === "salary" || despesa.cat === "tax"
          ? 1 + 0.014 * (offset + 11)
          : 1;

      push({
        type: "expense",
        category: despesa.cat,
        // No mês corrente, o que vence depois de hoje segue pendente.
        status: mesCorrente && venc > TODAY ? "pending" : "paid",
        amount_cents: Math.round(despesa.cents * fator),
        description: despesa.desc,
        client_id: null,
        due_date: iso(venc),
        paid_date: mesCorrente && venc > TODAY ? null : iso(venc),
        provider: null,
        external_id: null,
      } as Omit<FinancialTransaction, "id" | "created_at">);
    }
  }

  /* --- Contas a pagar do mês, ainda em aberto ---------------------- */
  const proximo = addDays(TODAY, 6);
  push({
    type: "expense",
    category: "ad_spend",
    status: "pending",
    amount_cents: 840_000,
    description: "Repasse de verba de mídia — fatura Meta",
    client_id: null,
    due_date: iso(proximo),
    paid_date: null,
    provider: null,
    external_id: null,
  } as Omit<FinancialTransaction, "id" | "created_at">);

  return out.sort((a, b) => b.due_date.localeCompare(a.due_date));
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export const demoTransactions: FinancialTransaction[] = build();

/**
 * Espelha a função `financial_monthly_summary` do Postgres — inclusive
 * o preenchimento de meses sem movimento, que evita o gráfico "pular"
 * um mês e distorcer a leitura de tendência.
 */
export function demoMonthlySummary(months = 12): MonthlySummary[] {
  const buckets = new Map<string, { income: number; expense: number }>();

  for (let offset = -(months - 1); offset <= 0; offset++) {
    buckets.set(iso(monthStart(offset)), { income: 0, expense: 0 });
  }

  for (const t of demoTransactions) {
    if (t.status !== "paid") continue;
    const base = t.paid_date ?? t.due_date;
    const key = `${base.slice(0, 7)}-01`;
    const bucket = buckets.get(key);
    if (!bucket) continue;
    if (t.type === "income") bucket.income += t.amount_cents;
    else bucket.expense += t.amount_cents;
  }

  return [...buckets.entries()].map(([month, v]) => ({
    month,
    income_cents: v.income,
    expense_cents: v.expense,
    net_cents: v.income - v.expense,
  }));
}
