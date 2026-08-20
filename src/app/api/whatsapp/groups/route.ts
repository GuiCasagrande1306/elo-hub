import { NextResponse, type NextRequest } from "next/server";

import {
  createSupabaseServerClient,
  getCurrentUser,
} from "@/lib/supabase/server";
import { fetchAllGroups } from "@/lib/whatsapp/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

export async function GET(request: NextRequest) {
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
  /* `?atualizar=1` PULA A TABELA e vai à Evolution, gravando o
     resultado. Sem isso não havia como um grupo NOVO aparecer: a rota
     devolvia a tabela sempre que ela tivesse linhas, e a tabela só era
     preenchida por um script rodado fora da Vercel.

     Medido em 19/08/2026: 512 grupos salvos, todos da sincronização de
     06 de agosto. Onze clientes seguiam sem destino, e três deles
     TINHAM grupo criado depois dessa data — invisível para sempre pelo
     seletor. */
  const atualizar = request.nextUrl.searchParams.get("atualizar") === "1";

  const supabase = await createSupabaseServerClient();
  const { data: salvos } = await supabase
    .from("whatsapp_groups")
    .select("jid, name")
    .eq("user_id", user.id)
    .order("name");

  if (!atualizar && salvos && salvos.length > 0) {
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
    /* 200 com `ok:false`, não 5xx: a lista indisponível é um estado
       esperado (WhatsApp limitando, celular desconectado), não uma
       falha do servidor — e o formulário precisa exibir o motivo em vez
       de tratar como erro de rede.

       NUMA ATUALIZAÇÃO, a lista salva volta junto: falhar a varredura
       não pode esvaziar o seletor de quem só queria ver se apareceu
       grupo novo. */
    return NextResponse.json(
      salvos && salvos.length > 0
        ? {
            ...resultado,
            groups: salvos.map((g) => ({ id: g.jid, name: g.name })),
            cached: true,
          }
        : resultado,
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  /* GRAVA O QUE VEIO. Sem isto a varredura serviria a uma tela e se
     perderia — a próxima abertura leria a tabela velha de novo, e o
     grupo recém-criado sumiria outra vez.

     `upsert` e não `delete`+`insert`: um grupo do qual a pessoa saiu
     deixa de vir na varredura, e apagar tudo antes faria uma falha no
     meio da gravação zerar a lista inteira. Sobra de grupo antigo é
     ruído; lista vazia é a tela sem saída. */
  if (resultado.groups.length > 0) {
    const admin = createSupabaseAdminClient();
    const agora = new Date().toISOString();

    await admin.from("whatsapp_groups").upsert(
      resultado.groups.map((g) => ({
        user_id: user.id,
        jid: g.id,
        name: g.name,
        updated_at: agora,
      })),
      { onConflict: "user_id,jid" },
    );
  }

  return NextResponse.json(
    { ...resultado, sincronizados: resultado.groups.length },
    { headers: { "Cache-Control": "no-store" } },
  );
}
