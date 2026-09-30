"use client";

import { useMemo } from "react";

import {
  funil,
  motivosDePerda,
  ondeMorre,
  tempoDeCiclo,
  tempoPorEtapa,
  type EventoDeEtapa,
} from "@/lib/crm/metricas";
import { MOTIVO_LABEL } from "@/lib/crm/stages";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DealWithRelations } from "@/types/database";

/* =====================================================================
   O painel do funil — tudo aqui é derivado
   ---------------------------------------------------------------------
   NENHUM NÚMERO DESTA TELA É DIGITADO POR ALGUÉM. Conversão, tempo em
   etapa, tempo de ciclo e onde a venda morre saem de `crm_stage_events`,
   escrito exclusivamente por trigger — a tabela não tem policy de
   insert, então nem a aplicação nem um script podem inventar uma
   passagem de etapa.

   Antes da migration 82 o mesmo histórico existia como a frase "Etapa
   mudou de novo para contato" dentro de um campo de texto. Nada nesta
   tela seria calculável em cima daquilo.

   ⚠️ A AMOSTRA APARECE JUNTO DA MÉDIA, sempre. "22 dias em Proposta"
   apoiado em três casos e em trinta são afirmações de força
   completamente diferente, e esconder o denominador é como um número
   ganha autoridade que não tem. Com o funil ainda pequeno — que é o
   estado normal dos primeiros meses — isso é a diferença entre um
   painel honesto e um enfeite.
   ===================================================================== */

interface Props {
  deals: DealWithRelations[];
  eventos: EventoDeEtapa[];
}

export function PainelDoFunil({ deals, eventos }: Props) {
  const degraus = useMemo(() => funil(eventos), [eventos]);
  const tempos = useMemo(() => tempoPorEtapa(eventos), [eventos]);
  const ciclo = useMemo(() => tempoDeCiclo(eventos), [eventos]);
  const mortes = useMemo(() => ondeMorre(eventos), [eventos]);
  const motivos = useMemo(() => motivosDePerda(deals), [deals]);

  const entraram = degraus[0]?.alcancaram ?? 0;

  if (entraram === 0) {
    return (
      <div className="surface-card p-5">
        <h2 className="text-sm font-semibold">Ainda não há o que contar</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Conversão, tempo de ciclo e onde a venda morre são calculados a
          partir das passagens de etapa. Registre um lead na barra acima e
          mova o cartão — o painel se preenche sozinho.
        </p>
      </div>
    );
  }

  const maior = Math.max(...degraus.map((d) => d.alcancaram), 1);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      {/* ------------------------------- o funil ------------------- */}
      <section className="surface-card p-5">
        <header className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Conversão por etapa</h2>
          <span className="text-2xs text-muted-foreground">
            {entraram} {entraram === 1 ? "negócio" : "negócios"} no histórico
          </span>
        </header>

        <ul className="mt-4 flex flex-col gap-2.5">
          {degraus.map((d, i) => {
            const tempo = tempos.find((t) => t.etapa === d.etapa);
            return (
              <li key={d.etapa} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="font-medium">{d.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {d.alcancaram}
                    {d.conversao !== null && (
                      <span
                        className={cn(
                          "ml-2 font-medium",
                          d.conversao >= 0.5 ? "text-positive" : "text-warning",
                        )}
                      >
                        {formatPercent(d.conversao)} segue
                      </span>
                    )}
                  </span>
                </div>

                {/* A barra é proporcional ao TOPO do funil, não ao degrau
                    anterior: é o que deixa a queda visível de relance. */}
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-signal/70"
                    style={{ width: `${(d.alcancaram / maior) * 100}%` }}
                  />
                </div>

                {tempo?.mediaDias !== null && tempo !== undefined && (
                  <span className="text-2xs text-muted-foreground">
                    {tempo.mediaDias!.toFixed(tempo.mediaDias! < 10 ? 1 : 0)} dias
                    em média para sair{" "}
                    <span className="opacity-70">
                      (de {tempo.amostra} {tempo.amostra === 1 ? "passagem" : "passagens"})
                    </span>
                  </span>
                )}

                {i === degraus.length - 1 && ciclo.mediaDias !== null && (
                  <span className="mt-1 text-2xs text-muted-foreground">
                    Ciclo completo:{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {ciclo.mediaDias.toFixed(0)} dias
                    </span>{" "}
                    da entrada ao contrato{" "}
                    <span className="opacity-70">
                      (de {ciclo.amostra} {ciclo.amostra === 1 ? "ganho" : "ganhos"})
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ------------------------- onde a venda morre --------------- */}
      <section className="surface-card flex flex-col gap-5 p-5">
        <div>
          <h2 className="text-sm font-semibold">Onde a venda morre</h2>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            A etapa de onde o negócio saiu para perdido.
          </p>

          {mortes.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Nenhuma perda registrada ainda.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1.5">
              {mortes.map((m) => (
                <li
                  key={m.etapa}
                  className="flex items-baseline justify-between text-xs"
                >
                  <span>{m.label}</span>
                  <span className="tabular-nums font-medium">{m.perdidos}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-hairline pt-4">
          <h3 className="text-sm font-semibold">Por quê</h3>
          {/* ⚠️ OS DOIS CORTES JUNTOS, e não um só. "Preço" na proposta e
              "preço" no primeiro contato são problemas opostos: um é a
              tabela, o outro é a qualificação do lead. Separados, cada
              lista responde metade da pergunta. */}
          {motivos.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Nenhum motivo registrado ainda.
            </p>
          ) : (
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {motivos.map((m) => (
                <li
                  key={m.motivo}
                  className="flex items-baseline justify-between text-xs"
                >
                  <span>{MOTIVO_LABEL[m.motivo]}</span>
                  <span className="tabular-nums font-medium">{m.perdidos}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
