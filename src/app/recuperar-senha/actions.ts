"use server";

import { z } from "zod";

import { supabaseUrl, supabaseAnonKey, serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* =====================================================================
   Pedir uma senha nova
   ---------------------------------------------------------------------
   ESTA AÇÃO É CHAMADA POR QUEM ESTÁ DESLOGADO. Não há sessão, não há
   RLS para apoiar, e o endereço é público — qualquer pessoa na internet
   pode dispará-la. Isso governa tudo o que ela faz:

   1. NUNCA DIZ SE O E-MAIL EXISTE. A resposta é a mesma para um acesso
      real e para um endereço inventado. Distinguir os dois transforma
      esta tela num verificador de quem é cliente da Elo — e a lista de
      clientes de uma agência é informação comercial.

   2. NÃO DEVOLVE LINK NENHUM. O link de recuperação é entregue por
      e-mail (pelo Supabase) ou pela agência, no WhatsApp. Devolvê-lo
      aqui deixaria qualquer um trocar a senha de qualquer conta sabendo
      só o endereço.

   3. GRAVA O PEDIDO ANTES DE TENTAR O E-MAIL. Se o SMTP estiver mudo, o
      pedido continua na fila da agência — que é o caminho que sempre
      funciona. Ver o cabeçalho da migration 65.
   ===================================================================== */

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export type Resultado = { ok: true } | { ok: false; error: string };

/**
 * A mesma frase para todo mundo.
 *
 * Exportada para a tela usar exatamente este texto: se a mensagem de
 * sucesso e a de "não achei" divergirem em uma vírgula, a diferença
 * vira o verificador que a regra 1 existe para impedir.
 */
export async function pedirRecuperacao(input: {
  email: string;
}): Promise<Resultado> {
  const parsed = schema.safeParse(input);

  /* E-mail malformado é o ÚNICO caso em que respondemos diferente — e
     mesmo assim não diz nada sobre existir ou não: "isto não é um
     e-mail" é uma afirmação sobre o texto digitado, não sobre a base. */
  if (!parsed.success) {
    return { ok: false, error: "Isso não parece um e-mail." };
  }

  const { email } = parsed.data;
  const admin = createSupabaseAdminClient();

  /* Quem é, se for alguém. Falha de consulta não interrompe: o pedido
     entra sem vínculo e a agência resolve olhando o endereço. */
  const { data: perfil } = await admin
    .from("profiles")
    .select("id, client_id, role")
    .eq("email", email)
    .maybeSingle();

  await admin.from("password_requests").insert({
    email,
    profile_id: perfil?.id ?? null,
    client_id: perfil?.client_id ?? null,
  });

  /* --- o caminho rápido, quando existe ------------------------------
     Só dispara para quem existe de verdade: pedir recuperação de um
     endereço sem conta gastaria a cota de e-mail do projeto com nada, e
     é assim que uma tela pública vira ferramenta de esgotamento.

     Chamado pelo endpoint REST em vez do SDK porque o SDK de servidor
     não tem `resetPasswordForEmail` sem sessão. Falha aqui é engolida:
     o pedido já está na fila, e dizer "não deu para enviar o e-mail"
     para quem está deslogado revelaria que o endereço existe. */
  if (perfil) {
    const destino = `${serverEnv.appUrl.replace(/\/$/, "")}/auth/confirm?next=/definir-senha`;

    await fetch(`${supabaseUrl}/auth/v1/recover`, {
      method: "POST",
      headers: { apikey: supabaseAnonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, redirect_to: destino }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
  }

  return { ok: true };
}
