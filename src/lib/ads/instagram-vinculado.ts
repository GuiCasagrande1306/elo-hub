import "server-only";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/* =====================================================================
   O @ do Instagram que a conta de anúncios já conhece
   ---------------------------------------------------------------------
   Cadastrar 61 perfis à mão é o tipo de tarefa que não acontece: começa,
   para na décima conta e a tela fica pela metade para sempre.

   A Graph API entrega parte disso de graça. `connected_instagram_accounts`
   devolve o perfil vinculado à conta de anúncios — medido em 20/08/2026
   sobre as 46 contas Meta ativas: DEZ responderam com o @, entre elas
   Piastro, Mascavo Massas, Istituto Burgo, Way Coonecta e Atacado de
   Pratas.

   As outras 36 voltam vazio, e não é falha: são contas cujo Instagram
   nunca foi vinculado ao gerenciador de anúncios. Para elas o cadastro é
   manual mesmo — mas dez a menos é dez.
   ===================================================================== */

export interface InstagramDescoberto {
  clientId: string;
  clientName: string;
  handle: string;
}

export async function descobrirInstagramVinculado(): Promise<
  InstagramDescoberto[]
> {
  if (!serverEnv.metaAppId) return [];

  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("client_integrations")
    .select(
      "client_id, external_account_id, integration_secrets(access_token), clients!inner(name, status)",
    )
    .eq("platform", "meta_ads")
    .eq("is_active", true);

  const linhas = (data ?? []) as unknown as {
    client_id: string;
    external_account_id: string;
    integration_secrets?: { access_token?: string | null } | null;
    clients?: { name?: string; status?: string } | null;
  }[];

  const encontrados: InstagramDescoberto[] = [];

  await Promise.all(
    linhas.map(async (linha) => {
      const token = linha.integration_secrets?.access_token;
      const conta = linha.external_account_id;

      if (!token || !conta || conta.startsWith("pending:")) return;
      if (!["active", "onboarding"].includes(linha.clients?.status ?? "")) return;

      try {
        const url = new URL(
          `https://graph.facebook.com/${serverEnv.metaApiVersion}/${conta}/connected_instagram_accounts`,
        );
        url.searchParams.set("fields", "username");

        const resposta = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          // Curto: são 46 contas em paralelo, e a tela espera.
          signal: AbortSignal.timeout(8_000),
          cache: "no-store",
        });

        const dado = (await resposta.json()) as {
          data?: { username?: string }[];
          error?: unknown;
        };

        if (!resposta.ok || dado.error) return;

        /* O PRIMEIRO, quando há mais de um. Conta com dois Instagram
           vinculados é rara e ambígua — pegar o primeiro e deixar a
           pessoa corrigir é melhor do que pular a conta inteira e não
           dar pista nenhuma. */
        const handle = dado.data?.find((x) => x.username)?.username;
        if (!handle) return;

        encontrados.push({
          clientId: linha.client_id,
          clientName: linha.clients?.name ?? "",
          handle: handle.replace(/^@/, ""),
        });
      } catch {
        // Conta que não respondeu fica de fora — cadastro manual.
      }
    }),
  );

  return encontrados.sort((a, b) => a.clientName.localeCompare(b.clientName, "pt-BR"));
}
