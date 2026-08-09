"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Circle,
  CheckCircle2,
  Plus,
} from "lucide-react";
import { toast } from "sonner";

import { COLOR_TAG_ROW } from "./task-meta";
import {
  COLUNAS,
  gradeDeColunas,
  ordenarTarefas,
  type ColunaId,
  type Ordenacao,
} from "./task-columns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  ClientCell,
  ColorTagCell,
  CriticalityCell,
  StatusCell,
} from "./task-quick-edit";
import { TimeCell } from "./task-timer";
import { createTask, updateTask } from "@/app/(app)/tarefas/actions";
import { formatDueDate, initials } from "@/lib/format";
import type { TaskWithRelations } from "@/types/database";

/* =====================================================================
   Visão em lista — grupos expansíveis
   ---------------------------------------------------------------------
   Complementa o Kanban: o quadro responde "em que pé está?", a lista
   responde "o que vence primeiro?". Por isso a ordenação padrão é por
   prazo, não pela posição no quadro.

   NÃO HÁ COLUNA DE TEMPO. A referência mostrava `00:00:00` em toda
   linha, e o sistema não tem rastreamento de tempo — nem campo, nem
   cronômetro. Coluna com número que ninguém alimenta é a mesma armadilha
   do saldo simulado e da métrica inventada: parece dado, não é.

   No mobile a grade vira cartões empilhados — tabela com scroll
   horizontal em tela pequena é o pior dos dois mundos.

   A GRADE É DERIVADA, não escrita. Era uma string CSS fixa com dez
   trilhas, e por isso esconder uma coluna deixava um buraco: a largura
   não sabia quais células existiam. Agora sai de `gradeDeColunas`, e a
   linha renderiza percorrendo o catálogo — cabeçalho e célula não têm
   como discordar sobre o que está visível.
   ===================================================================== */

/** Tarefa criada pelo sistema, não por uma pessoa. */
function isAlerta(title: string): boolean {
  return /^\s*(🚨|⚠️)?\s*ALERTA:/i.test(title);
}

export function TaskList({
  tasks,
  clients,
  onOpenTask,
  title,
  tone,
  /** Só no grupo de concluídos: filtra pela data de conclusão. */
  dateFilter,
  onDateFilterChange,
  defaultClientId = null,
  visiveis,
  ordenacao,
  onOrdenar,
}: {
  tasks: TaskWithRelations[];
  /** Carteira para o seletor de cliente da linha e da criação. */
  clients: { id: string; name: string }[];
  onOpenTask: (id: string) => void;
  title: string;
  tone: "aberto" | "concluido";
  dateFilter?: string;
  onDateFilterChange?: (valor: string) => void;
  defaultClientId?: string | null;
  /* Visibilidade e ordenação vêm DE CIMA, não de cada grupo: com estado
     por grupo, "Demandas da semana" e "Concluídos" acabariam com colunas
     diferentes na mesma tela. */
  visiveis: ColunaId[];
  ordenacao: Ordenacao;
  onOrdenar: (coluna: ColunaId) => void;
}) {
  const [aberto, setAberto] = useState(true);
  const concluido = tone === "concluido";

  const grade = gradeDeColunas(visiveis);
  const ordenadas = ordenarTarefas(tasks, ordenacao, concluido);

  return (
    <section className="surface-card overflow-hidden">
      {/* Cabeçalho do grupo ----------------------------------------- */}
      <header className="flex flex-wrap items-center gap-3 px-3 py-2.5 md:px-4 md:py-3">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          className="flex items-center gap-2 rounded-md px-1 py-0.5 transition-colors hover:bg-accent"
        >
          <ChevronDown
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              !aberto && "-rotate-90",
            )}
          />
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full",
              concluido ? "bg-positive" : "bg-signal",
            )}
          />
          <span className="text-sm font-semibold">{title}</span>
        </button>

        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-2xs tabular-nums text-muted-foreground">
          {ordenadas.length}
        </span>

        {concluido && onDateFilterChange && (
          <label className="ml-auto flex items-center gap-2 text-2xs text-muted-foreground">
            Filtrar por dia
            <input
              type="date"
              value={dateFilter ?? ""}
              onChange={(e) => onDateFilterChange(e.target.value)}
              className="rounded-md border border-hairline bg-surface-2 px-2 py-1 text-xs text-foreground"
            />
          </label>
        )}
      </header>

      {aberto && (
        <>
          {/* Cabeçalho de colunas — só no desktop. */}
          <div
            className="hidden gap-3 border-y border-hairline px-4 py-2 md:grid"
            style={{ gridTemplateColumns: grade }}
          >
            <span />
            <span className="eyebrow">Tarefa</span>
            {COLUNAS.filter((c) => visiveis.includes(c.id)).map((coluna) => {
              const ativa = ordenacao.coluna === coluna.id;
              /* "Prazo" vira "Concluído" no grupo de feitos: é a mesma
                 coluna de data, e chamá-la de prazo ali seria mentira. */
              const rotulo =
                coluna.id === "prazo" && concluido ? "Concluído" : coluna.label;

              if (!coluna.ordenavel) {
                return (
                  <span key={coluna.id} className="eyebrow">
                    {rotulo}
                  </span>
                );
              }

              return (
                <button
                  key={coluna.id}
                  type="button"
                  onClick={() => onOrdenar(coluna.id)}
                  className={cn(
                    "eyebrow flex items-center gap-1 text-left transition-colors hover:text-foreground",
                    ativa && "text-foreground",
                  )}
                  title={`Ordenar por ${rotulo.toLowerCase()}`}
                >
                  {rotulo}
                  {ativa &&
                    (ordenacao.direcao === "asc" ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3" />
                    ))}
                </button>
              );
            })}
          </div>

          <ul className="divide-y divide-hairline">
            {ordenadas.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                clients={clients}
                concluido={concluido}
                onOpenTask={onOpenTask}
                visiveis={visiveis}
                grade={grade}
              />
            ))}
          </ul>

          {/* Linha fantasma: criar sem sair da tabela. Só nos grupos
              abertos — criar uma tarefa já concluída não faz sentido. */}
          {!concluido && (
            <GhostRow
              defaultClientId={defaultClientId}
              clients={clients}
              onCreated={onOpenTask}
            />
          )}

          {ordenadas.length === 0 && concluido && (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              Nenhuma tarefa concluída neste dia.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function TaskRow({
  clients,
  task,
  concluido,
  onOpenTask,
  visiveis,
  grade,
}: {
  task: TaskWithRelations;
  clients: { id: string; name: string }[];
  concluido: boolean;
  onOpenTask: (id: string) => void;
  visiveis: ColunaId[];
  /** Mesma trilha do cabeçalho — vem pronta para não recalcular por linha. */
  grade: string;
}) {
  const [feito, setFeito] = useState(concluido);
  /* Cor e cliente vivem AQUI, não dentro das células. A cor pinta a
     linha toda e o cliente aparece na coluna — nos dois casos quem
     precisa saber o valor é a linha, e um estado por célula faria o
     seletor mudar na hora enquanto o resto só acompanharia depois do
     revalidate. */
  const [cor, setCor] = useState(task.color_tag);
  const [cliente, setCliente] = useState<{ id: string; name: string } | null>(
    task.client ? { id: task.client.id, name: task.client.name } : null,
  );
  const [, startTransition] = useTransition();

  const due = formatDueDate(task.due_date);
  const alerta = isAlerta(task.title);

  const mostra = (id: ColunaId) => visiveis.includes(id);

  function alternar() {
    const anterior = feito;
    setFeito(!feito);

    startTransition(async () => {
      const r = await updateTask({
        taskId: task.id,
        status: !feito ? "done" : "todo",
      });
      if (!r.ok) {
        setFeito(anterior);
        toast.error(r.error);
      }
    });
  }

  return (
    <li>
      <div
        className={cn(
          /* Mobile: flex que QUEBRA. Título ocupa o resto da primeira
             linha ao lado do checkbox; responsável, status, criticidade
             e prazo caem para a segunda. Antes era `grid-cols-1`, que
             empilhava tudo numa coluna e espremia o título até sumir. */
          "flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 transition-colors md:grid md:gap-y-2 md:px-4 md:py-2",
          /* Sem cor, o hover é o cinza padrão. Com cor, a lavagem já
             ocupa o fundo e um hover por cima dela viraria lama —
             então o realce passa a ser o próprio tom, mais forte. */
          cor
            ? COLOR_TAG_ROW[cor]
            : "hover:bg-accent/40",
        )}
        /* `style` e não classe: a trilha é montada em tempo de execução
           a partir das colunas visíveis, e o Tailwind só gera classes
           que existem no código-fonte. */
        style={{ gridTemplateColumns: grade }}
      >
        {/* Concluir */}
        <button
          type="button"
          onClick={alternar}
          aria-label={feito ? "Reabrir tarefa" : "Concluir tarefa"}
          className="grid size-7 place-items-center rounded-md transition-colors hover:bg-accent"
        >
          {feito ? (
            <CheckCircle2 className="size-4 text-positive" />
          ) : (
            <Circle className="size-4 text-muted-foreground/45" />
          )}
        </button>

        {/* Tarefa */}
        <button
          type="button"
          onClick={() => onOpenTask(task.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left md:flex-none"
        >
          {alerta && (
            <AlertTriangle className="size-3.5 shrink-0 text-negative" />
          )}
          <span
            className={cn(
              "truncate text-sm",
              feito
                ? "text-muted-foreground/70 line-through"
                : "font-medium",
            )}
          >
            {task.title}
          </span>
        </button>

        {/* Da aqui para baixo, TODA célula é condicional. `mostra()` é a
            mesma fonte que o cabeçalho consulta — não há como uma coluna
            aparecer no título e sumir na linha, ou o contrário. */}

        {/* Cliente em DUAS formas: seletor no desktop, texto no mobile.

            Ele estava só no desktop, com a justificativa de que o nome
            já aparece no card do Kanban — mas quem abre a lista no
            celular não está no Kanban, e "de quem é isto" é a segunda
            pergunta depois do título. Como texto ele custa meia linha e
            não rouba o título; editar continua na gaveta. */}
        {mostra("cliente") && (
          <>
            <span className="hidden min-w-0 md:block">
              <ClientCell
                taskId={task.id}
                value={cliente}
                clients={clients}
                onChange={setCliente}
              />
            </span>
            {cliente && (
              <span className="max-w-full truncate text-2xs text-muted-foreground md:hidden">
                {cliente.name}
              </span>
            )}
          </>
        )}

        {/* Avatares sobrepostos. Três e um contador: quatro cabeças
            numa célula estreita viram borrão ilegível. */}
        {mostra("responsaveis") && (
          <span className="flex -space-x-1.5">
            {task.assignees.length === 0 ? (
              <span className="text-2xs text-muted-foreground/60">—</span>
            ) : (
              <>
                {task.assignees.slice(0, 3).map((p) => (
                  <span
                    key={p.id}
                    title={p.full_name}
                    className="grid size-6 place-items-center rounded-full bg-surface-2 text-[9px] font-semibold ring-2 ring-card"
                  >
                    {initials(p.full_name)}
                  </span>
                ))}
                {task.assignees.length > 3 && (
                  <span className="grid size-6 place-items-center rounded-full bg-surface-2 text-[9px] font-medium text-muted-foreground ring-2 ring-card">
                    +{task.assignees.length - 3}
                  </span>
                )}
              </>
            )}
          </span>
        )}

        {mostra("status") && (
          <StatusCell taskId={task.id} value={task.status} />
        )}

        {/* Tempo rastreado. Play aparece no hover; parado mostra "—". */}
        {mostra("tempo") && (
          <span className="hidden md:contents">
            <TimeCell
              taskId={task.id}
              trackedSeconds={task.tracked_seconds}
              startedAt={task.timer_started_at}
            />
          </span>
        )}

        {/* Criticidade: UMA célula, que mostra e edita.

            Havia aqui uma barra desenhada à mão e, ao lado, o
            `CriticalityCell` — que já desenha número E barra. Eram duas
            colunas da grade fixa, então a duplicação passava; virando uma
            célula só, a linha ficava "10 ▮▮▮▮▮ 10". O comentário
            original já admitia o problema ("duas leituras do mesmo dado
            na mesma linha") e contornava escondendo o editor no mobile.

            Agora é o próprio valor que se clica para editar, que é como
            uma tabela deste tipo se comporta — e funciona no celular
            também, onde antes só dava para ver. */}
        {mostra("criticidade") && (
          /* No mobile o invólucro limita a largura; no desktop
             `md:contents` some com ele e a célula entra direto na grade.
             Sem o limite, o gatilho `w-full` do editor tomava a linha
             toda no celular e empurrava o prazo para uma quarta linha —
             cada tarefa virava quatro linhas de altura. */
          <span className="flex w-[132px] shrink-0 md:contents">
            <CriticalityCell taskId={task.id} value={task.criticality} />
          </span>
        )}

        {/* Prazo ou conclusão */}
        {mostra("prazo") && (
          <span className="shrink-0 text-2xs tabular-nums">
            {concluido ? (
              task.completed_at ? (
                <ConcluidoEm iso={task.completed_at} />
              ) : (
                <span className="text-muted-foreground/60">—</span>
              )
            ) : (
              <span
                className={cn(
                  due.tone === "overdue" && "font-medium text-negative",
                  due.tone === "today" && "font-medium text-warning",
                  (due.tone === "soon" || due.tone === "normal") &&
                    "text-muted-foreground",
                  !due.label && "text-muted-foreground/60",
                )}
              >
                {due.label || "—"}
              </span>
            )}
          </span>
        )}

        {mostra("cor") && (
          <span className="hidden md:contents">
            <ColorTagCell taskId={task.id} value={cor} onChange={setCor} />
          </span>
        )}
      </div>
    </li>
  );
}

/** "19:25" sobre "30/07" — hora primeiro, que é o que distingue no dia. */
function ConcluidoEm({ iso }: { iso: string }) {
  const d = new Date(iso);
  const hora = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(d);
  const dia = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(d);

  return (
    <span className="block leading-tight">
      <span className="block font-medium">{hora}</span>
      <span className="block text-muted-foreground/70">{dia}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Linha fantasma.
 *
 * Criar sem abrir modal é o que muda o ritmo de uso: numa reunião de
 * planejamento entram dez tarefas seguidas, e dez modais matam o fluxo.
 * Enter cria e mantém o campo aberto para a próxima; Escape desiste.
 */
function GhostRow({
  defaultClientId,
  clients,
  onCreated,
}: {
  defaultClientId: string | null;
  clients: { id: string; name: string }[];
  onCreated: (taskId: string) => void;
}) {
  const [titulo, setTitulo] = useState("");
  /* Cliente escolhido aqui vale para a próxima tarefa e para as
     seguintes: numa reunião entram cinco tarefas do mesmo cliente
     seguidas, e reescolher a cada uma seria o oposto de agilizar. */
  const [cliente, setCliente] = useState<{ id: string; name: string } | null>(
    () => clients.find((c) => c.id === defaultClientId) ?? null,
  );
  const [salvando, startTransition] = useTransition();

  function criar() {
    const limpo = titulo.trim();
    if (limpo.length < 2) return;

    startTransition(async () => {
      const r = await createTask({
        title: limpo,
        clientId: cliente?.id ?? defaultClientId,
      });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      setTitulo("");
      /* Abre a gaveta da tarefa recém-criada. O título por si só quase
         nunca é a tarefa inteira — falta prazo, responsável, descrição —
         e antes era preciso criar, procurar a linha e clicar nela. */
      onCreated(r.taskId);
    });
  }

  return (
    <div className="flex items-center gap-2 border-t border-hairline px-3 py-2 md:px-4">
      <Plus className="size-3.5 shrink-0 text-muted-foreground/50" />
      <input
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") criar();
          if (e.key === "Escape") setTitulo("");
        }}
        /* Sem `onBlur={criar}`: com a gaveta abrindo em seguida, o blur
           disparado ao focar o modal criaria uma segunda tarefa. Enter é
           o gesto, e continua sendo. */
        disabled={salvando}
        placeholder="Adicionar tarefa e pressionar Enter"
        className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground/50"
      />

      <GhostClientPicker
        clients={clients}
        value={cliente}
        onChange={setCliente}
      />
    </div>
  );
}

/**
 * Cliente da linha fantasma.
 *
 * Mesma busca por nome da célula da tabela, em versão compacta. Não
 * reaproveita `ClientCell` porque aquela salva no clique — aqui a
 * tarefa ainda não existe, e o valor só viaja no Enter.
 */
function GhostClientPicker({
  clients,
  value,
  onChange,
}: {
  clients: { id: string; name: string }[];
  value: { id: string; name: string } | null;
  onChange: (novo: { id: string; name: string } | null) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");

  const termo = busca.trim().toLowerCase();
  const filtrados = termo
    ? clients.filter((c) => c.name.toLowerCase().includes(termo))
    : clients;

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="shrink-0 rounded-md px-2 py-1 text-2xs transition-colors hover:bg-accent"
          />
        }
      >
        {value ? (
          <span className="font-medium text-signal">{value.name}</span>
        ) : (
          <span className="text-muted-foreground/60">+ cliente</span>
        )}
      </PopoverTrigger>

      <PopoverContent className="w-60 p-0" align="end">
        <input
          autoFocus
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar cliente…"
          className="w-full border-b border-hairline bg-transparent px-3 py-2 text-xs outline-none placeholder:text-muted-foreground/50"
        />
        <div className="max-h-56 overflow-y-auto p-1">
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setAberto(false);
            }}
            className="w-full rounded px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent"
          >
            Sem cliente
          </button>
          {filtrados.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange(c);
                setAberto(false);
                setBusca("");
              }}
              className={cn(
                "w-full truncate rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                c.id === value?.id && "bg-accent font-medium",
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
