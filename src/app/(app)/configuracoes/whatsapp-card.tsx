"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, LogOut, QrCode, RefreshCw, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* =====================================================================
   Meu WhatsApp
   ---------------------------------------------------------------------
   O QR da Evolution expira em ~40 segundos. Isso define a interface:

   • O QR não é buscado ao abrir a página — só quando a pessoa clica.
     Buscar antes garante um QR morto na hora em que ela for ler.
   • Enquanto o QR está na tela, o estado é consultado a cada 3s. Assim
     a tela reage sozinha ao pareamento, sem pedir "clique para
     verificar" — o usuário está com as duas mãos no celular.
   • O polling PARA ao conectar, ao desmontar e ao expirar. Timer que
     sobrevive à navegação vira requisição infinita em segundo plano.
   ===================================================================== */

type Estado = "open" | "connecting" | "close" | "absent";

interface StatusResposta {
  state: Estado;
  phone?: string;
  profileName?: string;
}

/** Validade real do QR, com folga para a leitura. */
const VALIDADE_MS = 40_000;
const INTERVALO_MS = 3_000;

export function WhatsAppCard({
  /** Resolvido no servidor: evita um round-trip e o flash de "carregando". */
  initialStatus,
}: {
  initialStatus: StatusResposta;
}) {
  const [status, setStatus] = useState<StatusResposta>(initialStatus);
  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [expirado, setExpirado] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiraRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limparTimers = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (expiraRef.current) clearTimeout(expiraRef.current);
    timerRef.current = null;
    expiraRef.current = null;
  }, []);

  const consultar = useCallback(async (): Promise<StatusResposta | null> => {
    try {
      const r = await fetch("/api/whatsapp/session", { cache: "no-store" });
      if (!r.ok) return null;
      const dado = (await r.json()) as StatusResposta;
      setStatus(dado);
      return dado;
    } catch {
      return null;
    }
  }, []);

  // Só limpeza: o estado inicial veio pronto do servidor, e o QR só é
  // buscado por clique — ver nota no topo.
  useEffect(() => limparTimers, [limparTimers]);

  async function parear() {
    setCarregando(true);
    setErro(null);
    setExpirado(false);
    limparTimers();

    try {
      const r = await fetch("/api/whatsapp/session", { method: "POST" });
      const dado = await r.json();

      if (!r.ok || !dado.success) {
        setErro(dado.error ?? "Não foi possível gerar o QR.");
        return;
      }

      if (dado.state === "open") {
        setQr(null);
        await consultar();
        return;
      }

      setQr(dado.qrDataUri ?? null);
      setPairingCode(dado.pairingCode ?? null);

      // Enquanto o QR vive, observa a conexão acontecer.
      timerRef.current = setInterval(async () => {
        const atual = await consultar();
        if (atual?.state === "open") {
          limparTimers();
          setQr(null);
          setPairingCode(null);
        }
      }, INTERVALO_MS);

      expiraRef.current = setTimeout(() => {
        limparTimers();
        setExpirado(true);
      }, VALIDADE_MS);
    } catch {
      setErro("Falha de rede ao falar com o servidor.");
    } finally {
      setCarregando(false);
    }
  }

  async function desconectar() {
    setCarregando(true);
    limparTimers();
    setQr(null);

    try {
      await fetch("/api/whatsapp/session", { method: "DELETE" });
      await consultar();
    } finally {
      setCarregando(false);
    }
  }

  const conectado = status.state === "open";

  return (
    <div className="surface-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ring-1",
              conectado
                ? "bg-positive-muted text-positive ring-positive/25"
                : "bg-muted text-muted-foreground ring-hairline",
            )}
          >
            <Smartphone className="size-4" />
          </span>

          <div>
            <h3 className="text-sm font-semibold">Meu WhatsApp</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {conectado
                ? `Conectado${status.phone ? ` — ${formatarTelefone(status.phone)}` : ""}`
                : "Conecte seu celular para enviar mensagens em seu nome."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {conectado ? (
            <Button
              variant="outline"
              size="sm"
              onClick={desconectar}
              disabled={carregando}
            >
              <LogOut className="size-3.5" />
              Desconectar
            </Button>
          ) : (
            <Button size="sm" onClick={parear} disabled={carregando}>
              {carregando ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <QrCode className="size-3.5" />
              )}
              {qr ? "Gerar novo QR" : "Conectar"}
            </Button>
          )}
        </div>
      </div>

      {erro && (
        <p className="mt-4 rounded-lg bg-negative-muted/40 px-3 py-2 text-xs text-negative">
          {erro}
        </p>
      )}

      {qr && !conectado && (
        <div className="mt-5 flex flex-col items-center gap-3 border-t border-hairline pt-5">
          <div className="relative">
            <Image
              src={qr}
              alt="QR Code para conectar o WhatsApp"
              width={240}
              height={240}
              unoptimized
              className={cn(
                "rounded-lg bg-white p-2 transition-opacity",
                expirado && "opacity-25",
              )}
            />

            {expirado && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                <p className="text-xs font-medium">QR expirado</p>
                <Button size="sm" variant="outline" onClick={parear}>
                  <RefreshCw className="size-3.5" />
                  Gerar outro
                </Button>
              </div>
            )}
          </div>

          {!expirado && (
            <div className="text-center">
              <p className="text-xs font-medium">
                WhatsApp → Aparelhos conectados → Conectar aparelho
              </p>
              <p className="mt-1 text-2xs text-muted-foreground">
                Expira em ~40 segundos. A tela se atualiza sozinha ao parear.
              </p>
              {pairingCode && (
                <p className="mt-2 text-2xs text-muted-foreground">
                  Ou use o código{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono">
                    {pairingCode}
                  </code>
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <p className="mt-4 border-t border-hairline pt-3 text-2xs text-muted-foreground">
        Use um chip secundário. A conexão usa WhatsApp Web não oficial e o
        número pode ser bloqueado pela Meta.
      </p>
    </div>
  );
}

/** 5548999110022 → +55 48 99911-0022 */
function formatarTelefone(bruto: string): string {
  const d = bruto.replace(/\D/g, "");
  if (d.length < 12) return bruto;

  const ddd = d.slice(2, 4);
  const numero = d.slice(4);
  const meio = numero.length > 8 ? numero.slice(0, 5) : numero.slice(0, 4);
  const fim = numero.slice(meio.length);

  return `+55 ${ddd} ${meio}-${fim}`;
}
