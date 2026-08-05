"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Building2, Loader2 } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AGENCY_PARTNERS } from "@/lib/validation/client";
import { buildClientsUrl } from "./filter-url";
import { mesCorrenteBR } from "@/lib/date-br";

/* =====================================================================
   Agência parceira
   ---------------------------------------------------------------------
   Separa conta própria de terceirização. O filtro recarrega do
   SERVIDOR, não esconde linhas no cliente: os totais do topo somam
   sobre a mesma lista que os cards, e filtrar em memória faria o resumo
   contar uma carteira e os cards mostrarem outra.
   ===================================================================== */

const TODAS = "__todas__";

export function AgencyFilter({
  value,
  month,
}: {
  /** "" = todas. */
  value: string;
  month: string;
}) {
  const router = useRouter();
  const [carregando, startTransition] = useTransition();

  function trocar(nova: string) {
    startTransition(() => {
      router.push(
        buildClientsUrl({
          month,
          agency: nova === TODAS ? "" : nova,
          currentMonth: mesCorrenteBR().referencia,
        }),
        { scroll: false },
      );
    });
  }

  return (
    <Select
      value={value || TODAS}
      onValueChange={(v) => trocar(v ?? TODAS)}
    >
      <SelectTrigger size="sm" className="w-full sm:w-48" aria-label="Agência">
        {carregando ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <SelectValue>
          {(v: string) => (v === TODAS ? "Todas as agências" : v)}
        </SelectValue>
      </SelectTrigger>

      <SelectContent>
        <SelectItem value={TODAS}>Todas as agências</SelectItem>
        {AGENCY_PARTNERS.map((a) => (
          <SelectItem key={a} value={a}>
            {a}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
