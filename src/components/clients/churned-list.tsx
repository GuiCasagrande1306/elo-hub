"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { setClientChurned } from "@/app/(app)/clientes/actions";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { ClientSegment } from "@/types/database";

/* =====================================================================
   Lista de contratos encerrados
   ---------------------------------------------------------------------
   Linha, não card. O card da carteira existe para comparar execução
   contra meta em contas vivas; aqui não há meta em curso e não há ritmo
   a acompanhar. O que interessa é o saldo do que passou e o caminho de
   volta — e isso cabe numa linha.
   ===================================================================== */

const SEGMENT_LABELS: Record<ClientSegment, string> = {
  ecommerce: "E-commerce",
  delivery: "Delivery",
  leads: "Leads",
  local_business: "Negócio local",
};

export interface ChurnedRow {
  id: string;
  name: string;
  slug: string;
  segment: ClientSegment;
  logoUrl: string | null;
  brandPrimary: string | null;
  spendCents: number;
  goalValue: number;
  metricLabel: string;
  metricIsCurrency: boolean;
}

export function ChurnedList({
  rows,
  totalInvestido,
}: {
  rows: ChurnedRow[];
  totalInvestido: number;
}) {
  return (
    <div className="mt-6">
      <div className="surface-card px-4 py-3">
        <span className="eyebrow">Investido nestas contas no mês</span>
        <p className="mt-0.5 text-lg font-semibold tabular-nums">
          {formatCurrency(totalInvestido)}
        </p>
      </div>

      <ul className="mt-4 flex flex-col gap-2">
        {rows.map((row) => (
          <Linha key={row.id} row={row} />
        ))}
      </ul>
    </div>
  );
}

function Linha({ row }: { row: ChurnedRow }) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();

  function reabrir() {
    startTransition(async () => {
      const r = await setClientChurned({ clientId: row.id, churned: false });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`${row.name} voltou para a carteira.`);
      router.refresh();
    });
  }

  return (
    <li className="surface-card flex flex-wrap items-center gap-3 p-3">
      <Marca row={row} />

      <div className="min-w-0 flex-1">
        <Link
          href={`/clientes/${row.slug}`}
          className="block truncate text-sm font-medium hover:underline"
        >
          {row.name}
        </Link>
        <p className="text-2xs text-muted-foreground">
          {SEGMENT_LABELS[row.segment]}
        </p>
      </div>

      {/* Números do mês corrente. Numa conta encerrada costumam ser
          zero — e zero aqui é informação, não falha: significa que a
          mídia já parou. */}
      <dl className="hidden gap-6 sm:flex">
        <div>
          <dt className="eyebrow">Investido</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">
            {formatCurrency(row.spendCents)}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">{row.metricLabel}</dt>
          <dd className="mt-0.5 text-sm font-semibold tabular-nums">
            {row.metricIsCurrency
              ? formatCurrency(Math.round(row.goalValue))
              : formatNumber(Math.round(row.goalValue))}
          </dd>
        </div>
      </dl>

      <Button
        size="sm"
        variant="outline"
        onClick={reabrir}
        disabled={pendente}
        className="shrink-0"
      >
        <RotateCcw className="size-3.5" />
        Reabrir
      </Button>
    </li>
  );
}

function Marca({ row }: { row: ChurnedRow }) {
  if (row.logoUrl) {
    return (
      <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-inset ring-black/10">
        {/* eslint-disable-next-line @next/next/no-img-element -- URL do Storage é externa e variável. */}
        <img
          src={row.logoUrl}
          alt=""
          className="size-full object-contain p-0.5"
        />
      </span>
    );
  }

  const letras = row.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <span
      aria-hidden
      /* Saturação baixa: a conta saiu, e a marca dela não deve competir
         em contraste com a carteira ativa. */
      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-2xs font-semibold text-white opacity-60 ring-1 ring-inset ring-black/10 dark:ring-white/10"
      style={{ background: row.brandPrimary ?? "var(--surface-2)" }}
    >
      {letras}
    </span>
  );
}
