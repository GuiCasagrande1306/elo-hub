"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ShieldCheck, User } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setUserRole } from "@/app/(app)/configuracoes/equipe/actions";
import { initials } from "@/lib/format";
import type { Profile } from "@/types/database";

/* =====================================================================
   Equipe e níveis de acesso
   ---------------------------------------------------------------------
   Antes disto, promover alguém exigia SQL no painel do Supabase — e a
   SQL que circula por aí escreve em `raw_user_meta_data` ou numa tabela
   `users` que não existe neste projeto. O papel mora em `profiles.role`,
   e é isto que esta tela edita.
   ===================================================================== */

const LABELS: Record<string, string> = {
  admin: "Administrador",
  collaborator: "Colaborador",
};

export function TeamTable({
  team,
  currentUserId,
}: {
  team: Profile[];
  currentUserId: string;
}) {
  return (
    <div className="surface-card overflow-hidden">
      <div className="hidden grid-cols-[1fr_200px_180px] gap-4 border-b border-hairline px-4 py-2.5 md:grid">
        {["Pessoa", "E-mail", "Acesso"].map((l) => (
          <span key={l} className="eyebrow">
            {l}
          </span>
        ))}
      </div>

      <ul className="divide-y divide-hairline">
        {team.map((pessoa) => (
          <TeamRow
            key={pessoa.id}
            pessoa={pessoa}
            ehVoce={pessoa.id === currentUserId}
          />
        ))}
      </ul>
    </div>
  );
}

function TeamRow({ pessoa, ehVoce }: { pessoa: Profile; ehVoce: boolean }) {
  const [papel, setPapel] = useState<string>(pessoa.role);
  const [salvando, startTransition] = useTransition();

  function trocar(novo: string) {
    const anterior = papel;
    setPapel(novo);

    startTransition(async () => {
      const r = await setUserRole({
        profileId: pessoa.id,
        role: novo as "admin" | "collaborator",
      });

      if (r.ok) {
        toast.success(
          `Acesso de ${pessoa.full_name} alterado para ${LABELS[novo]}.`,
        );
      } else {
        setPapel(anterior);
        toast.error(r.error);
      }
    });
  }

  return (
    <li className="grid grid-cols-1 items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[1fr_200px_180px]">
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] font-semibold ring-1 ring-hairline">
          {initials(pessoa.full_name)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            {pessoa.full_name || "Sem nome"}
            {ehVoce && (
              <span className="ml-1.5 text-2xs font-normal text-muted-foreground">
                (você)
              </span>
            )}
          </span>
          {pessoa.job_title && (
            <span className="block truncate text-2xs text-muted-foreground">
              {pessoa.job_title}
            </span>
          )}
        </span>
      </span>

      <span className="truncate text-xs text-muted-foreground">
        {pessoa.email}
      </span>

      {/* O próprio admin não se rebaixa: sem nenhum admin, a agência
          perde a capacidade de promover e o conserto volta a ser SQL. A
          action barra também — aqui é só para o controle não prometer o
          que vai recusar. */}
      <Select
        value={papel}
        onValueChange={(v) => trocar(v ?? papel)}
        disabled={salvando || ehVoce}
      >
        <SelectTrigger size="sm" className="w-full">
          <SelectValue>
            {(v: string) => (
              <span className="flex items-center gap-1.5">
                {v === "admin" ? (
                  <ShieldCheck className="size-3.5 text-signal" />
                ) : (
                  <User className="size-3.5 text-muted-foreground" />
                )}
                {LABELS[v] ?? v}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="admin">Administrador</SelectItem>
          <SelectItem value="collaborator">Colaborador</SelectItem>
        </SelectContent>
      </Select>
    </li>
  );
}
