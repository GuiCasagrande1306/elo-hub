/* Lê os pedidos de uma janela e mostra as vendas pagas com clique do Google.
   Com --enviar, manda para o Google Ads (ação "Compra paga (Magazord)").
     npx tsx --conditions=react-server --env-file=.env.local scripts/teste-vendas-google.mts 2026-11-01 2026-11-19 [--enviar] */
import { pedidosDaJanela } from "@/lib/loja/magazord";
import { enviarVendasAoGoogle } from "@/lib/ads/enviar-vendas-google";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const [inicio, fim] = process.argv.slice(2, 4);
const admin = createSupabaseAdminClient();
const { data: loja } = await admin.from("store_integrations")
  .select("client_id, base_url, store_secrets(access_token)").eq("is_active", true)
  .ilike("base_url", "%atacadodepratas%").single();
const l = loja as unknown as { client_id: string; base_url: string; store_secrets: { access_token: string } };
const r = await pedidosDaJanela(l.base_url, l.store_secrets.access_token, inicio, fim);
if (!r) throw new Error("API da loja não respondeu");
const v = r.vendasDoGoogle;
console.log(`${r.totalDePedidos} pedidos, ${v.length} pagos com clique do Google, R$ ${(v.reduce((a, x) => a + x.valorCents, 0) / 100).toFixed(2)}`);
console.assert(v.every((x) => x.valorCents > 0 && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(x.dataHora) && (x.gclid || x.gbraid || x.wbraid)), "venda malformada");
console.log(v.slice(0, 3));
if (process.argv.includes("--enviar")) console.log(await enviarVendasAoGoogle(admin, l.client_id, v));
