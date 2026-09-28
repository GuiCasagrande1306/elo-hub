"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Copy, Link2, Loader2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  gerarLinkDoRelatorio,
  revogarLinkDoRelatorio,
} from "@/app/(app)/clientes/actions";

/* =====================================================================
   Link do relatório para o cliente
   ---------------------------------------------------------------------
   A alternativa ao PDF: em vez de mandar um arquivo fechado num
   período fixo, manda-se um endereço onde o cliente escolhe as datas.

   ⚠️ ISTO ABRE UMA PORTA SEM SENHA, e a tela precisa dizer isso. Quem
   receber o endereço vê o desempenho de mídia da conta sem login — se
   a conversa for encaminhada, quem recebeu também vê. O aviso abaixo
   não é burocracia: é a diferença entre uma decisão tomada e uma
   consequência descoberta depois.

   O ENDEREÇO SAI DE `window.location.origin`, não de uma variável de
   ambiente. Assim o link copiado aponta sempre para o domínio de onde
   a pessoa está olhando — em produção, produção; num ambiente de
   teste, o de teste. Com a variável, um link gerado no ambiente errado
   é copiado, mandado ao cliente e só falha na mão dele.
   ===================================================================== */

export function LinkDoRelatorio({ clientId }: { clientId: string }) {
  const [aberto, setAberto] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [visitas, setVisitas] = useState<number | null>(null);
  const [ultimaVisita, setUltimaVisita] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, startTransition] = useTransition();

  const url =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/relatorio/${token}`
      : null;

  /* Busca ao ABRIR, não ao montar: o painel do cliente não deve criar
     um link só porque alguém passou por ele. */
  function aoAbrir(novo: boolean) {
    setAberto(novo);
    setConfirmando(false);
    if (!novo || token) return;

    startTransition(async () => {
      const r = await gerarLinkDoRelatorio(clientId);
      if (r.ok) {
        setToken(r.token);
        setVisitas(r.viewCount);
        setUltimaVisita(r.lastViewedAt);
        setErro(null);
      } else {
        setErro(r.error);
      }
    });
  }

  async function copiar() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* Área de transferência bloqueada acontece — o campo abaixo é
         selecionável, então dá para copiar à mão. Dizer isso é melhor
         que um botão que não faz nada. */
      toast.error("O navegador bloqueou a cópia. Selecione o endereço e copie.");
    }
  }

  function revogar() {
    startTransition(async () => {
      const r = await revogarLinkDoRelatorio(clientId);
      if (r.ok) {
        setToken(null);
        setVisitas(null);
        setConfirmando(false);
        setAberto(false);
        toast.success("Link desligado.", {
          description: "Quem tiver o endereço antigo passa a ver 404.",
        });
      } else {
        toast.error(r.error);
      }
    });
  }

  return (
    <Popover open={aberto} onOpenChange={aoAbrir}>
      <PopoverTrigger
        render={
          <Button size="sm" variant="outline" className="h-9" type="button">
            <Link2 className="size-4" />
            Link do cliente
          </Button>
        }
      />

      <PopoverContent align="end" className="w-[400px] p-4">
        <p className="text-sm font-semibold">Relatório por link</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          O cliente abre no navegador e escolhe o período. Os números são
          os mesmos do PDF.
        </p>

        {ocupado && !token && (
          <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Preparando o link…
          </div>
        )}

        {erro && (
          <p className="mt-3 rounded-lg bg-negative-muted/40 px-2.5 py-2 text-2xs text-negative">
            {erro}
          </p>
        )}

        {url && (
          <>
            <div className="mt-3 flex items-center gap-2">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-hairline bg-surface-2 px-2.5 py-2 font-mono text-2xs"
              />
              <Button size="sm" type="button" onClick={copiar}>
                {copiado ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                {copiado ? "Copiado" : "Copiar"}
              </Button>
            </div>

            {/* ⚠️ O AVISO FICA JUNTO DO ENDEREÇO, não escondido num
                tooltip: é no momento de copiar que a decisão é tomada. */}
            <p className="mt-2.5 flex items-start gap-1.5 text-2xs text-warning">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" />
              Quem tiver este endereço vê o desempenho da conta, sem
              login. Se a conversa for encaminhada, quem receber também vê.
            </p>

            <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3">
              <span className="text-2xs text-muted-foreground">
                {visitas === 0
                  ? "Nunca aberto"
                  : `${visitas} ${visitas === 1 ? "abertura" : "aberturas"}`}
                {ultimaVisita && ` · último em ${formatarDia(ultimaVisita)}`}
              </span>

              {confirmando ? (
                <span className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() => setConfirmando(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    type="button"
                    disabled={ocupado}
                    onClick={revogar}
                  >
                    Desligar mesmo
                  </Button>
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  type="button"
                  onClick={() => setConfirmando(true)}
                >
                  Desligar link
                </Button>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** "12/09/2026" a partir de um timestamp. */
function formatarDia(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
