"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { reopenTransaction, settleTransaction } from "@/app/(app)/gestao/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CATEGORY_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  isOverdue,
} from "@/lib/finance/kpi";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Client, FinancialTransaction } from "@/types/database";

/* =====================================================================
   Tabela de lançamentos
   ---------------------------------------------------------------------
   Paginação e filtros no CLIENTE, de propósito: a página já carrega os
   12 meses de lançamentos para alimentar os gráficos, e uma agência
   fecha isso na casa de centenas de linhas. Paginar no servidor aqui
   custaria um round-trip por página para dados que já estão na memória.
   Se um dia o volume passar de alguns milhares, o corte natural é mover
   filtro e paginação para a query — a assinatura da tabela não muda.
   ===================================================================== */

const ALL = "__all__";
const PAGE_SIZE = 12;

interface Props {
  transactions: FinancialTransaction[];
  clients: Client[];
}

export function TransactionsTable({ transactions, clients }: Props) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [page, setPage] = useState(0);
  const [isPending, startTransition] = useTransition();

  const clientName = useMemo(
    () => new Map(clients.map((c) => [c.id, c.name])),
    [clients],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return transactions.filter((t) => {
      if (typeFilter !== ALL && t.type !== typeFilter) return false;

      // "overdue" não é um status no banco — é `pending` com vencimento
      // passado. Fica como filtro porque é a pergunta que o financeiro
      // realmente faz.
      if (statusFilter === "overdue" && !isOverdue(t)) return false;
      if (
        statusFilter !== ALL &&
        statusFilter !== "overdue" &&
        t.status !== statusFilter
      ) {
        return false;
      }

      if (!needle) return true;
      return (
        t.description.toLowerCase().includes(needle) ||
        (t.client_id
          ? (clientName.get(t.client_id) ?? "").toLowerCase().includes(needle)
          : false)
      );
    });
  }, [transactions, query, typeFilter, statusFilter, clientName]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Filtrar pode encurtar a lista abaixo da página atual; sem o clamp a
  // tabela mostraria vazio com o usuário achando que não há resultado.
  const safePage = Math.min(page, pageCount - 1);
  const rows = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function handleSettle(t: FinancialTransaction) {
    startTransition(async () => {
      const result =
        t.status === "paid"
          ? await reopenTransaction(t.id)
          : await settleTransaction({ id: t.id });

      if (!result.ok) toast.error(result.error);
      else
        toast.success(
          t.status === "paid" ? "Lançamento reaberto." : "Baixa registrada.",
        );
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Filtros ---------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Buscar descrição ou cliente…"
            className="h-9 pl-8"
            aria-label="Buscar lançamento"
          />
        </div>

        <Select
          value={typeFilter}
          onValueChange={(v) => {
            setTypeFilter(v ?? ALL);
            setPage(0);
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-36" aria-label="Tipo">
            <SelectValue>
              {(v: string) =>
                v === ALL
                  ? "Entradas e saídas"
                  : TYPE_LABELS[v as FinancialTransaction["type"]]
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Entradas e saídas</SelectItem>
            <SelectItem value="income">Entradas</SelectItem>
            <SelectItem value="expense">Saídas</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v ?? ALL);
            setPage(0);
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Status">
            <SelectValue>
              {(v: string) =>
                v === ALL
                  ? "Todos os status"
                  : v === "overdue"
                    ? "Em atraso"
                    : STATUS_LABELS[v as FinancialTransaction["status"]]
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os status</SelectItem>
            <SelectItem value="pending">Pendente</SelectItem>
            <SelectItem value="overdue">Em atraso</SelectItem>
            <SelectItem value="paid">Baixado</SelectItem>
          </SelectContent>
        </Select>

        <span className="ml-auto text-2xs tabular-nums text-muted-foreground">
          {filtered.length} lançamento{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Tabela ----------------------------------------------------- */}
      <div className="surface-card overflow-hidden">
        <div className="hidden grid-cols-[1fr_130px_110px_110px_92px] gap-4 border-b border-hairline px-4 py-2.5 lg:grid">
          {["Lançamento", "Categoria", "Vencimento", "Valor", ""].map(
            (label, i) => (
              <span
                key={label || i}
                className={cn("eyebrow", i === 3 && "text-right")}
              >
                {label}
              </span>
            ),
          )}
        </div>

        {rows.length === 0 ? (
          <p className="py-14 text-center text-sm text-muted-foreground">
            Nenhum lançamento com esses filtros.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {rows.map((t) => {
              const atrasado = isOverdue(t);
              const entrada = t.type === "income";

              return (
                <li
                  key={t.id}
                  className="grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-3 lg:grid-cols-[1fr_130px_110px_110px_92px] lg:items-center"
                >
                  {/* Descrição */}
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span
                      className={cn(
                        "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md",
                        entrada
                          ? "bg-positive-muted text-positive"
                          : "bg-warning-muted text-warning",
                      )}
                      aria-hidden
                    >
                      {entrada ? (
                        <ArrowDownLeft className="size-3.5" />
                      ) : (
                        <ArrowUpRight className="size-3.5" />
                      )}
                    </span>

                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {t.description}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-2xs text-muted-foreground">
                        {t.client_id && (
                          <>
                            <span className="truncate">
                              {clientName.get(t.client_id) ?? "Cliente"}
                            </span>
                            <span aria-hidden>·</span>
                          </>
                        )}
                        <StatusPill status={t.status} overdue={atrasado} />
                      </p>
                    </div>
                  </div>

                  <span className="text-xs text-muted-foreground">
                    {CATEGORY_LABELS[t.category]}
                  </span>

                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      atrasado
                        ? "font-medium text-negative"
                        : "text-muted-foreground",
                    )}
                  >
                    {formatDate(`${t.due_date}T12:00:00`)}
                  </span>

                  <span
                    className={cn(
                      "text-sm font-medium tabular-nums lg:text-right",
                      entrada ? "text-positive" : "text-foreground",
                    )}
                  >
                    {entrada ? "+" : "−"} {formatCurrency(t.amount_cents)}
                  </span>

                  <div className="flex lg:justify-end">
                    <Button
                      size="sm"
                      variant={t.status === "paid" ? "ghost" : "outline"}
                      className="h-7 px-2 text-xs"
                      disabled={isPending || t.status === "canceled"}
                      onClick={() => handleSettle(t)}
                    >
                      {t.status === "paid" ? (
                        <>
                          <RotateCcw className="size-3.5" />
                          <span className="sr-only lg:not-sr-only">Reabrir</span>
                        </>
                      ) : (
                        <>
                          <Check className="size-3.5" />
                          Dar baixa
                        </>
                      )}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Paginação --------------------------------------------------- */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs tabular-nums text-muted-foreground">
            Página {safePage + 1} de {pageCount}
          </span>
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(p - 1, 0))}
            >
              <ChevronLeft className="size-4" />
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(p + 1, pageCount - 1))}
            >
              Próxima
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({
  status,
  overdue,
}: {
  status: FinancialTransaction["status"];
  overdue: boolean;
}) {
  if (overdue) {
    return <span className="font-medium text-negative">Em atraso</span>;
  }
  if (status === "paid") {
    return <span className="text-positive">Baixado</span>;
  }
  return <span>{STATUS_LABELS[status]}</span>;
}
