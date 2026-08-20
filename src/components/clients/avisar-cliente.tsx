"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import {
  enviarAvisoDeRecarga,
  previaDoAvisoDeRecarga,
} from "@/app/(app)/alertas-saldo/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AdPlatform } from "@/types/database";

/* =====================================================================
   Avisar o cliente que o saldo está acabando
   ---------------------------------------------------------------------
   A PRÉVIA NÃO É ENFEITE. A mensagem vai para o grupo do CLIENTE, com
   um valor de recarga sugerido, assinada pelo WhatsApp de quem clica.
   Mandar direto do botão economizaria dois segundos e tiraria a única
   chance de alguém notar que o ritmo dobrou por causa de uma campanha
   de fim de semana e o valor saiu estranho.

   O texto exibido é o texto EXATO que sai — vem do servidor, da mesma
   função que envia. Uma prévia montada no cliente seria uma segunda
   implementação da mensagem, livre para divergir.
   ===================================================================== */

export function AvisarCliente({
  clientId,
  clientName,
  platform,
  temGrupo,
  avisadoEm,
}: {
  clientId: string;
  clientName: string;
  platform: AdPlatform;
  temGrupo: boolean;
  avisadoEm: string | null;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [previa, setPrevia] = useState<{ texto: string; destino: string } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [enviando, iniciar] = useTransition();

  async function abrir() {
    setAberto(true);
    setCarregando(true);
    const r = await previaDoAvisoDeRecarga({
      clientId,
      platform: platform as "meta_ads" | "google_ads",
    });
    setCarregando(false);

    if (!r.ok) {
      toast.error(r.error);
      setAberto(false);
      return;
    }
    setPrevia({ texto: r.texto, destino: r.destino });
  }

  function enviar() {
    iniciar(async () => {
      const r = await enviarAvisoDeRecarga({
        clientId,
        platform: platform as "meta_ads" | "google_ads",
      });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      toast.success("Aviso enviado ao grupo do cliente.");
      setAberto(false);
      router.refresh();
    });
  }

  /* Já avisado HOJE some do caminho: a conta continua na lista, com o
     alerta, mas o botão não convida a mandar a mesma cobrança de novo. */
  const avisadoHoje =
    avisadoEm !== null &&
    new Date(avisadoEm).toDateString() === new Date().toDateString();

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={!temGrupo || avisadoHoje}
        onClick={abrir}
        title={
          !temGrupo
            ? "Este cliente não tem grupo de WhatsApp cadastrado"
            : avisadoHoje
              ? "O aviso de hoje já foi enviado"
              : "Ver a mensagem antes de enviar"
        }
      >
        <Send className="size-3.5" />
        {avisadoHoje ? "Avisado hoje" : "Avisar cliente"}
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Avisar {clientName}</DialogTitle>
            <DialogDescription>
              Vai para {previa?.destino ?? "o grupo do cliente"}, pelo seu
              WhatsApp. Confira o valor antes.
            </DialogDescription>
          </DialogHeader>

          {carregando ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Montando a mensagem…
            </div>
          ) : (
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-hairline bg-surface-2 p-3 text-xs leading-relaxed">
              {previa?.texto}
            </pre>
          )}

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={enviar} disabled={enviando || carregando}>
              {enviando ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
              Enviar ao grupo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
