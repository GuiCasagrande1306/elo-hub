import { z } from "zod";

import { brandColorFromName } from "@/lib/brand-color";
import { parseCurrencyToCents } from "@/lib/format";
import { defaultGoalMetricFor, parseGoalInput } from "@/lib/metrics/goal-metric";

/* =====================================================================
   Schema de cadastro de cliente
   ---------------------------------------------------------------------
   Um único schema, importado pelo formulário E pela Server Action. O
   navegador valida para dar feedback imediato; o servidor valida de novo
   porque Server Action é endpoint HTTP público e o payload nunca é
   confiável só por ter saído de um componente nosso.

   O SCHEMA NÃO TRANSFORMA — de propósito.

   A tentação é fazer `"24.000,00"` virar `2400000` dentro do próprio
   schema com `.transform()`. Isso faz `z.input` e `z.output` serem tipos
   diferentes, e o `useForm` do react-hook-form passa a exigir três
   genéricos que brigam com o `zodResolver`. Pior: o valor que sai da
   validação deixa de ser o valor que a Server Action recebe, e a
   revalidação no servidor falharia contra o próprio dado transformado.

   Aqui o schema só VALIDA (tudo string, entrada = saída) e a conversão
   para centavos acontece em `toClientPayload`, explícita e testável.
   ===================================================================== */

/* Lista fixa aqui e não no banco: parceria nova é decisão comercial, e
   um enum no Postgres pediria migração a cada acordo. */
/* ⚠️ O texto aqui é CHAVE, não rótulo. Ele vai literal para
   `clients.agency_partner` e precisa casar caractere a caractere com
   `agency_contracts.agency` — que também é texto. Corrigir a grafia de
   uma parceria depois de haver cliente nela quebra o vínculo em
   silêncio: os clientes continuam apontando para o nome antigo, somem da
   cobrança da agência e não voltam a ser faturados individualmente.
   Renomear pede UPDATE nas duas tabelas, junto. */
export const AGENCY_PARTNERS = [
  "Elo Marketing",
  /* Renomeada de "Brava Hills" em 08/08/2026, junto com o UPDATE nas
     duas tabelas — `clients.agency_partner` e `agency_contracts.agency`.
     Trocar só aqui deixaria os 8 clientes apontando para um nome que a
     lista não conhece, e o formulário de cliente os empurraria para
     "Elo Marketing" no primeiro salvamento (ver o fallback em
     `client-form.tsx`), voltando a cobrá-los individualmente. */
  "Brava Reels",
  "Bagano",
  "Ampla Marketing",
  "Grupo Tasty",
  "Agência Send",
] as const;

export type AgencyPartner = (typeof AGENCY_PARTNERS)[number];

/**
 * Conta própria da Elo — cliente que a agência atende e FATURA direto.
 *
 * Os demais são terceirizados: quem paga é a agência parceira, um valor
 * só, e o cliente não gera cobrança individual.
 */
export const AGENCIA_PROPRIA: AgencyPartner = "Elo Marketing";

/**
 * Cliente atendido por agência parceira — NÃO gera cobrança própria.
 *
 * Mora aqui, e não no motor de recorrência, porque o motor é
 * `server-only` e esta regra também é lida pelo KPI de MRR e pela tela
 * de Recorrência. UMA função para todos: se a tela decidisse por conta
 * própria quem listar, os dois divergiriam no primeiro cliente que
 * trocasse de agência — a lista mostraria 27 contratos e o mês sairia
 * com 26, sem nada apontando a diferença.
 */
export function ehTerceirizado(cliente: { agency_partner: string }): boolean {
  return Boolean(cliente.agency_partner) &&
    cliente.agency_partner !== AGENCIA_PROPRIA;
}

export const CLIENT_SEGMENTS = [
  "ecommerce",
  "delivery",
  "leads",
  "local_business",
] as const;

/** Só os status que fazem sentido no cadastro — não se cria um churned. */
export const CREATABLE_STATUSES = ["active", "onboarding", "paused"] as const;

export const SEGMENT_LABELS: Record<(typeof CLIENT_SEGMENTS)[number], string> = {
  ecommerce: "E-commerce",
  delivery: "Delivery",
  leads: "Leads",
  local_business: "Negócio local",
};

/**
 * Status que se troca no formulário de edição.
 *
 * Mais amplo que `CREATABLE_STATUSES` porque `lead` é estado para onde
 * uma conta VOLTA (proposta reaberta), não estado em que ela nasce pelo
 * cadastro. E `churned` fica de fora dos dois: encerrar contrato tem
 * ação própria, com aviso e página de destino — devolvê-lo a um
 * `<select>` faria um salvamento distraído tirar a conta da carteira.
 */
export const EDITABLE_STATUSES = [
  "active",
  "onboarding",
  "paused",
  "lead",
] as const;

export const STATUS_LABELS: Record<(typeof EDITABLE_STATUSES)[number], string> =
  {
    active: "Ativo",
    onboarding: "Onboarding",
    paused: "Pausado",
    lead: "Lead",
  };

/* O parser mora em `lib/format`, junto do `formatCurrency` que o
   espelha. Re-exportado aqui porque meia dúzia de telas e actions já o
   importam deste caminho. */
export { parseCurrencyToCents };

/** Campo de texto opcional: string sempre, "" quando vazio. */
const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label}: máximo de ${max} caracteres.`);

export const newClientSchema = z.object({
  /* --- Informações básicas ----------------------------------------- */
  name: z
    .string()
    .trim()
    .min(2, "Informe o nome da empresa.")
    .max(120, "Máximo de 120 caracteres."),

  segment: z.enum(CLIENT_SEGMENTS, { message: "Selecione o nicho." }),
  /* TEXTO, não `z.enum`: a lista de agências virou cadastro e um enum
     compilado recusaria toda agência criada depois do deploy. Quem
     garante que o nome existe é a tela, que só oferece o que está
     cadastrado, e o banco, onde `agency_partner` casa com
     `agency_contracts.agency`. */
  agencyPartner: z.string().trim().min(1, {
    message: "Selecione a agência.",
  }),
  status: z.enum(CREATABLE_STATUSES, { message: "Selecione o status." }),

  /* Dia da rotina de otimização. Vazio é legítimo — conta em onboarding
     ou projeto pontual não entra na esteira semanal.

     Fica como STRING, sem `.transform`: este schema mantém entrada e
     saída idênticas (ver nota em `NewClientValues`), e transformar aqui
     faria o formulário passar string enquanto o tipo prometeria número.
     A conversão acontece em `toClientPayload`. */
  optimizationDay: z.union([z.literal(""), z.enum(["1", "2", "3", "4", "5"])]),

  contactName: optionalText(120, "Contato"),

  // União com string vazia em vez de `.optional()`: mantém o tipo como
  // `string` puro, então entrada e saída do schema são idênticas.
  contactEmail: z.union([
    z.literal(""),
    z.string().trim().email("E-mail inválido."),
  ]),

  // Formato livre: a normalização para E.164 acontece em lib/whatsapp.
  whatsappPhone: optionalText(30, "WhatsApp"),

  website: z.union([
    z.literal(""),
    z.string().trim().url("Informe a URL completa, com https://"),
  ]),

  /* --- Metas do ciclo ----------------------------------------------- */
  plannedBudget: z
    .string()
    .trim()
    .refine((value) => parseCurrencyToCents(value) !== null, {
      message: "Valor inválido. Use algo como 24.000,00",
    }),

  plannedResults: z
    .string()
    .trim()
    .refine(
      (value) =>
        value === "" || (Number.isFinite(Number(value)) && Number(value) >= 0),
      { message: "Informe um número igual ou maior que zero." },
    ),

  /* --- Integrações (opcionais) --------------------------------------- */
  // "act_123456789" ou só os dígitos — o provider normaliza o prefixo.
  metaAccountId: optionalText(40, "ID Meta"),
  // "123-456-7890" ou "1234567890" — o provider remove os hífens.
  googleCustomerId: optionalText(30, "ID Google"),
});

/** Entrada e saída são o MESMO tipo — não há transformação no schema. */
export type NewClientValues = z.infer<typeof newClientSchema>;

export const newClientDefaults: NewClientValues = {
  name: "",
  segment: "ecommerce",
  agencyPartner: "Elo Marketing",
  status: "onboarding",
  optimizationDay: "",
  contactName: "",
  contactEmail: "",
  whatsappPhone: "",
  website: "",
  plannedBudget: "",
  plannedResults: "",
  metaAccountId: "",
  googleCustomerId: "",
};

/* ------------------------------------------------------------------ */
/* Conversão para o payload da RPC                                     */
/* ------------------------------------------------------------------ */

export interface ClientRpcPayload {
  p_name: string;
  p_segment: (typeof CLIENT_SEGMENTS)[number];
  p_status: (typeof CREATABLE_STATUSES)[number];
  p_contact_name: string | null;
  p_contact_email: string | null;
  p_whatsapp_phone: string | null;
  p_website: string | null;
  p_brand_primary: string | null;
  p_planned_budget_cents: number;
  p_planned_results: number;
  p_period_start: string | null;
  p_period_end: string | null;
  p_meta_account_id: string | null;
  p_google_customer_id: string | null;
}

/** Campo vazio vira NULL no banco, não string vazia. */
const nullIfBlank = (value: string): string | null =>
  value.trim() === "" ? null : value.trim();

export function toClientPayload(values: NewClientValues): ClientRpcPayload {
  return {
    p_name: values.name.trim(),
    p_segment: values.segment,
    p_status: values.status,
    p_contact_name: nullIfBlank(values.contactName),
    p_contact_email: nullIfBlank(values.contactEmail),
    p_whatsapp_phone: nullIfBlank(values.whatsappPhone),
    p_website: nullIfBlank(values.website),
    /* Não vem mais do formulário: a logo tomou o lugar do seletor de
       cor. Derivada do nome para os quadradinhos de identificação
       continuarem distinguindo cliente nas telas sem imagem. */
    p_brand_primary: brandColorFromName(values.name),
    // A validação já garantiu que converte; o `?? 0` é só para o tipo.
    p_planned_budget_cents: parseCurrencyToCents(values.plannedBudget) ?? 0,
    /* A meta muda de UNIDADE conforme o segmento: loja e delivery a
       definem em faturamento, e o formulário mostrou "R$" no campo. Ler
       "50.000" como cinquenta mil pedidos gravaria uma meta 100× errada
       e o card acusaria 0,02% de execução o mês inteiro.

       A RPC não recebe a unidade — quem a grava é o trigger
       `client_goals_default_metric`, que a deriva do mesmo segmento
       usado aqui. As duas pontas leem a mesma regra. */
    p_planned_results:
      values.plannedResults.trim() === ""
        ? 0
        : (parseGoalInput(
            defaultGoalMetricFor(values.segment),
            values.plannedResults,
          ) ?? 0),
    // NULL faz a função usar o mês corrente.
    p_period_start: null,
    p_period_end: null,
    p_meta_account_id: nullIfBlank(values.metaAccountId),
    p_google_customer_id: nullIfBlank(values.googleCustomerId),
  };
}


/* =====================================================================
   Edição completa da conta
   ---------------------------------------------------------------------
   Um schema só para o formulário inteiro, em vez de um por seção. As
   abas são organização visual; a validação é do cadastro como um todo,
   e é isso que permite ao formulário apontar em QUAL aba está o erro.

   `churned` NÃO entra na lista de status. Encerrar contrato tem ação
   própria, com aviso e página de destino — ver `setClientChurned`.
   Devolvê-lo a um `<select>` faria um salvamento distraído tirar a conta
   da carteira sem que ninguém percebesse, que é exatamente o que aquela
   separação evita.
   ===================================================================== */

export const clientFormSchema = z
  .object({
    clientId: z.string().min(1),

    /* Editável, ao contrário do SLUG. O nome aparece em PDF já
       entregue, mas corrigir "Brazo" para "Brazzo" é necessidade real e
       não quebra nada. O slug está em URL e em link já compartilhado —
       esse continua congelado e nem chega ao formulário. */
    name: z.string().trim().min(2, "Nome: mínimo de 2 caracteres.").max(120),
    legalName: optionalText(160, "Razão social"),

    segment: z.enum(CLIENT_SEGMENTS, { message: "Selecione o nicho." }),
    status: z.enum(EDITABLE_STATUSES, { message: "Selecione o status." }),
    /* TEXTO, não `z.enum`: a lista de agências virou cadastro e um enum
     compilado recusaria toda agência criada depois do deploy. Quem
     garante que o nome existe é a tela, que só oferece o que está
     cadastrado, e o banco, onde `agency_partner` casa com
     `agency_contracts.agency`. */
  agencyPartner: z.string().trim().min(1, { message: "Selecione a agência." }),

    website: optionalText(200, "Site"),
    contactName: optionalText(120, "Contato"),
    contactEmail: z.union([
      z.literal(""),
      z.string().email("E-mail do contato inválido."),
    ]),

    /* 60 e não 30. Um JID de grupo tem ~23 caracteres, mas os antigos
       (`5547999...-1612345678@g.us`) chegam a 28 e o limite anterior
       deixava margem de dois caracteres para um campo que o usuário
       cola. Apertado o bastante para falhar em algum grupo real. */
    whatsappPhone: optionalText(60, "WhatsApp"),

    reportEnabled: z.boolean(),
    reportDay: z
      .number()
      .int()
      .min(1, "O dia vai de 1 a 28.")
      .max(28, "O dia vai de 1 a 28.")
      .nullable(),
    optimizationDay: z.number().int().min(1).max(5).nullable(),
  })
  .refine((v) => !v.reportEnabled || v.reportDay !== null, {
    message: "Escolha o dia do mês para o envio automático.",
    path: ["reportDay"],
  })
  .refine((v) => !v.reportEnabled || v.whatsappPhone.trim() !== "", {
    message: "Sem WhatsApp cadastrado não há para onde enviar.",
    path: ["whatsappPhone"],
  });

export type ClientFormValues = z.infer<typeof clientFormSchema>;

/**
 * Em qual aba mora cada campo.
 *
 * Serve para o formulário marcar a aba que contém erro. Fica aqui, ao
 * lado do schema, porque um campo novo precisa ganhar aba junto com a
 * regra — separados, o campo entra e o erro passa a ser invisível.
 */
export const FIELD_TAB: Record<keyof ClientFormValues, "perfil" | "operacional"> =
  {
    clientId: "perfil",
    name: "perfil",
    legalName: "perfil",
    segment: "perfil",
    status: "perfil",
    agencyPartner: "perfil",
    website: "perfil",
    contactName: "perfil",
    contactEmail: "perfil",
    whatsappPhone: "operacional",
    reportEnabled: "operacional",
    reportDay: "operacional",
    optimizationDay: "operacional",
  };

/** Dias úteis da esteira. Fim de semana fica fora: otimização é
    trabalho de dia útil, e uma coluna que ninguém atende é ruído. */
export const OPTIMIZATION_DAYS = [
  { value: "1", label: "Segunda-feira" },
  { value: "2", label: "Terça-feira" },
  { value: "3", label: "Quarta-feira" },
  { value: "4", label: "Quinta-feira" },
  { value: "5", label: "Sexta-feira" },
] as const;

export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Segunda-feira",
  2: "Terça-feira",
  3: "Quarta-feira",
  4: "Quinta-feira",
  5: "Sexta-feira",
};
