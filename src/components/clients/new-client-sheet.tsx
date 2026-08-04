"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { createClientAction } from "@/app/(app)/clientes/actions";
import {
  CLIENT_SEGMENTS,
  CREATABLE_STATUSES,
  SEGMENT_LABELS,
  STATUS_LABELS,
  newClientDefaults,
  newClientSchema,
  type NewClientValues,
} from "@/lib/validation/client";

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
import { WhatsAppDestinationPicker } from "./whatsapp-destination-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/* =====================================================================
   NewClientSheet
   ---------------------------------------------------------------------
   Painel lateral com o cadastro em três seções.

   Sobre o Realtime: o novo cliente aparece na listagem sozinho porque
   `ClientsDirectory` assina a tabela `clients`. A Server Action também
   chama `revalidatePath` — cinto e suspensório de propósito. Depender só
   do socket significa que um cadastro feito com a conexão instável
   simplesmente não aparece, e o usuário cadastra de novo achando que
   falhou.

   Sobre o toast: usamos `sonner`, não o `use-toast` do shadcn. O próprio
   shadcn descontinuou o `use-toast` em favor do sonner, e o projeto já
   tem o `<Toaster />` do sonner montado no layout raiz — manter os dois
   significaria dois sistemas de notificação empilhados na tela.
   ===================================================================== */

export function NewClientSheet() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Entrada e saída do schema são o mesmo tipo (ver a nota em
  // lib/validation/client.ts), então um genérico basta.
  const form = useForm<NewClientValues>({
    resolver: zodResolver(newClientSchema),
    defaultValues: newClientDefaults,
    // Valida ao sair do campo, não a cada tecla: erro aparecendo na
    // segunda letra do nome é hostil.
    mode: "onBlur",
  });

  function onSubmit() {
    const values = form.getValues();

    startTransition(async () => {
      // A action roda o MESMO schema do zero: payload de Server Action
      // é HTTP público e não pode ser confiado por ter vindo daqui.
      const result = await createClientAction(values);

      if (!result.ok) {
        // Erros por campo voltam do servidor para o formulário, em vez
        // de virarem um toast genérico que não diz onde está o problema.
        if (result.fieldErrors) {
          for (const [field, messages] of Object.entries(result.fieldErrors)) {
            form.setError(field as keyof NewClientValues, {
              message: messages[0],
            });
          }
        }
        toast.error(result.error);
        return;
      }

      toast.success("Cliente adicionado com sucesso!", {
        description: `${result.client.name} já aparece na listagem.`,
      });

      form.reset(newClientDefaults);
      setOpen(false);
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // Fechar no meio do envio deixaria o usuário sem saber se
        // gravou. O painel só destrava quando a action termina.
        if (isPending) return;
        setOpen(next);
        if (!next) form.reset(newClientDefaults);
      }}
    >
      <SheetTrigger
        render={<Button size="sm" className="h-9" />}
        nativeButton
      >
        <Plus className="size-4" />
        Novo cliente
      </SheetTrigger>

      <SheetContent
        side="right"
        showCloseButton={!isPending}
        /**
         * `data-[side=right]:w-full` e não só `w-full`.
         *
         * O SheetContent já traz `data-[side=right]:w-3/4` e
         * `data-[side=right]:sm:max-w-sm`. Classes simples NÃO
         * sobrescrevem: o `tailwind-merge` trata o prefixo de variante
         * como outra chave e mantém as duas, e a regra com variante vem
         * depois na folha de estilo.
         *
         * Sem casar a variante, o painel ficava com 293px de 390 no
         * celular e travado em 384px no desktop — apertado demais para
         * um formulário com grid de duas colunas.
         */
        className="flex w-full flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      >
        <header className="shrink-0 border-b border-hairline px-5 py-4">
          <SheetTitle className="text-base font-semibold tracking-[-0.01em]">
            Novo cliente
          </SheetTitle>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Só o nome, o nicho e o status são obrigatórios. O resto pode ser
            preenchido depois.
          </p>
        </header>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(() => onSubmit())}
            /**
             * `noValidate` é OBRIGATÓRIO aqui, não estilo.
             *
             * Há `<input type="email">` e `type="url"` no formulário —
             * corretos, porque mudam o teclado no celular. Mas eles
             * trazem junto a validação nativa do HTML5, que ao falhar
             * BLOQUEIA o submit antes de o React ver o evento. O
             * resultado: o Zod nunca roda, nenhum `FormMessage`
             * aparece, e o usuário recebe o balão do navegador — em
             * outro idioma, com outro visual, e só no primeiro campo
             * inválido.
             *
             * Com `noValidate`, a validação é inteiramente do Zod e as
             * mensagens saem no design system.
             */
            noValidate
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex-1 overflow-y-auto px-5 py-5">
              {/* ============ INFORMAÇÕES BÁSICAS ============ */}
              <SectionTitle
                title="Informações básicas"
                hint="Como a conta aparece no painel e nos relatórios."
              />

              <div className="mt-4 flex flex-col gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome da empresa *</FormLabel>
                      <FormControl
                        render={
                          <Input placeholder="Verdi Cosméticos" autoFocus />
                        }
                        {...field}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="segment"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nicho *</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={(value) =>
                            field.onChange(value ?? "ecommerce")
                          }
                        >
                          <FormControl
                            render={
                              <SelectTrigger className="w-full">
                                <SelectValue>
                                  {(value: string) =>
                                    SEGMENT_LABELS[
                                      value as (typeof CLIENT_SEGMENTS)[number]
                                    ] ?? "Selecione"
                                  }
                                </SelectValue>
                              </SelectTrigger>
                            }
                          />
                          <SelectContent>
                            {CLIENT_SEGMENTS.map((segment) => (
                              <SelectItem key={segment} value={segment}>
                                {SEGMENT_LABELS[segment]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormDescription>
                          Define o template de relatório padrão.
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
                        <FormLabel>Status *</FormLabel>
                        <Select
                          value={field.value}
                          onValueChange={(value) =>
                            field.onChange(value ?? "onboarding")
                          }
                        >
                          <FormControl
                            render={
                              <SelectTrigger className="w-full">
                                <SelectValue>
                                  {(value: string) =>
                                    STATUS_LABELS[
                                      value as (typeof CREATABLE_STATUSES)[number]
                                    ] ?? "Selecione"
                                  }
                                </SelectValue>
                              </SelectTrigger>
                            }
                          />
                          <SelectContent>
                            {CREATABLE_STATUSES.map((status) => (
                              <SelectItem key={status} value={status}>
                                {STATUS_LABELS[status]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="contactName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contato</FormLabel>
                        <FormControl
                          render={<Input placeholder="Juliana Verdi" />}
                          {...field}
                        />
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="whatsappPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Grupo do WhatsApp (relatórios)</FormLabel>
                        <WhatsAppDestinationPicker
                          value={field.value}
                          onChange={field.onChange}
                        />
                        <FormDescription>
                          Selecione o grupo onde o relatório em PDF será
                          enviado. Também aceita um número comum.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="contactEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>E-mail</FormLabel>
                        <FormControl
                          render={
                            <Input
                              type="email"
                              placeholder="contato@empresa.com.br"
                            />
                          }
                          {...field}
                        />
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
                          render={<Input placeholder="https://empresa.com.br" />}
                          {...field}
                        />
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="brandPrimary"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cor da marca</FormLabel>
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="size-9 shrink-0 rounded-lg ring-1 ring-inset ring-hairline"
                          style={{
                            background: /^#[0-9a-fA-F]{6}$/.test(
                              field.value ?? "",
                            )
                              ? field.value
                              : "var(--surface-2)",
                          }}
                        />
                        <FormControl
                          render={<Input placeholder="#2F6F4E" />}
                          {...field}
                        />
                      </div>
                      <FormDescription>
                        Usada no card, no gráfico e na capa do PDF.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* ============ METAS FINANCEIRAS ============ */}
              <Separator className="my-7" />
              <SectionTitle
                title="Metas do mês"
                hint="Vira a barra de planejado versus executado no card. Pode ficar em branco e ser definida depois."
              />

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="plannedBudget"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Orçamento planejado</FormLabel>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          R$
                        </span>
                        <FormControl
                          render={
                            <Input
                              inputMode="decimal"
                              placeholder="24.000,00"
                              className="pl-9 tabular-nums"
                            />
                          }
                          {...field}
                        />
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="plannedResults"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Meta de resultados</FormLabel>
                      <FormControl
                        render={
                          <Input
                            inputMode="numeric"
                            placeholder="260"
                            className="tabular-nums"
                          />
                        }
                        {...field}
                      />
                      <FormDescription>Leads ou vendas no mês.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* ============ INTEGRAÇÕES ============ */}
              <Separator className="my-7" />
              <SectionTitle
                title="Integrações"
                hint="Opcional. Sem elas o cliente é cadastrado, mas o sync não traz métricas."
              />

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="metaAccountId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ID da conta Meta Ads</FormLabel>
                      <FormControl
                        render={
                          <Input
                            placeholder="act_123456789"
                            className="font-mono text-xs"
                          />
                        }
                        {...field}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="googleCustomerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>ID do cliente Google Ads</FormLabel>
                      <FormControl
                        render={
                          <Input
                            placeholder="123-456-7890"
                            className="font-mono text-xs"
                          />
                        }
                        {...field}
                      />
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Os tokens de acesso são configurados à parte, em
                Configurações — eles nunca passam por este formulário.
              </p>
            </div>

            {/* ============ RODAPÉ ============ */}
            <footer className="flex shrink-0 gap-2 border-t border-hairline px-5 py-4">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                disabled={isPending}
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>

              <Button type="submit" className="flex-1" disabled={isPending}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                {isPending ? "Salvando…" : "Cadastrar cliente"}
              </Button>
            </footer>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h3 className="eyebrow">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}
