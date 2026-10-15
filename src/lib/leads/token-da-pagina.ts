import "server-only";

import { serverEnv } from "@/lib/env";

/**
 * Token da PÁGINA a partir do token de usuário salvo na integração.
 *
 * Lead de formulário só se lê com token de página — com o de usuário a
 * Graph responde "Object does not exist", mesmo com `leads_retrieval`.
 * `null` quem autorizou não administra a página (ou falta permissão).
 */
export async function tokenDaPagina(
  userToken: string,
  pageId: string,
): Promise<string | null> {
  let url: string | null =
    `https://graph.facebook.com/${serverEnv.metaApiVersion}/me/accounts` +
    `?fields=id,access_token&limit=100&access_token=${encodeURIComponent(userToken)}`;

  try {
    for (let pagina = 0; url && pagina < 20; pagina++) {
      const res: Response = await fetch(url, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
      const dado = (await res.json().catch(() => ({}))) as {
        data?: { id: string; access_token?: string }[];
        paging?: { next?: string };
      };
      const achada = dado.data?.find((p) => p.id === pageId);
      if (achada?.access_token) return achada.access_token;
      url = dado.paging?.next ?? null;
    }
  } catch (err) {
    console.error("[meta-leads] me/accounts falhou:", err instanceof Error ? err.message : err);
  }

  return null;
}
