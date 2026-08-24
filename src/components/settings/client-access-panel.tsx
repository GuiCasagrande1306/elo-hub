"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  KeyRound,
  Link2,
  LifeBuoy,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

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
  ClientSearchPicker,
  type ClienteEscolhivel,
} from "@/components/clients/client-search-picker";
import {
  atenderPedido,
  convidarCliente,
  reenviarAcesso,
  removerAcesso,
  type PedidoDeSenha,
} from "@/app/(app)/configuracoes/acessos/actions";
import { formatDateFull, initials } from "@/lib/format";

/* =====================================================================
   Convidar, reenviar, remover
   ---------------------------------------------------------------------
   O QUE ESTA TELA ENTREGA É UM LINK PARA COLAR NO WHATSAPP, e essa
   escolha manda no desenho todo. Não existe "enviar convite" que
   dispare e-mail e deixe a pessoa esperando: o convite aparece na tela,
   com um botão de copiar, e quem manda é o humano que já está no grupo
   do cliente.

   Por isso o link fica VISÍVEL depois de gerado, num bloco que não
   fecha sozinho. Um `toast` de sucesso que some em três segundos
   levaria embora a única coisa que a operação produziu.
   ===================================================================== */

interface Acesso {
  id: string;
  email: string;
  full_name: string;
  client_id: string;
  created_at: string;
}

export function ClientAccessPanel({
  acessos,
  pedidos,
  clients,
  clienteInicial,
}: {
  acessos: Acesso[];
  /** Fila do "esqueci minha senha", só os abertos. */
  pedidos: PedidoDeSenha[];
  clients: ClienteEscolhivel[];
  /** Vem de `?cliente=` — o atalho que sai do CRM já escolhe a empresa. */
  clienteInicial: string | null;
}) {
  const [convidando, setConvidando] = useState(clienteInicial !== null);

  const nomeDoCliente = useMemo(
    () => new Map(clients.map((c) => [c.id, c.name])),
    [clients],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* A FILA VEM PRIMEIRO quando tem gente nela. É o único bloco
          desta tela com prazo: do outro lado há alguém que não consegue
          entrar agora. A lista de acessos pode esperar; isto não. */}
      {pedidos.length > 0 && <Pedidos pedidos={pedidos} />}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {acessos.length === 0
            ? "Nenhum cliente com acesso ainda."
            : `${acessos.length} ${acessos.length === 1 ? "pessoa" : "pessoas"} de fora da agência.`}
        </p>

        <Button size="sm" onClick={() => setConvidando(true)}>
          <UserPlus className="size-3.5" />
          Convidar cliente
        </Button>
      </div>

      {acessos.length > 0 && (
        <div className="surface-card overflow-hidden">
          <div className="hidden grid-cols-[1fr_220px_150px] gap-4 border-b border-hairline px-4 py-2.5 md:grid">
            {["Pessoa", "Empresa", ""].map((l, i) => (
              <span key={i} className="eyebrow">
                {l}
              </span>
            ))}
          </div>

          <ul className="divide-y divide-hairline">
            {acessos.map((a) => (
              <Linha
                key={a.id}
                acesso={a}
                empresa={nomeDoCliente.get(a.client_id) ?? "Empresa removida"}
              />
            ))}
          </ul>
        </div>
      )}

      <ConviteDialog
        aberto={convidando}
        onFechar={() => setConvidando(false)}
        clients={clients}
        clienteInicial={clienteInicial}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Quem pediu senha nova e ainda não recebeu.
 *
 * UM BOTÃO SÓ, e ele faz as duas coisas: gera o link e risca da fila.
 * Separar deixaria a agência gerar e esquecer de marcar — a fila
 * encheria de pedido resolvido e pararia de ser olhada, que é o único
 * jeito de uma fila falhar.
 */
function Pedidos({ pedidos }: { pedidos: PedidoDeSenha[] }) {
  return (
    <section className="surface-card overflow-hidden">
      <header className="flex items-center gap-2 border-b border-hairline px-4 py-2.5">
        <LifeBuoy className="size-3.5 text-warning" />
        <h3 className="text-sm font-medium">
          {pedidos.length === 1
            ? "1 pessoa pediu uma senha nova"
            : `${pedidos.length} pessoas pediram senha nova`}
        </h3>
      </header>

      <ul className="divide-y divide-hairline">
        {pedidos.map((p) => (
          <LinhaDoPedido key={p.id} pedido={p} />
        ))}
      </ul>
    </section>
  );
}

function LinhaDoPedido({ pedido }: { pedido: PedidoDeSenha }) {
  const router = useRouter();
  const [ocupado, iniciar] = useTransition();
  const [link, setLink] = useState<string | null>(null);

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {pedido.nome ?? pedido.email}
          </p>
          <p className="truncate text-2xs text-muted-foreground">
            {pedido.nome ? `${pedido.email} · ` : ""}
            {pedido.empresa ?? "empresa não identificada"} ·{" "}
            {formatDateFull(pedido.created_at)}
          </p>
        </div>

        <Button
          size="sm"
          disabled={ocupado}
          onClick={() =>
            iniciar(async () => {
              const r = await atenderPedido(pedido.id);
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              if (r.dados.link) {
                setLink(r.dados.link);
              } else {
                toast.success(
                  "Esse e-mail não tem acesso ao painel. Pedido arquivado.",
                );
                router.refresh();
              }
            })
          }
        >
          <KeyRound className="size-3.5" />
          {pedido.temAcesso ? "Gerar link" : "Arquivar"}
        </Button>
      </div>

      {/* O AVISO DE E-MAIL DESCONHECIDO fica na linha, não num toast:
          quase sempre é erro de digitação, e a agência precisa LER o
          endereço para descobrir qual é o certo. */}
      {!pedido.temAcesso && (
        <p className="text-2xs text-warning">
          Nenhum acesso com esse e-mail. Provável erro de digitação — confirme
          o endereço com a pessoa antes de arquivar.
        </p>
      )}

      {link && <CaixaDoLink link={link} />}
    </li>
  );
}

/* ------------------------------------------------------------------ */

function Linha({ acesso, empresa }: { acesso: Acesso; empresa: string }) {
  const router = useRouter();
  const [ocupado, iniciar] = useTransition();
  const [link, setLink] = useState<string | null>(null);

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="grid grid-cols-1 items-center gap-x-4 gap-y-2 md:grid-cols-[1fr_220px_150px]">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] font-semibold ring-1 ring-hairline">
            {initials(acesso.full_name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">
              {acesso.full_name || "Sem nome"}
            </span>
            <span className="block truncate text-2xs text-muted-foreground">
              {acesso.email} · desde {formatDateFull(acesso.created_at)}
            </span>
          </span>
        </span>

        <span className="truncate text-xs">{empresa}</span>

        <span className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={ocupado}
            title="Gerar um link novo para esta pessoa definir a senha"
            onClick={() =>
              iniciar(async () => {
                const r = await reenviarAcesso(acesso.email);
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                setLink(r.dados);
              })
            }
          >
            <KeyRound className="size-3.5" />
            Novo link
          </Button>

          <Button
            size="icon-sm"
            variant="ghost"
            disabled={ocupado}
            aria-label={`Remover acesso de ${acesso.full_name}`}
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={() => {
              if (
                !window.confirm(
                  `Remover o acesso de ${acesso.full_name}? Ela deixa de entrar imediatamente. Os leads cadastrados ficam.`,
                )
              ) {
                return;
              }
              iniciar(async () => {
                const r = await removerAcesso(acesso.id);
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success("Acesso removido.");
                router.refresh();
              });
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </span>
      </div>

      {link && <CaixaDoLink link={link} />}
    </li>
  );
}

/* ------------------------------------------------------------------ */

function ConviteDialog({
  aberto,
  onFechar,
  clients,
  clienteInicial,
}: {
  aberto: boolean;
  onFechar: () => void;
  clients: ClienteEscolhivel[];
  clienteInicial: string | null;
}) {
  const router = useRouter();
  const [salvando, iniciar] = useTransition();

  const [escolha, setEscolha] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [gerado, setGerado] = useState<{ link: string; reenvio: boolean } | null>(
    null,
  );

  const clientId = escolha ?? clienteInicial;

  function fechar() {
    setEscolha(null);
    setNome("");
    setEmail("");
    setGerado(null);
    onFechar();
  }

  function convidar() {
    if (!clientId) return toast.error("Escolha a empresa.");
    if (!nome.trim()) return toast.error("Escreva o nome de quem vai acessar.");
    if (!email.trim()) return toast.error("Informe o e-mail.");

    iniciar(async () => {
      const r = await convidarCliente({ clientId, fullName: nome, email });

      if (!r.ok) {
        toast.error(r.error);
        return;
      }

      setGerado({ link: r.dados.link, reenvio: r.dados.reenvio });
      router.refresh();
    });
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {gerado ? "Pronto — mande este link" : "Convidar cliente"}
          </DialogTitle>
          <DialogDescription>
            {gerado
              ? gerado.reenvio
                ? "Essa pessoa já tinha acesso. Este link serve para ela definir uma senha nova."
                : "O acesso foi criado. Ele só existe de verdade quando a pessoa abrir este link e escolher a senha."
              : "A pessoa vai enxergar apenas o CRM desta empresa."}
          </DialogDescription>
        </DialogHeader>

        {gerado ? (
          <CaixaDoLink link={gerado.link} />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Empresa</Label>
              <ClientSearchPicker
                clients={clients}
                value={clientId}
                onChange={setEscolha}
                className="w-full"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="acesso-nome">Nome de quem vai acessar</Label>
              <Input
                id="acesso-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Pedro Henrique"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="acesso-email">E-mail</Label>
              <Input
                id="acesso-email"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="pedro@empresadocliente.com.br"
              />
              <p className="text-[10px] text-muted-foreground">
                É com ele que a pessoa entra. Não precisa ser um e-mail que ela
                leia — o convite vai pelo WhatsApp.
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

/* ------------------------------------------------------------------ */

/**
 * O link, à vista, com um botão de copiar.
 *
 * `break-all` e fonte de código porque ele é longo e a pessoa precisa
 * conseguir CONFERIR que copiou inteiro — link cortado no meio é o
 * defeito mais comum de convite colado em mensageiro.
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
          // Volta ao ícone original: o check permanente perde o sentido.
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
