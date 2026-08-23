import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { getCurrentUser } from "@/lib/supabase/server";
import { DefinirSenhaForm } from "./form";

export const metadata: Metadata = { title: "Definir senha" };
export const dynamic = "force-dynamic";

/* =====================================================================
   Primeira senha — e também a de quem esqueceu
   ---------------------------------------------------------------------
   Chega-se aqui pelo `/auth/confirm`, com a sessão JÁ criada a partir
   do token do convite. Por isso a página não pede e-mail nem token: a
   pessoa está autenticada, só não tem senha própria ainda.

   FORA DO GRUPO `(app)` de propósito. O AppShell tem sidebar, busca
   global e lista de contas — tudo inútil e um pouco assustador para
   alguém que ainda não escolheu a senha. Aqui é uma tela só, com uma
   coisa para fazer.
   ===================================================================== */

export default async function DefinirSenhaPage() {
  const user = await getCurrentUser();

  /* Sem sessão não há o que definir. Acontece quando alguém salva este
     endereço nos favoritos e volta semanas depois. */
  if (!user) redirect("/login");

  return (
    <main className="flex min-h-dvh flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-9 flex items-center gap-2.5">
          <span className="relative flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
            <span className="text-sm font-bold leading-none">E</span>
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-signal ring-2 ring-background" />
          </span>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-semibold tracking-tight">Elo Hub</span>
            <span className="text-2xs text-muted-foreground">Marketing 360</span>
          </div>
        </div>

        <h1 className="text-2xl font-semibold tracking-[-0.02em]">
          Escolha sua senha
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Você entrou como <strong className="font-medium">{user.email}</strong>.
          Defina uma senha para acessar da próxima vez.
        </p>

        <DefinirSenhaForm />
      </div>
    </main>
  );
}
