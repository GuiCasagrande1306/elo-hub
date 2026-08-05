"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CalendarRange, Loader2 } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ultimosMeses } from "@/lib/date-br";
import { buildClientsUrl } from "./filter-url";

/* =====================================================================
   Mês da carteira
   ---------------------------------------------------------------------
   O filtro vive na URL, não em estado do componente: os números vêm do
   servidor, e guardá-lo aqui obrigaria a página inteira a virar Client
   Component só para escolher um mês.

   Efeito colateral útil: a URL passa a ser compartilhável. "Olha o
   fechamento de julho" vira um link, não uma instrução.
   ===================================================================== */

export function MonthFilter({
  value,
  agency,
}: {
  value: string;
  /** Preservada na troca de mês — ver `filter-url.ts`. */
  agency: string;
}) {
  const router = useRouter();
  const [carregando, startTransition] = useTransition();

  /* Gerado a cada render a partir de hoje. Uma lista fixa envelheceria
     calada: em janeiro ainda ofereceria os meses do ano anterior como
     se fossem os últimos. */
  const meses = ultimosMeses(12);

  function trocar(novo: string) {
    startTransition(() => {
      // `scroll: false`: trocar de mês não é navegar para outra tela, e
      // ser jogado para o topo perde a linha que a pessoa estava lendo.
      router.push(
        buildClientsUrl({
          month: novo,
          agency,
          currentMonth: meses[0].value,
        }),
        { scroll: false },
      );
    });
  }

  const rotulo = (v: string) => {
    const m = meses.find((x) => x.value === v);
    if (!m) return v;
    return m.atual ? `Este mês (${m.label})` : m.label;
  };

  return (
    <Select value={value} onValueChange={(v) => trocar(v ?? meses[0].value)}>
      <SelectTrigger size="sm" className="w-full sm:w-44">
        {carregando ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <CalendarRange className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <SelectValue>{(v: string) => rotulo(v)}</SelectValue>
      </SelectTrigger>

      <SelectContent>
        {meses.map((m) => (
          <SelectItem key={m.value} value={m.value}>
            {m.atual ? `Este mês (${m.label})` : m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
