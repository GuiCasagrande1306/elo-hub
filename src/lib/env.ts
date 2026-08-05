/**
 * Configuração de ambiente.
 *
 * O sistema roda em dois modos:
 *
 *  • REAL   — há um projeto Supabase configurado. Auth, RLS e Realtime
 *             ativos, dados vindos do Postgres.
 *  • DEMO   — nenhuma credencial presente. A camada de dados devolve o
 *             dataset de `src/lib/mock`, para que a interface possa ser
 *             avaliada e desenvolvida antes do provisionamento.
 *
 * O modo é derivado, nunca chutado: basta preencher o .env.local para
 * o sistema passar a apontar para o banco real, sem tocar em código.
 */

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

const hasSupabase = Boolean(supabaseUrl && supabaseAnonKey);
const demoRequested = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
// `next build` roda com NODE_ENV=production, então checar só isso
// quebraria o build de quem não tem as credenciais em mãos. A fase de
// build se identifica por NEXT_PHASE — a trava vale para o servidor
// EM EXECUÇÃO, que é onde o vazamento aconteceria.
const isProduction =
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build";

/**
 * ⚠️ Trava de segurança para deploy.
 *
 * Em desenvolvimento, a ausência de credenciais cai em modo demo — é o
 * que faz o projeto rodar com um `npm run dev` e nada mais.
 *
 * Em PRODUÇÃO isso seria perigoso: um deploy em que alguém esqueceu de
 * configurar as variáveis publicaria o sistema inteiro na internet SEM
 * AUTENTICAÇÃO, com o proxy desligado e todas as telas abertas. O modo
 * demo deixaria de ser conveniência e viraria vazamento.
 *
 * Por isso, em produção o demo precisa ser pedido explicitamente. Sem
 * credenciais e sem o pedido, a aplicação falha na inicialização com uma
 * mensagem clara — falhar alto é melhor que servir aberto.
 */
if (isProduction && !hasSupabase && !demoRequested) {
  throw new Error(
    "[elo-hub] Configuração ausente: NEXT_PUBLIC_SUPABASE_URL e " +
      "NEXT_PUBLIC_SUPABASE_ANON_KEY são obrigatórias em produção.\n" +
      "Sem elas a autenticação fica desligada e o sistema serviria dados " +
      "sem login. Configure as variáveis no painel do provedor.\n" +
      "Para publicar uma demonstração pública de propósito, defina " +
      "NEXT_PUBLIC_DEMO_MODE=1 — ciente de que a tela fica aberta a qualquer um.",
  );
}

/** Visível no browser para que os hooks de Realtime saibam se devem conectar. */
export const isDemoMode = demoRequested || !hasSupabase;

/** Segredos exclusivos do servidor — nunca prefixados com NEXT_PUBLIC_. */
export const serverEnv = {
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",

  // Meta Ads (Graph API)
  metaAppId: process.env.META_APP_ID ?? "",
  metaAppSecret: process.env.META_APP_SECRET ?? "",
  metaApiVersion: process.env.META_API_VERSION ?? "v21.0",
  /* Preenchido só quando o app usa "Login do Facebook para empresas",
     onde as permissões vêm de uma configuração salva no painel em vez
     da lista de `scope`. Vazio = fluxo clássico. */
  metaLoginConfigId: process.env.META_LOGIN_CONFIG_ID ?? "",

  // Google Ads API
  googleAdsDeveloperToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
  googleAdsClientId: process.env.GOOGLE_ADS_CLIENT_ID ?? "",
  googleAdsClientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? "",
  googleAdsLoginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "",

  // WhatsApp — ver src/lib/whatsapp/index.ts
  whatsappProvider: (process.env.WHATSAPP_PROVIDER ?? "cloud_api") as
    | "cloud_api"
    | "evolution",
  whatsappToken:
    process.env.EVOLUTION_API_KEY ?? process.env.WHATSAPP_TOKEN ?? "",
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  // Evolution API. Os nomes EVOLUTION_* têm precedência; os
  // WHATSAPP_EVOLUTION_* seguem aceitos para não quebrar quem já
  // configurou antes de o serviço de grupos existir.
  whatsappEvolutionUrl:
    process.env.EVOLUTION_API_URL ?? process.env.WHATSAPP_EVOLUTION_URL ?? "",
  whatsappEvolutionInstance:
    process.env.EVOLUTION_INSTANCE_NAME ??
    process.env.WHATSAPP_EVOLUTION_INSTANCE ??
    "",
  /**
   * Formato do corpo de `sendMedia`, que mudou entre as versões.
   * Explícito porque enviar o corpo errado não produz erro claro —
   * ver `evolutionMediaBody` em lib/whatsapp.
   */
  evolutionApiVersion: (process.env.EVOLUTION_API_VERSION ?? "v2") as
    | "v1"
    | "v2",

  // Renderizador de PDF: "react-pdf" (padrão) ou "puppeteer"
  pdfEngine: (process.env.PDF_ENGINE ?? "react-pdf") as "react-pdf" | "puppeteer",

  // Módulo carregado quando pdfEngine = "puppeteer". Fica aqui, e não
  // inline no require, para que o bundler não consiga dobrar o valor
  // numa string literal e tentar resolver a dependência opcional em
  // tempo de build. Em serverless, apontar para "puppeteer-core".
  puppeteerModule: process.env.PUPPETEER_MODULE ?? "puppeteer",

  // Caminho de um Chrome/Chromium já instalado na máquina. Só é usado
  // fora de serverless e só quando o pacote `puppeteer` completo não
  // está presente — evita baixar 170MB de navegador só para pré-
  // visualizar um relatório em desenvolvimento.
  chromeExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? "",

  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:5210",

  /** Protege as rotas de sincronização chamadas por cron. */
  cronSecret: process.env.CRON_SECRET ?? "",
};

/** Falha cedo e com mensagem útil quando um segredo obrigatório falta. */
export function requireServerEnv<K extends keyof typeof serverEnv>(
  key: K,
): string {
  const value = serverEnv[key];
  if (!value || typeof value !== "string") {
    throw new Error(
      `Variável de ambiente ausente: ${key}. Defina-a em .env.local — veja .env.example.`,
    );
  }
  return value;
}
