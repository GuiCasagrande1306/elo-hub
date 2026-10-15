"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { importarLeadMeta } from "@/app/(app)/leads/actions";

export function ImportarLeadMetaModal({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [leadgenId, setLeadgenId] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function fechar() {
    setAberto(false);
    setLeadgenId("");
    setErro(null);
  }

  function importar() {
    setErro(null);
    startTransition(async () => {
      const result = await importarLeadMeta({ clientId, leadgenId });
      if (!result.ok) {
        setErro(result.error);
      } else {
        toast.success("Lead importado e notificação enviada.");
        fechar();
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) fechar(); else setAberto(true); }}>
      <DialogTrigger>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Download className="size-3.5" />
          Importar do Meta
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Importar lead do Meta</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <p className="text-sm text-muted-foreground">
            Cole o ID do lead (leadgen_id) que aparece na biblioteca de formulários
            ou no Meta Leads Center. O lead será importado para o funil e a
            notificação será enviada para o WhatsApp configurado.
          </p>

          <div className="grid gap-1.5">
            <Label>ID do lead (leadgen_id)</Label>
            <Input
              placeholder="Ex: 1234567890123456"
              value={leadgenId}
              onChange={(e) => setLeadgenId(e.target.value.trim())}
              onKeyDown={(e) => { if (e.key === "Enter" && leadgenId) importar(); }}
            />
            <p className="text-2xs text-muted-foreground">
              No Meta Business Suite → Biblioteca de Formulários → clique no formulário
              → veja a lista de respostas → coluna "Lead ID".
            </p>
          </div>

          {erro && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={fechar} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={importar} disabled={isPending || !leadgenId}>
            {isPending ? "Importando…" : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
