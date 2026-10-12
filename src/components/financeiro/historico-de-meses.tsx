import { TrendingDown, TrendingUp } from "lucide-react";

import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MonthlySummary } from "@/types/database";

/* =====================================================================
   Histórico mês a mês
   ---------------------------------------------------------------------
   Os números vêm de `financial_monthly_summary`, que SÓ CONTA `paid` —
   é o fechamento, não a previsão. O painel de metas, ao lado, conta
   pago e a vencer: são perguntas diferentes e por isso os dois podem
   mostrar valores diferentes no mês corrente, de propósito.

   ⚠️ MÊS SEM MOVIMENTO APARECE, zerado. Quem some da lista não é lido
   como "não houve", é lido como "não existe" — e a leitura de
   tendência num gráfico que pula meses é falsa. A função no Postgres
   já garante isso com `generate_series`; aqui é só não filtrar.

   ⚠️ O MÊS CORRENTE AINDA ESTÁ ABERTO e a tabela diz isso. Sem a
   marca, o último mês sempre parece o pior do ano — ele tem menos
   dias de receita lançada que os fechados, e alguém conclui queda onde
   só há calendário.
   ===================================================================== */

export function HistoricoDeMeses({ meses }: { meses: MonthlySummary[] }) {
  if (meses.length === 0) {
    return (
      <p className="surface-card p-5 text-sm text-muted-foreground">
        Nenhum mês com movimento liquidado ainda.
      </p>
    );
  }

  /* Do mais recente para o mais antigo: a pergunta de quem abre é
     "como está este mês", não "como começou o ano". */
  const emOrdem = [...meses].reverse();
  const mesCorrente = new Date().toISOString().slice(0, 7);

  return (
    <div className="surface-card overflow-hidden">
      <div className="hidden grid-cols-[1fr_140px_140px_140px] gap-4 border-b border-hairline px-4 py-2.5 md:grid">
        {["Mês", "Entrou", "Saiu", "Sobrou"].map((r, i) => (
          <span key={r} className={cn("eyebrow", i > 0 && "text-right")}>
            {r}
          </span>
        ))}
      </div>

      <ul className="divide-y divide-hairline">
        {emOrdem.map((m) => {
          const aberto = m.month.slice(0, 7) === mesCorrente;
          const positivo = m.net_cents >= 0;

          return (
            <li
              key={m.month}
              className="grid grid-cols-2 gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[1fr_140px_140px_140px] md:items-center"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                {nomeDoMes(m.month)}
                {aberto && (
                  <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-hairline">
                    em aberto
                  </span>
                )}
              </span>

              <span className="text-right text-sm tabular-nums text-positive md:text-right">
                {formatCurrency(m.income_cents)}
              </span>

              <span className="text-right text-sm tabular-nums text-muted-foreground">
                {m.expense_cents === 0 ? "—" : formatCurrency(m.expense_cents)}
              </span>

              <span
                className={cn(
                  "flex items-center justify-end gap-1 text-right text-sm font-semibold tabular-nums",
                  positivo ? "text-foreground" : "text-negative",
                )}
              >
                {positivo ? (
                  <TrendingUp className="size-3.5 text-positive" />
                ) : (
                  <TrendingDown className="size-3.5" />
                )}
                {formatCurrency(m.net_cents)}
              </span>
            </li>
          );
        })}
      </ul>

      {/* ⚠️ A RESSALVA FICA NA TELA, não só no código. Medido em
          11/10/2026: as 79 linhas do financeiro são todas receita. Uma
          coluna "Saiu" cheia de traços, sem explicação, parece defeito
          do sistema — e "Sobrou" igual a "Entrou" parece lucro de 100%. */}
      {emOrdem.every((m) => m.expense_cents === 0) && (
        <p className="border-t border-hairline bg-surface-2/40 px-4 py-2.5 text-2xs text-muted-foreground">
          Nenhuma despesa lançada em nenhum destes meses — então{" "}
          <strong>&ldquo;Sobrou&rdquo; é igual a &ldquo;Entrou&rdquo;</strong>, e
          não é lucro. Enquanto a saída não entrar, o histórico mede
          faturamento, não resultado.
        </p>
      )}
    </div>
  );
}

/** "outubro de 2026", com a primeira letra maiúscula. */
function nomeDoMes(iso: string): string {
  /* `T12:00` e não a data seca: `new Date("2026-10-01")` é
     interpretada como UTC e, no fuso de São Paulo, volta como 30 de
     setembro — o mês inteiro sai errado por três horas. */
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const texto = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
