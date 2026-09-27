/* =====================================================================
   Backfill das miniaturas de criativo para o Storage
   ---------------------------------------------------------------------
   Rode com:  npx tsx scripts/backfill-miniaturas.mts
   Depois da migration 20260927000078_bucket_de_criativos.sql.

   POR QUE PRECISA EXISTIR. A sincronização passa a guardar a cópia de
   cada anúncio novo, mas só dos NOVOS — e ela tem teto por rodada.
   Medido em 26/09/2026: 951 criativos no banco, 951 sem cópia. Sem este
   script, o histórico inteiro ficaria dependendo de URLs da Meta que já
   estão vencendo.

   ⚠️ BOA PARTE VAI FALHAR, E ISSO É O ESPERADO. As URLs da Meta são
   assinadas com prazo: as dos criativos antigos já devolvem 403, e não
   há como recuperá-las — a imagem daquela geração se perdeu quando o
   link venceu. O script conta separadamente o que copiou e o que já
   estava vencido, justamente para a diferença ficar visível em vez de
   parecer erro do script.

   IDEMPOTENTE. Roda de novo sem estragar nada: pula quem já tem cópia e
   tenta de novo quem falhou. Vale repetir depois de uma sincronização,
   que renova as URLs dos anúncios ATIVOS — um criativo que falhou hoje
   por link vencido pode ter link novo amanhã.

   NÃO TOCA EM DADO DE NEGÓCIO. A única escrita é `storage_path`, que
   hoje é nula em todas as linhas.
   ===================================================================== */

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { guardarMiniatura } from "../src/lib/ads/miniaturas";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/* `as never` porque o script monta o cliente à mão, sem os tipos
   gerados do projeto — o módulo só usa `.storage` e `.from`, que são
   iguais nos dois. */
const cliente = admin as never;

const { data, error } = await admin
  .from("ad_creatives")
  .select("id, client_id, external_ad_id, ad_name, thumbnail_url, is_active, clients(name)")
  .is("storage_path", null)
  .not("thumbnail_url", "is", null)
  /* Ativos primeiro: são os que aparecem nos relatórios que ainda vão
     ser gerados, e também os de URL mais recente — os com maior chance
     de o link ainda valer. */
  .order("is_active", { ascending: false })
  .order("spend_cents", { ascending: false });

if (error) {
  console.error("Consulta recusada pelo banco:", error.message);
  process.exit(1);
}

const pendentes = (data ?? []) as unknown as {
  id: string;
  client_id: string;
  external_ad_id: string;
  ad_name: string | null;
  thumbnail_url: string;
  is_active: boolean;
  clients: { name?: string } | null;
}[];

console.log(`criativos sem cópia: ${pendentes.length}\n`);

let copiados = 0;
let vencidos = 0;

for (const [i, ad] of pendentes.entries()) {
  const url = await guardarMiniatura(
    cliente,
    ad.client_id,
    ad.external_ad_id,
    ad.thumbnail_url,
  );

  if (!url) {
    vencidos += 1;
    console.log(
      `  ${String(i + 1).padStart(4)}. ✗ ${ad.clients?.name ?? ad.client_id} · ${ad.ad_name ?? ad.external_ad_id} — link vencido`,
    );
    continue;
  }

  const { error: erroUpdate } = await admin
    .from("ad_creatives")
    .update({ storage_path: url })
    .eq("id", ad.id);

  if (erroUpdate) {
    vencidos += 1;
    console.log(`  ${String(i + 1).padStart(4)}. ✗ falha ao gravar: ${erroUpdate.message}`);
    continue;
  }

  copiados += 1;
  console.log(
    `  ${String(i + 1).padStart(4)}. ✓ ${ad.clients?.name ?? ad.client_id} · ${ad.ad_name ?? ad.external_ad_id}`,
  );
}

console.log(
  `\ncopiados: ${copiados} · links já vencidos: ${vencidos} · total: ${pendentes.length}`,
);
console.log(
  vencidos > 0
    ? "\nOs vencidos não se recuperam: a imagem daquela geração se perdeu junto com o link.\n" +
        "Vale rodar de novo depois de uma sincronização — ela renova a URL dos anúncios ATIVOS."
    : "",
);
