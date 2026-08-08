"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";

/* =====================================================================
   Período: presets E calendário no mesmo lugar
   ---------------------------------------------------------------------
   Os atalhos ficam DENTRO do popover do calendário, não ao lado dele.
   Dois controles separados para a mesma decisão obrigam a olhar os dois
   para saber qual está valendo — e quando o intervalo é escolhido à mão,
   os botões de preset ficam todos apagados, sem dizer o que está ativo.
   Aqui o gatilho sempre mostra o período em vigor, venha de onde vier.

   `<input type="date">` em vez de um calendário desenhado: o nativo já
   traz teclado, acessibilidade e o formato do sistema, e evita uma
   dependência inteira para uma escolha que se faz duas vezes por mês.
   ===================================================================== */

export interface Periodo {
  since: string;
  until: string;
  /** Preset ativo, quando o intervalo veio de um atalho. */
  dias?: number;
}

const PRESETS = [7, 14, 30, 90] as const;

const FUSO = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Últimos N dias terminando ONTEM, no fuso de São Paulo.
 *
 * Termina ontem porque o dia corrente ainda está veiculando e entraria
 * como uma queda que não existe — mesma regra de `lastNDays`.
 */
export function janelaDeDias(dias: number): Periodo {
  const fim = new Date(`${FUSO.format(new Date())}T12:00:00-03:00`);
  fim.setUTCDate(fim.getUTCDate() - 1);
  const inicio = new Date(fim);
  inicio.setUTCDate(inicio.getUTCDate() - (dias - 1));

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { since: iso(inicio), until: iso(fim), dias };
}

export function PeriodPicker({
  valor,
  onChange,
}: {
  valor: Periodo;
  onChange: (p: Periodo) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [de, setDe] = useState(valor.since);
  const [ate, setAte] = useState(valor.until);

  function aplicarPreset(dias: number) {
    const p = janelaDeDias(dias);
    setDe(p.since);
    setAte(p.until);
    onChange(p);
    setAberto(false);
  }

  function aplicarIntervalo() {
    /* Ordem invertida produz `time_range` vazio, e a tela mostraria
       "nenhuma entrega" para uma conta que gastou — erro que parece
       dado. Trocar em silêncio é mais útil que recusar. */
    const [since, until] = de <= ate ? [de, ate] : [ate, de];
    onChange({ since, until });
    setAberto(false);
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className="h-8 gap-1.5">
            <CalendarDays className="size-3.5" />
            <span className="tabular-nums">
              {valor.dias
                ? `Últimos ${valor.dias} dias`
                : formatPeriod(valor.since, valor.until)}
            </span>
          </Button>
        }
      />

      <PopoverContent align="start" className="w-72 p-3">
        <p className="eyebrow mb-2">Atalhos</p>
        <div className="grid grid-cols-4 gap-1.5">
          {PRESETS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => aplicarPreset(d)}
              className={cn(
                "rounded-md border border-hairline px-2 py-1.5 text-xs tabular-nums transition-colors hover:bg-accent",
                valor.dias === d && "border-signal bg-accent font-medium",
              )}
            >
              {d}d
            </button>
          ))}
        </div>

        <div className="mt-4 border-t border-hairline pt-3">
          <p className="eyebrow mb-2">Intervalo</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
              De
              <Input
                type="date"
                value={de}
                max={ate}
                onChange={(e) => setDe(e.target.value)}
                className="h-8 text-xs"
              />
            </label>
            <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
              Até
              <Input
                type="date"
                value={ate}
                min={de}
                onChange={(e) => setAte(e.target.value)}
                className="h-8 text-xs"
              />
            </label>
          </div>

          <Button
            size="sm"
            className="mt-3 h-8 w-full"
            onClick={aplicarIntervalo}
          >
            Aplicar intervalo
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
