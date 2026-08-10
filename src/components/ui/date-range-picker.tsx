"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  PRESETS_INTERVALO,
  dataNoBrasil,
  resolvePeriod,
  type IntervaloPreset,
} from "@/lib/date-br";
import { cn } from "@/lib/utils";

/* =====================================================================
   Seletor de intervalo, no formato do Gerenciador de Anúncios
   ---------------------------------------------------------------------
   Atalhos à esquerda, dois meses de calendário à direita, e o intervalo
   escolhido escrito por extenso no rodapé antes de aplicar.

   POR QUE DOIS MESES: quase todo intervalo real cruza a virada — "de 20
   de julho a 5 de agosto" é a forma normal de pedir. Com um mês só, quem
   escolhe precisa clicar o início, navegar, e clicar o fim sem enxergar
   mais o começo; o erro de um dia nas pontas fica invisível até o PDF
   sair com o período errado.

   O ESTADO SÓ SAI NO "APLICAR". Enquanto o popover está aberto, mexer
   nas datas não dispara nada — o pai continua com o intervalo antigo.
   Um seletor que aplica a cada clique recarrega a tela no meio da
   escolha, com o intervalo pela metade (só o início marcado).

   TUDO EM `YYYY-MM-DD`, string, no fuso de São Paulo. `Date` como
   moeda de troca traria de volta o bug que `date-br.ts` existe para
   matar: o servidor da Vercel roda em UTC e "ontem" lá vira hoje aqui
   das 21h à meia-noite.
   ===================================================================== */

export interface Intervalo {
  inicio: string;
  fim: string;
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const DIAS = ["D", "S", "T", "Q", "Q", "S", "S"];

export function DateRangePicker({
  value,
  onChange,
  className,
  id,
}: {
  value: Intervalo;
  onChange: (intervalo: Intervalo) => void;
  className?: string;
  id?: string;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            className={cn("h-9 w-full justify-start gap-2 font-normal", className)}
          >
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{rotuloDoIntervalo(value)}</span>
          </Button>
        }
      />

      <PopoverContent align="start" className="w-auto p-0">
        {/* Remonta a cada abertura: o rascunho interno precisa nascer do
            valor atual, e `key` faz isso sem copiar prop em estado por
            efeito — o padrão que o React Compiler recusa neste projeto. */}
        <Painel
          key={`${value.inicio}:${value.fim}:${String(aberto)}`}
          value={value}
          onAplicar={(intervalo) => {
            onChange(intervalo);
            setAberto(false);
          }}
          onCancelar={() => setAberto(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */

function Painel({
  value,
  onAplicar,
  onCancelar,
}: {
  value: Intervalo;
  onAplicar: (intervalo: Intervalo) => void;
  onCancelar: () => void;
}) {
  const [inicio, setInicio] = useState(value.inicio);
  const [fim, setFim] = useState(value.fim);
  /* Depois de fechar um intervalo, o próximo clique começa outro. Sem
     este sinal, clicar de novo só empurraria o fim para frente e não
     haveria como escolher um intervalo que começa depois. */
  const [escolhendoFim, setEscolhendoFim] = useState(false);

  /* Abre no mês do INÍCIO, não no do fim. Com a âncora no fim, um
     intervalo que cruza a virada — "11 de jul a 9 de ago", que é o
     formato de quase todo relatório mensal — abre mostrando agosto e
     setembro, e a ponta de julho fica fora da tela. Ancorando no início,
     os dois painéis cobrem as duas pontas. */
  const [ancora, setAncora] = useState(() => value.inicio.slice(0, 7));

  const hoje = dataNoBrasil();

  const presetAtivo = useMemo(
    () =>
      PRESETS_INTERVALO.find((p) => {
        const r = resolvePeriod(p.value);
        return r.start === inicio && r.end === fim;
      })?.value ?? null,
    [inicio, fim],
  );

  function escolherPreset(preset: IntervaloPreset) {
    const { start, end } = resolvePeriod(preset);
    setInicio(start);
    setFim(end);
    setEscolhendoFim(false);
    setAncora(start.slice(0, 7));
  }

  function clicarDia(dia: string) {
    if (!escolhendoFim) {
      setInicio(dia);
      setFim(dia);
      setEscolhendoFim(true);
      return;
    }

    /* Clique ANTES do início vira um novo início, em vez de um intervalo
       invertido. É o que o calendário do Meta faz, e evita o estado
       "fim < início" que nenhuma query aceita. */
    if (dia < inicio) {
      setInicio(dia);
      setFim(dia);
      return;
    }

    setFim(dia);
    setEscolhendoFim(false);
  }

  const [ano, mes] = ancora.split("-").map(Number);
  const segundo = mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, "0")}`;

  function navegar(delta: number) {
    const d = new Date(Date.UTC(ano, mes - 1 + delta, 1));
    setAncora(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  const dias = Math.round(
    (Date.parse(`${fim}T12:00:00Z`) - Date.parse(`${inicio}T12:00:00Z`)) / 86400000,
  ) + 1;

  return (
    /* LARGURA EXPLÍCITA NO CELULAR. O popover é `w-auto`, então quem
       define a largura é o filho mais largo — e a fila de atalhos tem
       ~600px de conteúdo. Sem esta trava ela empurrava o painel para a
       largura inteira da tela, com um calendário de 196px perdido no
       meio. 248px = a coluna do calendário (196) mais o respiro. */
    <div className="flex w-[248px] flex-col sm:w-auto">
      <div className="flex flex-col sm:flex-row">
        {/* --------------------------- Atalhos ---------------------------
            Quebra em linhas no celular e vira coluna a partir de `sm`.
            Rolagem horizontal esconderia metade dos atalhos atrás de um
            gesto que ninguém adivinha num popover. */}
        <div className="flex shrink-0 flex-wrap gap-1 border-b border-hairline p-2 sm:w-44 sm:flex-nowrap sm:flex-col sm:border-b-0 sm:border-r">
          {PRESETS_INTERVALO.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => escolherPreset(p.value)}
              aria-pressed={presetAtivo === p.value}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-xs transition-colors sm:w-full",
                presetAtivo === p.value
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* -------------------------- Calendário ------------------------- */}
        <div className="p-3">
          <header className="mb-2 flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="size-7 shrink-0 p-0"
              onClick={() => navegar(-1)}
              aria-label="Mês anterior"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="flex-1 text-center text-xs font-medium">
              {rotuloDoMes(ancora)}
            </span>
            {/* O segundo mês só existe a partir de `sm`: dois calendários
                lado a lado pedem ~520px e o popover fica mais largo que a
                tela do celular. */}
            <span className="hidden flex-1 text-center text-xs font-medium sm:block">
              {rotuloDoMes(segundo)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="size-7 shrink-0 p-0"
              onClick={() => navegar(1)}
              aria-label="Próximo mês"
            >
              <ChevronRight className="size-4" />
            </Button>
          </header>

          <div className="flex gap-4">
            <Mes
              referencia={ancora}
              inicio={inicio}
              fim={fim}
              hoje={hoje}
              onClicar={clicarDia}
            />
            <div className="hidden sm:block">
              <Mes
                referencia={segundo}
                inicio={inicio}
                fim={fim}
                hoje={hoje}
                onClicar={clicarDia}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ---------------------------- Rodapé ---------------------------- */}
      <footer className="flex flex-wrap items-center gap-2 border-t border-hairline px-3 py-2.5">
        <span className="text-2xs text-muted-foreground">
          {/* O intervalo por extenso ANTES de aplicar: é a única chance de
              flagrar o erro de um dia nas pontas sem gerar o PDF. */}
          {rotuloDoIntervalo({ inicio, fim })} ·{" "}
          <span className="tabular-nums">
            {dias} {dias === 1 ? "dia" : "dias"}
          </span>
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="sm" className="h-8" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button
            size="sm"
            className="h-8"
            onClick={() => onAplicar({ inicio, fim })}
          >
            Aplicar
          </Button>
        </div>
      </footer>
    </div>
  );
}

function Mes({
  referencia,
  inicio,
  fim,
  hoje,
  onClicar,
}: {
  referencia: string;
  inicio: string;
  fim: string;
  hoje: string;
  onClicar: (dia: string) => void;
}) {
  const [ano, mes] = referencia.split("-").map(Number);
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const primeiroDiaSemana = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();

  return (
    <div className="w-[196px]">
      <div className="grid grid-cols-7">
        {DIAS.map((d, i) => (
          <span
            key={i}
            className="py-1 text-center text-[10px] font-medium uppercase text-muted-foreground"
          >
            {d}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {Array.from({ length: primeiroDiaSemana }, (_, i) => (
          <span key={`v-${i}`} />
        ))}

        {Array.from({ length: diasNoMes }, (_, i) => {
          const dia = `${referencia}-${String(i + 1).padStart(2, "0")}`;
          const dentro = dia >= inicio && dia <= fim;
          const ehPonta = dia === inicio || dia === fim;
          /* Datas futuras ficam desabilitadas: não existe métrica
             veiculada amanhã, e deixar escolher produziria um relatório
             com dias vazios que achatam a média. */
          const futuro = dia > hoje;

          return (
            <button
              key={dia}
              type="button"
              disabled={futuro}
              onClick={() => onClicar(dia)}
              className={cn(
                "relative h-7 text-xs tabular-nums transition-colors",
                futuro && "cursor-not-allowed text-muted-foreground/30",
                !futuro && !dentro && "hover:bg-accent",
                dentro && !ehPonta && "bg-signal-muted text-signal",
                ehPonta && "bg-signal font-semibold text-white",
                dia === inicio && "rounded-l-md",
                dia === fim && "rounded-r-md",
              )}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function rotuloDoMes(referencia: string): string {
  const [ano, mes] = referencia.split("-").map(Number);
  return `${MESES[mes - 1]} de ${ano}`;
}

/** "20 de jul — 5 de ago de 2026", ou um dia só quando as pontas batem. */
export function rotuloDoIntervalo({ inicio, fim }: Intervalo): string {
  if (!inicio || !fim) return "Escolher período";

  const [ai, mi, di] = inicio.split("-").map(Number);
  const [af, mf, df] = fim.split("-").map(Number);

  const curto = (m: number) => MESES[m - 1].slice(0, 3);

  if (inicio === fim) return `${di} de ${curto(mi)} de ${ai}`;
  if (ai !== af) return `${di} de ${curto(mi)} de ${ai} — ${df} de ${curto(mf)} de ${af}`;
  if (mi !== mf) return `${di} de ${curto(mi)} — ${df} de ${curto(mf)} de ${af}`;
  return `${di} — ${df} de ${curto(mf)} de ${af}`;
}
