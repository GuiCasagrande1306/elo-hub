"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

/* =====================================================================
   Rede de segurança do app inteiro
   ---------------------------------------------------------------------
   O projeto não tinha NENHUM `error.tsx`. Qualquer exceção não tratada
   dentro de `(app)` — uma server action que rejeita, um `.map` sobre
   `undefined` vindo de uma consulta que voltou vazia — subia até o
   boundary padrão do Next e, em produção, resultava em TELA BRANCA. Sem
   mensagem, sem botão, sem caminho de volta: a pessoa fechava o
   navegador achando que o sistema tinha caído.

   Fica no grupo `(app)`, e não em `global-error`, de propósito: aqui
   dentro o layout autenticado sobrevive, então a barra lateral continua
   na tela e dá para navegar para outra página em vez de recarregar tudo.

   ⚠️ A PROP DE RETENTATIVA CHAMA `unstable_retry` NESTA VERSÃO DO NEXT,
   não `reset` — ver `node_modules/next/dist/docs/01-app/03-api-reference/
   03-file-conventions/error.md`. Escrever `reset` compila, porque o
   parâmetro simplesmente chega `undefined`, e o botão não faz nada.
   ===================================================================== */

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    /* Em produção a mensagem real é omitida pelo React e sobra o
       `digest` — que é a chave para achar o stack no log da Vercel.
       Sem ele impresso aqui, investigar um relato de usuário vira
       adivinhação. */
    console.error("[erro na aplicação]", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-10">
      <div className="surface-card w-full max-w-md p-6 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-full bg-negative-muted">
          <TriangleAlert className="size-5 text-negative" />
        </span>

        <h1 className="mt-4 text-base font-semibold tracking-[-0.01em]">
          Alguma coisa quebrou nesta tela
        </h1>

        <p className="mt-1.5 text-sm text-muted-foreground">
          O erro foi registrado. Tentar de novo costuma resolver quando é
          falha de conexão; se repetir, avise um administrador.
        </p>

        {/* O código só aparece quando existe. É o que liga o relato da
            pessoa ao stack no log — pedir print de tela branca não liga
            nada a lugar nenhum. */}
        {error.digest && (
          <p className="mt-3 font-mono text-2xs text-muted-foreground/70">
            código {error.digest}
          </p>
        )}

        <Button className="mt-5" onClick={() => unstable_retry()}>
          <RotateCcw className="size-4" />
          Tentar de novo
        </Button>
      </div>
    </div>
  );
}
