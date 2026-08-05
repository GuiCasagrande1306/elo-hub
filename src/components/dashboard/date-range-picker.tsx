"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/* =====================================================================
   Intervalo por calendário
   ---------------------------------------------------------------------
   Os presets 7/30/90 respondem "como estamos indo". Não respondem "o
   que aconteceu na semana da promoção" — e é essa a pergunta que leva
   alguém a abrir o Gerenciador de Anúncios por fora.

   Calendário próprio, sem react-day-picker: a base é Base UI, o
   componente do shadcn assume Radix, e a adaptação custaria mais que as
   cem linhas de grade aqui.

   Datas trafegam como YYYY-MM-DD, o mesmo formato de `metric_date` no
   banco. Nenhum `Date` cruza a fronteira — é o que evita o painel
   discordar de si mesmo por causa de fuso.
   ===================================================================== */

const DIAS = ["D", "S", "T", "Q", "Q", "S", "S"];
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** YYYY-MM-DD de um ano/mês/dia, sem passar por fuso. */
function iso(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function formatarBR(data: string): string {
  const [a, m, d] = data.split("-");
  return `${d}/${m}/${a}`;
}

export function DateRangePicker({
  slug,
  start,
  end,
  active,
}: {
  slug: string;
  start: string;
  end: string;
  /** Intervalo veio do calendário, não de um preset. */
  active: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);

  // Mês exibido na grade. Abre no mês do fim do período atual.
  const [ano, setAno] = useState(() => Number(end.slice(0, 4)));
  const [mes, setMes] = useState(() => Number(end.slice(5, 7)) - 1);

  /* Seleção em duas etapas: o primeiro clique fixa o início e zera o
     fim; o segundo fecha. Guardar só o início enquanto pendura evita o
     estado ambíguo de "um clique só" ser lido como intervalo de um dia
     que ninguém pediu. */
  const [de, setDe] = useState<string | null>(null);

  function clicar(data: string) {
    if (!de) {
      setDe(data);
      return;
    }

    // Clique fora de ordem não é erro do usuário — é o intervalo ao
    // contrário. Ordenamos em vez de recusar.
    const [inicio, fim] = de <= data ? [de, data] : [data, de];
    setDe(null);
    setAberto(false);
    router.push(`/clientes/${slug}?de=${inicio}&ate=${fim}`, { scroll: false });
  }

  function navegar(delta: number) {
    const novo = mes + delta;
    if (novo < 0) {
      setMes(11);
      setAno(ano - 1);
    } else if (novo > 11) {
      setMes(0);
      setAno(ano + 1);
    } else {
      setMes(novo);
    }
  }

  /* `new Date(ano, mes + 1, 0)` no fuso local só é usado para CONTAR
     dias do mês — nunca para produzir a data que vai para a URL. */
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const primeiroDiaSemana = new Date(ano, mes, 1).getDay();

  const hoje = iso(
    new Date().getFullYear(),
    new Date().getMonth(),
    new Date().getDate(),
  );

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant={active ? "default" : "outline"}
            size="sm"
            className="h-8 gap-1.5"
          >
            <CalendarDays className="size-3.5" />
            <span className="hidden text-xs tabular-nums sm:inline">
              {active ? `${formatarBR(start)} – ${formatarBR(end)}` : "Escolher"}
            </span>
          </Button>
        }
      />

      <PopoverContent className="w-auto p-3" align="end">
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            onClick={() => navegar(-1)}
            aria-label="Mês anterior"
          >
            <ChevronLeft className="size-4" />
          </Button>

          <span className="text-xs font-medium">
            {MESES[mes]} de {ano}
          </span>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            onClick={() => navegar(1)}
            aria-label="Próximo mês"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <div className="mt-2 grid grid-cols-7 gap-0.5">
          {DIAS.map((d, i) => (
            <span
              key={i}
              className="grid size-8 place-items-center text-[10px] font-medium text-muted-foreground"
            >
              {d}
            </span>
          ))}

          {Array.from({ length: primeiroDiaSemana }, (_, i) => (
            <span key={`vazio-${i}`} className="size-8" />
          ))}

          {Array.from({ length: diasNoMes }, (_, i) => {
            const dia = i + 1;
            const data = iso(ano, mes, dia);

            const noIntervalo = !de && data >= start && data <= end;
            const extremo = !de && (data === start || data === end);
            const pendente = de === data;
            /* Dia ainda em veiculação: escolhê-lo traria um número
               parcial que se lê como queda. */
            const futuro = data >= hoje;

            return (
              <button
                key={dia}
                type="button"
                disabled={futuro}
                onClick={() => clicar(data)}
                className={cn(
                  "grid size-8 place-items-center rounded-md text-xs tabular-nums transition-colors",
                  futuro && "cursor-not-allowed text-muted-foreground/30",
                  !futuro && "hover:bg-surface-2",
                  noIntervalo && !extremo && "bg-signal-muted/50",
                  (extremo || pendente) &&
                    "bg-signal font-medium text-white hover:bg-signal",
                )}
              >
                {dia}
              </button>
            );
          })}
        </div>

        <p className="mt-2.5 border-t border-hairline pt-2.5 text-2xs text-muted-foreground">
          {de
            ? `Início em ${formatarBR(de)}. Escolha o fim.`
            : "Clique no primeiro e no último dia."}
        </p>
      </PopoverContent>
    </Popover>
  );
}
