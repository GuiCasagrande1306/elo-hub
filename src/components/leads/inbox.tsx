"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Eye,
  FileText,
  Send,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useRealtimeRefresh } from "@/hooks/use-realtime";
import {
  enviarMensagem,
  marcarComoLida,
} from "@/app/(app)/crm/conversas-actions";
import { cn } from "@/lib/utils";
import type {
  ConversaDaLista,
  MensagemDaThread,
} from "@/lib/crm/conversas";

/* =====================================================================
   A caixa de entrada
   ---------------------------------------------------------------------
   DUAS COLUNAS NO DESKTOP, UMA NO CELULAR. No celular a lista e a
   conversa não cabem juntas, e espremer as duas dá uma thread de
   quarenta caracteres de largura — que é ilegível justamente no
   aparelho em que a pessoa mais vai atender.

   A CONVERSA ABERTA VIVE NA URL (`?conversa=`), não em estado. Três
   coisas saem de graça com isso: o botão voltar do celular fecha a
   conversa em vez de sair da página, recarregar não perde o lugar, e o
   `router.refresh()` do Realtime traz mensagem nova sem desmontar nada.

   SÓ O CLIENTE ESCREVE. A equipe da agência vê a conversa inteira e não
   tem campo de resposta — decisão de 23/08/2026, e a trava de verdade
   está na server action. Aqui é só não oferecer o que vai ser recusado.
   ===================================================================== */

interface Props {
  clientId: string;
  conversas: ConversaDaLista[];
  /** A conversa aberta, se houver — vem da URL. */
  aberta: ConversaDaLista | null;
  thread: MensagemDaThread[];
  ehCliente: boolean;
}

export function Inbox({ clientId, conversas, aberta, thread, ehCliente }: Props) {
  const router = useRouter();

  /* A URL é MONTADA, não lida. Os únicos parâmetros que existem nesta
     tela são `cliente`, `aba` e `conversa`, então reconstruí-los é mais
     barato — e mais previsível — que puxar `useSearchParams`, que ainda
     obrigaria um limite de Suspense acima. O `cliente` some para quem é
     do cliente: ele não escolhe conta nenhuma. */
  const hrefDaConversa = (id: string | null) => {
    const p = new URLSearchParams();
    if (!ehCliente) p.set("cliente", clientId);
    p.set("aba", "conversas");
    if (id) p.set("conversa", id);
    return `/crm?${p.toString()}`;
  };

  /* Uma assinatura para a empresa inteira, não uma por conversa: a
     lista precisa reagir a mensagem de QUALQUER thread, e é o mesmo
     evento que atualiza a conversa aberta. */
  useRealtimeRefresh("wa_mensagens", { filter: `client_id=eq.${clientId}` });

  if (conversas.length === 0) {
    return (
      <div className="surface-card flex flex-col items-start gap-2 p-6">
        <h3 className="text-sm font-semibold">Nenhuma conversa ainda</h3>
        <p className="max-w-prose text-sm text-muted-foreground">
          Assim que alguém mandar mensagem para o número conectado, a conversa
          aparece aqui. Só vale do pareamento em diante — histórico anterior
          fica no aplicativo.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[min(70vh,640px)] overflow-hidden rounded-xl border border-hairline">
      {/* --- lista ---------------------------------------------------- */}
      <aside
        className={cn(
          "w-full shrink-0 overflow-y-auto border-hairline sm:w-80 sm:border-r",
          // No celular, abrir a conversa esconde a lista.
          aberta && "hidden sm:block",
        )}
      >
        <ul className="divide-y divide-hairline">
          {conversas.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => router.push(hrefDaConversa(c.id))}
                className={cn(
                  "flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors",
                  c.id === aberta?.id ? "bg-accent" : "hover:bg-surface-2",
                )}
              >
                <span className="flex items-center gap-1.5">
                  {c.eh_grupo && (
                    <Users className="size-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {c.nome ?? telefone(c.jid) ?? "Sem nome"}
                  </span>
                  {c.nao_lidas > 0 && (
                    <span className="shrink-0 rounded-full bg-signal px-1.5 text-[10px] font-semibold tabular-nums text-signal-foreground">
                      {c.nao_lidas}
                    </span>
                  )}
                </span>

                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                    {c.ultima_previa ?? "—"}
                  </span>
                  {c.ultima_em && (
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                      {quando(c.ultima_em)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* --- conversa ------------------------------------------------- */}
      {aberta ? (
        <Conversa
          conversa={aberta}
          thread={thread}
          ehCliente={ehCliente}
          onVoltar={() => router.push(hrefDaConversa(null))}
        />
      ) : (
        <div className="hidden flex-1 items-center justify-center p-6 sm:flex">
          <p className="text-center text-xs text-muted-foreground">
            Escolha uma conversa à esquerda.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Conversa({
  conversa,
  thread,
  ehCliente,
  onVoltar,
}: {
  conversa: ConversaDaLista;
  thread: MensagemDaThread[];
  ehCliente: boolean;
  onVoltar: () => void;
}) {
  const fim = useRef<HTMLDivElement | null>(null);

  /* ROLA PARA O FIM ao abrir e a cada mensagem nova. Uma conversa que
     abre no topo obriga a rolar até embaixo para ler o que importa —
     que é sempre a última linha. */
  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [conversa.id, thread.length]);

  /* Zera o contador ao abrir. Em efeito e não no clique porque também
     vale para quem chegou pela URL direta. A action ignora quem não é
     dono do número — ver `marcarComoLida`. */
  useEffect(() => {
    if (conversa.nao_lidas > 0) void marcarComoLida(conversa.id);
  }, [conversa.id, conversa.nao_lidas]);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <button
          type="button"
          onClick={onVoltar}
          aria-label="Voltar para a lista"
          className="-ml-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground sm:hidden"
        >
          <ArrowLeft className="size-4" />
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {conversa.nome ?? telefone(conversa.jid) ?? "Sem nome"}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {conversa.eh_grupo ? "Grupo" : telefone(conversa.jid)}
          </p>
        </div>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto bg-surface-2/30 p-3">
        {thread.map((m) => (
          <Balao key={m.id} msg={m} />
        ))}
        <div ref={fim} />
      </div>

      {ehCliente ? (
        <Composer conversaId={conversa.id} />
      ) : (
        <p className="flex items-center gap-1.5 border-t border-hairline px-3 py-2.5 text-2xs text-muted-foreground">
          <Eye className="size-3 shrink-0" />
          Somente leitura — quem responde por este número é a empresa.
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Balao({ msg }: { msg: MensagemDaThread }) {
  const minha = msg.de_mim;

  return (
    <div className={cn("flex", minha ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[min(32rem,85%)] rounded-xl px-2.5 py-1.5 text-xs leading-relaxed",
          minha
            ? "rounded-br-sm bg-signal/15 ring-1 ring-signal/20"
            : "rounded-bl-sm bg-surface-1 ring-1 ring-hairline",
        )}
      >
        <Midia msg={msg} />

        {msg.texto && <p className="whitespace-pre-wrap break-words">{msg.texto}</p>}

        {!msg.texto && !msg.midia_url && (
          <p className="italic text-muted-foreground">{rotuloSemTexto(msg.tipo)}</p>
        )}

        <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] tabular-nums text-muted-foreground">
          {hora(msg.enviada_em)}
          {minha && <Check className="size-2.5" />}
        </p>
      </div>
    </div>
  );
}

/**
 * O anexo, quando ele existe de verdade.
 *
 * `midia_url` nula com `tipo` de mídia significa que o arquivo não pôde
 * ser baixado da Evolution — ver `guardarMidia`. A mensagem continua na
 * thread, com o rótulo do tipo: saber que chegou um áudio às 14h02 vale
 * mais do que um buraco na conversa.
 */
function Midia({ msg }: { msg: MensagemDaThread }) {
  if (!msg.midia_url) return null;

  if (msg.tipo === "imagem" || msg.tipo === "sticker") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={msg.midia_url}
        alt={msg.midia_nome ?? "Imagem recebida"}
        className="mb-1 max-h-72 w-auto rounded-lg"
      />
    );
  }

  if (msg.tipo === "audio") {
    return <audio controls src={msg.midia_url} className="mb-1 h-8 w-56 max-w-full" />;
  }

  if (msg.tipo === "video") {
    return (
      <video controls src={msg.midia_url} className="mb-1 max-h-72 w-auto rounded-lg" />
    );
  }

  return (
    <a
      href={msg.midia_url}
      target="_blank"
      rel="noopener noreferrer"
      className="mb-1 flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1.5 text-2xs transition-colors hover:bg-accent"
    >
      <FileText className="size-3.5 shrink-0" />
      <span className="truncate">{msg.midia_nome ?? "Arquivo"}</span>
    </a>
  );
}

function rotuloSemTexto(tipo: string): string {
  const mapa: Record<string, string> = {
    imagem: "Imagem (não foi possível baixar)",
    audio: "Áudio (não foi possível baixar)",
    video: "Vídeo (não foi possível baixar)",
    documento: "Documento (não foi possível baixar)",
    sticker: "Figurinha",
    localizacao: "Localização enviada",
    contato: "Contato enviado",
  };
  return mapa[tipo] ?? "Mensagem sem texto";
}

/* ------------------------------------------------------------------ */

function Composer({ conversaId }: { conversaId: string }) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [enviando, iniciar] = useTransition();

  function enviar() {
    const corpo = texto.trim();
    if (!corpo) return;

    iniciar(async () => {
      const r = await enviarMensagem({ conversaId, texto: corpo });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      /* Limpa só depois do ok. Limpar antes perderia o texto digitado
         quando o número está desconectado — e é justamente aí que a
         pessoa vai querer copiar e mandar pelo celular. */
      setTexto("");
      router.refresh();
    });
  }

  return (
    <div className="flex items-end gap-2 border-t border-hairline p-2">
      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          /* Enter envia, Shift+Enter quebra linha — é o que o WhatsApp
             faz, e a memória muscular vem de lá. */
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            enviar();
          }
        }}
        placeholder="Escreva uma mensagem…"
        rows={1}
        className="max-h-32 min-h-9 flex-1 resize-none py-2 text-xs"
      />
      <Button
        size="icon"
        onClick={enviar}
        disabled={enviando || !texto.trim()}
        aria-label="Enviar mensagem"
      >
        <Send className="size-3.5" />
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** `5547999998888@s.whatsapp.net` → `+55 47 99999-8888`. */
function telefone(jid: string): string | null {
  if (jid.endsWith("@g.us")) return null;

  const d = jid.split("@")[0].replace(/\D/g, "");
  if (d.length < 12 || d.length > 13) return d ? `+${d}` : null;

  const resto = d.slice(4);
  return resto.length === 9
    ? `+${d.slice(0, 2)} ${d.slice(2, 4)} ${resto.slice(0, 5)}-${resto.slice(5)}`
    : `+${d.slice(0, 2)} ${d.slice(2, 4)} ${resto.slice(0, 4)}-${resto.slice(4)}`;
}

const HORA = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

const DIA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function hora(iso: string): string {
  return HORA.format(new Date(iso));
}

/**
 * Hora para hoje, data para o resto.
 *
 * FUSO FIXO em São Paulo nos dois formatadores. Sem ele, o servidor
 * (UTC na Vercel) e o navegador renderizariam horas diferentes para a
 * mesma mensagem — divergência de hidratação, e um horário errado numa
 * conversa é o tipo de erro que ninguém desconfia.
 */
function quando(iso: string): string {
  const data = new Date(iso);
  return DIA.format(data) === DIA.format(new Date()) ? hora(iso) : DIA.format(data);
}
