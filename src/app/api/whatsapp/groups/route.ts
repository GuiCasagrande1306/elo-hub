import { NextResponse } from "next/server";

import {
  createSupabaseServerClient,
  getCurrentUser,
} from "@/lib/supabase/server";
import { fetchAllGroups } from "@/lib/whatsapp/session";

/**
 * GET /api/whatsapp/groups
 *
 * Grupos do WhatsApp do usuário logado, para o seletor de destino.
 *
 * A instância é derivada da sessão — nunca vem por parâmetro. Além de
 * ser a regra de autorização do módulo, é o que faz a lista ter
 * sentido: só dá para postar em grupo do qual se participa, então
 * mostrar os grupos de outra pessoa ofereceria destinos que o envio
 * recusaria depois.
 *
 * A chave da Evolution não sai do servidor.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* 60s é o teto do plano. A varredura na Evolution é errática — 8,8s numa
   medição, 110s em outra —, então o que sobra de margem vira lista
   entregue em vez de erro. O `fetch` interno corta antes, em 45s, para
   que a falha seja NOSSA e tratada, e não a função sendo morta. */
export const maxDuration = 60;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  /* PRIMEIRO A TABELA, e quase sempre só ela.

     A varredura na Evolution leva ~110s nesta conta (231 grupos, com
     metadados pedidos um a um à Meta) e não cabe no teto de 60s da
     função. Enquanto ela era o caminho principal, o seletor simplesmente
     nunca carregava — e "cole o ID manualmente" não é saída de verdade,
     porque o JID não aparece em lugar nenhum do WhatsApp.

     Quem preenche `whatsapp_groups` é `scripts/evolution.mjs
     sincronizar`, rodado de fora da Vercel. Ver a migration 26. */
  const supabase = await createSupabaseServerClient();
  const { data: salvos } = await supabase
    .from("whatsapp_groups")
    .select("jid, name")
    .eq("user_id", user.id)
    .order("name");

  if (salvos && salvos.length > 0) {
    return NextResponse.json(
      {
        ok: true,
        groups: salvos.map((g) => ({ id: g.jid, name: g.name })),
        cached: true,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  /* Tabela vazia: primeira vez, ou sincronização nunca rodada. Tenta ao
     vivo — em conta com poucos grupos isso responde dentro do limite, e
     é o que faz o recurso funcionar sem exigir o script. */
  const resultado = await fetchAllGroups(user.id);

  if (!resultado.ok) {
    // 200 com `ok:false`, não 5xx: a lista indisponível é um estado
    // esperado (WhatsApp limitando, celular desconectado), não uma
    // falha do servidor — e o formulário precisa exibir o motivo em vez
    // de tratar como erro de rede.
    return NextResponse.json(resultado, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json(resultado, {
    headers: { "Cache-Control": "no-store" },
  });
}
