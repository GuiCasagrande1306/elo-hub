import { redirect } from "next/navigation";

import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { CollaboratorDashboard } from "@/components/dashboard/collaborator-dashboard";
import { getCurrentUser } from "@/lib/supabase/server";

/**
 * Página inicial — dois painéis, uma rota.
 *
 * A escolha é pela pergunta que cada perfil faz ao abrir o sistema:
 *
 *   colaborador → "o que eu faço agora?"
 *   admin       → "onde está o problema e quem eu cobro?"
 *
 * São leituras diferentes o bastante para justificarem componentes
 * separados; espremer as duas num só, com condicionais espalhadas,
 * produziria uma tela que não serve bem a nenhum dos dois.
 *
 * ⚠️ ISTO NÃO É CONTROLE DE ACESSO. O `role` aqui só escolhe o layout —
 * quem impede um colaborador de LER dado da agência é o RLS, em cada
 * consulta. Se esta linha fosse a barreira, bastaria adulterar o perfil
 * no cliente para ver tudo.
 */
export default async function OverviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return user.role === "admin" ? (
    <AdminDashboard user={user} />
  ) : (
    <CollaboratorDashboard user={user} />
  );
}
