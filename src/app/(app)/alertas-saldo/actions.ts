"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentUser } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";

/* =====================================================================
   Para onde o aviso de saldo vai
   ---------------------------------------------------------------------
   Escolher o grupo é escolher para onde a agência manda mensagem
   automática todo dia — por isso só admin, checado aqui E por policy.
   ===================================================================== */

const schema = z.object({
  /* Vazio limpa a configuração e DESLIGA o aviso. É estado legítimo:
     desligar deve ser tão fácil quanto ligar, senão alguém desliga
     arrancando o cron. */
  jid: z.string().trim(),
  nome: z.string().trim().max(200).default(""),
});

export async function definirGrupoDoAviso(
  input: z.input<typeof schema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const user = await getCurrentUser();
  if (user?.role !== "admin") {
    return { ok: false, error: "Só administradores mudam o destino do aviso." };
  }

  const { jid, nome } = parsed.data;

  if (jid !== "" && !jid.endsWith("@g.us")) {
    return { ok: false, error: "Escolha um grupo da lista." };
  }

  if (isDemoMode) return { ok: true };

  const admin = createSupabaseAdminClient();

  /* O DONO DO GRUPO É QUEM ENVIA. `whatsapp_groups` guarda de qual
     usuário cada grupo veio na sincronização, e é a instância dele que
     tem permissão de postar ali. Deduzir isso aqui evita pedir à pessoa
     uma segunda escolha que ela não teria como responder. */
  let senderId: string | null = null;

  if (jid !== "") {
    const { data: grupo } = await admin
      .from("whatsapp_groups")
      .select("user_id")
      .eq("jid", jid)
      .maybeSingle();

    senderId = grupo?.user_id ?? user.id;
  }

  const { error } = await admin
    .from("balance_alert_settings")
    .update({
      group_jid: jid === "" ? null : jid,
      group_name: jid === "" ? null : nome || null,
      sender_id: senderId,
      /* Zera a trava do dia: trocar o destino deve permitir que o aviso
         de hoje saia no destino novo, em vez de esperar amanhã. */
      last_sent_on: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/alertas-saldo");
  return { ok: true };
}
