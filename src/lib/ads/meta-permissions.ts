import "server-only";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  ESCOPOS_CRITICOS,
  ESCOPOS_ELOCHAT,
  type PermissoesMeta,
} from "./elochat-scopes";

/* =====================================================================
   Permissões do token da Meta — o que falta para o EloChat rodar
   ---------------------------------------------------------------------
   MEDIDO EM PRODUÇÃO em 08/08/2026, contra três contas reais:

     GET /v21.0/me/permissions  → HTTP 200
     granted: ads_read, business_management, public_profile

   Ou seja: o endpoint funciona com o token que este sistema guarda (é um
   token de USUÁRIO), e NENHUMA das 43 integrações tem permissão de
   Instagram. Não é acidente — a rota de consentimento pede só
   `ads_read` e `business_management`. Ver `api/auth/meta/route.ts`.

   POR QUE NÃO `debug_token`. Seria a checagem mais completa (diz tipo do
   token, validade e escopos de uma vez), mas exige o token de app
   `APP_ID|APP_SECRET`, e no ambiente testado ele volta com
   "Invalid OAuth access token signature". `/me/permissions` responde com
   o próprio token do cliente e não depende do segredo do app.

   POR QUE NÃO A COLUNA `scopes` DO BANCO. Ela existe e parece a resposta
   barata, mas MENTE: o callback do OAuth grava a lista que foi PEDIDA,
   fixa no código, e não a que a Meta concedeu. Quem recusar uma
   permissão no diálogo fica com o banco dizendo que ela foi concedida.
   Só a chamada ao vivo é prova.
   ===================================================================== */

function vazio(error: string | null): PermissoesMeta {
  return {
    isReadyForEloChat: false,
    missingPermissions: [...ESCOPOS_ELOCHAT],
    declinedPermissions: [],
    granted: [],
    error,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Consulta a Graph API e diz se o token do cliente serve para o EloChat.
 *
 * Roda com `service_role`: o token vive em `integration_secrets`, tabela
 * com RLS ligado e ZERO policies. Por isso a autorização tem de ser
 * checada por quem chama — ver a server action.
 */
export async function checkMetaPermissions(
  clientId: string,
): Promise<PermissoesMeta> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("client_integrations")
    .select("integration_secrets(access_token)")
    .eq("client_id", clientId)
    .eq("platform", "meta_ads")
    .maybeSingle();

  if (error) return vazio(`Falha ao ler a integração: ${error.message}`);
  if (!data) return vazio("Este cliente ainda não tem o Meta conectado.");

  const segredo = (
    data as { integration_secrets?: { access_token?: string | null } | null }
  ).integration_secrets;

  const token = segredo?.access_token;
  if (!token) return vazio("A integração existe, mas não há token gravado.");

  const url = new URL(
    `https://graph.facebook.com/${serverEnv.metaApiVersion}/me/permissions`,
  );
  url.searchParams.set("access_token", token);

  let resposta: Response;
  try {
    /* `no-store` porque a resposta muda quando alguém revoga o acesso no
       Facebook, e um cache aqui mostraria "pronto" para um token que já
       não vale. */
    resposta = await fetch(url, { cache: "no-store" });
  } catch (e) {
    return vazio(
      `Não foi possível falar com a Meta: ${e instanceof Error ? e.message : "erro de rede"}`,
    );
  }

  const corpo = (await resposta.json().catch(() => null)) as {
    data?: { permission: string; status: string }[];
    error?: { message?: string; code?: number };
  } | null;

  if (!resposta.ok || corpo?.error) {
    const msg = corpo?.error?.message ?? `HTTP ${resposta.status}`;
    /* 190 é token inválido ou expirado — o caso em que reautorizar
       realmente resolve, e vale dizer com estas palavras. */
    return vazio(
      corpo?.error?.code === 190
        ? `O token do Meta expirou ou foi revogado (${msg}). É preciso autorizar de novo.`
        : `A Meta recusou a consulta: ${msg}`,
    );
  }

  const linhas = Array.isArray(corpo?.data) ? corpo.data : [];

  const granted = linhas
    .filter((p) => p.status === "granted")
    .map((p) => p.permission);

  const declinedTodas = new Set(
    linhas.filter((p) => p.status === "declined").map((p) => p.permission),
  );

  const missingPermissions = ESCOPOS_ELOCHAT.filter(
    (p) => !granted.includes(p),
  );

  return {
    isReadyForEloChat: [...ESCOPOS_CRITICOS].every((p) => granted.includes(p)),
    missingPermissions,
    declinedPermissions: ESCOPOS_ELOCHAT.filter((p) => declinedTodas.has(p)),
    granted,
    error: null,
    checkedAt: new Date().toISOString(),
  };
}
