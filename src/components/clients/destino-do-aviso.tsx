"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, BellOff } from "lucide-react";
import { toast } from "sonner";

import { definirGrupoDoAviso } from "@/app/(app)/alertas-saldo/actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/* =====================================================================
   Para onde o aviso diário vai
   ---------------------------------------------------------------------
   A página sabia quais contas estão prestes a zerar e não avisava
   ninguém. Aqui se escolhe o grupo de WhatsApp que recebe.

   SEM GRUPO ESCOLHIDO, O CRON NÃO MANDA NADA — e a tela diz isso, em
   vez de deixar supor que o aviso está de pé. Um alerta que a pessoa
   acha que existe e não existe é pior que nenhum.
   ===================================================================== */

export interface GrupoDisponivel {
  jid: string;
  name: string;
}

const NENHUM = "__nenhum__";

export function DestinoDoAviso({
  grupos,
  jidAtual,
  nomeAtual,
  podeEditar,
}: {
  grupos: GrupoDisponivel[];
  jidAtual: string | null;
  nomeAtual: string | null;
  podeEditar: boolean;
}) {
  const router = useRouter();
  const [valor, setValor] = useState(jidAtual ?? NENHUM);
  const [salvando, iniciar] = useTransition();

  function escolher(novo: string | null) {
    const jid = novo ?? NENHUM;
    setValor(jid);

    iniciar(async () => {
      const r = await definirGrupoDoAviso({
        jid: jid === NENHUM ? "" : jid,
        nome: grupos.find((g) => g.jid === jid)?.name ?? "",
      });

      if (!r.ok) {
        setValor(jidAtual ?? NENHUM);
        toast.error(r.error);
        return;
      }

      toast.success(
        jid === NENHUM ? "Aviso diário desligado." : "Destino do aviso salvo.",
      );
      router.refresh();
    });
  }

  const ligado = Boolean(jidAtual);

  return (
    <div className="mt-6 flex flex-col gap-3 rounded-xl border border-hairline bg-surface-2/60 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2.5">
        {ligado ? (
          <BellRing className="mt-0.5 size-4 shrink-0 text-positive" />
        ) : (
          <BellOff className="mt-0.5 size-4 shrink-0 text-warning" />
        )}

        <div>
          <p className="text-sm font-medium">
            {ligado ? "Aviso diário ligado" : "Ninguém está sendo avisado"}
          </p>
          <p className="mt-1 max-w-prose text-2xs text-muted-foreground">
            {ligado ? (
              <>
                Todo dia de manhã, as contas <strong>críticas</strong> e as de{" "}
                <strong>leitura vencida</strong> vão para{" "}
                <strong>{nomeAtual ?? jidAtual}</strong>. Contas em atenção e
                sem saldo informado ficam de fora — aviso que chega todo dia
                deixa de ser lido.
              </>
            ) : (
              <>
                Esta página só alerta quem a abre. Escolha um grupo para
                receber as contas críticas de manhã.
              </>
            )}
          </p>
        </div>
      </div>

      {podeEditar ? (
        <Select
          value={valor}
          onValueChange={escolher}
          disabled={salvando || grupos.length === 0}
        >
          <SelectTrigger className="w-full shrink-0 sm:w-64">
            <SelectValue>
              {(v: string) =>
                v === NENHUM
                  ? "Não avisar"
                  : (grupos.find((g) => g.jid === v)?.name ?? "Grupo escolhido")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NENHUM}>Não avisar</SelectItem>
            {grupos.map((g) => (
              <SelectItem key={g.jid} value={g.jid}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-2xs text-muted-foreground">
          Só administradores mudam o destino.
        </span>
      )}
    </div>
  );
}
