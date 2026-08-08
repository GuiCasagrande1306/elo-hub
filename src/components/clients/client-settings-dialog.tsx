"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClientForm } from "@/components/clients/client-form";
import { IntegrationsCard } from "@/components/clients/integrations-card";
import type { Client, ClientSegment } from "@/types/database";
import type { IntegrationStatus } from "@/lib/data";

/* =====================================================================
   Configuração da conta — atrás de um botão
   ---------------------------------------------------------------------
   Cadastro e credenciais de mídia saíram do fluxo da página. Não é só
   arrumação: eram os dois últimos blocos de uma página que se rola para
   ler desempenho, e ficavam abertos o tempo todo — id de conta de
   anúncios, CNPJ, contato e o botão de encerrar contrato visíveis em
   qualquer olhada por cima do ombro, numa tela que se mostra em reunião
   com cliente.

   O que fica FORA daqui continua na página: logo, meta do mês e
   histórico. São coisas que se consulta junto com o desempenho, e
   escondê-las atrás de um clique só criaria atrito.

   Um diálogo, duas abas, e o conteúdo só monta quando abre — o
   `IntegrationsCard` dispara chamadas para listar contas de anúncio, e
   pagá-las em toda visita à página do cliente seria desperdício.
   ===================================================================== */

export function ClientSettingsDialog({
  client,
  integrations,
  segment,
}: {
  client: Client;
  integrations: IntegrationStatus[];
  segment: ClientSegment;
}) {
  const [aberto, setAberto] = useState(false);

  const pendentes = integrations.filter((i) => !i.connected).length;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-9"
        onClick={() => setAberto(true)}
      >
        <Settings2 className="size-4" />
        Configurar
        {/* O ponto avisa que falta vincular uma conta sem obrigar a abrir
            para descobrir. Sem conta de mídia não há número nenhum. */}
        {pendentes > 0 && (
          <span
            className="ml-0.5 size-1.5 rounded-full bg-warning"
            aria-label={`${pendentes} integração pendente`}
          />
        )}
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Configuração de {client.name}</DialogTitle>
            <DialogDescription>
              Cadastro e contas de mídia. Alterações aqui mudam o que os
              painéis medem.
            </DialogDescription>
          </DialogHeader>

          {aberto && (
            <Tabs defaultValue="integracoes" className="mt-2">
              <TabsList>
                {/* Integrações primeiro: é o que quebra a conta quando
                    está errado, e o motivo mais comum de abrir isto. */}
                <TabsTrigger value="integracoes">Contas de mídia</TabsTrigger>
                <TabsTrigger value="cadastro">Cadastro</TabsTrigger>
              </TabsList>

              <TabsContent value="integracoes" className="mt-4">
                <IntegrationsCard
                  clientId={client.id}
                  clientSlug={client.slug}
                  segment={segment}
                  integrations={integrations}
                  semMoldura
                />
              </TabsContent>

              <TabsContent value="cadastro" className="mt-4">
                <ClientForm client={client} semMoldura />
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
