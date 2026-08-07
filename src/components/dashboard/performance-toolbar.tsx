"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PERIOD_PRESETS, type PeriodPreset } from "@/lib/date-br";
import { CLIENT_SEGMENTS, SEGMENT_LABELS } from "@/lib/validation/client";

/* =====================================================================
   Filtros da Performance
   ---------------------------------------------------------------------
   ESTADO NA URL, não em `useState`. Três consequências práticas: a busca
   sobrevive ao F5, o link colado no WhatsApp abre o mesmo recorte, e o
   botão voltar do navegador desfaz o filtro em vez de sair da página.

   O `useState` daqui é só o RASCUNHO do campo de texto. A URL é a fonte
   da verdade; o estado local existe para o input não engasgar enquanto o
   servidor refaz a consulta.
   ===================================================================== */

const TODOS = "__todos__";

export function PerformanceToolbar({
  query,
  period,
  niche,
}: {
  query: string;
  period: PeriodPreset;
  /** "" = todos os nichos. */
  niche: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [rascunho, setRascunho] = useState(query);
  const [ultimaUrl, setUltimaUrl] = useState(query);

  /* A URL pode mudar por fora — botão voltar, link colado — e o campo
     precisa acompanhar. Ajuste DURANTE o render, não num efeito: efeito
     que chama setState renderiza duas vezes e faz o input piscar com o
     valor antigo antes de corrigir. É o padrão que o React documenta
     para estado derivado de prop. */
  if (query !== ultimaUrl) {
    setUltimaUrl(query);
    setRascunho(query);
  }

  function navegar(next: { q?: string; period?: string; niche?: string }) {
    const params = new URLSearchParams(searchParams.toString());

    const q = next.q ?? query;
    const p = next.period ?? period;
    const n = next.niche ?? niche;

    if (q.trim()) params.set("q", q.trim());
    else params.delete("q");

    /* O padrão sai da URL: link limpo é o de 30 dias, e carregar
       `?period=30d` em toda navegação é ruído. */
    if (p && p !== "30d") params.set("period", p);
    else params.delete("period");

    if (n) params.set("niche", n);
    else params.delete("niche");

    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  /* 400ms. Cada tecla refazendo a consulta significaria uma varredura de
     46 contas por caractere digitado — e a lista piscando enquanto a
     pessoa ainda está escrevendo o nome. */
  useEffect(() => {
    if (rascunho === query) return;
    const id = setTimeout(() => navegar({ q: rascunho }), 400);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rascunho]);

  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          placeholder="Buscar conta…"
          className="pl-9"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Nicho antes do período: recorta QUAIS contas entram; o
            período recorta QUANDO. A ordem segue a leitura. */}
        <Select
          value={niche || TODOS}
          onValueChange={(v) =>
            v && navegar({ niche: v === TODOS ? "" : v })
          }
        >
          <SelectTrigger className="w-44">
            <SelectValue>
              {(v: string) =>
                v === TODOS
                  ? "Todos os nichos"
                  : (SEGMENT_LABELS[v as keyof typeof SEGMENT_LABELS] ??
                    "Todos os nichos")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os nichos</SelectItem>
            {CLIENT_SEGMENTS.map((seg) => (
              <SelectItem key={seg} value={seg}>
                {SEGMENT_LABELS[seg]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

      <Select
        value={period}
        onValueChange={(v) => v && navegar({ period: v })}
      >
        <SelectTrigger className="w-44">
          {/* Sem a função de render, o Base UI mostra o valor cru. */}
          <SelectValue>
            {(v: string) =>
              PERIOD_PRESETS.find((p) => p.value === v)?.label ?? "Período"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PERIOD_PRESETS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      </div>
    </div>
  );
}
