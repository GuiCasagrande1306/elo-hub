"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Formulário de login por e-mail e senha.
 *
 * Autentica pelo cliente do browser porque é ele que grava os cookies
 * de sessão que o proxy vai renovar nas próximas requisições. Depois de
 * autenticar, `router.refresh()` faz os Server Components recarregarem
 * já com a sessão válida.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase não configurado.");
      setLoading(false);
      return;
    }

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      // Mensagem genérica de propósito: distinguir "e-mail não existe" de
      // "senha errada" permite enumerar quem tem conta na agência.
      setError("E-mail ou senha incorretos.");
      setLoading(false);
      return;
    }

    router.replace(searchParams.get("next") || "/");
    router.refresh();
  }

  /* O QUE ACONTECEU COM O CONVITE, quando a pessoa chega desviada de
     `/auth/confirm`. Sem este aviso ela vê a tela de login limpa depois
     de clicar num link que a agência disse que funcionaria, e a
     conclusão razoável é que o sistema está quebrado. */
  const convite = searchParams.get("convite");

  return (
    <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
      {convite && (
        <div className="rounded-lg border border-hairline bg-surface-2/60 px-3.5 py-3">
          <p className="text-sm font-medium">
            {convite === "expirado"
              ? "Esse link não vale mais"
              : "Link de convite incompleto"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {convite === "expirado"
              ? "Links de acesso são de uso único e expiram. Peça um novo à Elo Marketing — leva um minuto."
              : "Copie o endereço inteiro da mensagem: links quebram quando o aplicativo corta o final."}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="voce@marketingelo.com.br"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Senha</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}

      <Button type="submit" disabled={loading} className="mt-1 h-10">
        {loading && <Loader2 className="size-4 animate-spin" />}
        Entrar
      </Button>
    </form>
  );
}
