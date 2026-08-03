"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RealtimeChannel,
  RealtimePostgresDeletePayload,
  RealtimePostgresInsertPayload,
} from "@supabase/supabase-js";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { isDemoMode } from "@/lib/env";

/* =====================================================================
   PÁGINA TEMPORÁRIA — diagnóstico do Supabase Realtime
   ---------------------------------------------------------------------
   ⚠️ Isto escreve na tabela `tasks` REAL. Há um botão de limpeza no fim
   que remove tudo que este teste criou (prefixo TEST_PREFIX).

   Três armadilhas específicas deste projeto que o teste precisa
   distinguir, porque as três se manifestam como "não acontece nada":

   1. MODO DEMO — sem credenciais do Supabase, `getSupabaseBrowserClient`
      devolve null e não existe socket nenhum. Em localhost esse é o
      estado padrão.

   2. SEM SESSÃO — o RLS bloqueia tudo para quem não está autenticado. O
      SELECT volta vazio (não dá erro) e o Realtime não entrega evento.

   3. RLS NO BROADCAST — o Realtime do Supabase aplica a policy de SELECT
      em cada evento. Aqui, `tasks_select` exige que o usuário seja
      assignee ou criador. A trigger `autoassign_task_creator` cuida
      disso no INSERT; se ela não existisse, você inseriria a linha e
      nunca receberia o próprio evento.

   O painel de status separa esses três casos em vez de deixar tudo como
   um silêncio ambíguo.
   ===================================================================== */

const TEST_PREFIX = "Tarefa de Teste - ";

type ChannelState =
  | "idle"
  | "demo"
  | "sem-sessao"
  | "conectando"
  | "conectado"
  | "erro";

interface TaskRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

interface LogEntry {
  at: string;
  icon: string;
  message: string;
  detail?: string;
}

export default function TestRealtimePage() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  // `isDemoMode` é constante de módulo — o estado inicial já é derivável
  // no mount, sem precisar de um setState dentro do efeito.
  const [state, setState] = useState<ChannelState>(
    isDemoMode ? "demo" : "idle",
  );
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inserting, setInserting] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);

  // O contador vive numa ref (fonte da verdade, lida dentro do callback
  // do canal) e é espelhado em estado só para renderizar. Ler a ref
  // direto no JSX não dispararia re-render — o número ficaria congelado.
  const eventCountRef = useRef(0);
  const [eventCount, setEventCount] = useState(0);

  const addLog = useCallback(
    (icon: string, message: string, detail?: unknown) => {
      const at = new Date().toLocaleTimeString("pt-BR", { hour12: false });
      const text =
        detail === undefined
          ? undefined
          : typeof detail === "string"
            ? detail
            : JSON.stringify(detail);

       
      console.log(`${icon} [${at}] ${message}`, detail ?? "");
      setLog((prev) => [{ at, icon, message, detail: text }, ...prev].slice(0, 40));
    },
    [],
  );

  /* ------------------------------------------------------------------
     Assinatura do canal
     ------------------------------------------------------------------ */
  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    // Tudo roda dentro da IIFE assíncrona, inclusive as saídas curtas.
    // Chamar setState de forma síncrona no corpo do efeito enfileira um
    // segundo render antes do browser pintar o primeiro — e é o que a
    // regra react-hooks/set-state-in-effect existe para evitar.
    (async () => {
      if (isDemoMode) {
        addLog("🟡", "Modo demo ativo — nenhuma credencial do Supabase.");
        return;
      }

      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setState("erro");
        setError("getSupabaseBrowserClient() devolveu null fora do modo demo.");
        return;
      }

      addLog("📡", "Conectando ao Realtime…");
      setState("conectando");

      // --- Sessão -----------------------------------------------------
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) {
        setState("erro");
        setError(`Falha ao ler a sessão: ${sessionError.message}`);
        addLog("❌", "Erro ao ler sessão", sessionError.message);
        return;
      }

      const session = sessionData.session;
      if (!session) {
        setState("sem-sessao");
        addLog("🔒", "Sem sessão — o RLS vai bloquear tudo. Faça login primeiro.");
        return;
      }

      if (cancelled) return;
      setUserEmail(session.user.email ?? session.user.id);
      addLog("👤", `Autenticado como ${session.user.email ?? session.user.id}`);

      // O Realtime precisa do JWT para avaliar RLS no broadcast. O
      // supabase-js propaga isso sozinho, mas deixar explícito remove a
      // dúvida quando o canal conecta e mesmo assim nada chega.
      await supabase.realtime.setAuth(session.access_token);

      // --- Carga inicial ---------------------------------------------
      const { data, error: selectError } = await supabase
        .from("tasks")
        .select("id, title, status, created_at")
        .order("created_at", { ascending: false })
        .limit(5);

      if (cancelled) return;

      if (selectError) {
        addLog("❌", "SELECT falhou", selectError.message);
        setError(`SELECT em tasks falhou: ${selectError.message}`);
      } else {
        setTasks(data ?? []);
        addLog("📋", `Carga inicial: ${data?.length ?? 0} tarefa(s).`);
        if ((data?.length ?? 0) === 0) {
          addLog(
            "ℹ️",
            "Lista vazia. Normal num banco novo — o RLS só mostra tarefas atribuídas a você.",
          );
        }
      }

      // --- Canal ------------------------------------------------------
      channel = supabase
        .channel("test-realtime-tasks")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "tasks" },
          (payload: RealtimePostgresInsertPayload<TaskRow>) => {
            eventCountRef.current += 1;
            setEventCount(eventCountRef.current);
            addLog("🔄", `Evento INSERT recebido (#${eventCountRef.current})`, payload.new);

            setTasks((prev) => {
              // O evento pode chegar depois de um refetch que já trouxe a
              // linha: sem essa checagem, a tarefa apareceria duplicada.
              if (prev.some((t) => t.id === payload.new.id)) return prev;
              return [payload.new, ...prev].slice(0, 5);
            });
          },
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "tasks" },
          (payload: RealtimePostgresDeletePayload<TaskRow>) => {
            eventCountRef.current += 1;
            setEventCount(eventCountRef.current);
            const removed = payload.old;
            addLog("🗑️", "Evento DELETE recebido", removed);
            setTasks((prev) => prev.filter((t) => t.id !== removed.id));
          },
        )
        .subscribe((status: string, err?: Error) => {
          if (cancelled) return;

          if (status === "SUBSCRIBED") {
            setState("conectado");
            addLog("✅", "Conectado com sucesso! Canal escutando `tasks`.");
            return;
          }

          if (status === "CHANNEL_ERROR") {
            setState("erro");
            const message =
              err?.message ??
              "CHANNEL_ERROR. Causa mais comum: a tabela não está na publicação `supabase_realtime`.";
            setError(message);
            addLog("❌", "Erro no canal", message);
            return;
          }

          if (status === "TIMED_OUT") {
            setState("erro");
            setError("Tempo esgotado ao assinar o canal — verifique a rede/WebSocket.");
            addLog("⏱️", "Timeout na assinatura do canal.");
            return;
          }

          addLog("📶", `Status do canal: ${status}`);
        });
    })();

    // --- Cleanup ------------------------------------------------------
    return () => {
      cancelled = true;
      const supabase = getSupabaseBrowserClient();
      if (channel && supabase) {
         
        console.log("🔌 Desmontando: removendo canal do Realtime.");
        supabase.removeChannel(channel);
      }
    };
  }, [addLog]);

  /* ------------------------------------------------------------------
     Inserção
     ------------------------------------------------------------------ */
  async function handleInsert() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    setInserting(true);
    setError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError("Sem usuário autenticado — não é possível inserir.");
        addLog("🔒", "INSERT abortado: sem sessão.");
        return;
      }

      const title = `${TEST_PREFIX}${new Date().toLocaleTimeString("pt-BR")}`;
      addLog("➕", `Inserindo: "${title}"`);

      // `created_by` é obrigatório: a policy `tasks_insert` exige
      // created_by = auth.uid(). Sem isso o INSERT é recusado pelo banco
      // e o teste pareceria uma falha do Realtime.
      // `client_id` fica null de propósito — evita depender de o usuário
      // ter permissão de escrita em algum cliente.
      const { error: insertError } = await supabase.from("tasks").insert({
        title,
        client_id: null,
        status: "todo",
        priority: "low",
        created_by: user.id,
        position: Date.now(),
      });

      if (insertError) {
        setError(`INSERT falhou: ${insertError.message}`);
        addLog("❌", "INSERT recusado", insertError.message);
        if (insertError.code === "42501") {
          addLog(
            "💡",
            "Código 42501 = RLS bloqueou. Confira se created_by é igual ao seu auth.uid().",
          );
        }
      } else {
        addLog("📤", "INSERT aceito. Aguardando o evento voltar pelo WebSocket…");
      }
    } finally {
      setInserting(false);
    }
  }

  /* ------------------------------------------------------------------
     Limpeza dos dados de teste
     ------------------------------------------------------------------ */
  async function handleCleanup() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    addLog("🧹", "Removendo tarefas criadas por este teste…");
    const { error: deleteError } = await supabase
      .from("tasks")
      .delete()
      .like("title", `${TEST_PREFIX}%`);

    if (deleteError) {
      setError(`Limpeza falhou: ${deleteError.message}`);
      addLog("❌", "DELETE falhou", deleteError.message);
    } else {
      addLog("✅", "Limpeza concluída.");
      setTasks((prev) => prev.filter((t) => !t.title.startsWith(TEST_PREFIX)));
    }
  }

  const canInteract = state === "conectado";

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-8">
        <p className="eyebrow">Página temporária de diagnóstico</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em]">
          Teste do Supabase Realtime
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Insere na tabela <code className="rounded bg-muted px-1">tasks</code>{" "}
          real e verifica se o evento volta pelo WebSocket sem recarregar a
          página. Apague esta rota antes de considerar o projeto pronto.
        </p>
      </header>

      <StatusPanel state={state} userEmail={userEmail} error={error} />

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleInsert}
          disabled={!canInteract || inserting}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {inserting ? "Inserindo…" : "Adicionar Tarefa de Teste"}
        </button>

        <button
          type="button"
          onClick={handleCleanup}
          disabled={!canInteract}
          className="rounded-lg px-4 py-2 text-sm font-medium ring-1 ring-hairline transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          Limpar tarefas de teste
        </button>
      </div>

      {/* Lista ------------------------------------------------------- */}
      <section className="mt-8">
        <h2 className="eyebrow mb-3">Últimas 5 tarefas</h2>
        {tasks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-hairline py-10 text-center text-sm text-muted-foreground">
            Nenhuma tarefa visível.
          </p>
        ) : (
          <ul className="divide-y divide-hairline overflow-hidden rounded-xl ring-1 ring-hairline">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="min-w-0 truncate text-sm">{task.title}</span>
                <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                  {new Date(task.created_at).toLocaleTimeString("pt-BR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Log --------------------------------------------------------- */}
      <section className="mt-8">
        <h2 className="eyebrow mb-3">
          Log de eventos · {eventCount} recebido(s)
        </h2>
        <div className="max-h-80 overflow-y-auto rounded-xl bg-surface-2/60 p-3 ring-1 ring-hairline">
          {log.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Aguardando…
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5 font-mono text-xs">
              {log.map((entry, index) => (
                <li key={index} className="flex gap-2">
                  <span className="shrink-0 text-muted-foreground">{entry.at}</span>
                  <span className="shrink-0">{entry.icon}</span>
                  <span className="min-w-0">
                    {entry.message}
                    {entry.detail && (
                      <span className="block break-all text-muted-foreground">
                        {entry.detail}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Painel de status — separa as causas de "não acontece nada"          */
/* ------------------------------------------------------------------ */

function StatusPanel({
  state,
  userEmail,
  error,
}: {
  state: ChannelState;
  userEmail: string | null;
  error: string | null;
}) {
  const config: Record<
    ChannelState,
    { dot: string; label: string; hint: string }
  > = {
    idle: { dot: "bg-muted-foreground", label: "Iniciando", hint: "…" },
    demo: {
      dot: "bg-warning",
      label: "Modo demo — sem Realtime",
      hint: "Não há credenciais do Supabase neste ambiente, então nenhum WebSocket é aberto. Rode `npx vercel env pull` para trazer as variáveis de produção para o .env.local, ou teste direto na URL publicada.",
    },
    "sem-sessao": {
      dot: "bg-negative",
      label: "Sem sessão",
      hint: "O RLS bloqueia leitura e escrita para quem não está autenticado. Entre em /login antes de testar — sem isso o canal conecta mas nenhum evento é entregue.",
    },
    conectando: {
      dot: "bg-warning",
      label: "Conectando…",
      hint: "Abrindo o WebSocket e assinando o canal.",
    },
    conectado: {
      dot: "bg-positive",
      label: "Conectado",
      hint: "Canal ativo escutando INSERT e DELETE em `tasks`.",
    },
    erro: {
      dot: "bg-negative",
      label: "Erro",
      hint: "Detalhes abaixo e no console.",
    },
  };

  const current = config[state];

  return (
    <div className="rounded-xl p-4 ring-1 ring-hairline">
      <div className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${current.dot}`} />
        <span className="text-sm font-medium">{current.label}</span>
        {userEmail && (
          <span className="ml-auto text-xs text-muted-foreground">{userEmail}</span>
        )}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {current.hint}
      </p>

      {error && (
        <p className="mt-3 rounded-lg bg-negative-muted px-3 py-2 font-mono text-xs text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
