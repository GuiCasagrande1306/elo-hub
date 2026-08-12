"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { NetworkRow } from "./network-glyph";
import { reagendarPost } from "@/app/(app)/midias-sociais/actions";
import {
  DIAS_SEMANA,
  MESES,
  agruparPorDia,
  horaDoPost,
  montarAgendamento,
  rotuloDoDia,
} from "@/lib/social/agenda";
import { SITUACOES, situacaoDoPost } from "@/lib/social/post-status";
import { dataNoBrasil } from "@/lib/date-br";
import { cn } from "@/lib/utils";
import type { SocialPostWithRelations } from "@/types/database";

/* =====================================================================
   Calendário editorial
   ---------------------------------------------------------------------
   Responde a pergunta que a lista não responde: "a semana que vem está
   vazia?". Uma lista ordenada por data mostra a sequência; só a grade
   mostra o BURACO — três posts na terça e nenhum de quarta a domingo é
   invisível numa lista, e é exatamente o que o cliente percebe.

   NO CELULAR NÃO É GRADE. Sete colunas em 375px dão 53px por dia, onde
   não cabe nem a hora. Vira agenda: só os dias que têm peça, em ordem.
   É a mesma adaptação que o Buffer faz, e não é degradação — a pergunta
   "o que sai hoje" se responde melhor em lista do que em grade.
   ===================================================================== */

export function SocialCalendar({
  posts,
  onAbrirPost,
  onNovoNoDia,
}: {
  posts: SocialPostWithRelations[];
  onAbrirPost: (post: SocialPostWithRelations) => void;
  onNovoNoDia: (dia: string) => void;
}) {
  const hojeISO = dataNoBrasil();
  const [ano, setAno] = useState(() => Number(hojeISO.slice(0, 4)));
  const [mes, setMes] = useState(() => Number(hojeISO.slice(5, 7)) - 1);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  /** Dia com a célula expandida além das três primeiras peças. */
  const [diaAberto, setDiaAberto] = useState<string | null>(null);
  const [, iniciar] = useTransition();
  const router = useRouter();

  const porDia = agruparPorDia(posts);
  const semData = posts.filter((p) => !p.scheduled_at);

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

  function irParaHoje() {
    setAno(Number(hojeISO.slice(0, 4)));
    setMes(Number(hojeISO.slice(5, 7)) - 1);
  }

  /**
   * Solta a peça em outro dia.
   *
   * PRESERVA A HORA. Arrastar um post das 19h de terça para quarta
   * deveria mantê-lo às 19h — reatribuir uma hora padrão faria o
   * arrasto mudar duas coisas quando quem arrastou pediu uma.
   */
  function soltarEm(dia: string) {
    const post = posts.find((p) => p.id === arrastando);
    setArrastando(null);
    setAlvo(null);
    if (!post) return;

    const hora = horaDoPost(post.scheduled_at) || "09:00";
    if (post.scheduled_at && dataNoBrasil(post.scheduled_at) === dia) return;

    iniciar(async () => {
      const r = await reagendarPost({
        postId: post.id,
        scheduledAt: montarAgendamento(dia, hora),
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`“${post.title}” movida para ${rotuloDoDia(dia)}.`);
      router.refresh();
    });
  }

  const diasNoMes = new Date(ano, mes + 1, 0).getDate();
  const primeiroDiaSemana = new Date(ano, mes, 1).getDay();

  const diasDoMes = Array.from({ length: diasNoMes }, (_, i) => {
    const dia = i + 1;
    return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  });

  const comPeca = diasDoMes.filter((iso) => (porDia.get(iso)?.length ?? 0) > 0);
  const noMes = comPeca.reduce((n, iso) => n + (porDia.get(iso)?.length ?? 0), 0);

  return (
    <section className="flex flex-col gap-4">
      {/* ---------------------------- Topo ---------------------------- */}
      <header className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            onClick={() => navegar(-1)}
            aria-label="Mês anterior"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-40 text-center text-sm font-semibold">
            {MESES[mes]} de {ano}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            onClick={() => navegar(1)}
            aria-label="Próximo mês"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <Button variant="outline" size="sm" className="h-8" onClick={irParaHoje}>
          Hoje
        </Button>

        <span className="ml-auto text-2xs text-muted-foreground">
          {noMes === 0
            ? "Nenhuma peça neste mês"
            : `${noMes} ${noMes === 1 ? "peça" : "peças"} em ${comPeca.length} ${comPeca.length === 1 ? "dia" : "dias"}`}
        </span>
      </header>

      {/* ------------------------ Grade (desktop) ---------------------
          `lg`, e o caminho até aqui vale registrar porque eu errei duas
          vezes.

          A grade já esteve em `xl` (1280px) com esta justificativa: a
          1024px sobrariam 8px para o título e a peça apareceria sem
          nome. A medida estava certa QUANDO foi feita — e envelheceu,
          porque depois disso a hora passou a sumir abaixo de 1536px e
          aqueles 31px voltaram para o título. Medido de novo a 1024:
          célula de 100px, título de 29px. Melhor, ainda inútil.

          O que destravou foi esconder os glifos de rede abaixo de 1280:
          o título vai a 69px, treze caracteres, o bastante para
          distinguir "Carrossel — …" de "Reels — …".

          `md` foi testado e recusado: a 768px a célula cai para 66px e o
          título para 35px, seis caracteres. Abaixo de `lg` vale a
          agenda em lista, que mostra tudo. */}
      <div className="surface-card hidden overflow-hidden lg:block">
        <div className="grid grid-cols-7 border-b border-hairline">
          {DIAS_SEMANA.map((d) => (
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
            <div
              key={`vazio-${i}`}
              className="min-h-28 border-b border-r border-hairline bg-surface-2/30"
            />
          ))}

          {diasDoMes.map((iso) => {
            const dia = Number(iso.slice(8));
            const doDia = porDia.get(iso) ?? [];
            const ehHoje = iso === hojeISO;
            const passou = iso < hojeISO;

            return (
              <div
                key={iso}
                onDragOver={(e) => {
                  e.preventDefault();
                  setAlvo(iso);
                }}
                onDragLeave={() => setAlvo((a) => (a === iso ? null : a))}
                onDrop={() => soltarEm(iso)}
                className={cn(
                  "group/dia relative min-h-28 border-b border-r border-hairline p-1.5 transition-colors",
                  ehHoje && "bg-signal-muted/20",
                  alvo === iso && "bg-accent ring-1 ring-inset ring-signal",
                )}
              >
                <div className="flex items-center justify-between">
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

                  {/* Só no hover: um "+" em cada uma das 31 células
                      transformaria a grade num painel de botões e
                      esconderia justamente o que ela mostra. */}
                  <button
                    type="button"
                    onClick={() => onNovoNoDia(iso)}
                    title="Nova peça neste dia"
                    className="rounded p-0.5 text-muted-foreground/0 transition-colors hover:bg-accent group-hover/dia:text-muted-foreground"
                  >
                    <CalendarPlus className="size-3.5" />
                  </button>
                </div>

                <div className="mt-1 flex flex-col gap-0.5">
                  {/* Três por célula, ou tudo se o dia estiver aberto.
                      O corte existe para a célula não crescer e
                      desalinhar as semanas seguintes. */}
                  {(diaAberto === iso ? doDia : doDia.slice(0, 3)).map((post) => (
                    <ChipDoPost
                      key={post.id}
                      post={post}
                      onAbrir={() => onAbrirPost(post)}
                      onArrastar={() => setArrastando(post.id)}
                      onFimArrasto={() => setArrastando(null)}
                      arrastando={arrastando === post.id}
                    />
                  ))}

                  {doDia.length > 3 && (
                    /* EXPANDE A CÉLULA. Antes este botão abria
                       `doDia[3]` — a quarta peça, sempre a mesma: num
                       dia com seis, a quinta e a sexta não tinham como
                       ser alcançadas pela grade. */
                    <button
                      type="button"
                      onClick={() =>
                        setDiaAberto((d) => (d === iso ? null : iso))
                      }
                      className="px-1 text-left text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {diaAberto === iso
                        ? "mostrar menos"
                        : `+${doDia.length - 3} no dia`}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ------------------------ Agenda (celular) -------------------- */}
      <div className="flex flex-col gap-3 lg:hidden">
        {comPeca.length === 0 ? (
          <p className="surface-card p-6 text-center text-sm text-muted-foreground">
            Nenhuma peça agendada em {MESES[mes]}.
          </p>
        ) : (
          comPeca.map((iso) => {
            const doDia = porDia.get(iso) ?? [];
            const ehHoje = iso === hojeISO;

            return (
              <section key={iso} className="surface-card overflow-hidden">
                <header
                  className={cn(
                    "flex items-center justify-between border-b border-hairline px-3 py-2",
                    ehHoje && "bg-signal-muted/25",
                  )}
                >
                  <span className="text-xs font-semibold">
                    {ehHoje ? "Hoje — " : ""}
                    {rotuloDoDia(iso)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onNovoNoDia(iso)}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent"
                    aria-label={`Nova peça em ${rotuloDoDia(iso)}`}
                  >
                    <CalendarPlus className="size-4" />
                  </button>
                </header>

                <ul className="divide-y divide-hairline">
                  {doDia.map((post) => {
                    const s = SITUACOES[situacaoDoPost(post)];
                    return (
                      <li key={post.id}>
                        <button
                          type="button"
                          onClick={() => onAbrirPost(post)}
                          className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent"
                        >
                          <span className="mt-1 w-11 shrink-0 text-2xs tabular-nums text-muted-foreground">
                            {horaDoPost(post.scheduled_at)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span
                                aria-hidden
                                className={cn("size-1.5 shrink-0 rounded-full", s.dot)}
                              />
                              <span className="truncate text-xs font-medium">
                                {post.title}
                              </span>
                            </span>
                            <span className="mt-1 flex items-center gap-2">
                              <NetworkRow
                                networks={post.targets.map((t) => t.network)}
                                max={3}
                              />
                              <span className="truncate text-2xs text-muted-foreground">
                                {post.client?.name}
                              </span>
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
      </div>

      {/* ------------------------- Pauta sem data --------------------- */}
      {semData.length > 0 && (
        <section className="surface-card overflow-hidden">
          <header className="flex items-center gap-2 border-b border-hairline px-3 py-2">
            <Inbox className="size-3.5 text-muted-foreground" />
            <h3 className="eyebrow">Pauta sem data ({semData.length})</h3>
            {/* Só onde existe grade para receber o drop. Abaixo de `xl`
                a tela é a agenda em lista, sem alvo de soltura — e
                arrastar não funciona por toque de qualquer forma. */}
            <span className="ml-auto hidden text-2xs text-muted-foreground xl:block">
              arraste para um dia
            </span>
          </header>

          <ul className="divide-y divide-hairline">
            {semData.map((post) => (
              <li key={post.id}>
                <button
                  type="button"
                  draggable
                  /* `setData` obrigatório: sem popular o drag data
                     store, o Firefox simplesmente não inicia a sessão de
                     arrasto. O drop continua lendo o id do estado — isto
                     aqui existe só para o arrasto começar. */
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", post.id);
                    e.dataTransfer.effectAllowed = "move";
                    setArrastando(post.id);
                  }}
                  onDragEnd={() => setArrastando(null)}
                  onClick={() => onAbrirPost(post)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent",
                    arrastando === post.id && "opacity-40",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      SITUACOES[situacaoDoPost(post)].dot,
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs">{post.title}</span>
                  <NetworkRow
                    networks={post.targets.map((t) => t.network)}
                    max={3}
                  />
                  <span className="hidden max-w-32 truncate text-2xs text-muted-foreground sm:block">
                    {post.client?.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function ChipDoPost({
  post,
  onAbrir,
  onArrastar,
  onFimArrasto,
  arrastando,
}: {
  post: SocialPostWithRelations;
  onAbrir: () => void;
  onArrastar: () => void;
  /** Sem isto, largar o card fora de uma célula deixava o chip preso em
      opacidade 40% até o próximo arrasto — o `dragend` é o único evento
      que dispara quando o drop não acontece. */
  onFimArrasto: () => void;
  arrastando: boolean;
}) {
  const situacao = situacaoDoPost(post);
  const s = SITUACOES[situacao];

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        // Ver o comentário do mesmo trecho na pauta sem data: o Firefox
        // exige o drag data store populado para iniciar o arrasto.
        e.dataTransfer.setData("text/plain", post.id);
        e.dataTransfer.effectAllowed = "move";
        onArrastar();
      }}
      onDragEnd={onFimArrasto}
      onClick={onAbrir}
      title={`${horaDoPost(post.scheduled_at)} · ${post.title} · ${s.label}`}
      className={cn(
        "flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] transition-colors hover:bg-accent",
        arrastando && "opacity-40",
        situacao === "arquivado" && "opacity-50 line-through",
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", s.dot)} />
      {/* A HORA SÓ A PARTIR DE 1536px. Medido em 1280: a célula dá 137px,
          o chip 124px, e a hora come 31 deles — o título ficava com 35px,
          o suficiente para "Carr…". Sem ela o título vai a ~74px. A hora
          não se perde: está na dica do próprio chip (`title` acima), na
          fila e na agenda, que são onde se lê horário. */}
      <span className="hidden shrink-0 tabular-nums text-muted-foreground 2xl:inline">
        {horaDoPost(post.scheduled_at)}
      </span>
      <span className="min-w-0 flex-1 truncate">{post.title}</span>
      {/* GLIFOS DE REDE SÓ A PARTIR DE 1280px. Medido em 1024: a célula
          dá 100px, o chip 87, e os dois glifos comem 36 — sobravam 29px
          para o título, cinco caracteres, o suficiente para "Carro…".
          Sem eles o título vai a ~65px.

          A rede não se perde: aparece ao abrir a peça, e na fila e na
          agenda, que é onde se compara destino. O que a grade responde é
          "o que sai neste dia" — e para isso o nome vale mais que o
          ícone. */}
      <span className="hidden xl:contents">
        <NetworkRow
          networks={post.targets.map((t) => t.network)}
          max={2}
          colorida={situacao !== "arquivado"}
        />
      </span>
    </button>
  );
}
