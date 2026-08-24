"use client";

import { useEffect, useState } from "react";
import { ChevronDown, MessageCircle, TriangleAlert } from "lucide-react";

import {
  ConnectionCard,
  type ConexaoDoCliente,
} from "@/components/elozap/connection-card";
import { cn } from "@/lib/utils";

/* =====================================================================
   Ligar o WhatsApp da empresa ao painel
   ---------------------------------------------------------------------
   O CARTÃO É O MESMO DO ELOZAP, de propósito. Parear é a mesma operação
   dos dois lados — muda quem clica. Uma segunda implementação aqui
   divergiria no primeiro ajuste, e o pareamento é justamente onde um
   comportamento diferente entre as telas custa caro.

   O QUE MUDA É O TEXTO AO REDOR. Do lado da agência, quem lê já sabe o
   que é uma instância e por que existem números por cliente. Aqui quem
   lê é o dono da pizzaria, e ele precisa saber três coisas antes de
   apontar o celular para um QR Code:

     • que o WhatsApp do negócio dele passa a ser espelhado no painel;
     • que a Elo Marketing vê essas conversas;
     • que só vale do pareamento em diante — conversa velha não vem.

   Dizer isso aqui, na hora do clique, é diferente de ter dito uma vez
   numa reunião. É o único momento em que a pessoa está decidindo.

   FECHADO QUANDO JÁ ESTÁ CONECTADO. Depois de ligado, isto vira uma
   linha discreta acima do funil — que é o que a pessoa veio ver. Só
   abre se ela pedir.
   ===================================================================== */

export function WhatsAppDoCliente({
  clientId,
  clientName,
  brandPrimary,
}: {
  clientId: string;
  clientName: string;
  brandPrimary: string | null;
}) {
  const [conexao, setConexao] = useState<ConexaoDoCliente>({
    clientId,
    state: "absent",
  });
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState(false);

  /* UMA consulta, na montagem. Nada de polling: o contêiner da Evolution
     é o mesmo que despacha relatório, e uma batida por segundo vinda de
     cada cliente logado o derrubaria. Quem pareou sabe quando terminou
     e o próprio cartão tem "Atualizar". */
  useEffect(() => {
    let vivo = true;

    fetch(`/api/elozap/session?cliente=${clientId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!vivo) return;
        if (d?.state) setConexao({ clientId, ...d });
        setCarregando(false);
      })
      .catch(() => vivo && setCarregando(false));

    return () => {
      vivo = false;
    };
  }, [clientId]);

  const conectado = conexao.state === "open";

  /* Enquanto não se sabe, não se afirma. Mostrar "conecte seu WhatsApp"
     para quem já conectou, por um segundo, é o tipo de piscada que faz
     a pessoa clicar e desfazer o que estava certo. */
  if (carregando) {
    return (
      <div className="h-9 animate-pulse rounded-lg border border-hairline bg-surface-2/40" />
    );
  }

  if (conectado && !aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-hairline bg-surface-2/40 px-3 py-2 text-left text-2xs transition-colors hover:border-muted-foreground/40"
      >
        <MessageCircle className="size-3.5 shrink-0 text-positive" />
        <span className="min-w-0 flex-1 truncate">
          WhatsApp conectado
          {conexao.phone && (
            <span className="text-muted-foreground"> · {conexao.phone}</span>
          )}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-hairline p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">WhatsApp da empresa</h3>
          <p className="mt-0.5 max-w-prose text-2xs leading-relaxed text-muted-foreground">
            Conecte o número que seus clientes já usam para falar com você. As
            conversas passam a aparecer aqui, ao lado dos leads.
          </p>
        </div>

        {conectado && (
          <button
            type="button"
            onClick={() => setAberto(false)}
            className="shrink-0 text-2xs text-muted-foreground transition-colors hover:text-foreground"
          >
            fechar
          </button>
        )}
      </div>

      {!conectado && <Avisos />}

      <ConnectionCard
        client={{ id: clientId, name: clientName, brand_primary: brandPrimary }}
        conexao={conexao}
        onConexao={setConexao}
        bloqueio={null}
      />
    </section>
  );
}

/**
 * O que precisa estar dito ANTES do clique.
 *
 * Não é letra miúda: é a diferença entre um cliente que aceitou e um
 * cliente que descobriu depois. O risco de bloqueio é real — a conexão
 * usa o WhatsApp Web por baixo, e o número em jogo é o do negócio dele.
 */
function Avisos() {
  const itens = [
    {
      tom: "atencao" as const,
      texto:
        "O número do seu negócio fica espelhado no painel. Em casos raros o WhatsApp pode bloquear um número conectado por fora do aplicativo oficial — considere isso antes de ligar o número principal.",
    },
    {
      tom: "neutro" as const,
      texto:
        "A equipe da Elo Marketing enxerga essas conversas para atender junto com você.",
    },
    {
      tom: "neutro" as const,
      texto:
        "Só vale daqui para a frente: conversas anteriores ao pareamento não são importadas.",
    },
  ];

  return (
    <ul className="flex flex-col gap-1.5">
      {itens.map((item) => (
        <li
          key={item.texto}
          className={cn(
            "flex items-start gap-2 rounded-lg px-2.5 py-2 text-2xs leading-relaxed",
            item.tom === "atencao"
              ? "bg-warning-muted text-warning"
              : "bg-surface-2/60 text-muted-foreground",
          )}
        >
          {item.tom === "atencao" && (
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
          )}
          <span>{item.texto}</span>
        </li>
      ))}
    </ul>
  );
}
