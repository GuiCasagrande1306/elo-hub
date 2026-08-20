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

/* ------------------------------------------------------------------ */
/* Forma de recarga                                                    */
/* ------------------------------------------------------------------ */

const recargaSchema = z.object({
  clientId: z.string().min(1),
  platform: z.enum(["meta_ads", "google_ads"]),
  /* String vazia limpa. "Não sei" é resposta legítima e precisa ser
     dizível — forçar uma escolha faria alguém chutar, e chute aqui vira
     alerta com a urgência errada. */
  metodo: z.enum(["pix", "cartao", ""]),
});

export async function definirFormaDeRecarga(
  input: z.input<typeof recargaSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = recargaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  if (isDemoMode) return { ok: true };

  const { clientId, platform, metodo } = parsed.data;

  /* Cliente de SESSÃO, não admin: quem edita precisa enxergar a conta, e
     a RLS de `client_integrations` já responde isso. */
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("client_integrations")
    .update({ recharge_method: metodo === "" ? null : metodo })
    .eq("client_id", clientId)
    .eq("platform", platform);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/alertas-saldo");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Aviso de recarga para o grupo do cliente                            */
/* ------------------------------------------------------------------ */

const avisoSchema = z.object({
  clientId: z.string().min(1),
  platform: z.enum(["meta_ads", "google_ads"]),
});

/**
 * Manda o aviso de saldo para o grupo do cliente, PELO WHATSAPP DE QUEM
 * CLICOU.
 *
 * O mesmo desenho do relatório, e pela mesma razão: a mensagem chega ao
 * grupo assinada por uma pessoa que está ali dentro, e não por um número
 * da agência que o cliente não reconhece. O celular precisa participar
 * do grupo — o WhatsApp não deixa postar em grupo do qual não se faz
 * parte, e a checagem de sessão traduz essa falha.
 *
 * NÃO É AUTOMÁTICO. Foi a escolha explícita: pedido de recarga com valor
 * estranho, ou no grupo errado, não tem desfazer.
 */
export async function enviarAvisoDeRecarga(
  input: z.input<typeof avisoSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = avisoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const { clientId, platform } = parsed.data;

  const { getBalanceAlerts } = await import("@/lib/ads/balances");
  const alerts = await getBalanceAlerts();
  const alert = alerts.find(
    (a) => a.clientId === clientId && a.platform === platform,
  );

  if (!alert) return { ok: false, error: "Conta não encontrada." };
  if (!alert.destinoDoCliente) {
    return {
      ok: false,
      error: "Este cliente não tem grupo de WhatsApp cadastrado.",
    };
  }
  if (!alert.externalAccountId) {
    return { ok: false, error: "Conta de anúncios sem id — não dá para montar o link." };
  }

  const { mensagemDeRecarga } = await import("@/lib/ads/recharge-notice");
  const texto = mensagemDeRecarga(alert, alert.externalAccountId);

  if (isDemoMode) return { ok: true };

  const { sendTextFromUser } = await import("@/lib/whatsapp/session");
  const envio = await sendTextFromUser(user.id, alert.destinoDoCliente, texto);

  if (!envio.success) {
    return { ok: false, error: envio.error ?? "Falha no envio." };
  }

  /* Carimba DEPOIS do envio confirmado. Marcar antes faria uma falha de
     rede esconder a conta da fila — o cliente não recebe e ninguém
     percebe, que é o pior dos dois erros possíveis aqui. */
  const admin = createSupabaseAdminClient();
  await admin
    .from("client_integrations")
    .update({ recharge_notice_sent_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("platform", platform);

  revalidatePath("/alertas-saldo");
  return { ok: true };
}

/** A prévia exata do que será enviado — para conferir antes de mandar. */
export async function previaDoAvisoDeRecarga(
  input: z.input<typeof avisoSchema>,
): Promise<{ ok: true; texto: string; destino: string } | { ok: false; error: string }> {
  const parsed = avisoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };

  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };

  const { getBalanceAlerts } = await import("@/lib/ads/balances");
  const alerts = await getBalanceAlerts();
  const alert = alerts.find(
    (a) => a.clientId === parsed.data.clientId && a.platform === parsed.data.platform,
  );

  if (!alert?.externalAccountId) {
    return { ok: false, error: "Conta não encontrada." };
  }

  const { mensagemDeRecarga } = await import("@/lib/ads/recharge-notice");

  return {
    ok: true,
    texto: mensagemDeRecarga(alert, alert.externalAccountId),
    destino: alert.destinoDoCliente ?? "sem grupo cadastrado",
  };
}
