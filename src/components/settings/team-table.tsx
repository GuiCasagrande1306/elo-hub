"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Link2,
  ShieldCheck,
  Trash2,
  User,
  UserPlus,
} from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  convidarMembro,
  removerMembro,
  setUserRole,
} from "@/app/(app)/configuracoes/equipe/actions";
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
  const [convidando, setConvidando] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {team.length} {team.length === 1 ? "pessoa" : "pessoas"} com acesso.
        </p>
        <Button size="sm" onClick={() => setConvidando(true)}>
          <UserPlus className="size-3.5" />
          Convidar pessoa
        </Button>
      </div>

      <div className="surface-card overflow-hidden">
      <div className="hidden grid-cols-[1fr_200px_180px_2rem] gap-4 border-b border-hairline px-4 py-2.5 md:grid">
        {["Pessoa", "E-mail", "Acesso", ""].map((l, i) => (
          <span key={i} className="eyebrow">
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

      <ConviteDialog aberto={convidando} onFechar={() => setConvidando(false)} />
    </div>
  );
}

function TeamRow({ pessoa, ehVoce }: { pessoa: Profile; ehVoce: boolean }) {
  const router = useRouter();
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
    <li className="grid grid-cols-1 items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[1fr_200px_180px_2rem]">
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

      {/* REMOVER NÃO APARECE PARA VOCÊ MESMO. Apagar o próprio acesso
          deixaria a sessão viva sobre um usuário que não existe mais —
          e, se fosse o último admin, a agência sem ninguém capaz de
          promover. A action barra também. */}
      {ehVoce ? (
        <span />
      ) : (
        <button
          type="button"
          disabled={salvando}
          aria-label={`Remover o acesso de ${pessoa.full_name}`}
          onClick={() => {
            if (
              !window.confirm(
                `Remover o acesso de ${pessoa.full_name || pessoa.email}? Ela deixa de entrar imediatamente. O que ela registrou nas contas fica.`,
              )
            ) {
              return;
            }
            startTransition(async () => {
              const r = await removerMembro(pessoa.id);
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              toast.success("Acesso removido.");
              router.refresh();
            });
          }}
          className="justify-self-end rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Convidar alguém da agência.
 *
 * O QUE SAI DAQUI É UM LINK, não uma senha — mesmo caminho do acesso de
 * cliente, e pelo mesmo motivo: senha mandada em mensageiro fica lá para
 * sempre, e o convite por e-mail depende de um SMTP que este projeto não
 * tem garantido. O link aparece na tela, com botão de copiar, e quem
 * manda é a pessoa que está convidando.
 */
function ConviteDialog({
  aberto,
  onFechar,
}: {
  aberto: boolean;
  onFechar: () => void;
}) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<"admin" | "collaborator">("collaborator");
  const [gerado, setGerado] = useState<{ link: string; reenvio: boolean } | null>(
    null,
  );
  const [salvando, iniciar] = useTransition();

  function fechar() {
    setNome("");
    setEmail("");
    setPapel("collaborator");
    setGerado(null);
    onFechar();
  }

  function convidar() {
    if (!nome.trim()) return toast.error("Escreva o nome da pessoa.");
    if (!email.trim()) return toast.error("Informe o e-mail.");

    iniciar(async () => {
      const r = await convidarMembro({ fullName: nome, email, role: papel });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      setGerado({ link: r.link, reenvio: r.reenvio });
      router.refresh();
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {gerado ? "Pronto — mande este link" : "Convidar pessoa"}
          </DialogTitle>
          <DialogDescription>
            {gerado
              ? gerado.reenvio
                ? "Essa pessoa já tem acesso. Este link serve para ela definir uma senha nova."
                : "O acesso foi criado. Ele só existe de verdade quando ela abrir o link e escolher a senha."
              : "Ela recebe um link para escolher a própria senha."}
          </DialogDescription>
        </DialogHeader>

        {gerado ? (
          <CaixaDoLink link={gerado.link} />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="membro-nome">Nome</Label>
              <Input
                id="membro-nome"
                autoFocus
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Marina Duarte"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="membro-email">E-mail</Label>
              <Input
                id="membro-email"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="marina@marketingelo.com.br"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Nível de acesso</Label>
              <Select
                value={papel}
                onValueChange={(v) =>
                  setPapel((v as "admin" | "collaborator") ?? "collaborator")
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: string) => LABELS[v] ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="collaborator">Colaborador</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Colaborador vê a operação inteira, menos valores de contrato e
                telas de cadastro.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="flex-row justify-end gap-2">
          <Button variant="ghost" onClick={fechar} disabled={salvando}>
            {gerado ? "Fechar" : "Cancelar"}
          </Button>
          {!gerado && (
            <Button onClick={convidar} disabled={salvando}>
              {salvando ? "Criando…" : "Criar acesso"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * O link, à vista, com botão de copiar.
 *
 * `break-all` e fonte de código porque ele é longo e quem manda precisa
 * CONFERIR que copiou inteiro — link cortado no meio é o defeito mais
 * comum de convite colado em mensageiro.
 */
function CaixaDoLink({ link }: { link: string }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface-2/60 p-3">
      <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <Link2 className="size-3" />
        Uso único — abrir uma vez já consome. Se expirar, gere outro.
      </div>

      <code className="break-all font-mono text-2xs leading-relaxed">{link}</code>

      <Button
        size="sm"
        variant="secondary"
        className="w-fit"
        onClick={async () => {
          await navigator.clipboard.writeText(link);
          setCopiado(true);
          toast.success("Link copiado.");
          setTimeout(() => setCopiado(false), 2000);
        }}
      >
        {copiado ? (
          <Check className="size-3.5 text-positive" />
        ) : (
          <Copy className="size-3.5" />
        )}
        Copiar link
      </Button>
    </div>
  );
}
