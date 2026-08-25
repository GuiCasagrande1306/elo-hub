import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { confirmarAcesso } from "./actions";

export const metadata: Metadata = {
  title: "Confirmar acesso",
  /* O robô de prévia não deve indexar, e ninguém deve chegar aqui pela
     busca: o endereço é para uma pessoa, com um token dentro. */
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/* =====================================================================
   A porta de entrada de quem foi convidado
   ---------------------------------------------------------------------
   UMA TELA COM UM BOTÃO, e o botão existe por um motivo específico: o
   token é de uso único, e mensageiro que monta prévia de link BUSCA a
   URL antes de a pessoa clicar. Enquanto isto era um redirecionamento
   direto, a prévia do WhatsApp consumia o convite e a pessoa recebia
   "esse link não vale mais" — medido em produção, ver `actions.ts`.

   Robô de prévia faz GET; formulário é POST. O clique a mais é o preço
   de o convite chegar vivo.

   SEM SESSÃO E SEM CASCA. Quem chega aqui não tem conta ainda — não há
   sidebar, não há busca, não há nada para clicar por engano.
   ===================================================================== */

export default async function ConfirmarAcessoPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}) {
  const { token_hash, type, next } = await searchParams;
  const completo = Boolean(token_hash && type);

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

        {completo ? (
          <>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              Confirmar seu acesso
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Clique no botão para entrar e escolher sua senha. O link vale uma
              vez só.
            </p>

            <form action={confirmarAcesso} className="mt-8">
              <input type="hidden" name="token_hash" value={token_hash} />
              <input type="hidden" name="type" value={type} />
              <input type="hidden" name="next" value={next ?? "/crm"} />
              <Button type="submit" className="h-10 w-full">
                Confirmar e continuar
              </Button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              Link incompleto
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Falta parte do endereço. Copie o link inteiro da mensagem —
              aplicativos às vezes cortam o final — ou peça um novo à Elo
              Marketing.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
