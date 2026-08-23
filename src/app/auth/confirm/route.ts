import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/* =====================================================================
   Troca o token do convite por uma sessão
   ---------------------------------------------------------------------
   É a primeira porta que uma pessoa de FORA da agência atravessa. Ela
   chega por um link colado no WhatsApp, sem conta, sem cookie e sem
   ideia do que é o Elo Hub.

   POR QUE ESTA ROTA EXISTE, se o Supabase já devolve um `action_link`
   pronto: aquele link aponta para `/auth/v1/verify` e entrega a sessão
   no FRAGMENTO da URL (`#access_token=…`). Fragmento não é enviado ao
   servidor — e este app guarda sessão em cookie, lido pelo proxy e
   pelos Server Components. O clique "funcionaria" e a pessoa cairia na
   tela de login mesmo assim.

   `verifyOtp` aqui, no servidor, grava os cookies pelo mesmo caminho do
   login normal. Daí em diante ela é um usuário como outro qualquer.

   ROTA PÚBLICA por desenho — ver a lista em `proxy.ts`. O que autoriza
   é o token de uso único na query, não a sessão; exigir sessão para
   estrear uma sessão seria circular.
   ===================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Só os dois tipos que esta agência emite. */
const TIPOS: EmailOtpType[] = ["invite", "recovery"];

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  /* `next` vem da query, e por isso é tratado como entrada hostil: só
     caminho interno passa. Sem esta checagem, `?next=https://…` faria
     um link do nosso domínio despejar a pessoa num site de terceiro —
     com a sessão recém-criada e nenhuma desconfiança. */
  const pedido = searchParams.get("next") ?? "/crm";
  const next = pedido.startsWith("/") && !pedido.startsWith("//") ? pedido : "/crm";

  if (!tokenHash || !type || !TIPOS.includes(type)) {
    return NextResponse.redirect(`${origin}/login?convite=invalido`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    /* Link de uso único: abrir duas vezes cai aqui, e é o caso comum —
       a pessoa clica, se distrai, volta no histórico. O motivo vai na
       query para a tela de login explicar em vez de só recusar. */
    return NextResponse.redirect(`${origin}/login?convite=expirado`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
