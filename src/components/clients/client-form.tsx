"use client";

import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { saveClientProfile } from "@/app/(app)/clientes/actions";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WhatsAppDestinationPicker } from "./whatsapp-destination-picker";
import {
  CLIENT_SEGMENTS,
  EDITABLE_STATUSES,
  FIELD_TAB,
  OPTIMIZATION_DAYS,
  SEGMENT_LABELS,
  STATUS_LABELS,
  clientFormSchema,
  type ClientFormValues,
} from "@/lib/validation/client";
import { cn } from "@/lib/utils";
import type { Client } from "@/types/database";

/* =====================================================================
   Cadastro completo da conta
   ---------------------------------------------------------------------
   Um formulário, um schema, um botão de salvar. Antes os campos estavam
   espalhados em blocos com salvamentos independentes, e dois deles —
   `status` e `agency_partner` — não tinham tela nenhuma: dava para
   filtrar a listagem por eles e não dava para mudá-los.

   ABAS SÃO ORGANIZAÇÃO, NÃO FRONTEIRA. A validação é do cadastro
   inteiro, e o erro de um campo escondido precisa aparecer mesmo com
   outra aba aberta — senão o botão recusa salvar e nada na tela explica
   por quê. Daí o ponto vermelho no gatilho da aba, alimentado por
   `FIELD_TAB`.

   O SLUG NÃO ESTÁ AQUI. É a URL da conta, já saiu em link e em PDF
   entregue. O nome, sim: corrigir um nome digitado errado é necessidade
   real e não quebra referência nenhuma.
   ===================================================================== */

const NENHUM = "__nenhum__";

export function ClientForm({
  client,
  /* Dentro do diálogo o card viraria caixa dentro de caixa, e o título
     repetiria o do próprio diálogo. */
  semMoldura = false,
  agencias,
}: {
  client: Client;
  semMoldura?: boolean;
  /** Vem do cadastro, não de uma lista fixa no código. */
  agencias: string[];
}) {
  const router = useRouter();
  const [aba, setAba] = useState<"perfil" | "operacional">("perfil");
  const [enviando, startTransition] = useTransition();

  /* Cadastro + o que este cliente já tem. Ver a nota no `SelectContent`. */
  const opcoesDeAgencia = useMemo(() => {
    const atual = client.agency_partner?.trim();
    return atual && !agencias.includes(atual) ? [...agencias, atual] : agencias;
  }, [agencias, client.agency_partner]);

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    mode: "onBlur",
    defaultValues: {
      clientId: client.id,
      name: client.name,
      legalName: client.legal_name ?? "",
      segment: client.segment,
      /* Conta encerrada abre como "Pausado": `churned` não é opção do
         formulário, e cair num valor fora da lista deixaria o select
         vazio. Reabrir de verdade é o botão em Fim do contrato. */
      status:
        client.status === "churned"
          ? "paused"
          : (client.status as ClientFormValues["status"]),
      /* A AGÊNCIA DO CLIENTE, LITERAL. Nada de conferir contra lista.
         ------------------------------------------------------------
         Aqui havia `AGENCY_PARTNERS.includes(...) ? ... : "Elo
         Marketing"` — uma lista FIXA no código, enquanto as agências
         são cadastradas no banco. Toda parceria nova nascia fora dela.

         O estrago, medido em 24/08/2026 com "The Cave Films": o
         cadastro salvava certo, e ao reabrir a ficha o formulário
         trocava a agência por "Elo Marketing" sozinho. Parecia que não
         tinha salvo — e no salvamento seguinte, de qualquer outro
         campo, o valor errado ia junto para o banco. O cliente saía da
         cobrança da parceira e voltava a ser faturado individualmente,
         em silêncio. O comentário em `validation/client.ts` já previa
         exatamente esta falha.

         Se o nome não estiver entre as opções, quem conserta é a lista
         logo abaixo, que o acrescenta — em vez de este campo escolher
         outra agência por conta própria. */
      agencyPartner: client.agency_partner ?? "",
      website: client.website ?? "",
      contactName: client.contact_name ?? "",
      contactEmail: client.contact_email ?? "",
      whatsappPhone: client.whatsapp_phone ?? "",
      optimizationDay: client.optimization_day,
    },
  });

  /* Quais abas têm erro agora. Lido do estado do RHF a cada render, e
     não guardado em state próprio — duplicar isso daria um marcador que
     descola da validação assim que um campo é corrigido. */
  const abasComErro = new Set(
    Object.keys(form.formState.errors).map(
      (campo) => FIELD_TAB[campo as keyof ClientFormValues],
    ),
  );

  function enviar(values: ClientFormValues) {
    startTransition(async () => {
      const r = await saveClientProfile(values);

      if (!r.ok) {
        toast.error(r.error);
        for (const [campo, mensagens] of Object.entries(r.fieldErrors ?? {})) {
          form.setError(campo as keyof ClientFormValues, {
            message: mensagens[0],
          });
        }
        /* Leva à aba do primeiro erro devolvido pelo servidor. Sem isto
           o toast acusaria um problema que a pessoa não consegue ver. */
        const primeiro = Object.keys(r.fieldErrors ?? {})[0];
        if (primeiro) setAba(FIELD_TAB[primeiro as keyof ClientFormValues]);
        return;
      }

      /* A troca de nicho zerou o alvo da meta. Merece toast próprio e
         mais tempo na tela: um "Cadastro salvo." verde esconderia que
         a conta ficou sem meta. */
      if (r.metaZerada) {
        toast.warning("Nicho alterado — a meta de resultados foi zerada.", {
          description:
            "A unidade mudou e não há conversão possível. Defina o novo alvo em “Meta deste mês”.",
          duration: 8000,
        });
      } else {
        toast.success("Cadastro salvo.");
      }

      form.reset(values);
      router.refresh();
    });
  }

  return (
    <Form {...form}>
      {/* O segundo callback do `handleSubmit` roda quando a validação do
          NAVEGADOR reprova, antes de qualquer ida ao servidor. Sem ele o
          ponto vermelho aparecia na aba certa mas ninguém era levado até
          lá: quem estava em Operacional via o salvamento recusado e o
          campo culpado escondido atrás de outra aba. */}
      <form
        onSubmit={form.handleSubmit(enviar, (erros) => {
          const primeiro = Object.keys(erros)[0] as
            | keyof ClientFormValues
            | undefined;
          if (primeiro) setAba(FIELD_TAB[primeiro]);
        })}
        className={semMoldura ? undefined : "surface-card p-5"}
      >
        {!semMoldura && (
          <>
            <h2 className="text-sm font-semibold">Cadastro da conta</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Tudo que define o cliente e o que ele recebe.
            </p>
          </>
        )}

        <Tabs
          value={aba}
          onValueChange={(v) => setAba(v as "perfil" | "operacional")}
          className="mt-4"
        >
          <TabsList>
            <GatilhoAba valor="perfil" temErro={abasComErro.has("perfil")}>
              Perfil
            </GatilhoAba>
            <GatilhoAba
              valor="operacional"
              temErro={abasComErro.has("operacional")}
            >
              Operacional
            </GatilhoAba>
          </TabsList>

          {/* ---------------------------- PERFIL ------------------- */}
          <TabsContent value="perfil" className="mt-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome do cliente</FormLabel>
                    <FormControl render={<Input />} {...field} />
                    <FormDescription>
                      Aparece nos painéis e na capa do PDF. O endereço da
                      conta não muda junto.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="legalName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Razão social</FormLabel>
                    <FormControl
                      render={<Input placeholder="Opcional" />}
                      {...field}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="segment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nicho</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => v && field.onChange(v)}
                    >
                      <SelectTrigger>
                        <SelectValue>
                          {(v: string) =>
                            SEGMENT_LABELS[v as keyof typeof SEGMENT_LABELS]
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {CLIENT_SEGMENTS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {SEGMENT_LABELS[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Decide o template do PDF, como o resultado é chamado e
                      qual evento conta como conversão.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => v && field.onChange(v)}
                    >
                      <SelectTrigger>
                        <SelectValue>
                          {(v: string) =>
                            STATUS_LABELS[v as keyof typeof STATUS_LABELS]
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {EDITABLE_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Contrato encerrado não é status: use Fim do contrato,
                      abaixo.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="agencyPartner"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Agência responsável</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) => v && field.onChange(v)}
                    >
                      <SelectTrigger>
                        <SelectValue>{(v: string) => v}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {/* O VALOR ATUAL SEMPRE ESTÁ NA LISTA. Uma
                            agência apagada do cadastro, ou renomeada,
                            deixaria o seletor em branco — e um seletor
                            em branco convida a escolher outra coisa,
                            que é como um cliente troca de agência sem
                            ninguém decidir. */}
                        {opcoesDeAgencia.map((a) => (
                          <SelectItem key={a} value={a}>
                            {a}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      &quot;Elo Marketing&quot; é conta própria; as demais são
                      terceirização.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="website"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Site</FormLabel>
                    <FormControl
                      render={<Input placeholder="https://" />}
                      {...field}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="contactName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pessoa de contato</FormLabel>
                    <FormControl render={<Input />} {...field} />
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="contactEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-mail do contato</FormLabel>
                    <FormControl
                      render={<Input inputMode="email" />}
                      {...field}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </TabsContent>

          {/* -------------------------- OPERACIONAL ---------------- */}
          <TabsContent value="operacional" className="mt-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="optimizationDay"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Dia de otimização</FormLabel>
                    <Select
                      value={field.value ? String(field.value) : NENHUM}
                      onValueChange={(v) =>
                        field.onChange(v === NENHUM ? null : Number(v))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue>
                          {(v: string) =>
                            v === NENHUM
                              ? "Sem rotina"
                              : (OPTIMIZATION_DAYS.find((d) => d.value === v)
                                  ?.label ?? "Sem rotina")
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NENHUM}>Sem rotina</SelectItem>
                        {OPTIMIZATION_DAYS.map((d) => (
                          <SelectItem key={d.value} value={d.value}>
                            {d.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Dia da semana em que esta conta entra na esteira.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* O DIA DO RELATÓRIO SAIU DAQUI, de propósito.
                  ------------------------------------------------------
                  Duas telas escreviam o mesmo agendamento com visões
                  diferentes dele. Esta conhecia `report_enabled` e
                  `report_day`; a de /relatorios conhece também
                  `report_weekday`, a agenda semanal. Cliente com
                  cadência SEMANAL tem, por definição, `report_day` nulo
                  — e a validação daqui exigia o dia sempre que o envio
                  estivesse ligado. Resultado medido: depois de marcar um
                  cliente como semanal, salvar QUALQUER campo do cadastro
                  dele (site, contato, status) passava a devolver "Escolha
                  o dia do mês para o envio automático", num campo que
                  para ele está corretamente vazio.

                  A agenda agora tem um dono só: a tabela "Agenda de
                  envio", em /relatorios, que resolve destino, cadência e
                  dia na mesma linha. */}

              <FormField
                control={form.control}
                name="whatsappPhone"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>WhatsApp de destino</FormLabel>
                    <WhatsAppDestinationPicker
                      value={field.value}
                      onChange={field.onChange}
                    />
                    <FormDescription>
                      Escolha o grupo pelo nome — o ID é gravado
                      automaticamente.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <p className="text-2xs text-muted-foreground sm:col-span-2">
                O envio automático do relatório — se está ligado, em que
                cadência e em que dia — fica em{" "}
                <span className="font-medium text-foreground">
                  Relatórios → Agenda de envio
                </span>
                . O WhatsApp acima é o destino que aquela tela usa.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-6 flex items-center justify-end gap-3 border-t border-hairline pt-4">
          {form.formState.isDirty && !enviando && (
            <span className="text-2xs text-muted-foreground">
              Alterações não salvas.
            </span>
          )}
          <Button type="submit" size="sm" disabled={enviando}>
            {enviando ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            {enviando ? "Salvando…" : "Salvar cadastro"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

/**
 * Gatilho de aba com marcador de erro.
 *
 * O ponto é redundante com a cor por decisão: cor sozinha não chega a
 * quem não distingue vermelho, e a aba fechada é justamente onde o erro
 * fica invisível.
 */
function GatilhoAba({
  valor,
  temErro,
  children,
}: {
  valor: string;
  temErro: boolean;
  children: React.ReactNode;
}) {
  return (
    <TabsTrigger value={valor} className={cn(temErro && "text-negative")}>
      {children}
      {temErro && (
        <AlertCircle
          className="size-3 text-negative"
          aria-label="Esta aba tem campos com erro"
        />
      )}
    </TabsTrigger>
  );
}
