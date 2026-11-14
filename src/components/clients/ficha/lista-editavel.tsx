"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { removerItem, salvarItem } from "@/app/(app)/clientes/ficha-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import type { DefinicaoDeCampo, ItemDaFicha } from "@/lib/clientes/ficha";
import { cn } from "@/lib/utils";
import { CampoDoFormulario, ValorOuLink, valorLegivel } from "./campos-editaveis";

/* Cor do selo por valor de opção — categoria de regra e status de acesso. */
const TOM: Record<string, string> = {
  nao_pode: "bg-negative-muted text-negative",
  obrigatorio: "bg-warning-muted text-warning",
  preferencia: "bg-muted text-muted-foreground",
  ativo: "bg-positive-muted text-positive",
  pendente: "bg-warning-muted text-warning",
};

export function SeloDaOpcao({ def, valor }: { def: DefinicaoDeCampo; valor: string | undefined }) {
  if (!valor) return null;
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium", TOM[valor] ?? "bg-muted")}>
      {valorLegivel(def, valor)}
    </span>
  );
}

/** Formulário de um item (novo ou existente). Usado na lista e nos botões do topo. */
export function FormularioDeItem({
  clientId,
  secao,
  definicao,
  item,
  onPronto,
}: {
  clientId: string;
  secao: string;
  definicao: readonly DefinicaoDeCampo[];
  item?: ItemDaFicha;
  onPronto: () => void;
}) {
  const [rascunho, setRascunho] = useState<Record<string, string>>(() => {
    if (item) return { ...item };
    // Campo de data começa em hoje: "desde quando" quase sempre é hoje.
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    return Object.fromEntries(definicao.filter((d) => d.tipo === "data").map((d) => [d.chave, hoje]));
  });
  const [salvando, iniciar] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const r = await salvarItem({ clientId, secao, item: rascunho });
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          onPronto();
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {definicao.map((d) => (
          <CampoDoFormulario
            key={d.chave}
            def={d}
            idBase={`${secao}-${item?.id ?? "novo"}`}
            valor={rascunho[d.chave] ?? ""}
            onChange={(v) => setRascunho((r) => ({ ...r, [d.chave]: v }))}
          />
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onPronto} disabled={salvando}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={salvando}>
          {salvando && <Loader2 className="size-3.5 animate-spin" />}
          Salvar
        </Button>
      </div>
    </form>
  );
}

/** Botão que abre o formulário de item num diálogo ("Nova regra" do topo). */
export function NovoItemDialog({
  clientId,
  secao,
  definicao,
  titulo,
  children,
}: {
  clientId: string;
  secao: string;
  definicao: readonly DefinicaoDeCampo[];
  titulo: string;
  /** O botão que abre. */
  children: (abrir: () => void) => React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      {children(() => setAberto(true))}
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
          </DialogHeader>
          {aberto && (
            <FormularioDeItem
              clientId={clientId}
              secao={secao}
              definicao={definicao}
              onPronto={() => setAberto(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Lista da ficha (regras, contatos, acessos...). O primeiro campo da
 * definição é o título do item; campos com opção viram selo; o resto
 * aparece em linhas pequenas.
 */
export function ListaEditavel({
  clientId,
  secao,
  titulo,
  descricao,
  definicao,
  itens,
  rotuloDoNovo = "Adicionar",
  filtrarPor,
  vazio = "Nada registrado ainda.",
}: {
  clientId: string;
  secao: string;
  titulo: string;
  descricao?: string;
  definicao: readonly DefinicaoDeCampo[];
  itens: ItemDaFicha[] | undefined;
  rotuloDoNovo?: string;
  /** Chave de um campo com opções: vira um filtro em abas acima da lista. */
  filtrarPor?: string;
  vazio?: string;
}) {
  const [editandoId, setEditandoId] = useState<string | "novo" | null>(null);
  const [filtro, setFiltro] = useState<string | null>(null);
  const [removendo, iniciar] = useTransition();

  const lista = itens ?? [];
  const [principal, ...resto] = definicao;
  const comOpcao = resto.filter((d) => d.opcoes);
  const detalhes = resto.filter((d) => !d.opcoes);
  const defFiltro = filtrarPor ? definicao.find((d) => d.chave === filtrarPor) : undefined;
  const visiveis = filtro && filtrarPor ? lista.filter((i) => i[filtrarPor] === filtro) : lista;

  return (
    <section className="surface-card p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{titulo}</h2>
          {descricao && <p className="mt-0.5 text-xs text-muted-foreground">{descricao}</p>}
        </div>
        {editandoId !== "novo" && (
          <Button size="sm" variant="outline" onClick={() => setEditandoId("novo")}>
            <Plus className="size-3.5" />
            {rotuloDoNovo}
          </Button>
        )}
      </header>

      {defFiltro?.opcoes && lista.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label={`Filtrar por ${defFiltro.rotulo}`}>
          {[{ valor: null, rotulo: "Todas" }, ...defFiltro.opcoes].map((o) => {
            const n = o.valor ? lista.filter((i) => i[defFiltro.chave] === o.valor).length : lista.length;
            const ativo = filtro === o.valor;
            return (
              <button
                key={o.valor ?? "todas"}
                type="button"
                aria-pressed={ativo}
                onClick={() => setFiltro(o.valor)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-hairline transition-colors",
                  ativo ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {o.rotulo} ({n})
              </button>
            );
          })}
        </div>
      )}

      {editandoId === "novo" && (
        <div className="mb-4 rounded-lg bg-surface-2/50 p-4 ring-1 ring-hairline">
          <FormularioDeItem
            clientId={clientId}
            secao={secao}
            definicao={definicao}
            onPronto={() => setEditandoId(null)}
          />
        </div>
      )}

      {visiveis.length === 0 && editandoId !== "novo" ? (
        <p className="rounded-lg border border-dashed border-hairline px-4 py-6 text-center text-xs text-muted-foreground">
          {vazio}
        </p>
      ) : (
        <ul className="divide-y divide-hairline">
          {visiveis.map((item) =>
            editandoId === item.id ? (
              <li key={item.id} className="py-3">
                <FormularioDeItem
                  clientId={clientId}
                  secao={secao}
                  definicao={definicao}
                  item={item}
                  onPronto={() => setEditandoId(null)}
                />
              </li>
            ) : (
              <li key={item.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {comOpcao.map((d) => (
                      <SeloDaOpcao key={d.chave} def={d} valor={item[d.chave]} />
                    ))}
                    <p className="min-w-0 whitespace-pre-line break-words text-sm font-medium">
                      {valorLegivel(principal, item[principal.chave])}
                    </p>
                  </div>
                  {detalhes.some((d) => item[d.chave]) && (
                    <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      {detalhes
                        .filter((d) => item[d.chave])
                        .map((d) => (
                          <div key={d.chave} className="min-w-0">
                            <dt className="inline">{d.rotulo}: </dt>
                            <dd className="inline break-words text-foreground/80">
                              <ValorOuLink texto={valorLegivel(d, item[d.chave])} />
                            </dd>
                          </div>
                        ))}
                    </dl>
                  )}
                  {item.criado_por && item.criado_em && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {item.criado_por} · {formatDate(`${item.criado_em}T12:00:00`)}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => setEditandoId(item.id)}
                    aria-label={`Editar "${item[principal.chave]}"`}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={removendo}
                    onClick={() => {
                      if (!confirm(`Remover "${item[principal.chave]}"?`)) return;
                      iniciar(async () => {
                        const r = await removerItem({ clientId, secao, itemId: item.id });
                        if (!r.ok) toast.error(r.error);
                      });
                    }}
                    aria-label={`Remover "${item[principal.chave]}"`}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-negative"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}
