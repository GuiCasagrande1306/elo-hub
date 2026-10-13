/* =====================================================================
   Backfill de pagamentos históricos do Asaas
   ---------------------------------------------------------------------
   Importa todos os pagamentos RECEIVED e CONFIRMED do Asaas para
   `financial_transactions`, usando a mesma lógica do webhook.

     npx tsx scripts/backfill-asaas.mts
     npx tsx scripts/backfill-asaas.mts --dry        # só imprime, não grava
     npx tsx scripts/backfill-asaas.mts --desde=2026-08-01

   IDEMPOTÊNCIA: usa `onConflict: "provider,external_id"` — pode rodar
   quantas vezes quiser. Segunda execução diz "N já existiam, 0 novas".

   POR QUE NÃO CONFLITA COM AS 79 MANUAIS: as entradas manuais não têm
   `provider` nem `external_id`, então não há constraint comum. As
   entradas do Asaas ficam ao lado delas. O usuário decide depois se
   apaga ou mantém as manuais como histórico.
   ===================================================================== */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const DESDE = args.find((a) => a.startsWith("--desde="))?.split("=")[1] ?? null;

const ASAAS_KEY = process.env.ASAAS_API_KEY!;
const BASE = "https://api.asaas.com/v3";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/* ------------------------------------------------------------------ */

interface AsaasPayment {
  id: string;
  customer: string;
  value: number;
  status: string;
  description: string | null;
  billingType: string;
  dueDate: string;
  paymentDate: string | null;
  clientPaymentDate: string | null;
  externalReference: string | null;
  subscription: string | null;
}

async function buscarPagamentos(status: string): Promise<AsaasPayment[]> {
  const todos: AsaasPayment[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const params = new URLSearchParams({
      status,
      limit: String(limit),
      offset: String(offset),
      ...(DESDE ? { paymentDate: DESDE } : {}),
    });

    const res = await fetch(`${BASE}/payments?${params}`, {
      headers: { "access_token": ASAAS_KEY },
    });
    const data = await res.json() as { data: AsaasPayment[]; hasMore: boolean; totalCount: number };

    todos.push(...data.data);
    process.stdout.write(`  ${status}: ${todos.length}/${data.totalCount}\r`);

    if (!data.hasMore) break;
    offset += limit;
  }
  process.stdout.write("\n");
  return todos;
}

/* Resolve customer → client_id via asaas_customer_id gravado no mapeamento */
const customerCache = new Map<string, string | null>();
let _mapaCache: Map<string, string> | null = null;

async function carregarMapa(): Promise<Map<string, string>> {
  if (_mapaCache) return _mapaCache;
  const { data } = await supabase
    .from("client_financials")
    .select("client_id, asaas_customer_id")
    .not("asaas_customer_id", "is", null);
  _mapaCache = new Map((data ?? []).map((r) => [r.asaas_customer_id as string, r.client_id as string]));
  return _mapaCache;
}

async function resolverCliente(customerId: string): Promise<string | null> {
  if (customerCache.has(customerId)) return customerCache.get(customerId)!;
  const mapa = await carregarMapa();
  const clientId = mapa.get(customerId) ?? null;
  customerCache.set(customerId, clientId);
  return clientId;
}

/* ------------------------------------------------------------------ */

async function main() {
  console.log(`\n=== Backfill Asaas → financial_transactions${DRY ? " [DRY RUN]" : ""} ===\n`);
  if (DESDE) console.log(`  Filtrando a partir de: ${DESDE}\n`);

  const [received, confirmed] = await Promise.all([
    buscarPagamentos("RECEIVED"),
    buscarPagamentos("CONFIRMED"),
  ]);

  /* Deduplicar por id (CONFIRMED pode virar RECEIVED no mesmo set) */
  const todos = [...new Map(
    [...received, ...confirmed].map((p) => [p.id, p])
  ).values()];

  console.log(`\nTotal único: ${todos.length} pagamentos\n`);

  if (DRY) {
    todos.slice(0, 5).forEach((p) =>
      console.log(`  ${p.id}  R$ ${p.value.toFixed(2)}  ${p.paymentDate ?? p.dueDate}`)
    );
    if (todos.length > 5) console.log(`  ... e mais ${todos.length - 5}`);
    return;
  }

  /* Processar em lotes de 20 para não explodir a conexão */
  const LOTE = 20;
  let novas = 0;
  let jaExistiam = 0;

  for (let i = 0; i < todos.length; i += LOTE) {
    const lote = todos.slice(i, i + LOTE);

    const linhas = await Promise.all(
      lote.map(async (p) => {
        const clientId = p.externalReference
          ? (await supabase.from("clients").select("id").eq("id", p.externalReference).maybeSingle()).data?.id ?? null
          : await resolverCliente(p.customer);

        const paidDate = p.paymentDate ?? p.clientPaymentDate ?? p.dueDate;

        return {
          type: "income" as const,
          category: "client_fee" as const,
          status: "paid" as const,
          amount_cents: Math.round(p.value * 100),
          description: p.description?.trim() || `Pagamento Asaas ${p.id}`,
          client_id: clientId,
          due_date: p.dueDate,
          paid_date: paidDate,
          provider: "asaas",
          external_id: p.id,
        };
      })
    );

    const { data, error } = await supabase
      .from("financial_transactions")
      .upsert(linhas, {
        onConflict: "provider,external_id",
        /* `ignoreDuplicates: false` permite atualizar client_id nas entradas já existentes.
           Se o backfill rodou antes do mapeamento, os 260 tinham client_id=null. */
        ignoreDuplicates: false,
      })
      .select("id");

    if (error) {
      console.error(`\nErro no lote ${i / LOTE + 1}:`, error.message);
      continue;
    }

    const criadas = data?.length ?? 0;
    novas += criadas;
    jaExistiam += lote.length - criadas;

    process.stdout.write(
      `  Progresso: ${Math.min(i + LOTE, todos.length)}/${todos.length}  (${novas} novas, ${jaExistiam} já existiam)\r`
    );
  }

  console.log(`\n\n=== Concluído ===`);
  console.log(`  Novas:        ${novas}`);
  console.log(`  Já existiam:  ${jaExistiam}`);
  console.log(`  Vinculadas a cliente: ${[...customerCache.values()].filter(Boolean).length}/${customerCache.size} clientes resolvidos`);
}

main().catch((e) => { console.error(e); process.exit(1); });
