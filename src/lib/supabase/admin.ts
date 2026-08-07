import "server-only";

import { createClient } from "@supabase/supabase-js";
import { requireServerEnv, supabaseUrl } from "@/lib/env";

/**
 * Cliente com `service_role` — IGNORA RLS por completo.
 *
 * Restrito a quatro usos, todos sem usuário na ponta:
 *   1. Sync de métricas do Google/Meta Ads (jobs de cron).
 *   2. Upload do PDF de relatório no Storage.
 *   3. Leitura de `integration_secrets` (tabela sem policy alguma).
 *   4. Materialização da recorrência financeira (`lib/finance/recurrence`).
 *
 * O caso 4 é o único que também tem entrada pela interface — a server
 * action `gerarLancamentosDoMes` checa `role === "admin"` à mão antes de
 * chamar, justamente porque aqui o RLS não protege mais nada.
 *
 * Regra: NUNCA importar isto em código que responde a input do usuário
 * sem antes checar a autorização à mão. O `import "server-only"` garante
 * apenas que a chave não vaze para o bundle do browser — não substitui
 * a verificação de permissão.
 */
export function createSupabaseAdminClient() {
  return createClient(supabaseUrl, requireServerEnv("supabaseServiceRoleKey"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
