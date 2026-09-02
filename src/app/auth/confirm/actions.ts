"use server";

import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/* =====================================================================
   Trocar o token do convite por uma sessão — só no POST
   ---------------------------------------------------------------------
   ⚠️ ISTO ERA UM GET, E O GET MATAVA O CONVITE.

   O token é de uso único. Colar o link no WhatsApp faz o servidor DELE
   buscar a URL para montar a prévia da mensagem — e essa busca é um GET
   como qualquer outro. A prévia consumia o token, e a pessoa que
   clicava um minuto depois encontrava "esse link não vale mais".

   Medido em 25/08/2026 contra produção, com o user agent do robô:

       robô de prévia   →  307  /definir-senha        (consumiu)
       pessoa, depois   →  307  /login?convite=expirado

   Não é caso raro: acontece TODA vez que o convite é colado num
   mensageiro que monta prévia — WhatsApp, Slack, Telegram, Discord,
   iMessage. O caminho que a agência usa é justamente esse.

   A porta agora é um POST, disparado por um botão. Robô de prévia
   busca; nenhum deles envia formulário. Custa um clique à pessoa e
   devolve o convite que ela ia perder.
   ===================================================================== */

const TIPOS: EmailOtpType[] = ["invite", "recovery"];

export async function confirmarAcesso(formData: FormData) {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const type = String(formData.get("type") ?? "") as EmailOtpType;

  /* `next` vem do formulário, e por isso é tratado como entrada hostil:
     só caminho interno passa. Sem isto, `?next=https://…` faria um link
     do nosso domínio despejar a pessoa em site de terceiro — com a
     sessão recém-criada e nenhuma desconfiança. */
  const pedido = String(formData.get("next") ?? "/");
  const next =
    pedido.startsWith("/") && !pedido.startsWith("//") ? pedido : "/";

  if (!tokenHash || !TIPOS.includes(type)) {
    redirect("/login?convite=invalido");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  /* Link de uso único: abrir duas vezes cai aqui, e é o caso comum —
     a pessoa clica, se distrai, volta no histórico. O motivo vai na
     query para a tela de login explicar em vez de só recusar. */
  if (error) {
    redirect("/login?convite=expirado");
  }

  redirect(next);
}
