import type { TransactionCategory } from "@/types/database";

/* =====================================================================
   Categorias de despesa — o que o servidor E o navegador podem ler
   ---------------------------------------------------------------------
   ⚠️ ESTE ARQUIVO EXISTE POR UM MOTIVO MECÂNICO, não de organização.
   Ele não tem `import "server-only"`, e é por isso que o painel de
   metas (client component) pode importá-lo.

   O QUE ACONTECEU EM 11/10/2026: os rótulos moravam em
   `financeiro/metas.ts`, que é `server-only` porque abre conexão com o
   Supabase. O painel importou `ROTULO_DA_CATEGORIA` de lá — um valor,
   não um tipo — e isso arrastou `server-only` e `next/headers` para o
   bundle do cliente.

   O sintoma não foi "a página de metas quebrou": foi O APP INTEIRO
   quebrar, `/gestao` e `/clientes` junto, com "You're importing a
   module that depends on next/headers". `app/layout.tsx` importa o
   mesmo `supabase/server`, então o grafo envenenado derruba todas as
   rotas de uma vez — e o erro aponta para `supabase/server.ts`, que
   está correto, em vez de para quem o puxou para o lado errado.

   REGRA QUE FICA: tipo atravessa a fronteira com `import type` e some
   na compilação; CONSTANTE não atravessa. Rótulo, lista e enum que o
   navegador precisa ler moram aqui.
   ===================================================================== */

/** As sete de despesa, na ordem em que `expense_budget_status` devolve. */
export const CATEGORIAS_DE_DESPESA: TransactionCategory[] = [
  "ad_spend",
  "salary",
  "contractor",
  "software",
  "office",
  "tax",
  "other",
];

/** Como cada categoria se chama na tela. */
export const ROTULO_DA_CATEGORIA: Record<string, string> = {
  ad_spend: "Verba de mídia",
  salary: "Folha",
  contractor: "Freelancer e PJ",
  software: "Ferramentas",
  office: "Estrutura",
  tax: "Impostos",
  other: "Outros",
  client_fee: "Honorário de cliente",
  project_fee: "Projeto pontual",
};

/** Primeiro dia do mês, que é como `expense_budgets` guarda. */
export function primeiroDiaDoMes(data = new Date()): string {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-01`;
}

export interface MetaDaCategoria {
  category: TransactionCategory;
  /**
   * Existe linha em `expense_budgets` para este mês e categoria.
   *
   * ⚠️ NÃO É `limiteCents > 0`. Meta zero é decisão — "nesta categoria
   * não quero gastar nada" —, e meta ausente é esquecimento. A tela
   * mostra as duas de formas diferentes, e misturá-las faria a
   * categoria sem orçamento parecer orçada em R$ 0,00.
   */
  temMeta: boolean;
  limiteCents: number;
  pagoCents: number;
  /**
   * Despesa do mês ainda não liquidada.
   *
   * Separada do pago de propósito: quem olha a meta no dia 10 precisa
   * enxergar o que já comprometeu. Só com o pago, o orçamento estoura
   * no fim do mês com contas que já existiam.
   */
  previstoCents: number;
  /**
   * Quantos lançamentos de despesa a categoria teve no mês.
   *
   * ⚠️ É O QUE SEPARA "não gastei" DE "ninguém anotou". Medido em
   * 11/10/2026: as 79 linhas do financeiro são TODAS receita — o lado
   * da despesa nunca recebeu um lançamento. Sem este número, a tela
   * diria "0% da meta" em toda categoria e o mês pareceria exemplar
   * justamente porque está vazio.
   */
  lancamentos: number;
}
