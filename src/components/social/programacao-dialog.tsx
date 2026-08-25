"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarSync, Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fixarSemanaComoProgramacao,
  gerarPautasDaProgramacao,
  removerLinhaDaProgramacao,
  salvarLinhaDaProgramacao,
} from "@/app/(app)/midias-sociais/programacao-actions";
import { DIAS_SEMANA } from "@/lib/social/agenda";
import { FORMATOS, FORMATO_LABEL } from "@/lib/social/networks";
import {
  SEMANAS_A_FRENTE,
  ordenarGrade,
  rotuloDaRecorrencia,
} from "@/lib/social/programacao";
import { rotuloDaSemana, semanaDe } from "@/lib/social/pauta";
import { cn } from "@/lib/utils";
import type {
  Client,
  SocialFormat,
  SocialRecurrenceWithClient,
} from "@/types/database";

/* =====================================================================
   Programação semanal
   ---------------------------------------------------------------------
   A carteira de conteúdo tem grade fixa: os mesmos clientes, nos mesmos
   dias, toda semana. Medido em 25/08/2026, 22 peças em 11 clientes —
   Brazzo seis vezes por semana, Way Coonecta às segundas, quartas e
   sextas, e sete clientes uma vez por semana na quarta.

   Sem esta tela, encher o mês seguinte é repetir 88 vezes o mesmo
   formulário. Com ela, a grade se declara uma vez e o gerador mantém as
   próximas oito semanas preenchidas sozinho.

   O ATALHO É O PONTO DE ENTRADA, não o formulário. Quem abre isto pela
   primeira vez já digitou uma semana inteira à mão — pedir que ela seja
   redigitada aqui é cobrar duas vezes pelo mesmo trabalho. Por isso o
   primeiro botão é "usar a semana atual", e o formulário existe para o
   ajuste depois.
   ===================================================================== */

interface Props {
  aberto: boolean;
  onAbertoChange: (v: boolean) => void;
  programacao: SocialRecurrenceWithClient[];
  clients: Client[];
  /** A semana que a grade está mostrando, para o atalho de "fixar". */
  semanaVisivel: string;
}

export function ProgramacaoDialog({
  aberto,
  onAbertoChange,
  programacao,
  clients,
  semanaVisivel,
}: Props) {
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  const porCliente = useMemo(() => {
    const mapa = new Map<string, SocialRecurrenceWithClient[]>();
    for (const linha of programacao) {
      const lista = mapa.get(linha.client_id);
      if (lista) lista.push(linha);
      else mapa.set(linha.client_id, [linha]);
    }

    return [...mapa.entries()]
      .map(([clientId, linhas]) => ({
        cliente: clients.find((c) => c.id === clientId) ?? null,
        clientId,
        linhas: ordenarGrade(linhas),
      }))
      .sort((a, b) =>
        (a.cliente?.name ?? "").localeCompare(b.cliente?.name ?? "", "pt-BR"),
      );
  }, [programacao, clients]);

  const totalPorSemana = programacao.length;
  const dias = semanaDe(semanaVisivel);

  function comAviso<T>(
    promessa: Promise<{ ok: true; dados: T } | { ok: false; error: string }>,
    aoDarCerto: (dados: T) => string,
  ) {
    iniciar(async () => {
      let r;
      try {
        r = await promessa;
      } catch {
        /* Server Action é fetch, e a rejeição dentro da transition sobe
           para o error boundary em vez de virar `ok: false`. */
        toast.error("Não deu para salvar agora. Verifique a conexão.");
        return;
      }
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(aoDarCerto(r.dados));
      router.refresh();
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={onAbertoChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Programação semanal</DialogTitle>
          <DialogDescription>
            A grade fixa de cada cliente. O sistema mantém as próximas{" "}
            {SEMANAS_A_FRENTE} semanas preenchidas sozinho — aqui você muda o
            dia e o que a peça é; a arte e a legenda seguem no calendário.
          </DialogDescription>
        </DialogHeader>

        {programacao.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-lg bg-surface-2 p-4">
            <p className="text-sm text-muted-foreground">
              Ainda não há grade. A semana que você já montou pode virar a
              programação — é o caminho mais curto, e depois dá para ajustar
              cliente por cliente aqui mesmo.
            </p>
            <Button
              size="sm"
              disabled={ocupado}
              onClick={() =>
                comAviso(
                  fixarSemanaComoProgramacao({ semana: dias[0]! }),
                  (d) =>
                    `${d.linhas} ${d.linhas === 1 ? "peça fixada" : "peças fixadas"} em ${d.clientes} ${d.clientes === 1 ? "cliente" : "clientes"}.`,
                )
              }
            >
              {ocupado ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wand2 className="size-4" />
              )}
              Usar {rotuloDaSemana(dias)} como programação
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {porCliente.map(({ clientId, cliente, linhas }) => (
              <section key={clientId} className="flex flex-col gap-1.5">
                <header className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{
                      background:
                        cliente?.brand_primary || "var(--muted-foreground)",
                    }}
                  />
                  <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
                    {cliente?.name ?? "Cliente"}
                  </h3>
                  <span className="text-2xs text-muted-foreground">
                    {linhas.length}/semana
                  </span>
                </header>

                {linhas.map((linha) => (
                  <LinhaDaGrade
                    key={linha.id}
                    linha={linha}
                    ocupado={ocupado}
                    onSalvar={(campos) =>
                      comAviso(
                        salvarLinhaDaProgramacao({
                          recurrenceId: linha.id,
                          clientId,
                          ...campos,
                        }),
                        (d) =>
                          d.movidas > 0
                            ? `Grade atualizada — ${d.movidas} ${d.movidas === 1 ? "peça movida" : "peças movidas"}.`
                            : "Grade atualizada.",
                      )
                    }
                    onRemover={() =>
                      comAviso(
                        removerLinhaDaProgramacao({ recurrenceId: linha.id }),
                        (d) =>
                          d.apagadas > 0
                            ? `Fora da grade — ${d.apagadas} ${d.apagadas === 1 ? "peça futura removida" : "peças futuras removidas"}.`
                            : "Fora da grade.",
                      )
                    }
                  />
                ))}

                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() =>
                    comAviso(
                      salvarLinhaDaProgramacao({
                        clientId,
                        weekday: 3,
                        hora: "09:00",
                        format: "video_vertical",
                        title: "",
                      }),
                      () => "Peça acrescentada à grade.",
                    )
                  }
                  className="flex items-center gap-1 self-start rounded px-1 py-0.5 text-2xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                >
                  <Plus className="size-3" />
                  mais uma por semana
                </button>
              </section>
            ))}
          </div>
        )}

        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
          <span className="mr-auto text-2xs text-muted-foreground">
            {totalPorSemana === 0
              ? "Nenhuma peça na grade"
              : `${totalPorSemana} ${totalPorSemana === 1 ? "peça" : "peças"} por semana · ${totalPorSemana * SEMANAS_A_FRENTE} nas próximas ${SEMANAS_A_FRENTE} semanas`}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={ocupado || programacao.length === 0}
            onClick={() =>
              comAviso(gerarPautasDaProgramacao(), (d) =>
                d.criadas === 0
                  ? "Já estava tudo preenchido."
                  : `${d.criadas} ${d.criadas === 1 ? "peça criada" : "peças criadas"} no calendário.`,
              )
            }
          >
            {ocupado ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CalendarSync className="size-4" />
            )}
            Preencher agora
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

function LinhaDaGrade({
  linha,
  ocupado,
  onSalvar,
  onRemover,
}: {
  linha: SocialRecurrenceWithClient;
  ocupado: boolean;
  onSalvar: (campos: {
    weekday: number;
    hora: string;
    format: SocialFormat;
    title: string;
  }) => void;
  onRemover: () => void;
}) {
  /* Estado local do formulário, semeado pela prop. O `key` da lista é o
     id da linha, então uma linha nova remonta com os valores certos sem
     copiar prop em estado por efeito — o padrão que o React Compiler
     recusa neste projeto. */
  const [weekday, setWeekday] = useState(linha.weekday);
  const [hora, setHora] = useState(linha.hora);
  const [formato, setFormato] = useState<SocialFormat>(linha.format);
  const [titulo, setTitulo] = useState(linha.title);

  const mudou =
    weekday !== linha.weekday ||
    hora !== linha.hora ||
    formato !== linha.format ||
    titulo !== linha.title;

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-surface-2/60 p-1.5">
      <Select
        value={String(weekday)}
        onValueChange={(v) => setWeekday(Number(v ?? weekday))}
      >
        <SelectTrigger size="sm" className="h-8 w-28">
          <SelectValue>
            {(v: string) => rotuloDaRecorrencia(Number(v))}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {DIAS_SEMANA.map((_, i) => (
            <SelectItem key={i} value={String(i)}>
              {rotuloDaRecorrencia(i)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <input
        type="time"
        value={hora}
        onChange={(e) => setHora(e.target.value)}
        className="h-8 w-24 rounded-md bg-surface px-2 text-xs tabular-nums outline-none ring-1 ring-hairline focus:ring-signal/60"
      />

      <Select
        value={formato}
        onValueChange={(v) => setFormato((v as SocialFormat) ?? formato)}
      >
        <SelectTrigger size="sm" className="h-8 w-36">
          <SelectValue>
            {(v: string) => FORMATO_LABEL.get(v as SocialFormat) ?? v}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {FORMATOS.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <input
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        placeholder="Nome da peça (opcional)"
        className="h-8 min-w-0 flex-1 rounded-md bg-surface px-2 text-xs outline-none ring-1 ring-hairline focus:ring-signal/60"
      />

      <Button
        size="sm"
        variant={mudou ? "default" : "ghost"}
        className={cn("h-8 px-2 text-xs", !mudou && "text-muted-foreground")}
        disabled={ocupado || !mudou}
        onClick={() => onSalvar({ weekday, hora, format: formato, title: titulo })}
      >
        Salvar
      </Button>

      <Button
        size="sm"
        variant="ghost"
        className="h-8 px-2 text-muted-foreground hover:text-negative"
        disabled={ocupado}
        onClick={onRemover}
        aria-label="Tirar da grade"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
