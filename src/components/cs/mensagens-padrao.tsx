"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Copy, Loader2 } from "lucide-react";

import { salvarMensagemPadrao } from "@/app/(app)/cs/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MENSAGENS_DE_FABRICA, type DiaDaMensagem } from "@/lib/cs/mensagens";
import { cn } from "@/lib/utils";

/**
 * Mensagens padrão do CS: segunda (relatório), quarta e sexta. A equipe
 * edita, salva e copia para colar no grupo do cliente. O texto salvo é
 * o mesmo para todo mundo.
 */
export function MensagensPadrao({ salvas }: { salvas: Partial<Record<DiaDaMensagem, string>> }) {
  return (
    <section className="surface-card p-5">
      <header className="mb-4">
        <h2 className="text-sm font-semibold">Mensagens padrão</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Edite, salve e copie para colar no grupo do cliente. O texto salvo vale para a equipe toda.
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-3">
        {MENSAGENS_DE_FABRICA.map((m) => (
          <Mensagem key={m.dia} dia={m.dia} titulo={m.titulo} dica={m.dica} inicial={salvas[m.dia] ?? m.texto} />
        ))}
      </div>
    </section>
  );
}

function Mensagem({ dia, titulo, dica, inicial }: { dia: DiaDaMensagem; titulo: string; dica: string; inicial: string }) {
  const [texto, setTexto] = useState(inicial);
  const [salvo, setSalvo] = useState(inicial);
  const [copiado, setCopiado] = useState(false);
  const [salvando, iniciar] = useTransition();
  const alterado = texto !== salvo;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Não consegui copiar. Selecione o texto e copie à mão.");
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-2/40 p-3 ring-1 ring-hairline">
      <div>
        <p className="text-sm font-medium">{titulo}</p>
        <p className="text-2xs text-muted-foreground">{dica}</p>
      </div>
      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={7}
        maxLength={5000}
        aria-label={`Mensagem padrão de ${titulo}`}
      />
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-2xs", alterado ? "text-warning" : "text-muted-foreground")}>
          {alterado ? "Alterado, não salvo" : "Salvo"}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!alterado || salvando}
            onClick={() =>
              iniciar(async () => {
                const r = await salvarMensagemPadrao({ dia, texto });
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                setSalvo(texto);
                toast.success("Mensagem salva.");
              })
            }
          >
            {salvando && <Loader2 className="size-3.5 animate-spin" />}
            Salvar
          </Button>
          <Button size="sm" onClick={copiar} disabled={!texto.trim()}>
            {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copiado ? "Copiado" : "Copiar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
