"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, Loader2 } from "lucide-react";

import { createTask } from "@/app/(app)/tarefas/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { STATUS_LABELS } from "@/components/tasks/task-meta";
import { formatDate } from "@/lib/format";
import type { TaskWithRelations } from "@/types/database";

/** "Nova tarefa" do topo: cria já ligada ao cliente. O resto se edita em Tarefas. */
export function NovaTarefa({
  clientId,
  children,
}: {
  clientId: string;
  children: (abrir: () => void) => React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [salvando, iniciar] = useTransition();

  return (
    <>
      {children(() => {
        setTitulo("");
        setAberto(true);
      })}
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nova tarefa</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              iniciar(async () => {
                const r = await createTask({ title: titulo.trim(), clientId });
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success("Tarefa criada. Responsável e prazo se definem em Tarefas.");
                setAberto(false);
              });
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nova-tarefa">Título</Label>
              <Input
                id="nova-tarefa"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Subir campanha de sofás"
                maxLength={200}
                autoFocus
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setAberto(false)} disabled={salvando}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" disabled={salvando || titulo.trim().length < 2}>
                {salvando && <Loader2 className="size-3.5 animate-spin" />}
                Criar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Tarefas abertas do cliente (Resumo). */
export function TarefasAbertas({ tarefas }: { tarefas: TaskWithRelations[] }) {
  const abertas = tarefas.filter((t) => t.status !== "done");
  return (
    <section className="surface-card p-5">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Tarefas abertas</h2>
        <Link href="/tarefas" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          Ver todas <ArrowRight className="size-3" />
        </Link>
      </header>
      {abertas.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma tarefa aberta.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {abertas.slice(0, 6).map((t) => (
            <li key={t.id} className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate">{t.title}</span>
                <span className="text-2xs text-muted-foreground">
                  {STATUS_LABELS[t.status]}
                  {t.assignees.length > 0 && ` · ${t.assignees.map((a) => a.full_name).join(", ")}`}
                </span>
              </span>
              {t.due_date && (
                <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                  {formatDate(`${t.due_date.slice(0, 10)}T12:00:00`)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
