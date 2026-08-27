"use client";

import { useState, useTransition } from "react";
import {
  CircleAlert,
  ExternalLink,
  Loader2,
  Send,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  enviarRelatorio,
  resolverEnvioPreso,
  type EnvioPendente,
} from "./actions";

/* =====================================================================
   Fila de envio
   ---------------------------------------------------------------------
   O cron gerou; aqui alguém confere e despacha. Duas decisões:

   1. O LINK DO PDF VEM ANTES DO BOTÃO DE ENVIAR. O ganho inteiro do
      envio manual é olhar o relatório antes de o cliente ver — se o
      botão estivesse sozinho, seria só um cron com etapa extra.

   2. O BOTÃO TRAVA DURANTE O ENVIO e o resultado aparece na linha. Uma
      segunda tentativa acidental manda o mesmo PDF duas vezes no grupo,
      que é constrangedor e não tem desfazer.
   ===================================================================== */

export function SendQueue({ itens }: { itens: EnvioPendente[] }) {
  if (itens.length === 0) {
    return (
      <p className="surface-card mt-4 p-5 text-sm text-muted-foreground">
        Nenhum relatório aguardando envio. O cron prepara os do dia às 6h20.
      </p>
    );
  }

  return (
    <ul className="surface-card mt-4 divide-y divide-hairline overflow-hidden">
      {itens.map((item) => (
        <LinhaEnvio key={item.report.id} item={item} />
      ))}
    </ul>
  );
}

function LinhaEnvio({ item }: { item: EnvioPendente }) {
  const [pendente, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(
    item.report.status === "failed" ? item.report.error_message : null,
  );
  const [enviado, setEnviado] = useState(false);
  const [resolvido, setResolvido] = useState(false);

  function despachar() {
    setErro(null);
    startTransition(async () => {
      const r = await enviarRelatorio(item.report.id);
      if (r.ok) setEnviado(true);
      else setErro(r.error ?? "Falha no envio.");
    });
  }

  function resolver(decisao: "chegou" | "nao-chegou") {
    setErro(null);
    startTransition(async () => {
      const r = await resolverEnvioPreso(item.report.id, decisao);
      if (r.ok) setResolvido(true);
      else setErro(r.error ?? "Não deu para resolver esta linha.");
    });
  }

  const destino = item.client.whatsapp_phone;

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3.5">
      <span
        aria-hidden
        className="size-5 shrink-0 rounded-md ring-1 ring-inset ring-black/10 dark:ring-white/10"
        style={{ backgroundColor: item.client.brand_primary ?? "#8a8a8a" }}
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.client.name}</p>
        <p className="truncate text-2xs text-muted-foreground">
          {formatPeriod(item.report.period_start, item.report.period_end)}
          {destino ? (
            <> · {destino.endsWith("@g.us") ? "grupo" : destino}</>
          ) : (
            <span className="text-warning"> · sem WhatsApp cadastrado</span>
          )}
        </p>
      </div>

      {item.pdfUrl && (
        <a
          href={item.pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-signal hover:underline"
        >
          <ExternalLink className="size-3" />
          Conferir PDF
        </a>
      )}

      {enviado ? (
        <span className="text-xs font-medium text-positive">Enviado ✓</span>
      ) : resolvido ? (
        <span className="text-xs font-medium text-muted-foreground">
          Resolvido ✓
        </span>
      ) : item.presoEmEnvio ? (
        /* PRESO: duas saídas, e nenhuma delas é "Enviar".
           A mensagem pode ter saído — só quem abre o grupo sabe. Um
           botão "Enviar" aqui seria o sistema apostando, e a aposta
           errada duplica o relatório no grupo do cliente. */
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => resolver("chegou")}
            disabled={pendente}
          >
            Chegou
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => resolver("nao-chegou")}
            disabled={pendente}
          >
            {pendente && <Loader2 className="size-3.5 animate-spin" />}
            Não chegou
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          onClick={despachar}
          disabled={pendente || !destino}
          title={
            destino
              ? "Envia pelo SEU WhatsApp"
              : "Cadastre o WhatsApp do cliente primeiro"
          }
        >
          {pendente ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          Enviar
        </Button>
      )}

      {item.presoEmEnvio && !resolvido && (
        <p className="flex w-full items-start gap-1.5 rounded-lg bg-warning-muted/50 px-3 py-2 text-xs text-warning">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <strong>Travou no meio do envio.</strong> A mensagem pode ter
            saído — abra o grupo do cliente e confira antes de decidir.
            &ldquo;Não chegou&rdquo; devolve a linha para a fila.
          </span>
        </p>
      )}

      {erro && (
        <p
          className={cn(
            "flex w-full items-start gap-1.5 rounded-lg bg-negative-muted/40 px-3 py-2 text-xs text-negative",
          )}
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {erro}
        </p>
      )}
    </li>
  );
}
