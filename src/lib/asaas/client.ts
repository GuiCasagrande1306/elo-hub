import "server-only";

/* =====================================================================
   Cliente HTTP para a API do Asaas (produção)
   ---------------------------------------------------------------------
   URL base sempre /v3 — a v1 e v2 são legado sem suporte.
   Auth: header `access_token`, sem Bearer. A chave fica em
   `ASAAS_API_KEY` e não passa nunca para o cliente.
   ===================================================================== */

const BASE = "https://api.asaas.com/v3";

function key(): string {
  const k = process.env.ASAAS_API_KEY;
  if (!k) throw new Error("ASAAS_API_KEY não configurada.");
  return k;
}

export async function asaasGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { "access_token": key(), "Content-Type": "application/json" },
    /* Não cacheamos: dados financeiros têm de ser frescos. */
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Asaas ${path} → ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

export interface AsaasPage<T> {
  object: "list";
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: T[];
}
