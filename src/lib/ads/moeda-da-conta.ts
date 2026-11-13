import "server-only";

import { serverEnv } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { API_VERSION, exchangeRefreshToken } from "./google-ads";
import { normalizeCustomerId } from "./normalize";

/* =====================================================================
   Moeda da conta de anúncio
   ---------------------------------------------------------------------
   A Meta e o Google devolvem gasto na moeda DA CONTA, escolhida quando
   ela foi criada e imutável depois. Conta cadastrada nos EUA (Marlenes
   Hair) gasta em dólar, e o painel imprimia "R$" na frente do número em
   dólar. O número está certo; só o símbolo precisa acompanhar.

   Roda no vínculo da conta (`setAdAccountId`), que é por onde todo
   cliente novo passa. Como a moeda não muda, não precisa rodar no cron.

   Grava em `client_integrations.currency` (por conta) e em
   `clients.ad_currency` (o que a página e o relatório leem). Contas do
   MESMO cliente em moedas diferentes não somam: o cliente fica como
   estava e a coleta recusa a conta divergente — ver `sync.ts`.
   ===================================================================== */

const ISO = /^[A-Z]{3}$/;

export type DeteccaoDeMoeda =
  | { ok: true; moeda: string }
  | { ok: false; motivo: string };

export async function detectarMoedaDoCliente(clientId: string): Promise<DeteccaoDeMoeda> {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("client_integrations")
    .select("id, platform, external_account_id, integration_secrets(access_token, refresh_token)")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .in("platform", ["meta_ads", "google_ads"]);

  if (error) return { ok: false, motivo: `Falha ao ler as contas: ${error.message}` };

  type Linha = {
    id: string;
    platform: "meta_ads" | "google_ads";
    external_account_id: string;
    integration_secrets: { access_token: string | null; refresh_token: string | null } | null;
  };
  const contas = ((data ?? []) as unknown as Linha[]).filter(
    (c) => !c.external_account_id.startsWith("pending:"),
  );
  if (contas.length === 0) return { ok: false, motivo: "Nenhuma conta de anúncio vinculada." };

  const moedas = new Map<string, string>(); // plataforma → moeda
  for (const c of contas) {
    const moeda =
      c.platform === "meta_ads"
        ? await moedaDaMeta(c.external_account_id, c.integration_secrets?.access_token ?? null)
        : await moedaDoGoogle(c.external_account_id, c.integration_secrets?.refresh_token ?? null);
    if (!moeda) continue;

    moedas.set(c.platform, moeda);
    const { error: erro } = await admin
      .from("client_integrations")
      .update({ currency: moeda })
      .eq("id", c.id);
    if (erro) return { ok: false, motivo: `Falha ao gravar a moeda da conta: ${erro.message}` };
  }

  const distintas = [...new Set(moedas.values())];
  if (distintas.length === 0) {
    return { ok: false, motivo: "A plataforma não informou a moeda da conta." };
  }
  if (distintas.length > 1) {
    return {
      ok: false,
      motivo: `Contas em moedas diferentes (${[...moedas].map(([p, m]) => `${p === "meta_ads" ? "Meta" : "Google"} ${m}`).join(", ")}). Os números não somam; a coleta recusa a conta que diverge do cliente.`,
    };
  }

  const [moeda] = distintas;
  const { error: erroCliente } = await admin
    .from("clients")
    .update({ ad_currency: moeda })
    .eq("id", clientId);
  if (erroCliente) return { ok: false, motivo: `Falha ao gravar a moeda do cliente: ${erroCliente.message}` };

  return { ok: true, moeda };
}

async function moedaDaMeta(conta: string, token: string | null): Promise<string | null> {
  if (!token) return null;
  const id = conta.startsWith("act_") ? conta : `act_${conta}`;
  try {
    const r = await fetch(
      `https://graph.facebook.com/${serverEnv.metaApiVersion}/${id}?fields=currency`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      },
    );
    const j = (await r.json()) as { currency?: string };
    return r.ok && j.currency && ISO.test(j.currency) ? j.currency : null;
  } catch {
    return null;
  }
}

async function moedaDoGoogle(conta: string, refreshToken: string | null): Promise<string | null> {
  if (!refreshToken) return null;
  const token = await exchangeRefreshToken(refreshToken);
  if (!token.ok) return null;
  try {
    const r = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${normalizeCustomerId(conta)}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "developer-token": serverEnv.googleAdsDeveloperToken,
          ...(serverEnv.googleAdsLoginCustomerId
            ? { "login-customer-id": normalizeCustomerId(serverEnv.googleAdsLoginCustomerId) }
            : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "SELECT customer.currency_code FROM customer" }),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      },
    );
    const payload = (await r.json()) as
      | { results?: { customer?: { currencyCode?: string } }[] }[]
      | { error?: unknown };
    const moeda = Array.isArray(payload)
      ? payload[0]?.results?.[0]?.customer?.currencyCode
      : undefined;
    return r.ok && moeda && ISO.test(moeda) ? moeda : null;
  } catch {
    return null;
  }
}
