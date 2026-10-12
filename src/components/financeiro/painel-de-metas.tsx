"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { salvarMetaDeGasto } from "@/app/(app)/financeiro/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
/* ⚠️ DE `categorias.ts`, NUNCA de `metas.ts`. Aquele é `server-only`:
   importar um valor de lá para cá arrasta `next/headers` para o bundle
   do cliente e derruba TODAS as rotas, não só esta. */
import {
  ROTULO_DA_CATEGORIA,
  type MetaDaCategoria,
} from "@/lib/financeiro/categorias";

/* =====================================================================
   Meta de gasto por categoria
   ---------------------------------------------------------------------
   Edição NA PRÓPRIA LINHA, cada uma salvando sozinha — mesma escolha
   da agenda de envio e da tabela de recorrência, e pelo mesmo motivo:
   são sete campos, e um formulário com "Salvar tudo" faz quem parou no
   meio perder o que já tinha digitado.

   ⚠️ A BARRA NÃO É O CORAÇÃO DESTA TELA; o número é. Barra de
   orçamento tem um vício conhecido: sem gasto nenhum ela fica
   bonita e vazia, e "0% da meta" lê como desempenho exemplar quando na
   verdade ninguém lançou nada. Por isso toda categoria sem lançamento
   no mês diz isso com todas as letras, em vez de desenhar uma barra
   zerada — ver `lancamentos` em `MetaDaCategoria`.
   ===================================================================== */

export function PainelDeMetas({
  mes,
  metas,
  rotuloDoMes,
}: {
  mes: string;
  metas: MetaDaCategoria[];
  rotuloDoMes: string;
}) {
  if (metas.length === 0) {
    return (
      <p className="surface-card p-5 text-sm text-muted-foreground">
        Não foi possível ler as metas agora. Recarregue a página; se
        persistir, a migration 90 pode não ter rodado neste ambiente.
      </p>
    );
  }

  return (
    <div className="surface-card divide-y divide-hairline overflow-hidden">
      {metas.map((meta) => (
        <LinhaDeMeta key={meta.category} mes={mes} meta={meta} rotuloDoMes={rotuloDoMes} />
      ))}
    </div>
  );
}

function LinhaDeMeta({
  mes,
  meta,
  rotuloDoMes,
}: {
  mes: string;
  meta: MetaDaCategoria;
  rotuloDoMes: string;
}) {
  const [limite, setLimite] = useState(
    meta.temMeta ? (meta.limiteCents / 100).toFixed(2).replace(".", ",") : "",
  );
  const [salvando, startTransition] = useTransition();

  const comprometido = meta.pagoCents + meta.previstoCents;
  const semLancamento = meta.lancamentos === 0;

  /* `null` quando não há meta: sem denominador não existe percentual, e
     imprimir 0% diria que a categoria está dentro do orçamento que ela
     não tem. */
  const fatia =
    meta.temMeta && meta.limiteCents > 0
      ? comprometido / meta.limiteCents
      : null;

  const estourou = fatia !== null && fatia > 1;

  function salvar() {
    startTransition(async () => {
      const r = await salvarMetaDeGasto({ mes, category: meta.category, limite });
      if (r.ok) {
        toast.success(
          limite.trim() === ""
            ? `${ROTULO_DA_CATEGORIA[meta.category]}: meta removida.`
            : `${ROTULO_DA_CATEGORIA[meta.category]}: meta salva.`,
        );
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {ROTULO_DA_CATEGORIA[meta.category] ?? meta.category}
        </p>

        {semLancamento ? (
          /* ⚠️ A FRASE NO LUGAR DA BARRA. Ver a nota no topo. */
          <p className="mt-1 text-2xs text-muted-foreground">
            Sem lançamento em {rotuloDoMes} — nada gasto ou nada anotado.
          </p>
        ) : (
          <>
            {/* ⚠️ SEM META NÃO TEM BARRA. Barra vazia ao lado de
                "R$ 7.154,80 pago" lê como 0% do orçamento — o mesmo
                vício que a frase de "sem lançamento" evita, só que uma
                casa adiante. Sem denominador, o texto basta. */}
            {fatia !== null && (
              <div className="mt-2 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-surface-2">
                <div
                  className={cn(
                    "h-full rounded-full",
                    estourou ? "bg-negative" : "bg-positive",
                  )}
                  style={{ width: `${Math.min(100, Math.round(fatia * 100))}%` }}
                />
              </div>
            )}
            <p className={cn("text-2xs text-muted-foreground", fatia !== null ? "mt-1.5" : "mt-1")}>
              {formatCurrency(meta.pagoCents)} pago
              {meta.previstoCents > 0 && (
                <> · {formatCurrency(meta.previstoCents)} a vencer</>
              )}
              {fatia !== null && (
                <span className={cn("ml-1.5 font-medium", estourou && "text-negative")}>
                  · {Math.round(fatia * 100)}% da meta
                </span>
              )}
              {!meta.temMeta && <> · sem meta definida</>}
            </p>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-2xs text-muted-foreground">
            R$
          </span>
          <Input
            value={limite}
            onChange={(e) => setLimite(e.target.value)}
            placeholder="sem meta"
            inputMode="decimal"
            aria-label={`Meta de ${ROTULO_DA_CATEGORIA[meta.category]}`}
            className="w-36 pl-8 text-right tabular-nums"
          />
        </div>
        <Button size="sm" variant="outline" onClick={salvar} disabled={salvando}>
          {salvando ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
          Salvar
        </Button>
      </div>
    </div>
  );
}
