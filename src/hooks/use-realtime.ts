"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Assina mudanças de uma tabela e revalida a página no servidor.
 *
 * Por que `router.refresh()` em vez de mutar estado local:
 *
 *   O dado renderizado veio de um Server Component, já filtrado por RLS.
 *   Aplicar o payload do evento direto no estado do cliente significaria
 *   reimplementar no browser as regras de junção e de permissão — e
 *   qualquer divergência vira dado errado na tela. `refresh()` refaz a
 *   query no servidor e o React reconcilia só o que mudou: sem
 *   navegação, sem perder scroll, sem perder estado de formulário.
 *
 * O Realtime do Supabase respeita RLS no broadcast: o colaborador nem
 * recebe o evento de uma linha que não pode ler. O canal não é um
 * caminho paralelo de vazamento.
 *
 * ⚠️ EVENTO PERDIDO É PERDIDO PARA SEMPRE. `postgres_changes` não tem
 * replay: o que acontece com o socket caído — aba em segundo plano,
 * máquina suspensa, wifi trocando — não chega nunca. A biblioteca
 * reconecta sozinha, mas reconectar só religa o fluxo FUTURO; o que
 * passou no intervalo continua faltando na tela.
 *
 * Foi exatamente assim que a tela de tarefas de um admin ficou TRÊS DIAS
 * mostrando cinco tarefas concluídas como "A fazer", e uma tarefa que já
 * tinha sido apagada do banco. A aba estava aberta desde quinta; o
 * servidor nunca foi consultado de novo; e o selo de prazo, que é
 * calculado no navegador, continuava se atualizando — então a tela
 * parecia recente enquanto o dado era de três dias antes.
 *
 * Por isso o `subscribe` agora recebe callback: toda vez que o canal
 * volta a ficar SUBSCRIBED depois de já ter estado, houve uma janela
 * cega, e a única resposta correta é reperguntar ao servidor.
 */
export function useRealtimeRefresh(
  table: string,
  options?: { filter?: string; enabled?: boolean },
) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const enabled = options?.enabled ?? true;
  const filter = options?.filter;

  useEffect(() => {
    if (!enabled) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) return; // modo demo: sem socket

    /* Distingue a PRIMEIRA assinatura das seguintes. Na primeira, o dado
       da tela acabou de vir do servidor e refazer a consulta seria
       desperdício; nas seguintes, houve queda, e o que passou na janela
       cega não chega por evento nenhum. */
    let jaAssinou = false;

    const agendarRefresh = () => {
      // Debounce: um drag de Kanban dispara vários UPDATEs em
      // sequência, e um refresh por evento derrubaria o servidor.
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 220);
    };

    const channel = supabase
      .channel(`realtime:${table}${filter ? `:${filter}` : ""}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
        agendarRefresh,
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          if (jaAssinou) agendarRefresh();
          jaAssinou = true;
          return;
        }

        /* CHANNEL_ERROR, TIMED_OUT e CLOSED eram engolidos em silêncio —
           `.subscribe()` sem callback transforma os quatro estados em
           no-op. A reconexão em si não depende disto (a biblioteca
           cuida), mas sem registro ninguém descobre que a tela parou de
           receber, e foi o que deixou o defeito passar despercebido. */
        if (status !== "CLOSED") {
          console.warn(`[realtime:${table}] canal em ${status}`);
        }
      });

    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [table, filter, enabled, router]);
}

/**
 * Rede de segurança que NÃO depende do socket.
 *
 * O Realtime é o único caminho de atualização de uma aba já aberta, e um
 * socket é frágil por natureza. Este hook fecha o buraco por outro lado:
 * quando a aba volta ao primeiro plano depois de um tempo escondida, ou
 * quando a rede volta, a página repergunta ao servidor.
 *
 * Chame UMA VEZ por tela, não uma por tabela: quatro assinaturas de
 * Realtime na mesma página são baratas, quatro listeners de foco
 * disparando quatro `refresh()` simultâneos não são.
 *
 * O PISO DE TEMPO existe para o caso comum de alternar de aba por dois
 * segundos para copiar um link — ali nada mudou, e refazer a consulta a
 * cada troca de foco transformaria uso normal em enxurrada de requisição.
 */
export function useRefreshAoVoltar(options?: { minimoEscondidoMs?: number }) {
  const router = useRouter();
  const escondidoEm = useRef<number | null>(null);
  const minimo = options?.minimoEscondidoMs ?? 30_000;

  useEffect(() => {
    const voltou = () => {
      const desde = escondidoEm.current;
      escondidoEm.current = null;
      if (desde !== null && Date.now() - desde < minimo) return;
      router.refresh();
    };

    const aoMudarVisibilidade = () => {
      if (document.visibilityState === "hidden") {
        escondidoEm.current = Date.now();
        return;
      }
      voltou();
    };

    /* `online` não passa por `visibilitychange`: a aba pode estar visível
       o tempo todo enquanto o wifi cai e volta. Sem piso de tempo aqui,
       porque queda de rede sempre significa janela cega. */
    const aoVoltarRede = () => {
      escondidoEm.current = null;
      router.refresh();
    };

    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    window.addEventListener("online", aoVoltarRede);

    return () => {
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      window.removeEventListener("online", aoVoltarRede);
    };
  }, [router, minimo]);
}

/**
 * Presença: quem mais está com esta tela aberta.
 * Alimenta a pilha de avatares "3 pessoas vendo agora".
 */
export function usePresence(
  room: string,
  user: { id: string; name: string } | null,
  onSync: (userIds: string[]) => void,
) {
  // O callback fica numa ref para que uma função inline recriada a cada
  // render não derrube e recrie o canal. A escrita vai num efeito
  // próprio: mexer em ref durante o render é leitura/escrita fora de
  // fase e o React não garante o valor.
  const callbackRef = useRef(onSync);
  useEffect(() => {
    callbackRef.current = onSync;
  }, [onSync]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !user) return;

    const channel = supabase.channel(room, {
      config: { presence: { key: user.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        callbackRef.current(Object.keys(channel.presenceState()));
      })
      .subscribe(async (status: string) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ name: user.name, at: Date.now() });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [room, user]);
}
