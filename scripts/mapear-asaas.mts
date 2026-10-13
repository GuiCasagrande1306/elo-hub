/* =====================================================================
   Mapeamento Asaas → Elo Hub (por nome normalizado)
   ---------------------------------------------------------------------
     npx tsx scripts/mapear-asaas.mts           # mostra sugestões
     npx tsx scripts/mapear-asaas.mts --gravar  # salva os confirmados

   "Confirmado" = o nome Asaas começa com o nome Elo Hub (ou vice-versa),
   ignorando acento, caixa, pontuação e sufixos legais (LTDA, LTDA., SA…).
   Ambíguos ficam na lista ✗ para você mapear manualmente via Supabase.
   ===================================================================== */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const GRAVAR = process.argv.includes("--gravar");
const ASAAS_KEY = process.env.ASAAS_API_KEY!;
const BASE = "https://api.asaas.com/v3";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const SUFIXOS = /\b(ltda\.?|s\.?a\.?|me|eireli|epp|microempresa|e construção|restaurante|pizzaria|farmacia|e manipulação|solucoes em informatica|curadoria imobiliaria|massas e tortas artesanais|negocios|acessorios e tecnologia)\b/gi;

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")  // remove acentos
    .replace(SUFIXOS, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function melhorMatch(
  asaasNome: string,
  eloClientes: { id: string; name: string }[],
): { id: string; name: string; confianca: "alta" | "baixa" } | null {
  const na = normalizar(asaasNome);
  let melhor: { id: string; name: string; score: number } | null = null;

  for (const c of eloClientes) {
    const ne = normalizar(c.name);
    // Começa com o outro (ex: "belz cont" começa com "belz", "belz contabilidade" também)
    const score =
      na.startsWith(ne) || ne.startsWith(na) ? 2
      : na.includes(ne) || ne.includes(na) ? 1
      : 0;
    if (score > (melhor?.score ?? 0)) melhor = { id: c.id, name: c.name, score };
  }

  if (!melhor || melhor.score === 0) return null;
  return { id: melhor.id, name: melhor.name, confianca: melhor.score >= 2 ? "alta" : "baixa" };
}

async function main() {
  const subRes = await fetch(`${BASE}/subscriptions?status=ACTIVE&limit=100`, {
    headers: { "access_token": ASAAS_KEY },
  });
  const subs = (await subRes.json()).data as { customer: string; value: number }[];
  const customerIds = [...new Set(subs.map((s) => s.customer))];

  const asaasClientes = new Map<string, { id: string; name: string; email: string | null }>();
  await Promise.all(
    customerIds.map(async (id) => {
      const r = await fetch(`${BASE}/customers/${id}`, { headers: { "access_token": ASAAS_KEY } });
      const c = await r.json();
      asaasClientes.set(id, { id, name: c.name, email: c.email });
    }),
  );

  const { data: eloClientes } = await sb.from("clients").select("id, name");
  const { data: financeiros } = await sb.from("client_financials").select("client_id, asaas_customer_id");
  const jaVinculados = new Set(
    (financeiros ?? []).filter((f) => f.asaas_customer_id).map((f) => f.client_id),
  );

  console.log(`\n=== Mapeamento Asaas → Elo Hub${GRAVAR ? " [GRAVANDO confirmados]" : " [só visualização]"} ===\n`);

  const vinculosAlta: { client_id: string; asaas_customer_id: string; elo: string; asaas: string }[] = [];
  const vinculosBaixa: { client_id: string; asaas_customer_id: string; elo: string; asaas: string }[] = [];
  const semMatch: { id: string; name: string; email: string | null }[] = [];

  for (const [asaasId, c] of asaasClientes) {
    if (jaVinculados.has(asaasId)) {
      console.log(`  ·  ${c.name.padEnd(45)} → já vinculado`);
      continue;
    }
    const match = melhorMatch(c.name, eloClientes ?? []);
    if (!match) {
      console.log(`  ✗  ${c.name.padEnd(45)} → NÃO ENCONTRADO | ${c.email ?? "sem e-mail"}`);
      semMatch.push(c);
    } else if (match.confianca === "alta") {
      console.log(`  ✓  ${c.name.padEnd(45)} → ${match.name}`);
      vinculosAlta.push({ client_id: match.id, asaas_customer_id: asaasId, elo: match.name, asaas: c.name });
    } else {
      console.log(`  ?  ${c.name.padEnd(45)} → ${match.name} (confiança baixa)`);
      vinculosBaixa.push({ client_id: match.id, asaas_customer_id: asaasId, elo: match.name, asaas: c.name });
    }
  }

  console.log(`\nAlta confiança: ${vinculosAlta.length} | Baixa: ${vinculosBaixa.length} | Sem match: ${semMatch.length}\n`);

  if (!GRAVAR) {
    if (semMatch.length > 0) {
      console.log("Para os sem match, vincule manualmente em client_financials.asaas_customer_id:");
      semMatch.forEach((c) => console.log(`  ${c.id}  ${c.name}`));
    }
    return;
  }

  // Gravar só os de alta confiança
  let salvos = 0;
  for (const v of vinculosAlta) {
    const { error } = await sb
      .from("client_financials")
      .update({ asaas_customer_id: v.asaas_customer_id })
      .eq("client_id", v.client_id);
    if (error) console.error(`  Erro ${v.elo}:`, error.message);
    else salvos++;
  }
  console.log(`${salvos} vínculos de alta confiança gravados.`);
  if (vinculosBaixa.length > 0) {
    console.log(`\n${vinculosBaixa.length} de baixa confiança NÃO foram gravados — confirme manualmente:`);
    vinculosBaixa.forEach((v) =>
      console.log(`  "${v.asaas}" → "${v.elo}"  (asaas_customer_id: ${v.asaas_customer_id})`),
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
