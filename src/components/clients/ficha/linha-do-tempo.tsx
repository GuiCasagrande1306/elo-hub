"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

import {
  apagarDaLinhaDoTempo,
  registrarNaLinhaDoTempo,
} from "@/app/(app)/clientes/ficha-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EntradaDaLinhaDoTempo } from "@/types/database";

type Tipo = EntradaDaLinhaDoTempo["kind"];

const TIPOS: { valor: Tipo; rotulo: string; classe: string }[] = [
  { valor: "reuniao", rotulo: "Reunião", classe: "bg-signal/15 text-signal" },
  { valor: "mensagem", rotulo: "Mensagem importante", classe: "bg-warning-muted text-warning" },
  { valor: "decisao", rotulo: "Decisão", classe: "bg-positive-muted text-positive" },
];

function hojeBR(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/** O formulário de registro, sem diálogo. Usado aqui e no Painel do CS. */
export function FormularioDaLinhaDoTempo({
  clientId,
  tipoInicial = "reuniao",
  onPronto,
}: {
  clientId: string;
  tipoInicial?: Tipo;
  onPronto: () => void;
}) {
  const [tipo, setTipo] = useState<Tipo>(tipoInicial);
  const [dia, setDia] = useState(hojeBR);
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [salvando, iniciar] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const r = await registrarNaLinhaDoTempo({
            clientId,
            occurredOn: dia,
            kind: tipo,
            title: titulo,
            body: texto,
          });
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          toast.success("Registrado na linha do tempo.");
          onPronto();
        });
      }}
    >
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipo">
        {TIPOS.map((t) => (
          <button
            key={t.valor}
            type="button"
            role="radio"
            aria-checked={tipo === t.valor}
            onClick={() => setTipo(t.valor)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-hairline transition-colors",
              tipo === t.valor ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.rotulo}
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lt-dia">Dia</Label>
          <Input id="lt-dia" type="date" value={dia} onChange={(e) => setDia(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lt-titulo">Título</Label>
          <Input
            id="lt-titulo"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Reunião de resultados de outubro"
            maxLength={200}
            required
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lt-texto">O que foi falado / decidido</Label>
        <Textarea id="lt-texto" value={texto} onChange={(e) => setTexto(e.target.value)} rows={5} maxLength={5000} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onPronto} disabled={salvando}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" disabled={salvando || titulo.trim().length < 2}>
          {salvando && <Loader2 className="size-3.5 animate-spin" />}
          Registrar
        </Button>
      </div>
    </form>
  );
}

/** Botão + diálogo de registro. `tipoInicial` = "reuniao" no "Registrar reunião" do topo. */
export function RegistrarNaLinhaDoTempo({
  clientId,
  tipoInicial = "reuniao",
  children,
}: {
  clientId: string;
  tipoInicial?: Tipo;
  children: (abrir: () => void) => React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      {children(() => setAberto(true))}
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Registrar na linha do tempo</DialogTitle>
          </DialogHeader>
          {/* Montado só aberto: cada abertura começa com o formulário limpo. */}
          {aberto && (
            <FormularioDaLinhaDoTempo
              clientId={clientId}
              tipoInicial={tipoInicial}
              onPronto={() => setAberto(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SeloDoTipo({ tipo }: { tipo: Tipo }) {
  const t = TIPOS.find((x) => x.valor === tipo) ?? TIPOS[0];
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium", t.classe)}>{t.rotulo}</span>;
}

/** A linha do tempo inteira (aba) ou as últimas N (Resumo, `compacta`). */
export function LinhaDoTempo({
  clientId,
  entradas,
  compacta = false,
}: {
  clientId: string;
  entradas: EntradaDaLinhaDoTempo[];
  compacta?: boolean;
}) {
  const [apagando, iniciar] = useTransition();

  return (
    <section className="surface-card p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{compacta ? "Últimas da linha do tempo" : "Linha do tempo"}</h2>
          {!compacta && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Reuniões, mensagens importantes do grupo e decisões.
            </p>
          )}
        </div>
        {!compacta && (
          <RegistrarNaLinhaDoTempo clientId={clientId}>
            {(abrir) => (
              <Button size="sm" variant="outline" onClick={abrir}>
                <Plus className="size-3.5" />
                Registrar
              </Button>
            )}
          </RegistrarNaLinhaDoTempo>
        )}
      </header>

      {entradas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-hairline px-4 py-6 text-center text-xs text-muted-foreground">
          Nada registrado ainda.
        </p>
      ) : (
        <ol className="flex flex-col gap-4">
          {entradas.map((e) => (
            <li key={e.id} className="grid grid-cols-[4.5rem_1fr_auto] gap-3">
              <time dateTime={e.occurred_on} className="pt-0.5 text-xs tabular-nums text-muted-foreground">
                {formatDate(`${e.occurred_on}T12:00:00`)}
              </time>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <SeloDoTipo tipo={e.kind} />
                  <p className="text-sm font-medium">{e.title}</p>
                </div>
                {e.body && (
                  <p className={cn("mt-1 whitespace-pre-line text-xs text-muted-foreground", compacta && "line-clamp-2")}>
                    {e.body}
                  </p>
                )}
                {!compacta && e.autor?.full_name && (
                  <p className="mt-1 text-[10px] text-muted-foreground">Registrado por {e.autor.full_name}</p>
                )}
              </div>
              {!compacta ? (
                <button
                  type="button"
                  disabled={apagando}
                  onClick={() => {
                    if (!confirm(`Apagar "${e.title}" da linha do tempo?`)) return;
                    iniciar(async () => {
                      const r = await apagarDaLinhaDoTempo({ id: e.id });
                      if (!r.ok) toast.error(r.error);
                    });
                  }}
                  aria-label={`Apagar "${e.title}"`}
                  className="self-start rounded-md p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-negative"
                >
                  <Trash2 className="size-3.5" />
                </button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
