import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { FlowBuilder } from "@/components/elochat/flow-builder";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "EloChat" };

/* =====================================================================
   EloChat
   ---------------------------------------------------------------------
   SEM `PageContainer`, e é a única tela do sistema assim. O container
   dá margem, largura máxima e rolagem da página — as três coisas que um
   canvas precisa NÃO ter. O construtor mede a própria altura descontando
   o cabeçalho do shell (e a barra inferior no mobile) para caber na
   janela sem criar uma segunda rolagem.

   Sem `redirect` de papel: o construtor ainda não grava nada, então não
   há o que proteger além do login, que o layout já garante. Quando
   existir fluxo publicável, esta linha muda junto.
   ===================================================================== */

export default async function EloChatPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return <FlowBuilder />;
}
