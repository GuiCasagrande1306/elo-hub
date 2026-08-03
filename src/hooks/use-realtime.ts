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

    const channel = supabase
      .channel(`realtime:${table}${filter ? `:${filter}` : ""}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
        () => {
          // Debounce: um drag de Kanban dispara vários UPDATEs em
          // sequência, e um refresh por evento derrubaria o servidor.
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => router.refresh(), 220);
        },
      )
      .subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [table, filter, enabled, router]);
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
