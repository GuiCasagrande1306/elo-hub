"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  FileDown,
  Globe,
  Link2Off,
  Pencil,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  apagarBrief,
  duplicarBrief,
  mudarStatus,
  publicarLink,
  revogarLink,
} from "@/app/(app)/conteudo/actions";
import {
  STATUS_BRIEF,
  STATUS_BRIEF_LABEL,
  type StatusBrief,
} from "@/lib/content/blocks";

/**
 * Barra de ações do documento.
 *
 * Fica fora do `.brief-doc` de propósito: usa os tokens do painel, e
 * nada aqui aparece no PDF nem no link que o cliente abre.
 *
 * O link público é montado no navegador, a partir de
 * `window.location.origin`. Vir do servidor exigiria `NEXT_PUBLIC_APP_URL`
 * correta em todo ambiente — e num deploy de preview da Vercel ela
 * aponta para produção, então o botão copiaria o endereço errado
 * justamente onde se testa antes de mandar para o cliente.
 */
export function BriefToolbar({
  briefId,
  clientId,
  titulo,
  status,
  shareToken,
  pendencias,
  ehAdmin,
}: {
  briefId: string;
  clientId: string;
  titulo: string;
  status: string;
  shareToken: string | null;
  pendencias: number;
  ehAdmin: boolean;
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  const [copiado, setCopiado] = useState(false);

  const linkPublico = shareToken
    ? `${typeof window === "undefined" ? "" : window.location.origin}/c/${shareToken}`
    : null;

  function rodar(acao: () => Promise<{ ok: boolean; error?: string }>, sucesso: string) {
    startTransition(async () => {
      const r = await acao();
      if (r.ok) {
        toast.success(sucesso);
        router.refresh();
      } else {
        toast.error(r.error ?? "Não deu certo.");
      }
    });
  }

  async function copiarLink() {
    if (!linkPublico) return;
    try {
      await navigator.clipboard.writeText(linkPublico);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* clipboard exige contexto seguro; em http:// da rede local ele
         rejeita. Mostrar o endereço é melhor que não fazer nada. */
      toast.info(linkPublico);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link href="/conteudo" />}
        >
          <ArrowLeft className="size-4" />
          Conteúdo
        </Button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            value={status}
            onValueChange={(v) =>
              rodar(
                () => mudarStatus(briefId, v as StatusBrief),
                "Status atualizado.",
              )
            }
          >
            <SelectTrigger className="w-[150px]" disabled={pendente}>
              <SelectValue>
                {(v: string) =>
                  STATUS_BRIEF_LABEL[v as StatusBrief] ?? "Status"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUS_BRIEF.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_BRIEF_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* `<a>` comum, não `<Link>`: o destino é um PDF, não uma
              rota do app — o roteador do Next não tem o que pré-buscar
              e uma navegação client-side deixaria a página em branco. */}
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <a
                href={`/api/conteudo/${briefId}/pdf`}
                target="_blank"
                rel="noopener"
              />
            }
          >
            <FileDown className="size-4" />
            PDF
          </Button>

          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={`/conteudo/${briefId}/editar`} />}
          >
            <Pencil className="size-4" />
            Editar
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={pendente}
            /* Duplica para o MESMO cliente. Trocar de cliente é uma
               edição do documento novo, não uma escolha escondida num
               menu — a cópia entra como rascunho justamente para ser
               revisada antes de virar entrega. */
            onClick={() =>
              rodar(
                () => duplicarBrief(briefId, clientId),
                "Cópia criada como rascunho.",
              )
            }
          >
            <Copy className="size-4" />
            Duplicar
          </Button>

          {ehAdmin ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={pendente}
              onClick={() => {
                if (
                  !confirm(
                    `Apagar "${titulo}"? Isso não volta. Para tirar da lista sem perder, use o status Arquivado.`,
                  )
                ) {
                  return;
                }
                startTransition(async () => {
                  const r = await apagarBrief(briefId);
                  if (r.ok) {
                    toast.success("Documento apagado.");
                    router.push("/conteudo");
                  } else {
                    toast.error(r.error ?? "Não deu certo.");
                  }
                });
              }}
            >
              <Trash2 className="size-4 text-destructive" />
            </Button>
          ) : null}
        </div>
      </div>

      {/* ---- Link público ---- */}
      <div className="surface-card flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
        <Globe className="size-4 shrink-0 text-muted-foreground" />

        {linkPublico ? (
          <>
            <code className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {linkPublico}
            </code>
            <Button size="sm" variant="outline" onClick={copiarLink}>
              {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copiado ? "Copiado" : "Copiar"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pendente}
              onClick={() => {
                if (
                  !confirm(
                    "Revogar o link? Quem já tem o endereço salvo deixa de abrir o documento.",
                  )
                ) {
                  return;
                }
                rodar(() => revogarLink(briefId), "Link revogado.");
              }}
            >
              <Link2Off className="size-4" />
              Revogar
            </Button>
          </>
        ) : (
          <>
            <span className="min-w-0 flex-1 text-muted-foreground">
              Sem link público. Ao gerar, qualquer pessoa com o endereço
              abre o documento em modo leitura, sem login.
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={pendente}
              onClick={() =>
                startTransition(async () => {
                  const r = await publicarLink(briefId);
                  if (r.ok) {
                    toast.success("Link gerado.");
                    router.refresh();
                  } else {
                    toast.error(r.error ?? "Não deu certo.");
                  }
                })
              }
            >
              Gerar link
            </Button>
          </>
        )}
      </div>

      {/* O aviso vem DEPOIS do link de propósito: é o último item antes
          do documento, no caminho de quem vai mandar para o cliente. */}
      {pendencias > 0 ? (
        <p className="flex items-center gap-2 text-xs text-warning">
          <AlertTriangle className="size-3.5 shrink-0" />
          {pendencias}{" "}
          {pendencias === 1
            ? "dado ainda precisa ser confirmado com o cliente"
            : "dados ainda precisam ser confirmados com o cliente"}{" "}
          antes de gravar — estão marcados em amarelo no texto.
        </p>
      ) : null}
    </div>
  );
}
