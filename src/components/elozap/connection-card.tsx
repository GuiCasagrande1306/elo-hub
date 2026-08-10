"use client";

/* eslint-disable @next/next/no-img-element */
import { useState, useTransition } from "react";
import { Loader2, Power, QrCode, RefreshCw, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Client } from "@/types/database";

/* =====================================================================
   Número de atendimento de um cliente
   ---------------------------------------------------------------------
   UM CARTÃO POR CONTA, porque a decisão foi um número por cliente: o
   cliente da Verdi fala com a agência pelo número da Verdi, e a equipe
   atende por ele. Instância separada da pessoal de cada atendente — ver
   `instanceNameForClient`.

   O QR EXPIRA EM ~40 SEGUNDOS e a tela diz isso. Sem o aviso, quem
   demora a pegar o celular acha que o pareamento falhou e clica de novo
   num laço — foi o que a tela do WhatsApp pessoal ensinou.

   NÃO faz polling automático de status. Ficar batendo na Evolution a
   cada segundo, para 47 contas, é carga constante num contêiner de
   US$ 5 que também sustenta os envios de relatório. Quem pareou sabe
   quando terminou e clica em atualizar.
   ===================================================================== */

type Estado = "open" | "connecting" | "close" | "absent";

export interface ConexaoDoCliente {
  clientId: string;
  state: Estado;
  phone?: string;
  profileName?: string;
}

const APARENCIA: Record<Estado, { rotulo: string; classe: string }> = {
  open: {
    rotulo: "Conectado",
    classe: "bg-positive-muted text-positive ring-positive/25",
  },
  connecting: {
    rotulo: "Aguardando leitura",
    classe: "bg-warning-muted text-warning ring-warning/25",
  },
  close: {
    rotulo: "Desconectado",
    classe: "bg-negative-muted text-negative ring-negative/25",
  },
  absent: {
    rotulo: "Sem número",
    classe: "bg-surface-2 text-muted-foreground ring-hairline",
  },
};

export function ConnectionCard({
  client,
  inicial,
  bloqueio,
}: {
  client: Pick<Client, "id" | "name" | "brand_primary">;
  inicial: ConexaoDoCliente;
  /**
   * Por que parear está indisponível, ou `null` se está disponível.
   *
   * Guardar o MOTIVO em vez de um booleano: são duas razões diferentes
   * (não é admin / está em demo) e um `podeParear: false` obrigaria a
   * tela a chutar qual delas mostrar. A trava de verdade está na rota;
   * isto aqui só evita o clique que vai voltar 403.
   */
  bloqueio: string | null;
}) {
  const [conexao, setConexao] = useState(inicial);
  const [qr, setQr] = useState<string | null>(null);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  const conectado = conexao.state === "open";
  const aparencia = APARENCIA[conexao.state];

  /**
   * Relê o estado no servidor e recompõe o cartão inteiro.
   *
   * Função separada porque DOIS caminhos precisam dela: o botão
   * Atualizar e o ramo "já está conectado" do pareamento. Ali a resposta
   * do POST não traz `phone` nem `profileName` — sem esta releitura o
   * cabeçalho continuaria dizendo "Nenhum aparelho pareado" ao lado do
   * selo verde.
   */
  async function consultarEstado() {
    const r = await fetch(`/api/elozap/session?cliente=${client.id}`);
    // Corpo vazio ou HTML de erro: `json()` lançaria e a falha viraria
    // "falha de rede", que manda investigar a coisa errada.
    const d = await r.json().catch(() => ({}) as Record<string, string>);

    if (!r.ok) {
      toast.error(d.error ?? "Não deu para consultar o estado.");
      return;
    }

    setConexao({ clientId: client.id, ...d });

    /* Conectou: o QR na tela vira lixo visual e, pior, um convite a
       escanear de novo com outro aparelho. */
    if (d.state === "open") {
      setQr(null);
      setCodigo(null);
    }
  }

  function atualizar() {
    iniciar(async () => {
      try {
        await consultarEstado();
      } catch {
        toast.error("Falha de rede ao consultar o estado.");
      }
    });
  }

  function parear() {
    iniciar(async () => {
      try {
        const r = await fetch("/api/elozap/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: client.id }),
        });
        const d = await r.json().catch(() => ({}) as Record<string, string>);

        if (!r.ok || !d.success) {
          toast.error(d.error ?? "Não deu para gerar o QR.");
          return;
        }

        /* JÁ ESTAVA CONECTADO — acontece de verdade: sem polling, o
           cartão continua marcado "aguardando leitura" depois que a
           pessoa escaneou, e o botão Novo QR segue à mão. `consultar`
           limpa o QR morto e traz o número; sem ele a tela ficava com
           QR e "expira em ~40 segundos" ao lado do selo Conectado. */
        if (d.state === "open") {
          toast.success("Número conectado.");
          await consultarEstado();
          return;
        }

        setQr(d.qrDataUri ?? null);
        setCodigo(d.pairingCode ?? null);
        // Forma funcional: o `conexao` do closure é o de quando o clique
        // começou, e entre ele e a resposta cabe outra atualização.
        setConexao((c) => ({ ...c, state: "connecting" }));
      } catch {
        toast.error("Falha de rede ao gerar o QR.");
      }
    });
  }

  function desconectar() {
    if (
      !window.confirm(
        `Desconectar o número de ${client.name}? A equipe para de receber e responder por ele até parear de novo.`,
      )
    ) {
      return;
    }

    iniciar(async () => {
      try {
        const r = await fetch(`/api/elozap/session?cliente=${client.id}`, {
          method: "DELETE",
        });
        const d = await r.json().catch(() => ({}) as Record<string, string>);
        if (!r.ok || !d.success) {
          toast.error(d.error ?? "Não deu para desconectar.");
          return;
        }
        toast.success("Número desconectado.");
        setConexao({ clientId: client.id, state: "close" });
        setQr(null);
        setCodigo(null);
      } catch {
        toast.error("Falha de rede ao desconectar.");
      }
    });
  }

  return (
    <article className="surface-card flex flex-col gap-3 p-4">
      <header className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="mt-1 size-2 shrink-0 rounded-full"
          style={{ background: client.brand_primary ?? "#94A3B8" }}
        />

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium">{client.name}</h3>
          <p className="mt-0.5 truncate text-2xs text-muted-foreground">
            {conectado && conexao.phone
              ? `+${conexao.phone}${conexao.profileName ? ` · ${conexao.profileName}` : ""}`
              : "Nenhum aparelho pareado"}
          </p>
        </div>

        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium ring-1 ring-inset",
            aparencia.classe,
          )}
        >
          {aparencia.rotulo}
        </span>
      </header>

      {/* `&& !conectado` é cinto e suspensório: todo caminho que descobre
          a conexão já chama `setQr(null)`, mas um QR ao lado do selo
          verde é contraditório o bastante para não depender só disso. */}
      {qr && !conectado && (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-white p-3">
          {/* Fundo branco fixo: o QR vem em PNG preto sobre transparente
              e some no tema escuro. */}
          <img src={qr} alt="QR Code para parear" className="size-44" />
          {codigo && (
            <p className="text-2xs text-slate-600">
              ou digite no celular:{" "}
              <span className="font-mono font-semibold">{codigo}</span>
            </p>
          )}
          <p className="text-center text-2xs text-slate-500">
            Expira em ~40 segundos. Depois de ler, clique em Atualizar.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={atualizar}
          disabled={ocupado}
        >
          {ocupado ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Atualizar
        </Button>

        {!bloqueio && !conectado && (
          <Button size="sm" className="h-8" onClick={parear} disabled={ocupado}>
            <QrCode className="size-3.5" />
            {conexao.state === "absent" ? "Conectar número" : "Novo QR"}
          </Button>
        )}

        {!bloqueio && conectado && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-negative hover:bg-negative-muted hover:text-negative"
            onClick={desconectar}
            disabled={ocupado}
          >
            <Power className="size-3.5" />
            Desconectar
          </Button>
        )}

        {bloqueio && (
          <span className="flex items-center gap-1 text-2xs text-muted-foreground">
            <Smartphone className="size-3" />
            {bloqueio}
          </span>
        )}
      </div>
    </article>
  );
}
