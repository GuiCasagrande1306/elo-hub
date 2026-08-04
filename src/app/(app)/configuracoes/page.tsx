import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck, ShieldX } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { getClients, getTeam } from "@/lib/data";
import { getCurrentUser } from "@/lib/supabase/server";
import { initials } from "@/lib/format";
import { isDemoMode } from "@/lib/env";
import { cn } from "@/lib/utils";
import { getSessionStatus } from "@/lib/whatsapp/session";
import { WhatsAppCard } from "./whatsapp-card";

export const metadata: Metadata = { title: "Configurações" };

/**
 * Equipe e permissões.
 *
 * A página é restrita a admin — mas isso é conveniência de navegação. O
 * que realmente protege os dados é o RLS: um colaborador que abrisse
 * esta rota à força receberia apenas o próprio perfil, porque a policy
 * `profiles_select` não devolve as outras linhas.
 */
export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [team, clients, whatsappStatus] = await Promise.all([
    getTeam(),
    getClients(),
    getSessionStatus(user.id),
  ]);
  const isAdmin = user.role === "admin";

  return (
    <PageContainer>
      <PageHeader
        title="Configurações"
        description="Equipe, papéis de acesso e integrações."
      />

      {!isAdmin && (
        <div className="mt-6 rounded-xl border border-hairline bg-warning-muted/40 p-4">
          <p className="text-sm">
            Seu perfil é de colaborador. Você vê apenas os próprios dados —
            a restrição é aplicada no banco, não nesta tela.
          </p>
        </div>
      )}

      {/* WhatsApp pessoal ------------------------------------------
          Antes da equipe de propósito: é a única seção acionável por
          qualquer perfil, e a que a pessoa vem procurar. */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-[-0.015em]">
          Meu WhatsApp
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Cada pessoa conecta o próprio celular. As mensagens que você
          disparar saem do seu número, não de um número da agência.
        </p>

        <div className="mt-4 max-w-2xl">
          <WhatsAppCard initialStatus={whatsappStatus} />
        </div>
      </section>

      {/* Equipe ---------------------------------------------------- */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-[-0.015em]">Equipe</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Administradores enxergam toda a operação. Colaboradores enxergam
          exclusivamente as tarefas e contas atribuídas a eles.
        </p>

        <ul className="surface-card mt-4 divide-y divide-hairline overflow-hidden">
          {team.map((person) => (
            <li key={person.id} className="flex items-center gap-3 px-4 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold ring-1 ring-hairline">
                {initials(person.full_name)}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {person.full_name}
                  {person.id === user.id && (
                    <span className="ml-2 text-2xs text-muted-foreground">
                      você
                    </span>
                  )}
                </p>
                <p className="truncate text-2xs text-muted-foreground">
                  {person.job_title ?? person.email}
                </p>
              </div>

              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium",
                  person.role === "admin"
                    ? "bg-signal-muted text-signal"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {person.role === "admin" ? (
                  <ShieldCheck className="size-3" />
                ) : (
                  <ShieldX className="size-3" />
                )}
                {person.role === "admin" ? "Administrador" : "Colaborador"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Integrações ----------------------------------------------- */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold tracking-[-0.015em]">Integrações</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Contas de mídia conectadas por cliente. Os tokens ficam em
          <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
            integration_secrets
          </code>
          — tabela sem nenhuma policy de leitura, acessível só pelo backend.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {clients.map((client) => (
            <article key={client.id} className="surface-card p-4">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="size-5 shrink-0 rounded-md ring-1 ring-inset ring-black/10 dark:ring-white/10"
                  style={{ backgroundColor: client.brand_primary ?? "#8a8a8a" }}
                />
                <span className="truncate text-sm font-medium">
                  {client.name}
                </span>
              </div>

              <dl className="mt-3 flex flex-col gap-1.5 border-t border-hairline pt-3 text-xs">
                <IntegrationRow label="Meta Ads" connected={!isDemoMode} />
                <IntegrationRow label="Google Ads" connected={!isDemoMode} />
                <IntegrationRow
                  label="WhatsApp"
                  connected={Boolean(client.whatsapp_phone)}
                  detail={client.whatsapp_phone ?? undefined}
                />
              </dl>
            </article>
          ))}
        </div>
      </section>
    </PageContainer>
  );
}

function IntegrationRow({
  label,
  connected,
  detail,
}: {
  label: string;
  connected: boolean;
  detail?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1.5">
        {detail && (
          <span className="truncate text-2xs tabular-nums text-muted-foreground">
            {detail}
          </span>
        )}
        <span
          className={cn(
            "size-1.5 rounded-full",
            connected ? "bg-positive" : "bg-muted-foreground/40",
          )}
        />
        <span className={connected ? "text-positive" : "text-muted-foreground"}>
          {connected ? "conectado" : "pendente"}
        </span>
      </dd>
    </div>
  );
}
