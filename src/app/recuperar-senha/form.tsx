"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pedirRecuperacao } from "./actions";

export function RecuperarSenhaForm() {
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [ocupado, iniciar] = useTransition();

  function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);

    iniciar(async () => {
      const r = await pedirRecuperacao({ email });

      if (!r.ok) {
        setErro(r.error);
        return;
      }

      setEnviado(true);
    });
  }

  /* A MESMA TELA PARA E-MAIL QUE EXISTE E PARA E-MAIL QUE NÃO EXISTE.
     Qualquer diferença aqui — texto, tempo, ícone — transformaria a
     página num verificador de quem é cliente da Elo. Ver a nota 1 em
     `actions.ts`. */
  if (enviado) {
    return (
      <div className="mt-8 flex flex-col gap-3 rounded-xl border border-hairline bg-surface-2/50 p-5">
        <CheckCircle2 className="size-5 text-positive" />
        <div>
          <p className="text-sm font-medium">Pedido registrado</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Se <strong className="font-medium text-foreground">{email}</strong>{" "}
            tiver acesso ao painel, o link chega por e-mail em alguns minutos.
          </p>
          <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
            Não chegou? Fale com a Elo Marketing pelo WhatsApp de sempre — o
            pedido já apareceu no painel deles, e eles conseguem te mandar um
            link novo na hora.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="mt-8 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@suaempresa.com.br"
        />
      </div>

      {erro && (
        <p role="alert" className="text-sm text-negative">
          {erro}
        </p>
      )}

      <Button type="submit" disabled={ocupado} className="mt-1 h-10">
        {ocupado && <Loader2 className="size-4 animate-spin" />}
        Pedir link de acesso
      </Button>
    </form>
  );
}
