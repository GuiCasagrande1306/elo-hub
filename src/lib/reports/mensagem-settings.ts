import "server-only";

import { isDemoMode } from "@/lib/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MENSAGEM_PADRAO } from "./mensagem-do-cliente";

/* =====================================================================
   Leitura do texto da legenda
   ---------------------------------------------------------------------
   Separado de `mensagem-do-cliente.ts` de propósito: aquele arquivo é
   puro e roda no navegador para a prévia. Marcá-lo como `server-only`
   por causa de uma consulta obrigaria a estação de comando a receber o
   texto renderizado do servidor a cada tecla.

   service_role, e não a sessão: quem lê isto inclui o CRON, que não tem
   usuário. A linha não é sigilosa — a policy de leitura é `using (true)`
   para toda a equipe —, então o que se ganha com a chave de serviço é um
   caminho só, que funciona nas duas origens.

   FALHA PARA O LADO DE ENVIAR. Migration não rodada, rede fora, linha
   apagada: devolve o texto de fábrica. Um relatório que não sai porque
   a legenda não pôde ser lida seria trocar um problema pequeno por um
   grande — e o padrão é uma frase correta, não um placeholder.
   ===================================================================== */

export async function getMensagemDoCliente(): Promise<string> {
  if (isDemoMode) return MENSAGEM_PADRAO;

  try {
    const { data } = await createSupabaseAdminClient()
      .from("report_message_settings")
      .select("template")
      .eq("id", true)
      .maybeSingle();

    const texto = (data?.template as string | undefined)?.trim();
    return texto && texto.length > 0 ? texto : MENSAGEM_PADRAO;
  } catch {
    return MENSAGEM_PADRAO;
  }
}
