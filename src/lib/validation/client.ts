import { z } from "zod";

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

export const STATUS_LABELS: Record<(typeof CREATABLE_STATUSES)[number], string> =
  {
    active: "Ativo",
    onboarding: "Onboarding",
    paused: "Pausado",
  };

/**
 * "5.000,00" | "5000" | "R$ 5.000" → 500000 centavos. `null` = inválido.
 *
 * Aceita o que o brasileiro realmente digita: com ou sem separador de
 * milhar, vírgula ou ponto decimal, com ou sem "R$". Devolver 0 em
 * entrada inválida seria pior que falhar — o usuário acharia que
 * cadastrou a meta e ela viria zerada.
 */
export function parseCurrencyToCents(input: string): number | null {
  const trimmed = input.trim();

  // Campo em branco = "não definir meta agora". É diferente de campo
  // preenchido com lixo.
  if (trimmed === "") return 0;

  const cleaned = trimmed.replace(/[^\d,.]/g, "");

  // O usuário digitou ALGO, mas sem nenhum dígito ("abc", "R$"). Aceitar
  // como zero faria a meta sumir sem aviso — ele sairia da tela achando
  // que cadastrou um orçamento.
  if (!/\d/.test(cleaned)) return null;

  // Com vírgula, ela é o separador decimal (pt-BR) e o ponto é milhar.
  // Sem vírgula, um ponto pode ser qualquer um dos dois — tratamos como
  // decimal só quando sobram 1 ou 2 casas ("1.5" = 1,50; "1.500" = mil
  // e quinhentos).
  let normalized: string;

  if (cleaned.includes(",")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    const parts = cleaned.split(".");
    const isDecimalPoint =
      parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2;
    normalized = isDecimalPoint ? cleaned : cleaned.replace(/\./g, "");
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;

  return Math.round(value * 100);
}

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
  status: z.enum(CREATABLE_STATUSES, { message: "Selecione o status." }),

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

  brandPrimary: z.union([
    z.literal(""),
    z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, "Use um hex de 6 dígitos, como #2F6F4E."),
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
  status: "onboarding",
  contactName: "",
  contactEmail: "",
  whatsappPhone: "",
  website: "",
  brandPrimary: "",
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
    p_brand_primary: nullIfBlank(values.brandPrimary),
    // A validação já garantiu que converte; o `?? 0` é só para o tipo.
    p_planned_budget_cents: parseCurrencyToCents(values.plannedBudget) ?? 0,
    p_planned_results:
      values.plannedResults.trim() === "" ? 0 : Number(values.plannedResults),
    // NULL faz a função usar o mês corrente.
    p_period_start: null,
    p_period_end: null,
    p_meta_account_id: nullIfBlank(values.metaAccountId),
    p_google_customer_id: nullIfBlank(values.googleCustomerId),
  };
}

/* =====================================================================
   Ajustes operacionais — o que dá para corrigir depois do cadastro
   ---------------------------------------------------------------------
   As regras espelham as constraints do banco de propósito. O Postgres
   continua sendo a autoridade (`clients_report_day_valid` e
   `clients_report_needs_day`); aqui é só para o usuário ver o erro no
   formulário em vez de receber uma violação crua.
   ===================================================================== */
export const clientSettingsSchema = z
  .object({
    clientId: z.string().min(1),
    segment: z.enum(CLIENT_SEGMENTS, { message: "Selecione o nicho." }),
    whatsappPhone: optionalText(30, "WhatsApp"),
    reportEnabled: z.boolean(),
    // 1 a 28, não 1 a 31: fevereiro existe, e um cliente agendado no dia
    // 30 nunca receberia nada — falha silenciosa.
    reportDay: z
      .number()
      .int()
      .min(1, "O dia vai de 1 a 28.")
      .max(28, "O dia vai de 1 a 28.")
      .nullable(),
  })
  .refine((v) => !v.reportEnabled || v.reportDay !== null, {
    message: "Escolha o dia do mês para o envio automático.",
    path: ["reportDay"],
  })
  .refine((v) => !v.reportEnabled || v.whatsappPhone.trim() !== "", {
    message: "Sem WhatsApp cadastrado não há para onde enviar.",
    path: ["whatsappPhone"],
  });

export type ClientSettingsValues = z.infer<typeof clientSettingsSchema>;
