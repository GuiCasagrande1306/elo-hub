"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageIcon, Link2, Loader2, Paperclip, Play, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { classificarArte, ehArteDoPainel } from "@/lib/social/media";
import { assinarArtes, enviarArte } from "@/app/(app)/midias-sociais/actions";

/* =====================================================================
   Anexo da arte
   ---------------------------------------------------------------------
   Antes daqui havia uma <textarea> de links, uma URL por linha, com o
   aviso "o sistema não guarda a arte". Guardava o endereço de um arquivo
   que morava no Drive — e o cliente que ia aprovar esbarrava no pedido
   de permissão do Drive, que é o atrito mais comum na hora de aprovar
   uma peça.

   Agora o arquivo sobe para um bucket privado e a miniatura aparece
   aqui. O campo de link continua, embaixo: vídeo acima de 50MB e material
   que já vive em outro lugar não precisam ser duplicados.

   A MINIATURA É O PONTO. Uma lista de sete URLs de 80 caracteres não diz
   qual arte é qual; sete quadradinhos dizem na hora — e é por isso que a
   ordem também importa: num carrossel, é a ordem dos slides.
   ===================================================================== */

interface Props {
  clientId: string | null;
  valores: string[];
  onChange: (valores: string[]) => void;
  disabled?: boolean;
}

export function ArtUploader({ clientId, valores, onChange, disabled }: Props) {
  const [enviando, setEnviando] = useState(0);
  const [previas, setPrevias] = useState<Record<string, string>>({});
  const [link, setLink] = useState("");
  const [sobrevoando, setSobrevoando] = useState(false);
  const inputArquivo = useRef<HTMLInputElement>(null);

  /* Assina o que veio do banco. Sem isto, editar uma peça já salva mostra
     quadrados vazios no lugar da arte que já estava anexada — e a pessoa
     conclui que perdeu o arquivo. */
  useEffect(() => {
    const pendentes = valores.filter(
      (v) => ehArteDoPainel(v) && !previas[v] && !v.startsWith("data:"),
    );
    if (pendentes.length === 0) return;

    let ativo = true;
    assinarArtes(pendentes).then((r) => {
      if (ativo && r.ok) setPrevias((atual) => ({ ...atual, ...r.dados }));
    });
    return () => {
      ativo = false;
    };
  }, [valores, previas]);

  const enviarArquivos = useCallback(
    async (arquivos: File[]) => {
      if (!clientId) {
        toast.error("Escolha o cliente antes de anexar a arte.");
        return;
      }

      setEnviando((n) => n + arquivos.length);
      let acumulado = valores;

      /* Sequencial, não em paralelo: são arquivos grandes, e disparar
         seis uploads de 30MB de uma vez satura a subida de quem está
         num escritório comum — todos ficam lentos e algum estoura. */
      for (const arquivo of arquivos) {
        const form = new FormData();
        form.append("arquivo", arquivo);
        form.append("clientId", clientId);

        const r = await enviarArte(form);
        setEnviando((n) => n - 1);

        if (!r.ok) {
          toast.error(r.error);
          continue;
        }

        setPrevias((atual) => ({ ...atual, [r.dados.caminho]: r.dados.url }));

        /* ACUMULADOR LOCAL, e não `[...valores, novo]` a cada volta.
           `valores` é a lista do render em que este callback nasceu:
           anexar três arquivos de uma vez gravaria só o último, porque
           cada volta partiria da mesma lista antiga. O acumulador
           carrega o que já entrou nesta rodada.

           E também não um ref espelhando a prop — o compilador do React
           recusa modificar valor passado a hook, com razão: seria estado
           paralelo ao do pai, livre para divergir. */
        acumulado = [...acumulado, r.dados.caminho];
        onChange(acumulado);
      }
    },
    [clientId, onChange, valores],
  );

  function remover(valor: string) {
    onChange(valores.filter((v) => v !== valor));
  }

  function adicionarLink() {
    const limpo = link.trim();
    if (!limpo) return;

    if (!/^https?:\/\//i.test(limpo)) {
      toast.error("O link precisa começar com http:// ou https://");
      return;
    }
    if (valores.includes(limpo)) {
      toast.error("Esse link já está na lista.");
      return;
    }

    onChange([...valores, limpo]);
    setLink("");
  }

  return (
    <div className="flex flex-col gap-2">
      {valores.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {valores.map((valor) => {
            const arte = classificarArte(valor);
            const previa = previas[valor] ?? (valor.startsWith("data:") ? valor : null);
            const ehImagem =
              arte.tipo === "imagem" || (previa?.startsWith("data:image") ?? false);

            return (
              <li
                key={valor}
                className="group relative size-16 overflow-hidden rounded-lg border border-hairline bg-surface-2"
                title={arte.nome}
              >
                {previa && ehImagem ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previa}
                    alt={arte.nome}
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="flex size-full flex-col items-center justify-center gap-1 px-1 text-muted-foreground">
                    {arte.origem === "link" ? (
                      <Link2 className="size-4" />
                    ) : arte.tipo === "video" ? (
                      <Play className="size-4" />
                    ) : (
                      <ImageIcon className="size-4" />
                    )}
                    <span className="w-full truncate text-center text-[9px] leading-tight">
                      {arte.nome}
                    </span>
                  </span>
                )}

                {!disabled && (
                  <button
                    type="button"
                    onClick={() => remover(valor)}
                    title={`Remover ${arte.nome}`}
                    className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-md bg-background/85 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </li>
            );
          })}

          {enviando > 0 &&
            Array.from({ length: enviando }).map((_, i) => (
              <li
                key={`enviando-${i}`}
                className="grid size-16 place-items-center rounded-lg border border-dashed border-hairline"
              >
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </li>
            ))}
        </ul>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setSobrevoando(true);
        }}
        onDragLeave={() => setSobrevoando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setSobrevoando(false);
          if (disabled) return;
          const arquivos = Array.from(e.dataTransfer.files);
          if (arquivos.length) void enviarArquivos(arquivos);
        }}
        className={cn(
          "rounded-lg border border-dashed px-3 py-2.5 text-center transition-colors",
          sobrevoando
            ? "border-signal bg-accent"
            : "border-hairline hover:border-muted-foreground/40",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        <button
          type="button"
          onClick={() => inputArquivo.current?.click()}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {enviando > 0 && valores.length === 0 ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Paperclip className="size-3.5" />
          )}
          <span>
            Arraste a arte aqui ou{" "}
            <span className="font-medium text-foreground underline underline-offset-2">
              escolha o arquivo
            </span>
          </span>
        </button>

        <input
          ref={inputArquivo}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime"
          className="hidden"
          onChange={(e) => {
            const arquivos = Array.from(e.target.files ?? []);
            if (arquivos.length) void enviarArquivos(arquivos);
            // Limpa para o mesmo arquivo poder ser escolhido de novo.
            e.target.value = "";
          }}
        />
      </div>

      <div className="flex gap-1.5">
        <input
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              adicionarLink();
            }
          }}
          disabled={disabled}
          placeholder="ou cole um link — Drive, Dropbox…"
          className="min-w-0 flex-1 rounded-lg border border-hairline bg-transparent px-2.5 py-1.5 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground focus:border-signal"
        />
        <button
          type="button"
          onClick={adicionarLink}
          disabled={disabled || !link.trim()}
          className="shrink-0 rounded-lg border border-hairline px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          Anexar
        </button>
      </div>
    </div>
  );
}
