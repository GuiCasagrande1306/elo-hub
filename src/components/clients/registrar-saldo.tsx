"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { setAccountFunds } from "@/app/(app)/clientes/actions";
import { cn } from "@/lib/utils";
import type { AdPlatform } from "@/types/database";

/* =====================================================================
   Informar o saldo sem sair da tela de alertas
   ---------------------------------------------------------------------
   POR QUE ISTO EXISTE. A conta de dias já estava pronta e correta, e
   mesmo assim a tela não alertava nada: medido em 19/08/2026, das 24
   contas pré-pagas, 23 nunca tiveram saldo informado.

   Não era desleixo. O único lugar para digitar o número era o diálogo de
   configuração de cada cliente — abrir 23 diálogos, um por um, para
   preencher 23 campos. O trabalho não cabia no fluxo de quem lê alertas,
   e por isso não acontecia.

   Aqui o campo fica na própria linha, ao lado do saldo que ele corrige.

   NÃO É UM SALDO QUE O SISTEMA LÊ. A Graph API não expõe a carteira da
   Meta, e a do Google não expõe saldo de conta pré-paga — o número vem
   do olho de quem abre o gerenciador. O que o sistema faz é ancorar:
   guarda a leitura com a data e desconta o gasto diário a partir dali.
   ===================================================================== */

export function RegistrarSaldo({
  clientId,
  platform,
  valorAtual,
  compacto,
}: {
  clientId: string;
  platform: AdPlatform;
  /** Centavos já registrados, para o campo abrir preenchido. */
  valorAtual: number | null;
  /** Sem rótulo, para caber na linha de uma conta que já tem saldo. */
  compacto?: boolean;
}) {
  const router = useRouter();
  const [valor, setValor] = useState(
    valorAtual === null ? "" : (valorAtual / 100).toFixed(2).replace(".", ","),
  );
  const [salvo, setSalvo] = useState(false);
  const [salvando, iniciar] = useTransition();

  function salvar() {
    iniciar(async () => {
      const r = await setAccountFunds({
        clientId,
        platform: platform as "meta_ads" | "google_ads",
        funds: valor,
      });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      setSalvo(true);
      toast.success(
        valor.trim() === "" ? "Saldo removido." : "Saldo registrado.",
      );
      /* `refresh` e não estado local: o saldo muda o STATUS da linha, a
         posição dela na ordenação e o resumo do topo. Repintar só o
         campo deixaria a tela dizendo "crítico" ao lado do número novo. */
      router.refresh();
      setTimeout(() => setSalvo(false), 2000);
    });
  }

  return (
    <div className="flex items-center gap-1.5">
      {!compacto && (
        <label
          htmlFor={`saldo-${clientId}-${platform}`}
          className="text-2xs text-muted-foreground"
        >
          Saldo hoje
        </label>
      )}

      <div className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-2xs text-muted-foreground">
          R$
        </span>
        <input
          id={`saldo-${clientId}-${platform}`}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              salvar();
            }
          }}
          /* `inputMode` decimal e não `type="number"`: o teclado do
             celular abre numérico, e o campo continua aceitando vírgula
             — que é como se escreve dinheiro em português. `number`
             recusa a vírgula em silêncio no Chrome. */
          inputMode="decimal"
          placeholder="341,77"
          disabled={salvando}
          className={cn(
            "w-28 rounded-lg border border-hairline bg-transparent py-1 pl-7 pr-2 text-xs tabular-nums outline-none",
            "placeholder:text-muted-foreground focus:border-signal disabled:opacity-60",
          )}
        />
      </div>

      <button
        type="button"
        onClick={salvar}
        disabled={salvando}
        className="rounded-lg border border-hairline px-2 py-1 text-2xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
      >
        {salvando ? (
          <Loader2 className="size-3 animate-spin" />
        ) : salvo ? (
          <Check className="size-3 text-positive" />
        ) : (
          "Salvar"
        )}
      </button>
    </div>
  );
}
