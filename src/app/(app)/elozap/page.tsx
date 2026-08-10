import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Inbox } from "lucide-react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import {
  ConnectionCard,
  type ConexaoDoCliente,
} from "@/components/elozap/connection-card";
import { getClients } from "@/lib/data";
import { getCurrentUser } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { instanceNameForClient, statusDeVarias } from "@/lib/whatsapp/session";

export const metadata: Metadata = { title: "EloZap" };

/* =====================================================================
   EloZap — atendimento por WhatsApp
   ---------------------------------------------------------------------
   PRIMEIRA ENTREGA: a conexão. Um número por cliente da carteira, que é
   como a agência opera — o cliente da Verdi fala pelo número da Verdi.

   O QUE AINDA NÃO EXISTE, e a tela diz isso em vez de fingir: caixa de
   entrada, filas e distribuição entre atendentes. Nenhuma mensagem entra
   no sistema hoje, porque não há webhook escutando o `messages.upsert` da
   Evolution nem tabela onde guardar conversa.

   A ordem é essa de propósito. Uma tela de configuração de filas e
   horários construída antes do inbox seria um painel de controles que
   não roteiam nada — o mesmo defeito que já foi removido do seletor de
   período dos relatórios nesta base.

   SEM `redirect` por papel: quem enxerga a carteira pode ver o estado
   dos números. Parear e desconectar é que exigem admin, e a trava está
   na rota, não aqui.
   ===================================================================== */

export default async function EloZapPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const clients = await getClients();

  /* Um `fetchInstances` POR CONTA seria uma chamada por cliente à
     Evolution só para pintar a tela. `statusDaInstancia` já consulta a
     lista inteira, então o custo é o mesmo — mas em paralelo o
     contêiner de US$ 5 recebe 47 requisições idênticas de uma vez.
     Resolvido com uma consulta só, reaproveitada por todos. */
  const conexoes = await estadoDosNumeros(clients.map((c) => c.id));

  const conectados = conexoes.filter((c) => c.state === "open").length;

  /* A carteira da demo é fictícia; a Evolution do outro lado não é.
     Parear na demo criaria a instância `cliente-verdi` de verdade no
     Railway. A rota recusa — aqui o botão nem aparece, para o clique não
     terminar num 403 sem explicação. */
  const bloqueio = isDemoMode
    ? "Modo demo: pareamento desativado"
    : user.role !== "admin"
      ? "Só administrador conecta"
      : null;

  return (
    <PageContainer>
      <PageHeader
        title="EloZap"
        description="Atendimento por WhatsApp, um número por cliente."
      />

      <div className="mt-7 flex flex-col gap-5">
        <p className="text-sm text-muted-foreground">
          <strong className="font-medium text-foreground tabular-nums">
            {conectados} de {clients.length}
          </strong>{" "}
          {clients.length === 1 ? "conta com número" : "contas com número"}{" "}
          conectado.
        </p>

        {/* O QUE FALTA, dito na tela. Um módulo que promete atendimento e
            entrega só o pareamento precisa dizer onde está — senão
            alguém conecta o número e fica esperando mensagem aparecer. */}
        <section className="flex items-start gap-3 rounded-xl bg-surface-2/60 p-4 ring-1 ring-hairline">
          <Inbox className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 text-sm">
            <p className="font-medium">A caixa de entrada ainda não existe.</p>
            <p className="mt-1 text-muted-foreground">
              Conectar o número já vale: ele fica pareado e pronto. Mas as
              mensagens que chegarem <strong>não aparecem aqui</strong> — falta
              o webhook que recebe da Evolution e as tabelas de conversa. É a
              próxima entrega.
            </p>
          </div>
        </section>

        {clients.length === 0 ? (
          <p className="surface-card p-8 text-center text-sm text-muted-foreground">
            Nenhuma conta ativa na carteira.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {clients.map((client) => (
              <ConnectionCard
                key={client.id}
                client={client}
                inicial={
                  conexoes.find((c) => c.clientId === client.id) ?? {
                    clientId: client.id,
                    state: "absent",
                  }
                }
                bloqueio={bloqueio}
              />
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}

/**
 * Estado de todos os números, com UMA consulta à Evolution.
 *
 * O trabalho mora em `statusDeVarias`, junto do parser que entende o
 * formato da Evolution — repeti-lo aqui criaria duas cópias para
 * corrigir quando a resposta mudar de forma na próxima versão.
 */
async function estadoDosNumeros(ids: string[]): Promise<ConexaoDoCliente[]> {
  if (ids.length === 0) return [];
  /* Nenhum id da demo existe na Evolution — a consulta só gastaria uma
     ida ao Railway para devolver "sem número" quatro vezes. */
  if (isDemoMode) return [];

  try {
    const porNome = await statusDeVarias(ids.map(instanceNameForClient));

    return ids.map((clientId) => ({
      clientId,
      ...(porNome.get(instanceNameForClient(clientId)) ?? { state: "absent" as const }),
    }));
  } catch {
    /* Evolution fora do ar não pode derrubar a tela: os cartões abrem
       como "sem número" e o botão Atualizar reconsulta um a um. */
    return [];
  }
}
