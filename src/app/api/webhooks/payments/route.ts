import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/webhooks/payments
 *
 * Recebe eventos de gateway de pagamento (Asaas por padrão) e lança a
 * receita em `financial_transactions`.
 *
 * TRÊS COISAS QUE FAZEM UM WEBHOOK DE PAGAMENTO FUNCIONAR
 * ---------------------------------------------------------------------
 * 1. IDEMPOTÊNCIA. Gateways reenviam o mesmo evento até receber 200 —
 *    por instabilidade de rede, timeout ou deploy no meio. Sem chave de
 *    idempotência, uma mensalidade entra três vezes no caixa e ninguém
 *    percebe até o fechamento. Aqui a constraint
 *    `unique (provider, external_id)` é a garantia, e o insert usa
 *    `upsert` com `ignoreDuplicates` — reenvio vira no-op silencioso,
 *    não erro.
 *
 * 2. AUTENTICAÇÃO. O endpoint é público por definição (o gateway não
 *    faz login). A proteção é o token que o próprio Asaas envia no
 *    header `asaas-access-token`, configurado no painel deles. Sem
 *    isso, qualquer um lança receita falsa no financeiro da agência.
 *
 * 3. RESPONDER 200 MESMO NO QUE NÃO INTERESSA. Devolver erro para um
 *    evento que decidimos ignorar faz o gateway reenfileirar para
 *    sempre e, no Asaas, acaba desativando a fila do webhook. Eventos
 *    fora do escopo saem com 200 e `ignored: true`.
 *
 * `service_role` porque não há usuário na ponta — e a tabela é
 * admin-only, então nenhuma outra chave conseguiria escrever.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Eventos que viram receita. Os demais são ignorados com 200. */
const EVENTOS_DE_RECEITA = new Set([
  "PAYMENT_RECEIVED",
  "PAYMENT_CONFIRMED",
]);

const asaasSchema = z.object({
  event: z.string(),
  payment: z.object({
    id: z.string(),
    value: z.number(),
    status: z.string().optional(),
    description: z.string().optional().nullable(),
    dueDate: z.string().optional(),
    paymentDate: z.string().optional().nullable(),
    clientPaymentDate: z.string().optional().nullable(),
    externalReference: z.string().optional().nullable(),
    customer: z.string().optional(),
  }),
  // Alguns webhooks trazem o cliente expandido; outros só o id.
  customer: z
    .object({
      email: z.string().optional().nullable(),
      cpfCnpj: z.string().optional().nullable(),
      name: z.string().optional().nullable(),
    })
    .optional(),
});

export async function POST(request: NextRequest) {
  /* --- 1. Autenticação do gateway ---------------------------------- */
  const expected = process.env.PAYMENTS_WEBHOOK_TOKEN;

  if (!expected) {
    // 503, não 500: é configuração faltando, e o gateway deve tentar de
    // novo depois — não descartar o evento.
    return NextResponse.json(
      { error: "PAYMENTS_WEBHOOK_TOKEN não configurado." },
      { status: 503 },
    );
  }

  const token =
    request.headers.get("asaas-access-token") ??
    request.headers.get("x-webhook-token");

  if (token !== expected) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  /* --- 2. Payload --------------------------------------------------- */
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const parsed = asaasSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload fora do formato esperado.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { event, payment, customer } = parsed.data;

  if (!EVENTOS_DE_RECEITA.has(event)) {
    // 200 de propósito — ver nota 3 no topo.
    return NextResponse.json({ ignored: true, event }, { status: 200 });
  }

  const admin = createSupabaseAdminClient();

  /* --- 3. Encontrar o cliente ---------------------------------------
     Três tentativas, da mais confiável para a menos:
       a) externalReference — o id do nosso cliente, se foi enviado na
          criação da cobrança. É o único caminho sem ambiguidade.
       b) CNPJ/CPF, com os dígitos normalizados.
       c) e-mail de contato.
     Não achar o cliente NÃO é erro: o lançamento entra sem vínculo e
     alguém concilia depois. Recusar o webhook faria o gateway
     reenfileirar um evento que nunca vai casar. */
  let clientId: string | null = null;

  if (payment.externalReference) {
    const { data } = await admin
      .from("clients")
      .select("id")
      .eq("id", payment.externalReference)
      .maybeSingle();
    clientId = data?.id ?? null;
  }

  if (!clientId && customer?.cpfCnpj) {
    const digits = customer.cpfCnpj.replace(/\D/g, "");
    /* O CNPJ mudou de casa: saiu de `clients` para `client_financials`
       quando a carteira virou legível por toda a equipe. Aqui a leitura
       é com service_role, que ignora RLS — o webhook não tem sessão. */
    const { data } = await admin
      .from("client_financials")
      .select("client_id, tax_id")
      .not("tax_id", "is", null);

    clientId =
      (data ?? []).find((c) => (c.tax_id ?? "").replace(/\D/g, "") === digits)
        ?.client_id ?? null;
  }

  if (!clientId && customer?.email) {
    const { data } = await admin
      .from("clients")
      .select("id")
      .eq("contact_email", customer.email)
      .maybeSingle();
    clientId = data?.id ?? null;
  }

  /* --- 4. Lançar a receita ------------------------------------------ */
  const paidDate =
    payment.paymentDate ?? payment.clientPaymentDate ?? isoToday();

  const { error, data } = await admin
    .from("financial_transactions")
    .upsert(
      {
        type: "income",
        category: "client_fee",
        status: "paid",
        // O Asaas manda reais decimais; o sistema guarda centavos.
        // `Math.round` é o que impede o centavo perdido em float.
        amount_cents: Math.round(payment.value * 100),
        description:
          payment.description?.trim() ||
          `Pagamento ${payment.id}${customer?.name ? ` — ${customer.name}` : ""}`,
        client_id: clientId,
        due_date: payment.dueDate ?? paidDate,
        paid_date: paidDate,
        provider: "asaas",
        external_id: payment.id,
        provider_payload: raw,
      },
      {
        // Reenvio do mesmo evento não duplica nem estoura erro.
        onConflict: "provider,external_id",
        ignoreDuplicates: true,
      },
    )
    .select("id")
    .maybeSingle();

  if (error) {
    // 500 aqui é correto: queremos que o gateway REENVIE, porque o
    // pagamento é real e ainda não foi registrado.
    console.error("[webhook/payments] falha ao lançar receita:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      // `null` quando o upsert ignorou um reenvio — sinal claro nos logs
      // de que o evento já tinha sido processado.
      transactionId: data?.id ?? null,
      duplicate: data === null,
      clientMatched: clientId !== null,
    },
    { status: 200 },
  );
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
