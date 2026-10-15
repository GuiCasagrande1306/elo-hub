/**
 * Assina a Página do cliente no webhook de leadgen do app Meta.
 *
 * 1. Busca o cliente pelo nome
 * 2. Pega o access_token de integration_secrets (meta_ads)
 * 3. Lista as Páginas disponíveis com esse token
 * 4. Assina o campo `leadgen` para a página escolhida
 *
 * USO:
 *   npx tsx scripts/subscrever-pagina-leads.mts "casa ximenes"
 *   npx tsx scripts/subscrever-pagina-leads.mts "casa ximenes" --page-id 123456789
 *   npx tsx scripts/subscrever-pagina-leads.mts "casa ximenes" --page-id 123456789 --gravar
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const VERSION = process.env.META_API_VERSION ?? "v21.0";
const nomeBusca = process.argv[2]?.toLowerCase();
const pageIdArg = process.argv.find((a) => a.startsWith("--page-id="))?.split("=")[1]
  ?? (process.argv.indexOf("--page-id") !== -1 ? process.argv[process.argv.indexOf("--page-id") + 1] : null);
const gravar = process.argv.includes("--gravar");

if (!nomeBusca) {
  console.error("Uso: npx tsx scripts/subscrever-pagina-leads.mts <nome do cliente>");
  process.exit(1);
}

async function main() {
  /* ── 1. Buscar cliente ────────────────────────────────────────────── */
  const { data: clientes } = await supabase
    .from("clients")
    .select("id, name, meta_page_id")
    .ilike("name", `%${nomeBusca}%`)
    .limit(5);

  if (!clientes?.length) {
    console.error(`Nenhum cliente encontrado para "${nomeBusca}".`);
    process.exit(1);
  }

  const cliente = clientes[0]!;
  console.log(`\n✅ Cliente: ${cliente.name} (${cliente.id})`);
  if (cliente.meta_page_id) {
    console.log(`   meta_page_id atual: ${cliente.meta_page_id}`);
  }

  /* ── 2. Token do Meta ─────────────────────────────────────────────── */
  const { data: intRow } = await supabase
    .from("client_integrations")
    .select("id, external_account_id, integration_secrets(access_token)")
    .eq("client_id", cliente.id)
    .eq("platform", "meta_ads")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const token = (intRow as {
    integration_secrets: { access_token: string | null } | null;
  } | null)?.integration_secrets?.access_token;

  const adAccount = (intRow as { external_account_id?: string } | null)?.external_account_id;

  if (!token) {
    console.error("Sem token Meta para este cliente. Conecte a conta de anúncios primeiro.");
    process.exit(1);
  }

  console.log(`   Conta de anúncios: ${adAccount ?? "—"}`);

  /* ── 3. Se page-id já foi passado, assina direto ─────────────────── */
  if (pageIdArg) {
    await assinar(pageIdArg, token, cliente.id, cliente.name, gravar);
    return;
  }

  /* ── 4. Listar páginas disponíveis ───────────────────────────────── */
  console.log("\n⏳ Buscando páginas acessíveis com este token...");
  const res = await fetch(
    `https://graph.facebook.com/${VERSION}/me/accounts?fields=id,name,category&limit=50&access_token=${token}`,
  );

  const json = await res.json() as {
    data?: { id: string; name: string; category: string }[];
    error?: { message: string };
  };

  if (json.error) {
    console.error("Graph API:", json.error.message);
    /* Token pode ser user token — tentar como Page token direto */
    console.log("\nO token pode ser de conta de anúncios. Use --page-id para assinar diretamente:");
    console.log(`  npx tsx scripts/subscrever-pagina-leads.mts "${nomeBusca}" --page-id SEU_PAGE_ID --gravar`);
    process.exit(1);
  }

  const paginas = json.data ?? [];

  if (!paginas.length) {
    console.log("Nenhuma página encontrada para este token.");
    console.log("Use --page-id para informar o ID manualmente:");
    console.log(`  npx tsx scripts/subscrever-pagina-leads.mts "${nomeBusca}" --page-id SEU_PAGE_ID --gravar`);
    return;
  }

  console.log("\n📄 Páginas disponíveis:");
  for (const p of paginas) {
    const marker = p.id === cliente.meta_page_id ? " ← atual" : "";
    console.log(`   ${p.id}  ${p.name}  (${p.category})${marker}`);
  }

  console.log(`\nEscolha a página e rode com --page-id:`);
  console.log(`  npx tsx scripts/subscrever-pagina-leads.mts "${nomeBusca}" --page-id ID_AQUI --gravar`);
}

async function assinar(
  pageId: string,
  userToken: string,
  clienteId: string,
  clienteNome: string,
  salvar: boolean,
) {
  /* Precisamos do PAGE access token, não do user token.
     Buscar via /me/accounts ou assumir que é page token direto. */

  /* Tenta pegar o page token via /me/accounts */
  const accountsRes = await fetch(
    `https://graph.facebook.com/${VERSION}/me/accounts?fields=id,name,access_token&limit=100&access_token=${userToken}`,
  );
  const accountsJson = await accountsRes.json() as {
    data?: { id: string; name: string; access_token: string }[];
    error?: { message: string };
  };

  const pagina = accountsJson.data?.find((p) => p.id === pageId);
  const pageToken = pagina?.access_token ?? userToken;

  console.log(`\n⏳ Assinando página ${pageId}${pagina ? ` (${pagina.name})` : ""} para o campo leadgen...`);

  const res = await fetch(
    `https://graph.facebook.com/${VERSION}/${pageId}/subscribed_apps`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        subscribed_fields: "leadgen",
        access_token: pageToken,
      }),
    },
  );

  const json = await res.json() as { success?: boolean; error?: { message: string } };

  if (json.error) {
    console.error("❌ Erro ao assinar:", json.error.message);
    process.exit(1);
  }

  console.log("✅ Assinatura feita:", json);

  if (salvar) {
    const { error } = await supabase
      .from("clients")
      .update({ meta_page_id: pageId })
      .eq("id", clienteId);

    if (error) {
      console.error("❌ Erro ao salvar meta_page_id no banco:", error.message);
    } else {
      console.log(`✅ meta_page_id=${pageId} gravado para "${clienteNome}".`);
    }
  } else {
    console.log(`\nPara gravar o meta_page_id=${pageId} no banco, rode com --gravar.`);
    console.log(`  npx tsx scripts/subscrever-pagina-leads.mts "${nomeBusca}" --page-id ${pageId} --gravar`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
