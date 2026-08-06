"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { criticalityBadge } from "./task-meta";
import { cn } from "@/lib/utils";
import { dataNoBrasil } from "@/lib/date-br";
import type { TaskWithRelations } from "@/types/database";

/* =====================================================================
   Calendário de prazos
   ---------------------------------------------------------------------
   Responde a pergunta que nem o quadro nem a lista respondem: "a semana
   que vem está sobrecarregada?". Lista ordenada por prazo mostra a
   sequência; só a grade mostra o ACÚMULO — seis entregas na quinta e
   nenhuma na sexta é invisível numa lista.

   Tarefa SEM prazo não aparece aqui, e isso é intencional: colocá-la
   num dia arbitrário inventaria um compromisso que ninguém assumiu. O
   contador no topo diz quantas ficaram de fora, para elas não sumirem
   da consciência de quem planeja.

   Datas em São Paulo. `due_date` é timestamptz e cortar a string em UTC
   jogaria prazos do fim da tarde para o dia seguinte — a mesma falha que
   já apareceu na esteira e no `lastNDays`.
   ===================================================================== */

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function TaskCalendar({
  tasks,
  onOpenTask,
}: {
  tasks: TaskWithRelations[];
  onOpenTask: (id: string) => void;
}) {
  const hojeISO = dataNoBrasil();
  const [ano, setAno] = useState(() => Number(hojeISO.slice(0, 4)));
  const [mes, setMes] = useState(() => Number(hojeISO.slice(5, 7)) - 1);

  /* Índice por dia. Montado a cada render em vez de memo: a carteira
     tem dezenas de tarefas, não milhares, e um memo aqui só adiciona
     uma dependência para esquecer de atualizar. */
  const porDia = new Map<string, TaskWithRelations[]>();
  let semPrazo = 0;

  for (const t of tasks) {
    if (!t.due_date) {
      semPrazo += 1;
      continue;
    }
    const dia = dataNoBrasil(t.due_date);
    const lista = porDia.get(dia);
    if (lista) lista.push(t);
    else porDia.set(dia, [t]);
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

  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const primeiroDiaSemana = new Date(ano, mes, 1).getDay();

  return (
    <section className="surface-card overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="size-7 p-0"
          onClick={() => navegar(-1)}
          aria-label="Mês anterior"
        >
          <ChevronLeft className="size-4" />
        </Button>

        <span className="text-sm font-semibold">
          {MESES[mes]} de {ano}
        </span>

        <Button
          variant="ghost"
          size="sm"
          className="size-7 p-0"
          onClick={() => navegar(1)}
          aria-label="Próximo mês"
        >
          <ChevronRight className="size-4" />
        </Button>

        {semPrazo > 0 && (
          <span className="ml-auto text-2xs text-muted-foreground">
            {semPrazo} {semPrazo === 1 ? "tarefa sem prazo" : "tarefas sem prazo"}
            {" "}— não aparecem aqui
          </span>
        )}
      </header>

      <div className="grid grid-cols-7 border-b border-hairline">
        {DIAS.map((d) => (
          <span
            key={d}
            className="px-2 py-1.5 text-center text-2xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            {d}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {Array.from({ length: primeiroDiaSemana }, (_, i) => (
          <div key={`vazio-${i}`} className="min-h-24 border-b border-r border-hairline" />
        ))}

        {Array.from({ length: diasNoMes }, (_, i) => {
          const dia = i + 1;
          const iso = `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
          const doDia = porDia.get(iso) ?? [];
          const ehHoje = iso === hojeISO;
          const passou = iso < hojeISO;

          return (
            <div
              key={dia}
              className={cn(
                "min-h-24 border-b border-r border-hairline p-1.5",
                ehHoje && "bg-signal-muted/25",
              )}
            >
              <span
                className={cn(
                  "inline-grid size-5 place-items-center rounded-full text-2xs tabular-nums",
                  ehHoje
                    ? "bg-signal font-semibold text-white"
                    : passou
                      ? "text-muted-foreground/45"
                      : "text-muted-foreground",
                )}
              >
                {dia}
              </span>

              <div className="mt-1 flex flex-col gap-0.5">
                {/* Três por dia e o resto como contador: célula que
                    cresce sem limite quebra o alinhamento da grade e
                    esconde as semanas seguintes. */}
                {doDia.slice(0, 3).map((t) => {
                  const badge = criticalityBadge(t.criticality);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onOpenTask(t.id)}
                      title={t.title}
                      className={cn(
                        "flex items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] transition-colors hover:bg-accent",
                        t.status === "done" && "opacity-50 line-through",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          badge.className.split(" ")[0],
                        )}
                      />
                      <span className="truncate">{t.title}</span>
                    </button>
                  );
                })}

                {doDia.length > 3 && (
                  <span className="px-1 text-[10px] text-muted-foreground">
                    +{doDia.length - 3}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
