"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  KanbanSquare,
  List,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";

import { TaskBoard } from "./task-board";
import { TaskList } from "./task-list";
import { TaskCalendar } from "./task-calendar";
import { TaskDialog } from "./task-dialog";
import { createTask, moveTask } from "@/app/(app)/tarefas/actions";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRealtimeRefresh, useRefreshAoVoltar } from "@/hooks/use-realtime";
import { useLocalPreference } from "@/lib/use-local-preference";
import { ColumnMenu } from "./column-menu";
import {
  COLUNAS_PADRAO,
  ORDENACAO_PADRAO,
  type ColunaId,
  type Ordenacao,
} from "./task-columns";
import { cn } from "@/lib/utils";
import { STATUS_LABELS, TASK_COLUMNS } from "./task-meta";
import { dataNoBrasil } from "@/lib/date-br";
import type {
  Client,
  Profile,
  TaskStatus,
  TaskWithRelations,
} from "@/types/database";

/**
 * Área de trabalho do módulo de tarefas.
 *
 * Concentra o que é estado de INTERFACE (visão, busca, filtro, tarefa
 * aberta). O dado em si continua vindo do servidor já filtrado por RLS,
 * e as mutações são Server Actions. O componente não sabe o que o
 * usuário pode ver — só desenha o que recebeu.
 *
 * A tarefa aberta vive na URL (`?tarefa=<id>`): link direto para uma
 * tarefa funciona, e o botão voltar fecha o modal em vez de sair da
 * página.
 */

const ALL = "__all__";

interface TasksWorkspaceProps {
  tasks: TaskWithRelations[];
  clients: Client[];
  /** Equipe, para o seletor de responsáveis do popup. */
  team: Profile[];
}

/* A prop `corteConcluidas` SAIU. Ela era calculada no servidor,
   atravessava a fronteira para o cliente e não tinha um único leitor —
   a janela de 7 dias deixou de existir quando o agrupamento virou
   estrito (`status === "done"` de um lado, o resto do outro). Uma prop
   sem leitor custa payload e, pior, mente sobre o contrato: quem lesse
   a interface concluiria que existe um recorte de data que não existe.

   `clients` continua em uso — não pelo filtro da barra, que saiu, mas
   pelo seletor de cliente dentro de cada linha da lista. */
export function TasksWorkspace({ tasks, clients, team }: TasksWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  /* Abre em LISTA, não no quadro. O Kanban responde "em que etapa está
     cada coisa"; a lista responde "o que é para hoje e de quem é" — que
     é a pergunta de quem acabou de abrir a página. O quadro continua a
     um clique. */
  const [view, setView] = useState<
    "board" | "list" | "calendar" | "done"
  >("list");
  const [query, setQuery] = useState("");

  /* Colunas e ordenação vivem AQUI e não em cada grupo: com estado por
     grupo, "Demandas da semana" e "Concluídos" ficariam com colunas
     diferentes na mesma tela. Persistidos no navegador porque é
     preferência de quem olha, não dado do sistema. */
  const [visiveis, setVisiveis] = useLocalPreference<ColunaId[]>(
    "tarefas:colunas",
    COLUNAS_PADRAO,
  );
  const [ordenacao, setOrdenacao] = useLocalPreference<Ordenacao>(
    "tarefas:ordenacao",
    ORDENACAO_PADRAO,
  );

  /* Três estados por coluna, não dois: crescente → decrescente → SEM
     ordenação. Sem o terceiro, não há como voltar à ordem natural do
     grupo (prazo em aberto, conclusão em feito) depois de clicar uma
     vez — e é ela que responde "o que vence primeiro". */
  function alternarOrdem(coluna: ColunaId) {
    if (ordenacao.coluna !== coluna) {
      setOrdenacao({ coluna, direcao: "asc" });
      return;
    }
    setOrdenacao(
      ordenacao.direcao === "asc"
        ? { coluna, direcao: "desc" }
        : ORDENACAO_PADRAO,
    );
  }
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [assigneeFilter, setAssigneeFilter] = useState<string>(ALL);
  /* Dia das concluídas. Vazio = todas — o padrão não pode esconder
     entrega, senão alguém conclui e acha que não salvou. */
  const [diaConcluidas, setDiaConcluidas] = useState("");

  /* Colaboradores derivados das TAREFAS, não de uma lista de equipe:
     oferecer alguém que não tem tarefa nenhuma dá um filtro que sempre
     volta vazio. */
  const colaboradores = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const t of tasks) {
      for (const p of t.assignees) mapa.set(p.id, p.full_name);
    }
    return [...mapa].map(([id, nome]) => ({ id, nome }));
  }, [tasks]);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  /* Um colega mexeu numa tarefa → a página revalida sozinha.

     `task_assignees` NÃO é opcional aqui, e o motivo não é óbvio: o
     Supabase respeita RLS no broadcast, e a atribuição acontece DEPOIS
     do insert da tarefa. No instante em que a linha de `tasks` nasce, o
     colaborador ainda não é responsável — `can_access_task` devolve
     falso e o evento nunca chega nele. Quem carrega a novidade é o
     insert em `task_assignees`, um instante depois.

     Sem esta linha, o admin cria e atribui, e o card só aparece na tela
     do colaborador quando ele recarrega a página à mão. */
  /* Rede de segurança independente do socket: evento perdido enquanto
     a aba esteve escondida não chega por Realtime nenhum. Uma tela
     aberta desde quinta já mostrou três dias de dado velho. */
  useRefreshAoVoltar();
  useRealtimeRefresh("tasks");
  useRealtimeRefresh("task_assignees");
  useRealtimeRefresh("task_checklist_items");
  // Contador de comentários no card fica vivo junto.
  useRealtimeRefresh("task_comments");

  const openTaskId = searchParams.get("tarefa");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (statusFilter !== ALL && task.status !== statusFilter) return false;
      if (
        assigneeFilter !== ALL &&
        !task.assignees.some((p) => p.id === assigneeFilter)
      ) {
        return false;
      }
      if (!needle) return true;
      return (
        task.title.toLowerCase().includes(needle) ||
        (task.client?.name.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [tasks, query, statusFilter, assigneeFilter]);


  /* Concluída some do quadro e da lista depois de 7 dias.

     Não é arquivamento — a tarefa continua no banco e na aba
     "Concluídas". É que uma coluna que só cresce transforma o quadro
     numa lista de histórico, e o que importa no dia a dia é o que ainda
     está em aberto. Sete dias porque a retrospectiva da semana ainda
     precisa enxergar o que foi entregue.

     O corte vem do SERVIDOR: calcular a data aqui seria impuro no render
     e divergiria entre servidor e cliente na hidratação.

     Sem `completed_at` a tarefa fica visível: é dado antigo, anterior ao
     trigger que carimba a data, e sumir com ela seria perder tarefa. */
  const concluidas = useMemo(
    () =>
      filtered
        .filter((t) => t.status === "done")
        .sort((a, b) =>
          (b.completed_at ?? "").localeCompare(a.completed_at ?? ""),
        ),
    [filtered],
  );

  /* Concluídas filtradas pelo dia escolhido. Compara em São Paulo: o
     `completed_at` é timestamptz, e cortar a string em UTC jogaria as
     entregas do fim da tarde para o dia seguinte. */
  const concluidasDoDia = useMemo(() => {
    if (!diaConcluidas) return concluidas;
    return concluidas.filter(
      (t) => t.completed_at && dataNoBrasil(t.completed_at) === diaConcluidas,
    );
  }, [concluidas, diaConcluidas]);

  /* Estritamente não-concluídas. A regra antiga mantinha as concluídas
     por 7 dias, o que fazia sentido quando "Concluídas" era uma aba
     separada — com o grupo logo abaixo na mesma tela, a tarefa aparecia
     duas vezes e o contador do topo mentia. */
  const emAndamento = useMemo(
    () => filtered.filter((t) => t.status !== "done"),
    [filtered],
  );

  const openTask = tasks.find((t) => t.id === openTaskId) ?? null;

  function setOpenTask(taskId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (taskId) params.set("tarefa", taskId);
    else params.delete("tarefa");

    // `scroll: false` mantém a posição do quadro ao abrir/fechar.
    router.replace(`/tarefas${params.size ? `?${params}` : ""}`, {
      scroll: false,
    });
  }

  function handleMove(taskId: string, status: TaskStatus, position: number) {
    startTransition(async () => {
      const result = await moveTask({ taskId, status, position });
      if (!result.ok) toast.error(result.error);
    });
  }

  function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) return;

    setNewTitle("");
    setCreating(false);

    startTransition(async () => {
      const result = await createTask({
        title,
        /* Sem filtro de cliente na barra, a criação rápida nasce sem
           conta — quem precisa vincular faz na gaveta. */
        clientId: null,
      });
      if (result.ok) toast.success("Tarefa criada.");
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Barra de ferramentas ------------------------------------- */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Quatro abas não cabem em 375px. Rolagem horizontal em vez de
            quebra: abas em duas linhas deixam de parecer um seletor. */}
        <div className="-mx-1 flex w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-surface-2/70 p-0.5 ring-1 ring-hairline sm:w-auto sm:max-w-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ViewButton
            active={view === "board"}
            onClick={() => setView("board")}
            icon={KanbanSquare}
            label="Quadro"
          />
          <ViewButton
            active={view === "list"}
            onClick={() => setView("list")}
            icon={List}
            label="Lista"
          />
          <ViewButton
            active={view === "calendar"}
            onClick={() => setView("calendar")}
            icon={CalendarDays}
            label="Calendário"
          />
          <ViewButton
            active={view === "done"}
            onClick={() => setView("done")}
            icon={CheckCircle2}
            label={`Concluídas${concluidas.length ? ` (${concluidas.length})` : ""}`}
          />
        </div>

        {/* `w-full` no mobile e só então `flex-1`. Com `flex-1` sozinho,
            a tira de abas ocupava a linha inteira e esta caixa sobrava
            com largura ZERO no fim dela — o `input` dentro vazava 44px
            para fora e a página inteira ganhava rolagem horizontal.
            Medido: container w=0, input right=403 numa tela de 375. */}
        <div className="relative w-full min-w-0 sm:w-auto sm:flex-1 sm:max-w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar tarefa…"
            className="h-9 pl-8"
          />
        </div>

        {/* Base UI entrega `string | null` (null = seleção limpa). */}

        {/* Desktop: filtros na barra. Mobile: dentro do Popover abaixo —
            dois selects de largura total empurravam a lista para fora da
            primeira dobra. */}
        {/* Só na visão de tabela: no quadro e no calendário não há
            coluna para esconder, e um menu que não faz nada ali seria o
            controle morto que esta sessão vem tirando das telas. */}
        {(view === "list" || view === "done") && (
          <div className="hidden md:block">
            <ColumnMenu visiveis={visiveis} onChange={setVisiveis} />
          </div>
        )}

        <div className="hidden items-center gap-2 md:flex">
        <Select
          value={assigneeFilter}
          onValueChange={(value) => setAssigneeFilter(value ?? ALL)}
        >
          <SelectTrigger size="sm" className="w-full sm:w-52">
            <SelectValue>
              {(value: string) =>
                value === ALL
                  ? "Todos os colaboradores"
                  : (colaboradores.find((c) => c.id === value)?.nome ??
                    "Todos os colaboradores")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os colaboradores</SelectItem>
            {colaboradores.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value ?? ALL)}
        >
          <SelectTrigger size="sm" className="w-full sm:w-40">
            <SelectValue>
              {(value: string) =>
                value === ALL
                  ? "Todos os status"
                  : (STATUS_LABELS[value as TaskStatus] ?? "Todos os status")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os status</SelectItem>
            {TASK_COLUMNS.map(({ status }) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        </div>

        <Popover>
          <PopoverTrigger
            render={
              <Button variant="outline" size="sm" className="h-9 md:hidden">
                <SlidersHorizontal className="size-4" />
                Filtros
              </Button>
            }
          />
          <PopoverContent align="start" className="flex w-64 flex-col gap-2 p-3">
        <Select
          value={assigneeFilter}
          onValueChange={(value) => setAssigneeFilter(value ?? ALL)}
        >
          <SelectTrigger size="sm" className="w-full sm:w-52">
            <SelectValue>
              {(value: string) =>
                value === ALL
                  ? "Todos os colaboradores"
                  : (colaboradores.find((c) => c.id === value)?.nome ??
                    "Todos os colaboradores")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os colaboradores</SelectItem>
            {colaboradores.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value ?? ALL)}
        >
          <SelectTrigger size="sm" className="w-full sm:w-40">
            <SelectValue>
              {(value: string) =>
                value === ALL
                  ? "Todos os status"
                  : (STATUS_LABELS[value as TaskStatus] ?? "Todos os status")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os status</SelectItem>
            {TASK_COLUMNS.map(({ status }) => (
              <SelectItem key={status} value={status}>
                {STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
          </PopoverContent>
        </Popover>

        {/* Destaque no CTA: é a única ação de escrita da barra, e no
            meio de cinco filtros cinzas ela desaparecia. */}
        <Button
          size="sm"
          className="h-9 w-full bg-signal text-white hover:bg-signal/90 md:ml-auto md:w-auto"
          onClick={() => setCreating((value) => !value)}
        >
          <Plus className="size-4" />
          Nova tarefa
        </Button>
      </div>

      {creating && (
        <form onSubmit={handleCreate} className="surface-card flex gap-2 p-2">
          <Input
            autoFocus
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setCreating(false);
            }}
            placeholder="O que precisa ser feito?"
            className="h-9 border-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Button type="submit" size="sm" className="h-9 shrink-0">
            Criar
          </Button>
        </form>
      )}

      {/* Conteúdo -------------------------------------------------- */}
      {view === "calendar" && (
        /* Recebe TODAS as filtradas, não só as abertas: o calendário é
           leitura de carga, e esconder o que já foi entregue faria a
           semana passada parecer vazia. */
        <TaskCalendar tasks={filtered} onOpenTask={setOpenTask} />
      )}

      {view === "board" && (
        <TaskBoard
          tasks={emAndamento}
          onOpenTask={setOpenTask}
          onMove={handleMove}
        />
      )}

      {/* Um grupo por seção, os dois na MESMA visão: separar em abas
          escondia o que acabou de ser entregue, e a pergunta "isso já
          foi feito?" é justamente a que se faz olhando a lista. */}
      {view === "list" && (
        <div className="flex flex-col gap-4">
          <TaskList
            tasks={emAndamento}
            clients={clients}
            onOpenTask={setOpenTask}
            title="Demandas da semana"
            tone="aberto"
            visiveis={visiveis}
            ordenacao={ordenacao}
            onOrdenar={alternarOrdem}
          />

          <TaskList
            tasks={concluidasDoDia}
            clients={clients}
            onOpenTask={setOpenTask}
            title="Concluídos"
            tone="concluido"
            visiveis={visiveis}
            ordenacao={ordenacao}
            onOrdenar={alternarOrdem}
            dateFilter={diaConcluidas}
            onDateFilterChange={setDiaConcluidas}
          />
        </div>
      )}

      {/* A aba separada de concluídas foi absorvida pelo grupo
          "Concluídos" da lista. Mantida por enquanto para quem tem o
          botão na memória. */}
      {view === "done" && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Tudo que já foi entregue, do mais recente para o mais antigo. No
            quadro e na lista, uma tarefa concluída some depois de 7 dias —
            aqui ela fica.
          </p>

          {concluidas.length === 0 ? (
            <div className="rounded-xl border border-dashed border-hairline py-14 text-center">
              <CheckCircle2 className="mx-auto size-7 text-muted-foreground/50" />
              <p className="mt-3 text-sm text-muted-foreground">
                Nenhuma tarefa concluída ainda.
              </p>
            </div>
          ) : (
            <TaskList
              tasks={concluidas}
              clients={clients}
              onOpenTask={setOpenTask}
              title="Concluídos"
              tone="concluido"
              visiveis={visiveis}
              ordenacao={ordenacao}
              onOrdenar={alternarOrdem}
            />
          )}
        </div>
      )}

      <TaskDialog
        clients={clients}
        team={team}
        /* Remonta ao trocar de tarefa: sem isto o estado local da gaveta
           (slider de criticidade) manteria o valor da tarefa anterior. */
        key={openTask?.id ?? "vazia"}
        task={openTask}
        open={Boolean(openTask)}
        onOpenChange={(open) => {
          if (!open) setOpenTask(null);
        }}
      />
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof List;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-[7px] px-2.5 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground ring-1 ring-hairline"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}
