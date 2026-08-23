"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Abaixo disto o Supabase recusa; oito é o piso que pedimos. */
const MINIMO = 8;

export function DefinirSenhaForm() {
  const router = useRouter();

  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);

    if (senha.length < MINIMO) {
      setErro(`A senha precisa de pelo menos ${MINIMO} caracteres.`);
      return;
    }

    /* CONFERÊNCIA ANTES DE GRAVAR. Sem o segundo campo, um erro de
       digitação vira uma senha que ninguém conhece — e o conserto é
       pedir outro convite à agência. */
    if (senha !== confirmacao) {
      setErro("As duas senhas não são iguais.");
      return;
    }

    setSalvando(true);

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setErro("Supabase não configurado.");
      setSalvando(false);
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: senha });

    if (error) {
      setErro(error.message);
      setSalvando(false);
      return;
    }

    /* Para a raiz, não para `/crm`: quem decide o destino por papel é
       a página inicial, e ela já manda o cliente para o funil. Fixar
       `/crm` aqui mandaria alguém da equipe que usou o mesmo caminho
       para a tela errada. */
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={enviar} className="mt-8 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="senha">Nova senha</Label>
        <Input
          id="senha"
          type="password"
          autoComplete="new-password"
          autoFocus
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          placeholder={`Ao menos ${MINIMO} caracteres`}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmacao">Repita a senha</Label>
        <Input
          id="confirmacao"
          type="password"
          autoComplete="new-password"
          required
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
        />
      </div>

      {erro && (
        <p role="alert" className="text-sm text-negative">
          {erro}
        </p>
      )}

      <Button type="submit" disabled={salvando} className="mt-1 h-10">
        {salvando && <Loader2 className="size-4 animate-spin" />}
        Salvar e entrar
      </Button>
    </form>
  );
}
