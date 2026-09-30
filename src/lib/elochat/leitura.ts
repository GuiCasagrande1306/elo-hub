import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import type { FluxoSalvo } from "@/components/elochat/flow-builder";

/**
 * O fluxo de um cliente, ou `null` se ainda não houver.
 *
 * ⚠️ `null` TAMBÉM QUANDO A CONSULTA FALHA, e aqui isso é a escolha
 * certa pelo motivo oposto do de sempre neste projeto: um erro derruba
 * a página inteira, e o construtor é utilizável sem fluxo salvo — quem
 * abre desenha e salva. O erro vai para o log do servidor para não
 * sumir de vez.
 *
 * O caso mais provável de falha é a migration 83 não ter rodado, e
 * nesse cenário derrubar a tela transformaria "falta rodar uma
 * migration" em "o EloChat quebrou".
 *
 * O MAIS RECENTE, quando há mais de um: rascunho é livre, publicado é
 * um só (índice parcial da migration 83). Abrir o último mexido é o
 * que casa com a expectativa de quem fechou a aba ontem.
 */
export async function fluxoDoCliente(
  clientId: string,
): Promise<FluxoSalvo | null> {
  if (isDemoMode) return null;

  try {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase
      .from("elochat_flows")
      .select("id, name, nodes, edges, status")
      .eq("client_id", clientId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[elochat] leitura do fluxo:", error.message);
      return null;
    }
    if (!data) return null;

    const f = data as unknown as {
      id: string;
      name: string;
      nodes: unknown;
      edges: unknown;
      status: "rascunho" | "publicado";
    };

    /* O JSONB volta como `unknown`: o banco garante que é JSON válido,
       não que tem a forma que o canvas espera. Array vazio no lugar de
       lixo mantém o construtor de pé — e é melhor abrir vazio do que
       estourar dentro do React Flow, que derruba a árvore inteira. */
    return {
      id: f.id,
      name: f.name,
      nodes: Array.isArray(f.nodes) ? (f.nodes as FluxoSalvo["nodes"]) : [],
      edges: Array.isArray(f.edges) ? (f.edges as FluxoSalvo["edges"]) : [],
      status: f.status,
    };
  } catch {
    return null;
  }
}
