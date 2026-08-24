import Link from "next/link";
import type { Metadata } from "next";

import { RecuperarSenhaForm } from "./form";

export const metadata: Metadata = { title: "Recuperar acesso" };

/* =====================================================================
   Esqueci minha senha
   ---------------------------------------------------------------------
   Fora do grupo `(app)` e pública no proxy: quem chega aqui não tem
   sessão, por definição.

   A PROMESSA DA TELA É MODESTA DE PROPÓSITO. Ela não diz "enviamos um
   e-mail", porque não temos como garantir que o e-mail chega — o
   endereço de acesso de um cliente muitas vezes nem é lido por ele.
   Diz o que de fato acontece: o pedido chega na Elo, e o link volta
   pelo caminho por onde essa conversa já acontece.
   ===================================================================== */

export default function RecuperarSenhaPage() {
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
          Recuperar acesso
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Informe o e-mail com que você entra. Vamos te mandar um link para
          escolher uma senha nova.
        </p>

        <RecuperarSenhaForm />

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link
            href="/login"
            className="underline underline-offset-4 transition-colors hover:text-foreground"
          >
            Voltar para o login
          </Link>
        </p>
      </div>
    </main>
  );
}
